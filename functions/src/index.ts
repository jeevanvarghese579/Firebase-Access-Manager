import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";

if (!getApps().length) initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10, timeoutSeconds: 60 });

const db = getFirestore();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();
const cleanText = (value: unknown, max = 120) => String(value || "").trim().slice(0, max);
const requestKey = (uid: string, appId: string) => createHash("sha256").update(`${uid}:${appId}`).digest("hex");
const expiryMailKey = (kind: string, identity: string, appId: string, expiresAt: number) =>
  `access-${kind}-${createHash("sha256").update(`${identity}:${appId}:${expiresAt}`).digest("hex")}`;

function projectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId as string; }
  catch { throw new HttpsError("internal", "Firebase project configuration is unavailable."); }
}

interface TrustedIdentity {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  providerIds: string[];
  signInProvider: string;
  mayClaimEmailRecords: boolean;
}

const ASCENSION_MANAGER_APP_ID = "1:379503088311:web:7b5117cc3447eded133332";

async function requireIdentity(request: CallableRequest<unknown>): Promise<TrustedIdentity> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in with Firebase Authentication.");
  const user = await getAuth().getUser(request.auth.uid);
  const email = normalizeEmail(user.email || request.auth.token.email);
  if (!email) throw new HttpsError("failed-precondition", "Your Firebase account must have an email address.");
  const providerIds = [...new Set(user.providerData.map((provider) => provider.providerId).filter(Boolean))].sort();
  const emailVerified = user.emailVerified === true;
  const signInProvider = cleanText(request.auth.token.firebase?.sign_in_provider, 80);
  let mayClaimEmailRecords = false;
  try { mayClaimEmailRecords = (await getAuth().getUserByEmail(email)).uid === user.uid; } catch { /* No unique email owner. */ }
  return { uid: user.uid, email, name: cleanText(user.displayName || request.auth.token.name), emailVerified, providerIds, signInProvider, mayClaimEmailRecords };
}

async function resolveUserAccess(identity: TrustedIdentity) {
  const canonicalRef = db.collection("accessUsers").doc(identity.uid);
  const legacyRef = db.collection("accessUsers").doc(identity.email);
  const inviteRef = db.collection("accessInvites").doc(identity.email);
  const ascensionInviteRef = db.collection("invitedEmails").doc(identity.email);
  return db.runTransaction(async (transaction) => {
    const [canonical, legacy, invite, ascensionInvite] = await Promise.all([
      transaction.get(canonicalRef),
      identity.mayClaimEmailRecords && identity.email !== identity.uid ? transaction.get(legacyRef) : Promise.resolve(null),
      identity.mayClaimEmailRecords ? transaction.get(inviteRef) : Promise.resolve(null),
      identity.mayClaimEmailRecords ? transaction.get(ascensionInviteRef) : Promise.resolve(null),
    ]);
    const canonicalData = canonical.data() || {};
    const legacyData = legacy?.data() || {};
    const inviteData = invite?.data() || {};
    const ascensionInviteData = ascensionInvite?.data() || {};
    const shouldMigrate = canonical.exists || legacy?.exists || invite?.exists || ascensionInvite?.exists;
    if (!shouldMigrate) return null;
    const legacyAscensionApps = ascensionInvite?.exists && ascensionInviteData.active === true
      ? { [ASCENSION_MANAGER_APP_ID]: true }
      : {};
    const apps = { ...legacyAscensionApps, ...(legacyData.apps || {}), ...(inviteData.apps || {}), ...(canonicalData.apps || {}) };
    const appExpirations = { ...(legacyData.appExpirations || {}), ...(inviteData.appExpirations || {}), ...(canonicalData.appExpirations || {}) };
    const appExpiryNotices = { ...(legacyData.appExpiryNotices || {}), ...(inviteData.appExpiryNotices || {}), ...(canonicalData.appExpiryNotices || {}) };
    const active = canonical.exists
      ? canonicalData.active === true
      : legacy?.exists
        ? legacyData.active === true
        : invite?.exists
          ? inviteData.active === true
          : ascensionInviteData.active === true;
    const value = {
      uid: identity.uid,
      email: identity.email,
      displayName: cleanText(canonicalData.displayName) || cleanText(legacyData.displayName) || cleanText(inviteData.displayName) || identity.name,
      providerIds: identity.providerIds,
      role: cleanText(canonicalData.role) || cleanText(legacyData.role) || cleanText(inviteData.role) || cleanText(ascensionInviteData.role) || "user",
      active,
      apps,
      appExpirations,
      appExpiryNotices,
      createdAt: canonicalData.createdAt || legacyData.createdAt || inviteData.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(canonicalRef, value, { merge: true });
    if (legacy?.exists && legacyRef.path !== canonicalRef.path) transaction.delete(legacyRef);
    if (invite?.exists) transaction.delete(inviteRef);
    return value;
  });
}

async function requireAdmin(request: CallableRequest<unknown>) {
  const identity = await requireIdentity(request);
  if (!identity.emailVerified) throw new HttpsError("permission-denied", "Administrator email verification is required.");
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

function serializeTimestampMap(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const iso = toIso(item);
    return iso ? [[key, iso]] : [];
  }));
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function serialize(snapshot: FirebaseFirestore.QueryDocumentSnapshot) {
  const value = snapshot.data();
  const publicValue = { ...value };
  delete publicValue.appExpiryNotices;
  return { id: snapshot.id, ...publicValue, appExpirations: serializeTimestampMap(value.appExpirations), createdAt: toIso(value.createdAt), updatedAt: toIso(value.updatedAt), lastSyncedAt: toIso(value.lastSyncedAt) };
}

