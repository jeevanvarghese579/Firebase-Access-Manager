# Firebase Access Manager

Admin-only control panel for assigning Google accounts to Firebase web apps in the shared `inter-level-progress-manager` project.

## Architecture

- React + TypeScript frontend hosted at `fir-access-manager-4af8c.web.app`.
- Google sign-in with active admin verification on every privileged callable function.
- Firebase Admin SDK for all access, app-registry, and administrator writes.
- Firebase Management API discovery using the Cloud Functions runtime identity; no privileged key is shipped to the browser.
- Server-only Firestore collections. Client SDK reads and writes to Access Manager data are denied.
- A separate `access-manager` Functions codebase preserves unrelated project functions.

## Data model

- `admins/{uid}` — `email`, `name`, `active`, `createdAt`, `activatedAt`.
- `adminInvites/{normalizedEmail}` — pre-approved admins who have not signed in yet.
- `accessUsers/{normalizedEmail}` — user status plus an `apps` map keyed by Firebase App ID.
- `appRegistry/{firebaseAppId}` — safe discovered metadata and current availability.
- `accessRequests/{requestId}` — immutable request identity/app details, status, timestamps, reviewer, and optional notes.
- `accessRequestKeys/{sha256(uid:appId)}` — server-only uniqueness lock for one pending request per account/app pair; removed after review.

## Backend functions

- `getAdminData` — admin-only dashboard data.
- `listFirebaseWebApps` — admin-only Firebase Management API sync.
- `saveAccessUser` / `deleteAccessUser` — admin-only user permission changes.
- `saveAdmin` / `setAdminStatus` — admin-only administrator management.
- `checkMyAccess` — lets a signed-in Google user check their own assigned access.
- `requestAppAccess` — creates an authenticated request using the verified token identity and a registered Firebase App ID.
- `reviewAccessRequest` — admin-only approval/rejection transaction; approval enables only the requested app.

## Bootstrap the first administrator

The deployed project includes an invite for the Firebase project owner account. On that account's first Google sign-in, the server atomically converts `adminInvites/{email}` into `admins/{uid}`.

For a manual bootstrap, create `admins/{firebase-auth-uid}` in Firestore with:

```json
{
  "email": "owner@example.com",
  "name": "Project Owner",
  "active": true
}
```

The account must use Google sign-in, its token email must be verified, and the document email must match it in lowercase. Never add a public first-user bootstrap route.

## Development and deployment

```bash
npm install
npm --prefix functions install
npm run build
npm --prefix functions run build
firebase deploy --only functions:access-manager,firestore:rules,hosting --project inter-level-progress-manager
```

The Access Manager Functions are deployed on the Blaze plan in the separate `access-manager` codebase.

Enable Google as an Authentication provider. The Firebase Management API (`firebase.googleapis.com`) must be enabled, and the Cloud Functions runtime service account must have permission to list Firebase apps. Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Pub/Sub, and Cloud Run APIs may also be enabled by Firebase during first deployment.

## Existing client app integration

Use `checkMyAccess` after Google sign-in to gate the interface:

```ts
const checkMyAccess = httpsCallable(functions, "checkMyAccess");
const { data } = await checkMyAccess({ appId: firebaseApp.options.appId });
if (!(data as { allowed: boolean }).allowed) {
  await signOut(auth);
  throw new Error("Your Google account is not authorized to use this application.");
}
```

This client check is for navigation and messaging only. Browser-supplied `appId` is not a security boundary. Every protected backend function must enforce the intended app's fixed/server-configured Firebase App ID and verify `accessUsers/{normalizedEmail}.active == true` plus `apps[trustedAppId] == true` before accessing protected data. Firestore rules cannot reliably infer which Firebase web app originated a request.

For the complete explicit **Request Access** button flow, reuse [`docs/client-access-request.ts`](docs/client-access-request.ts). It derives the email and UID exclusively from Firebase Authentication; client apps submit only their configured `firebaseApp.options.appId`. A pending request returns an awaiting-review state instead of creating a duplicate.

## Test checklist

- Approved admin signs in; unapproved Google account is signed out with an authorization error.
- Initial load and **Refresh apps** discover only current web apps.
- Add, edit, disable, revoke, and delete a user; confirm permissions persist.
- Add an existing admin and a never-signed-in admin invite; confirm both flows.
- Confirm ordinary authenticated users cannot read or write the four Access Manager collections directly.
- Confirm `checkMyAccess` denies disabled users, unassigned apps, and unavailable apps.
- Sign in to a client app as an unauthorized user and explicitly request access; confirm one pending request appears in Access Manager.
- Click the request twice and confirm no duplicate pending request is created.
- Approve it and confirm only the requested Firebase App ID becomes enabled; all other permissions remain unchanged.
- Reject another request and confirm its history remains visible while access stays denied.
- Confirm existing shared-project Ascension Manager and `/users/{uid}` behavior still passes after the merged rules deploy.
