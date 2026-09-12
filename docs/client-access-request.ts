import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

export type AccessGateState =
  | { kind: "allowed" }
  | { kind: "denied"; message: string; requestAccess: () => Promise<AccessGateState> }
  | { kind: "pending"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "inactive"; message: string }
  | { kind: "verification-required"; message: string }
  | { kind: "requested"; message: string };

// Call after Google sign-in. Render the returned requestAccess action as an
// explicit "Request Access" button; do not auto-submit on login failure.
export async function checkAccessWithRequestOption(
  firebaseApp: FirebaseApp,
  auth: Auth,
  functions: Functions,
  requestType: "new-account" | "access-request" = "access-request",
): Promise<AccessGateState> {
  const appId = firebaseApp.options.appId;
  if (!appId) throw new Error("This Firebase app has no configured App ID.");

  const checkMyAccess = httpsCallable<{ appId: string }, { allowed: boolean; requestStatus?: "pending" | "approved" | "rejected" }>(functions, "checkMyAccess");
  const check = await checkMyAccess({ appId });
  if (check.data.allowed) return { kind: "allowed" };
  if (check.data.requestStatus === "pending") return { kind: "pending", message: "Your access request is awaiting administrator approval." };
  if (check.data.requestStatus === "rejected") return { kind: "rejected", message: "Your access request was not approved. Contact an administrator if you need this decision reviewed." };
  if (check.data.requestStatus === "approved") return { kind: "inactive", message: "Access was approved, but this account or application is currently inactive. Contact an administrator." };

  return {
    kind: "denied",
    message: "Your account does not currently have access to this application.",
    requestAccess: async () => {
      const requestAppAccess = httpsCallable<{ appId: string; requestType: string }, { status: "created" | "pending" | "approved" | "rejected" | "already-approved" }>(functions, "requestAppAccess");
      let result;
      try {
        result = await requestAppAccess({ appId, requestType });
      } catch (error: unknown) {
        if ((error as { code?: string }).code === "functions/failed-precondition") {
          return { kind: "verification-required", message: "Verify your email address before requesting access to this application." };
        }
        throw error;
      }
      if (result.data.status === "already-approved") return { kind: "allowed" };
      if (result.data.status === "approved") return { kind: "inactive", message: "Access was approved, but this account or application is currently inactive. Contact an administrator." };
      if (result.data.status === "pending") {
        return { kind: "pending", message: "Your access request is awaiting administrator approval." };
      }
      if (result.data.status === "rejected") return { kind: "rejected", message: "Your access request was not approved. Contact an administrator if you need this decision reviewed." };
      await signOut(auth);
      return { kind: "requested", message: "Access request sent. An administrator must approve your account before you can use this application." };
    },
  };
}

// Account creation is authentication only. It never grants app access. Call
// checkAccessWithRequestOption(..., "new-account") and render its explicit
// Request Access action. If the app requires verification, the server returns
// verification-required; then send the email using the helper below.
export async function createPasswordAccountForApproval(auth: Auth, email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  return { user: credential.user, message: "Your account has been created. Account creation does not grant application access; request access to continue." };
}

export async function sendVerificationForPendingAccount(auth: Auth) {
  if (!auth.currentUser) throw new Error("Sign in before requesting email verification.");
  await sendEmailVerification(auth.currentUser);
  return "Verification email sent. Verify your address, sign in again, and request access.";
}
