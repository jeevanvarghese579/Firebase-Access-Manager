import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import { signOut } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

export type AccessGateState =
  | { kind: "allowed" }
  | { kind: "denied"; message: string; requestAccess: () => Promise<AccessGateState> }
  | { kind: "pending"; message: string }
  | { kind: "requested"; message: string };

// Call after Google sign-in. Render the returned requestAccess action as an
// explicit "Request Access" button; do not auto-submit on login failure.
export async function checkAccessWithRequestOption(
  firebaseApp: FirebaseApp,
  auth: Auth,
  functions: Functions,
): Promise<AccessGateState> {
  const appId = firebaseApp.options.appId;
  if (!appId) throw new Error("This Firebase app has no configured App ID.");

  const checkMyAccess = httpsCallable<{ appId: string }, { allowed: boolean }>(functions, "checkMyAccess");
  const check = await checkMyAccess({ appId });
  if (check.data.allowed) return { kind: "allowed" };

  return {
    kind: "denied",
    message: "Your account does not currently have access to this application.",
    requestAccess: async () => {
      const requestAppAccess = httpsCallable<{ appId: string }, { status: "created" | "pending" | "already-approved" }>(functions, "requestAppAccess");
      const result = await requestAppAccess({ appId });
      if (result.data.status === "already-approved") return { kind: "allowed" };
      if (result.data.status === "pending") {
        return { kind: "pending", message: "Your access request is awaiting administrator approval." };
      }
      await signOut(auth);
      return { kind: "requested", message: "Access request sent. An administrator must approve your account before you can use this application." };
    },
  };
}
