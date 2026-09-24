# Firebase Namespace Migration Report

Completed: 2026-09-24 (Asia/Calcutta)

## Outcome

Application code for all 13 Firebase data-using repositories now targets an application-owned namespace. Photo Resizer / FrameFit and Certificate Printer were audited and required no data-path change. Shared Firestore/Storage policy is owned only by Firebase Access Manager. No legacy production document or object was copied, updated, normalized, moved, or deleted.

Canonical shapes:

- Per-user Firestore: `apps/{appKey}/users/{uid}/...`
- App-wide Firestore: `apps/{appKey}/data/...`
- Per-user Storage: `apps/{appKey}/users/{uid}/...`

## Migration matrix

| Repository | App key | Legacy path(s) | Canonical path(s) | Branch / implementation commit | Build | Status |
|---|---|---|---|---|---|---|
| School Academics Manager | `schoolAcademicsManager` | `users/{uid}/{settings,classes,students,exams,examMarks,plusOneMarks,assignments,assignmentStatuses,graceMarks,combinedAnalyses}` | `apps/schoolAcademicsManager/users/{uid}/...` | `firebase-namespace-isolation` / `ceb5d8ec9c493d1818b17d6105573c3fbe885335` | Pass | Repository paths, erase/restore scope, and backup identity isolated. |
| Ascension Manager | `ascensionManager` | `ascensionManagerUsers/{uid}/...` | `apps/ascensionManager/users/{uid}/...` | `firebase-namespace-isolation` / `ca97aa4f2a32fb06a3d8a6fd5d25eb9d62fa087d` | Pass | Entitlement retained; backup identity added. |
| Firebase Access Manager | `firebaseAccessManager` | Global control plane | Control plane intentionally remains global; canonical shared rules live here | `firebase-namespace-isolation` / `dd9f193d83e59a45f6eeb63f4d4c017fa57e0da7` | Pass | Canonical rules/indexes/Storage owner, tests, audit, analyzer, and plans added. |
| School Exams Manager | `schoolExamsManager` | `users/{uid}/projects` | `apps/schoolExamsManager/users/{uid}/projects` | `firebase-namespace-isolation` / `40ed0719ffe6297ebaccf9a0e7d33adaa70b17e0` | Pass | CRUD centralized through path helpers. |
| School Fest Pro | `schoolFestPro` | `schoolFestProUsers/{uid}/data/main`; historical `users/{uid}/schoolFestData/main` | `apps/schoolFestPro/users/{uid}/data/main` | `firebase-namespace-isolation` / `4c649eb3616740d8b9c061e134c09cdb3dd1b6a4` | Pass | Automatic legacy copy removed; reset and restore are app-scoped; backup identity added. |
| Photo Resizer / FrameFit | `photoResizerFramefit` | None | None | `main` / no change (`ae41f0537b3fe4669535099aef77a576433180d6`) | Pass | Authentication/hosting only; no business Firestore or Storage usage found. |
| School Bell Manager | `schoolBellManager` | `users/{uid}/{profiles,sounds,settings}`; Storage `users/{uid}/sounds/...` | `apps/schoolBellManager/users/{uid}/...` | `firebase-namespace-isolation` / `42e9b35486b8d3ff5692b6e6e07f3eed895c8d76` | Pass | Firestore and Storage helpers centralized. |
| Gym Tracker | `gymTracker` | `users/{uid}/{settings,workouts}` | `apps/gymTracker/users/{uid}/...` | `firebase-namespace-isolation` / `f2bf046dc6910462e159b3eaa692b48de359efc3` | Pass | CRUD and destructive operations inherit the app root. |
| Collage Maker | `collageMaker` | `users/{uid}/{students,categories,items,participations,results,frameTemplates,settings}`; Storage `users/{uid}/{photos,frames}` | `apps/collageMaker/users/{uid}/...` | `firebase-namespace-isolation` / `efa0477e9fb686668ab578ea25638236642c1ac3` | Pass | Entitlement, backup identity, Firestore, and Storage isolated. |
| School Election Manager | `schoolElectionManager` | `elections/{uid}/...`; Storage `election-symbols/{uid}` | `apps/schoolElectionManager/users/{uid}/elections/main`; Storage `apps/schoolElectionManager/users/{uid}/symbols/...` | `firebase-namespace-isolation` / `8a9b5a279cd8d46235285dca4cd4ab9c5187053f` | Pass | Separate Firebase project. Its code/rules were migrated but its rules were not deployed in this shared-project release. |
| Attendance Manager with WA Sender | `attendanceManagerWithWaSender` | `attendanceManagerUsers/{uid}/...` | `apps/attendanceManagerWithWaSender/users/{uid}/...` | `firebase-namespace-isolation` / `810a0742cbd0b7a05063c89058b10b4140e1a9a5` | Pass | Entitlement, online reset/restore, and backup identity isolated. |
| Teachers Exam Duty Allotment | `teachersExamDutyAllotment` | `plannerData/default` | `apps/teachersExamDutyAllotment/data/planner` | `firebase-namespace-isolation` / `d66786c9abf45c79557842c67e7d95b0d0ac1ad5` | Pass | App-wide path isolated; authentication remains a documented follow-up. |
| LabMetrics | `labMetrics` | `users/{uid}/{students,experiments,grades,settings}` | `apps/labMetrics/users/{uid}/...` | `firebase-namespace-isolation` / `3ff9c4a7cacfd375ee868903b0499e5093b0219e` | Pass | Entitlement and backup identity isolated; mixed/missing legacy fields handled defensively. |
| Certificate Printer | `certificatePrinter` | None | None | `main` / no change (`1aace9eaf604435032aa68d5aaa34da7c4837b4b`) | Pass | No business Firebase data usage found. |
| Attendance WA Sender | `attendanceWaSender` | `users/{uid}` plus `{settings,classes,students,absentees,backups}` | `apps/attendanceWaSender/users/{uid}/...` | `firebase-namespace-isolation` / `a59239f07cce3900931ff51dddd34b5d55432d92` | Pass | Profile, CRUD, backup, and reset paths isolated. |

