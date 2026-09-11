# Firebase Access Manager

Admin-only control panel for assigning Firebase Authentication users to Firebase web apps in the shared `inter-level-progress-manager` project. Google, email/password, and linked-provider accounts use the same authorization workflow.

## Architecture

- React + TypeScript frontend hosted at `fir-access-manager-4af8c.web.app`.
- Firebase Authentication establishes identity; Access Manager separately grants per-app authorization.
- Active admin verification runs on every privileged callable function.
- Firebase Admin SDK supplies trusted UID, normalized email, and provider data. Passwords never enter Access Manager.
- Firebase Management API discovery uses the Cloud Functions runtime identity; no privileged key is shipped to browsers.
- Access Manager collections are server-only under Firestore Rules.
- The separate `access-manager` Functions codebase preserves unrelated project functions.

## Data model

- `admins/{uid}` — administrator email, name, status, and timestamps.
- `adminInvites/{normalizedEmail}` — pre-approved administrators who have not signed in.
- `accessUsers/{uid}` — canonical UID, normalized email, display name, provider IDs, global status, and an `apps` map keyed by Firebase App ID.
- `accessInvites/{normalizedEmail}` — pre-approved app permissions for someone without a Firebase UID.
- `appRegistry/{firebaseAppId}` — safe discovered app metadata and availability.
- `accessRequests/{requestId}` — trusted identity/provider data, requested app, request type, status, timestamps, reviewer, and notes.
- `accessRequestKeys/{sha256(uid:appId)}` — current request state and uniqueness lock for one UID/app pair.

## Backend functions

- `getAdminData` — admin-only dashboard, user, provider, app, and request data.
- `listFirebaseWebApps` — admin-only Firebase Management API sync.
- `saveAccessUser` / `deleteAccessUser` — admin-only UID access or email preapproval management.
- `saveAdmin` / `setAdminStatus` — admin-only administrator management.
- `checkMyAccess` — lets any authenticated Firebase user check their UID-based access and request state.
- `requestAppAccess` — creates a request using identity/provider data fetched from Firebase Admin.
- `reviewAccessRequest` — admin-only approval/rejection transaction; approval enables only the requested app.

## Bootstrap the first administrator

The deployed project includes an invite for the Firebase project owner. At first sign-in the server converts `adminInvites/{email}` into `admins/{uid}`. A manual bootstrap can create `admins/{firebase-auth-uid}` with a matching lowercase `email`, `name`, and `active: true`. Never add a public first-user bootstrap route.

## Development and deployment

```bash
npm install
npm --prefix functions install
npm run build
npm --prefix functions run build
firebase deploy --only functions:access-manager,firestore:rules,hosting --project inter-level-progress-manager
```

Enable the desired Firebase Authentication providers (Google and/or Email/Password). The Firebase Management API (`firebase.googleapis.com`) must be enabled, and the Functions runtime identity must be able to list Firebase apps.

## Client integration

Call `checkMyAccess` after every Firebase sign-in:

```ts
const checkMyAccess = httpsCallable(functions, "checkMyAccess");
const { data } = await checkMyAccess({ appId: firebaseApp.options.appId });
if ((data as { allowed: boolean }).allowed) openApplication();
else showPendingRejectedOrRequestAccessScreen();
```

The client check gates navigation only. Browser-supplied `appId` is not a security boundary. Every protected app backend must enforce its fixed/server-configured Firebase App ID and verify `accessUsers/{request.auth.uid}.active == true` plus `apps[trustedAppId] == true`.

Reuse [`docs/client-access-request.ts`](docs/client-access-request.ts) for the explicit **Request Access** button and password-signup flow. UID, email, verification state, and providers come only from Firebase Admin. Clients submit their configured App ID and a display-only request type. Existing pending/rejected states do not produce duplicate requests.

Password signup deliberately separates account creation from authorization: create the Firebase account, send the verification email, sign out, and let the verified user sign in and explicitly request access. Unverified password users cannot create new requests. This does not retroactively disable existing legacy approvals.

## UID migration and provider linking

Existing email-keyed `accessUsers` records migrate lazily and idempotently when their authenticated user calls the backend. Firebase Admin must confirm that `getUserByEmail(email)` resolves to the same UID before an email-keyed legacy approval or invite can be claimed. Permissions are merged into `accessUsers/{uid}` and the claimed legacy/invite record is removed. There is no blind bulk migration.

Providers securely linked in Firebase Authentication share one UID and therefore one Access Manager record. Different UIDs are never merged merely because their email strings match; linking must use Firebase Authentication's reauthentication/linking APIs.

Rejecting an app request only updates request history and grants nothing. It never deletes or disables the Firebase Authentication account. Because this project is shared, Auth-account deletion is intentionally not exposed here. If later required, implement a separate admin-only callable using `admin.auth().deleteUser(uid)`, require explicit UID confirmation, audit the actor/time, and keep it independent from rejection and access-record deletion.

## Test checklist

- New Google user signs in, requests one app, and remains pending until approval.
- New Gmail and non-Gmail email/password users see “account created” separately from approval, verify email, then request access.
- Unverified password users cannot create an access request.
- Existing approved Google users retain and lazily migrate their permissions.
- Pre-approved email claims only its invited app permissions after unique UID/email verification.
- Approval enables only the requested app and preserves all other permissions.
- Rejection remains in history, grants nothing, and does not delete the Auth account.
- Repeated request clicks for one UID/app do not create duplicates.
- Google and Password providers linked to the same UID use one access record.
- Different UIDs are never merged only because an email matches.
- Ordinary authenticated users cannot directly modify Access Manager collections.
- Existing shared-project rules and unrelated functions continue to operate.