export const getAdminData = onCall(async (request) => {
  await requireAdmin(request);
  const [users, accessInvites, apps, admins, invites, requests] = await Promise.all([
    db.collection("accessUsers").orderBy("updatedAt", "desc").get(),
    db.collection("accessInvites").orderBy("createdAt", "desc").get(),
    db.collection("appRegistry").orderBy("displayName").get(),
    db.collection("admins").orderBy("createdAt").get(),
    db.collection("adminInvites").orderBy("createdAt").get(),
    db.collection("accessRequests").orderBy("requestedAt", "desc").get(),
  ]);
  return {
    users: [
      ...users.docs.map(serialize),
      ...accessInvites.docs.map((doc) => ({ ...serialize(doc), uid: null, providerIds: [], pendingIdentity: true })),
    ],
    apps: apps.docs.map(serialize),
    admins: [
      ...admins.docs.map((doc) => ({ ...serialize(doc), uid: doc.id, pending: false })),
      ...invites.docs.map((doc) => ({ ...serialize(doc), pending: true })),
    ],
    requests: requests.docs.map(serialize),
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
  const existingById = new Map(existing.docs.map((doc) => [doc.id, doc.data()]));
  const batch = db.batch();
  existing.docs.forEach((doc) => batch.set(doc.ref, { active: false, lastSyncedAt: FieldValue.serverTimestamp() }, { merge: true }));
  apps.forEach((app) => batch.set(db.collection("appRegistry").doc(app.appId), {
    firebaseAppId: app.appId,
    displayName: cleanText(app.displayName) || "Unnamed Firebase app",
    projectId: app.projectId || projectId(),
    platform: "WEB",
    state: app.state || "STATE_UNSPECIFIED",
    active: app.state !== "DELETED",
    requireEmailVerification: existingById.get(app.appId)?.requireEmailVerification === true,
    lastSyncedAt: FieldValue.serverTimestamp(),
  }, { merge: true }));
  await batch.commit();
  return { apps: apps.map((app) => ({ firebaseAppId: app.appId, displayName: app.displayName || "Unnamed Firebase app", projectId: app.projectId || projectId(), platform: "WEB", active: app.state !== "DELETED", state: app.state })) };
});

export const setAppSettings = onCall(async (request) => {
  await requireAdmin(request);
  const input = (request.data || {}) as { firebaseAppId?: unknown; requireEmailVerification?: unknown };
  const firebaseAppId = cleanText(input.firebaseAppId, 256);
  if (!firebaseAppId || typeof input.requireEmailVerification !== "boolean") throw new HttpsError("invalid-argument", "A valid Firebase App ID and email-verification setting are required.");
  const ref = db.collection("appRegistry").doc(firebaseAppId);
  const app = await ref.get();
  if (!app.exists || app.data()?.platform !== "WEB") throw new HttpsError("not-found", "Firebase web app not found in the registry.");
  await ref.set({ requireEmailVerification: input.requireEmailVerification, settingsUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, requireEmailVerification: input.requireEmailVerification };
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
  let authUser: UserRecord | undefined;
  try { authUser = await getAuth().getUserByEmail(email); } catch (error: unknown) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
  }
  const requestedId = cleanText(input.id, 256);
  const knownUid = requestedId && requestedId !== email && !input.pendingIdentity ? requestedId : authUser?.uid;
  if (knownUid) {
    const ref = db.collection("accessUsers").doc(knownUid);
    const current = await ref.get();
    const providerIds = authUser?.uid === knownUid ? [...new Set(authUser.providerData.map((provider) => provider.providerId))].sort() : current.data()?.providerIds || [];
    await ref.set({ uid: knownUid, email, displayName: cleanText(input.displayName), providerIds, role: cleanText(current.data()?.role) || "user", active: input.active === true, apps, appExpirations: current.data()?.appExpirations || {}, appExpiryNotices: current.data()?.appExpiryNotices || {}, createdAt: current.exists ? current.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await db.collection("accessInvites").doc(email).delete();
    if (requestedId === email && knownUid !== email) await db.collection("accessUsers").doc(email).delete();
  } else {
    const ref = db.collection("accessInvites").doc(email);
    const current = await ref.get();
    await ref.set({ email, displayName: cleanText(input.displayName), role: cleanText(current.data()?.role) || "user", active: input.active === true, apps, appExpirations: current.data()?.appExpirations || {}, appExpiryNotices: current.data()?.appExpiryNotices || {}, createdAt: current.exists ? current.data()?.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  }
  return { ok: true };
});

export const setUserAppAccess = onCall(async (request) => {
  await requireAdmin(request);
  const input = (request.data || {}) as Record<string, unknown>;
  const email = normalizeEmail(input.email);
  const appId = cleanText(input.firebaseAppId, 256);
  const expiresOn = cleanText(input.expiresOn, 10);
  const enabled = input.enabled === true;
  if (!emailPattern.test(email) || !appId) throw new HttpsError("invalid-argument", "A valid email and Firebase App ID are required.");
  const app = await db.collection("appRegistry").doc(appId).get();
  if (!app.exists || app.data()?.platform !== "WEB") throw new HttpsError("not-found", "Firebase web app not found in the registry.");

  let expiresAt: Timestamp | null = null;
  if (expiresOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new HttpsError("invalid-argument", "Expiry must be a valid date.");
    const expiryDate = new Date(`${expiresOn}T23:59:59.999+05:30`);
    if (Number.isNaN(expiryDate.valueOf())) throw new HttpsError("invalid-argument", "Expiry must be a valid date.");
    expiresAt = Timestamp.fromDate(expiryDate);
    if (enabled && expiresAt.toMillis() <= Date.now()) throw new HttpsError("invalid-argument", "Choose a future expiry date before enabling access.");
  }

  let authUser: UserRecord | undefined;
  try { authUser = await getAuth().getUserByEmail(email); } catch (error: unknown) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
  }
  const requestedId = cleanText(input.id, 256);
  const pendingIdentity = input.pendingIdentity === true;
  const uid = authUser?.uid || (!pendingIdentity && requestedId && requestedId !== email ? requestedId : "");
  const ref = uid ? db.collection("accessUsers").doc(uid) : db.collection("accessInvites").doc(email);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const value = current.data() || {};
    const apps = { ...(value.apps || {}), [appId]: enabled };
    const appExpirations = { ...(value.appExpirations || {}) } as Record<string, Timestamp>;
    const appExpiryNotices = { ...(value.appExpiryNotices || {}) } as Record<string, unknown>;
    if (expiresAt) appExpirations[appId] = expiresAt;
    else delete appExpirations[appId];
    delete appExpiryNotices[appId];
    transaction.set(ref, {
      ...(uid ? { uid } : {}),
      email,
      displayName: cleanText(value.displayName) || cleanText(input.displayName) || cleanText(authUser?.displayName),
      providerIds: uid && authUser?.uid === uid ? [...new Set(authUser.providerData.map((provider) => provider.providerId))].sort() : value.providerIds || [],
      role: cleanText(value.role) || "user",
      active: current.exists ? value.active !== false : true,
      apps,
      appExpirations,
      appExpiryNotices,
      createdAt: current.exists ? value.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  if (uid) await db.collection("accessInvites").doc(email).delete();
  return { ok: true, pendingIdentity: !uid };
});

export const deleteAccessUser = onCall(async (request) => {
  await requireAdmin(request);
  const input = (request.data || {}) as { id?: unknown; email?: unknown; pendingIdentity?: unknown };
  const email = normalizeEmail(input.email);
  if (!emailPattern.test(email)) throw new HttpsError("invalid-argument", "A valid email is required.");
  const id = cleanText(input.id, 256);
  if (input.pendingIdentity === true) await db.collection("accessInvites").doc(email).delete();
  else await db.collection("accessUsers").doc(id || email).delete();
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
  const identity = await requireIdentity(request);
  const appId = cleanText((request.data as { appId?: unknown } | undefined)?.appId, 256);
  if (!appId) throw new HttpsError("invalid-argument", "Firebase App ID is required.");
  await resolveUserAccess(identity);
  const [user, app] = await Promise.all([
    db.collection("accessUsers").doc(identity.uid).get(),
    db.collection("appRegistry").doc(appId).get(),
  ]);
  const expiresAt = timestampMillis(user.data()?.appExpirations?.[appId]);
  const unexpired = expiresAt === null || expiresAt > Date.now();
  const allowed = user.exists && user.data()?.active === true && user.data()?.apps?.[appId] === true && unexpired && app.exists && app.data()?.active === true;
  const resolvedPermission = {
    userDocumentPath: `accessUsers/${identity.uid}`,
    userExists: user.exists,
    userActive: user.data()?.active === true,
    appPermission: user.data()?.apps?.[appId] === true,
    appAccessExpiresAt: toIso(user.data()?.appExpirations?.[appId]) || null,
    appAccessExpired: !unexpired,
    appDocumentPath: `appRegistry/${appId}`,
    appExists: app.exists,
    appActive: app.data()?.active === true,
  };
  const canonicalAccessDocument = {
    path: `accessUsers/${identity.uid}`,
    uid: cleanText(user.data()?.uid) || identity.uid,
    email: normalizeEmail(user.data()?.email),
    active: user.data()?.active === true,
    role: cleanText(user.data()?.role) || null,
    apps: { [appId]: user.data()?.apps?.[appId] === true },
  };
  console.info("Access check resolved", { uid: identity.uid, email: identity.email, appId, allowed, canonicalAccessDocument, ...resolvedPermission });
  const state = allowed ? null : await db.collection("accessRequestKeys").doc(requestKey(identity.uid, appId)).get();
  return {
    allowed,
    active: user.data()?.active === true,
    requestStatus: state?.data()?.status || null,
    uid: identity.uid,
    providerIds: identity.providerIds,
    signInProvider: identity.signInProvider,
    emailVerified: identity.emailVerified,
    requireEmailVerification: app.exists && app.data()?.requireEmailVerification === true,
    resolvedPermission,
    canonicalAccessDocument,
    role: cleanText(user.data()?.role) || null,
  };
});

export const requestAppAccess = onCall(async (request) => {
  const identity = await requireIdentity(request);
  const input = (request.data || {}) as { appId?: unknown; message?: unknown; requestType?: unknown };
  const appId = cleanText(input.appId, 256);
  const message = cleanText(input.message, 500);
  const requestType = input.requestType === "new-account" ? "new-account" : "access-request";
  if (!appId) throw new HttpsError("invalid-argument", "Firebase App ID is required.");

  await resolveUserAccess(identity);
  const appRef = db.collection("appRegistry").doc(appId);
  const userRef = db.collection("accessUsers").doc(identity.uid);
  const keyRef = db.collection("accessRequestKeys").doc(requestKey(identity.uid, appId));
  const newRequestRef = db.collection("accessRequests").doc();

  return db.runTransaction(async (transaction) => {
    const [app, user, key] = await Promise.all([
      transaction.get(appRef),
      transaction.get(userRef),
      transaction.get(keyRef),
    ]);
    if (!app.exists || app.data()?.active !== true) throw new HttpsError("not-found", "This Firebase web app is not available for access requests.");
    if (app.data()?.requireEmailVerification === true && identity.signInProvider === "password" && !identity.emailVerified) {
      throw new HttpsError("failed-precondition", "Verify your email address before requesting access to this application.");
    }
    const expiresAt = timestampMillis(user.data()?.appExpirations?.[appId]);
    if (user.exists && user.data()?.active === true && user.data()?.apps?.[appId] === true && (expiresAt === null || expiresAt > Date.now())) return { status: "already-approved" };

    if (key.exists) {
      const existingId = cleanText(key.data()?.requestId, 256);
      if (existingId) {
        const existing = await transaction.get(db.collection("accessRequests").doc(existingId));
        if (existing.exists && existing.data()?.status === "pending") return { status: "pending", requestId: existingId };
        if (existing.exists && existing.data()?.status === "rejected") return { status: "rejected", requestId: existingId };
        if (existing.exists && existing.data()?.status === "approved") return { status: "approved", requestId: existingId };
      }
    }

    const keyHash = requestKey(identity.uid, appId);
    transaction.create(newRequestRef, {
      email: identity.email,
      uid: identity.uid,
      displayName: identity.name,
      providerIds: identity.providerIds,
      firebaseAppId: appId,
      appDisplayName: cleanText(app.data()?.displayName) || "Unnamed Firebase app",
      status: "pending",
      requestType,
      requestedAt: FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null,
      reviewedByEmail: null,
      message,
      keyHash,
    });
    transaction.set(keyRef, { requestId: newRequestRef.id, uid: identity.uid, firebaseAppId: appId, status: "pending", createdAt: FieldValue.serverTimestamp() });
    return { status: "created", requestId: newRequestRef.id };
  });
});

export const reviewAccessRequest = onCall(async (request) => {
  const admin = await requireAdmin(request);
  const input = (request.data || {}) as { requestId?: unknown; decision?: unknown; note?: unknown };
  const requestId = cleanText(input.requestId, 256);
  const decision = cleanText(input.decision, 20);
  const note = cleanText(input.note, 500);
  if (!requestId || !["approved", "rejected"].includes(decision)) throw new HttpsError("invalid-argument", "A valid request and decision are required.");

  const accessRequestRef = db.collection("accessRequests").doc(requestId);
  return db.runTransaction(async (transaction) => {
    const accessRequest = await transaction.get(accessRequestRef);
    if (!accessRequest.exists) throw new HttpsError("not-found", "Access request not found.");
    const value = accessRequest.data()!;
    if (value.status !== "pending") throw new HttpsError("failed-precondition", "This access request has already been reviewed.");

    if (decision === "approved") {
      const email = normalizeEmail(value.email);
      const uid = cleanText(value.uid, 256);
      const appId = cleanText(value.firebaseAppId, 256);
      if (!emailPattern.test(email) || !uid || !appId) throw new HttpsError("failed-precondition", "The request contains invalid account or app data.");
      const userRef = db.collection("accessUsers").doc(uid);
      const user = await transaction.get(userRef);
      const existing = user.data() || {};
      const appExpirations = { ...(existing.appExpirations || {}) } as Record<string, Timestamp>;
      const appExpiryNotices = { ...(existing.appExpiryNotices || {}) } as Record<string, unknown>;
      delete appExpirations[appId];
      delete appExpiryNotices[appId];
      transaction.set(userRef, {
        uid,
        email,
        displayName: cleanText(existing.displayName) || cleanText(value.displayName),
        providerIds: Array.isArray(value.providerIds) ? value.providerIds : existing.providerIds || [],
        role: cleanText(existing.role) || "user",
        active: user.exists ? existing.active === true : true,
        apps: { ...(existing.apps || {}), [appId]: true },
        appExpirations,
        appExpiryNotices,
        createdAt: user.exists ? existing.createdAt || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.update(accessRequestRef, {
      status: decision,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: admin.uid,
      reviewedByEmail: admin.email,
      reviewNote: note,
    });
    if (value.keyHash) transaction.set(db.collection("accessRequestKeys").doc(String(value.keyHash)), { requestId, uid: value.uid, firebaseAppId: value.firebaseAppId, status: decision, reviewedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { status: decision };
  });
});

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

async function processExpiryDocument(ref: FirebaseFirestore.DocumentReference, appNames: Map<string, string>, now: number) {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const value = snapshot.data() || {};
    const email = normalizeEmail(value.email);
    if (!emailPattern.test(email)) return;
    const apps = { ...(value.apps || {}) } as Record<string, boolean>;
    const notices = { ...(value.appExpiryNotices || {}) } as Record<string, { expiresAt?: number; warningQueuedAt?: unknown; expiredQueuedAt?: unknown }>;
    const actions: Array<{ kind: "warning" | "expired"; appId: string; expiresAt: number; mailRef: FirebaseFirestore.DocumentReference }> = [];
    for (const [appId, rawExpiry] of Object.entries(value.appExpirations || {})) {
      const expiresAt = timestampMillis(rawExpiry);
      if (!expiresAt || apps[appId] !== true) continue;
      const notice = notices[appId] || {};
      if (expiresAt <= now && (notice.expiresAt !== expiresAt || !notice.expiredQueuedAt)) {
        actions.push({ kind: "expired", appId, expiresAt, mailRef: db.collection("mail").doc(expiryMailKey("expired", ref.path, appId, expiresAt)) });
      } else if (expiresAt <= now + TEN_DAYS_MS && (notice.expiresAt !== expiresAt || !notice.warningQueuedAt)) {
        actions.push({ kind: "warning", appId, expiresAt, mailRef: db.collection("mail").doc(expiryMailKey("warning", ref.path, appId, expiresAt)) });
      }
    }
    if (!actions.length) return;
    const mailSnapshots = await Promise.all(actions.map((action) => transaction.get(action.mailRef)));
    actions.forEach((action, index) => {
      const appName = appNames.get(action.appId) || "your application";
      const date = new Date(action.expiresAt).toLocaleDateString("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" });
      if (action.kind === "expired") apps[action.appId] = false;
      const previous = notices[action.appId]?.expiresAt === action.expiresAt ? notices[action.appId] : {};
      notices[action.appId] = {
        ...previous,
        expiresAt: action.expiresAt,
        ...(action.kind === "warning" ? { warningQueuedAt: FieldValue.serverTimestamp() } : { expiredQueuedAt: FieldValue.serverTimestamp() }),
      };
      if (!mailSnapshots[index].exists) transaction.create(action.mailRef, {
        to: [email],
        message: action.kind === "warning" ? {
          subject: `${appName} access expires soon`,
          text: `Your access to ${appName} will expire on ${date}. Please contact the administrator if you need to renew it.`,
        } : {
          subject: `${appName} access has expired`,
          text: `Your access to ${appName} expired on ${date} and has now been disabled. Please contact the administrator if you need to renew it.`,
        },
        accessManager: { kind: action.kind, appId: action.appId, expiresAt: Timestamp.fromMillis(action.expiresAt), identityPath: ref.path },
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    transaction.update(ref, { apps, appExpiryNotices: notices, updatedAt: FieldValue.serverTimestamp() });
  });
}

export const processAccessExpirations = onSchedule({ schedule: "every 1 hours", timeZone: "Asia/Kolkata" }, async () => {
  const [apps, users, invites] = await Promise.all([
    db.collection("appRegistry").get(),
    db.collection("accessUsers").get(),
    db.collection("accessInvites").get(),
  ]);
  const appNames = new Map(apps.docs.map((doc) => [doc.id, cleanText(doc.data().displayName) || "your application"]));
  const documents = [...users.docs, ...invites.docs];
  for (let index = 0; index < documents.length; index += 20) {
    await Promise.all(documents.slice(index, index + 20).map((doc) => processExpiryDocument(doc.ref, appNames, Date.now())));
  }
  console.info("Access expiration scan complete", { documents: documents.length });
});