All 13 modified branches were pushed to `origin/firebase-namespace-isolation`.

## Rules and deployment

Deployment identity:

- Firebase CLI account: `jeevanvarghese579@gmail.com`
- Project: `inter-level-progress-manager` (`379503088311`, “School Softwares”)
- Firestore database: `(default)`
- Storage bucket: `inter-level-progress-manager.firebasestorage.app`

The previously deployed rules were inspected read-only before merging. The baseline Firestore ruleset was `99f84470-2636-478e-865c-9ee71b6fe5f8`; the baseline Storage ruleset was `d3766917-c565-4095-b961-f29ab0686bff`. Existing control-plane denial, `invitedEmails`, Ascension compatibility, `inaugurationSessions`, UID ownership, and broad temporary authenticated legacy compatibility were retained. The broad fallback explicitly excludes `/apps`, preventing it from bypassing canonical app-specific rules.

On 2026-09-24, this command completed successfully from Firebase Access Manager:

`firebase deploy --only firestore:rules,firestore:indexes,storage --project inter-level-progress-manager`

The CLI compiled and released Firestore and Storage rules and deployed the source-of-truth index file (`0` composite indexes, `0` field overrides) to `(default)`. No hosting or Functions deployment occurred. School Election Manager's separate `school-election-soft` rules were not deployed.

Noncanonical shared-project repositories no longer declare Firestore/Storage rules in `firebase.json`; this prevents an ordinary app deployment from replacing the shared ruleset. Their old rule files remain only as repository history/reference and are not deployment targets.

## Verification

- All 15 application builds passed. SAM was validated in an isolated temporary copy because two user-started Vite processes held its local `esbuild.exe`; those processes were not interrupted.
- Declared typechecks passed for SAM, School Bell Manager, School Fest Pro, and LabMetrics. TypeScript build checks also passed where included in build scripts.
- Unit tests passed for SAM, School Exams Manager, and School Fest Pro.
- Canonical Firestore and Storage rules passed 17 emulator tests covering every canonical per-user namespace, UID isolation, app-entitlement isolation, destructive-operation confinement, control-plane denial, temporary legacy ownership, and both canonical Storage namespaces.
- Firebase Access Manager and its Functions package build and lint passed. The read-only analyzer passes Node syntax validation and imports no write API.
- Migration-touched files lint clean except for unchanged pre-existing debt inside Gym Tracker's Firestore module (three unused query imports) and School Bell Manager's CloudProvider conversions (`any`). Their builds/typechecks pass.

Repository-wide pre-existing validation debt was not modified: SAM lint, Attendance WA Sender's ESLint configuration parse, Certificate Printer lint, Gym Tracker lint, School Bell Manager lint, and Photo Resizer lint currently fail independently of this migration. Photo Resizer's test also expects a missing `app/_sites-preview/SkeletonPreview.tsx`. School Fest's old local partial-rules emulator command is intentionally superseded by the canonical Access Manager rules suite because School Fest no longer owns deployable shared rules.

## Compatibility and limitations

- Production legacy data remains in place and accessible through temporary compatibility rules. New branch code does not read or write legacy paths.
- The migration does not automatically copy legacy data, avoiding misclassification of the known shared `users/{uid}/students`, `classes`, and `settings` collision zones.
- Firebase Auth tokens do not carry a trustworthy originating Web App identity. Rules enforce UID ownership and Access Manager entitlement where the product already has entitlement checks; owner-only app separation additionally relies on the now-centralized application paths.
- Teachers Exam Duty Allotment has no Firebase Authentication. Its one canonical planner document remains explicitly public to preserve current behavior; adding authentication is required before tightening it.
- Existing deployed production hosting continues using legacy paths until each application branch is reviewed and separately deployed. Compatibility rules preserve that behavior. No hosting deployment was part of this task.

## Rollback

If the shared policy must be rolled back, restore the inspected baseline rulesets (Firestore `99f84470-2636-478e-865c-9ee71b6fe5f8`, Storage `d3766917-c565-4095-b961-f29ab0686bff`) or redeploy their exported content. Application rollback is a normal hosting rollback to the previous build. Because this release performed no production data migration or deletion, no Firestore or Storage data restore is required.

Future legacy migration must follow `LEGACY_DATA_MIGRATION_PLAN.md`, use the read-only analyzer first, require human approval for ambiguous documents, preserve IDs and complete values, and never overwrite canonical data.
