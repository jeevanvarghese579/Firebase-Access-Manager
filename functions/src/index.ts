import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { GoogleAuth } from "google-auth-library";

if (!getApps().length) initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10, timeoutSeconds: 60 });

const db = getFirestore();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const cleanText = (value: unknown, max = 120) => String(value || "").trim().slice(0, max);

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId as string; }
  catch { throw new HttpsError("internal", "Firebase project configuration is unavailable."); }
}

function requireGoogleIdentity(request: CallableRequest<unknown>) {
  const email = normalizeEmail(request.auth?.token.email);
  if (!request.auth || !email || request.auth.token.email_verified !== true || request.auth.token.firebase?.sign_in_provider !== "google.com") {
    throw new HttpsError("unauthenticated", "Sign in with a verified Google account.");
  }
  return { uid: request.auth.uid, email, name: cleanText(request.auth.token.name) };
}

async function requireAdmin(request: CallableRequest<unknown>) {
  const identity = requireGoogleIdentity(request);
  const adminRef = db.collection("admins").doc(identity.uid);
  const admin = await adminRef.get();
  if (admin.exists && admin.data()?.active === true && normalizeEmail(admin.data()?.email) === identity.email) return identity;

  const inviteRef = db.collection("adminInvites").doc(identity.email);
  const invite = await inviteRef.get();
  if (invite.exists && invite.data()?.active === true) {
    await db.runTransaction(async (transaction) => {
      const freshInvite = await transaction.get(inviteRef);
      if (!freshInvite.exists || freshInvite.data()?.active !== true) throw new HttpsError("permission-denied", "Administrator invitation is no longer active.");
      transaction.set(adminRef, {
        email: identity.email,
        name: cleanText(freshInvite.data()?.name) || identity.name,
        active: true,
        createdAt: freshInvite.data()?.createdAt || FieldValue.serverTimestamp(),
        activatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(inviteRef);
    });
    return identity;
  }
  throw new HttpsError("permission-denied", "You are not authorized to access this administration panel.");
}

function toIso(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : undefined;
}

function serialize(snapshot: FirebaseFirestore.QueryDocumentSnapshot) {
  const value = snapshot.data();
  return { id: snapshot.id, ...value, createdAt: toIso(value.createdAt), updatedAt: toIso(value.updatedAt), lastSyncedAt: toIso(value.lastSyncedAt) };
}

export const getAdminData = onCall(async (request) => {
  await requireAdmin(request);
  const [users, apps, admins, invites] = await Promise.all([
    db.collection("accessUsers").orderBy("updatedAt", "desc").get(),
    db.collection("appRegistry").orderBy("displayName").get(),
    db.collection("admins").orderBy("createdAt").get(),
    db.collection("adminInvites").orderBy("createdAt").get(),
  ]);
  return {
    users: users.docs.map(serialize),
    apps: apps.docs.map(serialize),
    admins: [
      ...admins.docs.map((doc) => ({ ...serialize(doc), uid: doc.id, pending: false })),
      ...invites.docs.map((doc) => ({ ...serialize(doc), pending: true })),
    ],
  };
});

interface FirebaseWebApp { appId: string; displayName?: string; projectId?: string; state?: string; }

async function fetchFirebaseWebApps() {
  const id = projectId();
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new HttpsError("internal", "The server could not obtain Firebase Management API credentials.");
  const apps: FirebaseWebApp[] = [];
  let pageToken = "";
  do {
    const url = new URL(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(id)}/webApps`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.token}` } });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Firebase Management API error", response.status, detail);
      throw new HttpsError("failed-precondition", "Unable to retrieve Firebase web apps. Verify that the Firebase Management API is enabled and the function runtime can view project apps.");
    }
    const payload = await response.json() as { apps?: FirebaseWebApp[]; nextPageToken?: string };
    apps.push(...(payload.apps || []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return apps;
}

export const listFirebaseWebApps = onCall(async (request) => {
  await requireAdmin(request);
  const apps = await fetchFirebaseWebApps();
  const existing = await db.collection("appRegistry").get();
  const batch = db.batch();
  existing.docs.forEach((doc) => batch.set(doc.ref, { active: false, lastSyncedAt: FieldValue.serverTimestamp() }, { merge: true }));
  apps.forEach((app) => batch.set(db.collection("appRegistry").doc(app.appId), {
    firebaseAppId: app.appId,
    displayName: cleanText(app.displayName) || "Unnamed Firebase app",
    projectId: app.projectId || projectId(),
    platform: "WEB",
    state: app.state || "STATE_UNSPECIFIED",
    active: app.state !== "DELETED",
    lastSyncedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));
  await batch.commit();
  return { apps: apps.map((app) => ({ firebaseAppId: app.appId, displayName: app.displayName || "Unnamed Firebase app", projectId: app.projectId || projectId(), platform: "WEB", active: app.state !== "DELETED", state: app.state })) };
});

export const saveAccessUser = onCall(async (request) => {
  await requireAdmin(request);
  const input = (request.data || {}) as Record<string, unknown>;
  const email = normalizeEmail(input.email);
  if (!emailPattern.test(email)) throw new HttpsError("invalid-argument", "Enter a valid email address.");
  const requestedApps = input.apps && typeof input.apps === "object" ? input.apps as Record<string, unknown> : {};
  const appDocs = await db.collection("appRegistry").get();
  const allowedIds = new Set(appDocs.docs.map((doc) => doc.id));
  const apps: Record<string, boolean> = {};
  for (const [id, enabled] of Object.entries(requestedApps)) if (allowedIds.has(id)) apps[id] = enabled === true;
  const ref = db.collection("accessUsers").doc(email);
  const current = await ref.get();
  await ref.set({
    email,
    displayName: cleanText(input.displayName),
    role: "user",
    active: input.active === true,
    apps,
    createdAt: current.exists ? current.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const deleteAccessUser = onCall(async (request) => {
  await requireAdmin(request);
  const email = normalizeEmail((request.data as { email?: unknown } | undefined)?.email);
  if (!emailPattern.test(email)) throw new HttpsError("invalid-argument", "A valid email is required.");
  await db.collection("accessUsers").doc(email).delete();
  return { ok: true };
});

export const saveAdmin = onCall(async (request) => {
  await requireAdmin(request);
  const input = (request.data || {}) as Record<string, unknown>;
  const email = normalizeEmail(input.email);
  const name = cleanText(input.name);
  if (!emailPattern.test(email)) throw new HttpsError("invalid-argument", "Enter a valid email address.");
  try {
    const user = await getAuth().getUserByEmail(email);
    await db.collection("admins").doc(user.uid).set({ email, name: name || user.displayName || "", active: true, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    await db.collection("adminInvites").doc(email).set({ email, name, active: true, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return { ok: true };
});

export const setAdminStatus = onCall(async (request) => {
  const caller = await requireAdmin(request);
  const input = (request.data || {}) as { id?: unknown; pending?: unknown; active?: unknown };
  const id = cleanText(input.id, 256);
  const active = input.active === true;
  if (!id) throw new HttpsError("invalid-argument", "Administrator identifier is required.");
  if (!input.pending && id === caller.uid && !active) throw new HttpsError("failed-precondition", "You cannot disable your own administrator account.");
  const collection = input.pending ? "adminInvites" : "admins";
  await db.collection(collection).doc(id).set({ active, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true };
});

export const checkMyAccess = onCall(async (request) => {
  const identity = requireGoogleIdentity(request);
  const appId = cleanText((request.data as { appId?: unknown } | undefined)?.appId, 256);
  if (!appId) throw new HttpsError("invalid-argument", "Firebase App ID is required.");
  const [user, app] = await Promise.all([
    db.collection("accessUsers").doc(identity.email).get(),
    db.collection("appRegistry").doc(appId).get(),
  ]);
  const allowed = user.exists && user.data()?.active === true && user.data()?.apps?.[appId] === true && app.exists && app.data()?.active === true;
  return { allowed, active: user.data()?.active === true };
});
