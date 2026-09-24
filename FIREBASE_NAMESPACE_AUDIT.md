# Firebase Namespace Audit

Audit date: 2026-09-24

This audit covers the 15 requested repositories. It is source-code and configuration based. No production Firestore documents or Storage objects were read, copied, updated, normalized, moved, or deleted.

## Project inventory

| Repository | App key | Firebase project | Firebase Web App ID | Auth | Firestore | Storage | Current Firestore paths | Current Storage paths | Destructive operations | Collision risk | Required migration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `school-academics-manager` | `schoolAcademicsManager` | `inter-level-progress-manager` | `1:379503088311:web:b52c1e725e81bfdc133332` | Google + email/password | Yes | No | `users/{uid}/{settings,classes,students,exams,examMarks,plusOneMarks,assignments,assignmentStatuses,graceMarks,combinedAnalyses}` | None | Full restore and Clear All enumerate and delete every document in those generic collections | Critical: mixed `students`, `settings`, and generic user root | Move all cloud repository paths to `apps/schoolAcademicsManager/users/{uid}/...`; bind backups to the app key |
| `Ascension-Manager` | `ascensionManager` | `inter-level-progress-manager` | `1:379503088311:web:7b5117cc3447eded133332` | Google + email/password + Access Manager entitlement | Yes | No | `ascensionManagerUsers/{uid}` plus `{students,items,participations,groupMembers,uploadedPhotos}` | None | Reset/restore synchronizes deletions within `ascensionManagerUsers/{uid}` | Currently isolated but noncanonical | Move to `apps/ascensionManager/users/{uid}/...`; preserve entitlement and invited-email compatibility; bind backups to app key |
| `Firebase-Access-Manager` | `firebaseAccessManager` | `inter-level-progress-manager` | `1:379503088311:web:261867e724dfe8e6133332` | Google admin auth | Control plane only | No | `admins`, `adminInvites`, `accessUsers`, `accessInvites`, `appRegistry`, `accessRequests`, `accessRequestKeys`, `invitedEmails`, `mail` | None | Callable functions update/delete control-plane access records; scheduled cleanup expires app permissions | Intentional shared-infrastructure exception | Keep control-plane collections global; make this repository the canonical shared rules owner |
| `school-exams-manager` | `schoolExamsManager` | `inter-level-progress-manager` | `1:379503088311:web:e737a88b7ad8c245133332` | Google | Yes | No | `users/{uid}/projects/{projectId}` | None | Deletes individual cloud projects only | High: generic user root | Move to `apps/schoolExamsManager/users/{uid}/projects` |
| `School-Fest-Pro` | `schoolFestPro` | `inter-level-progress-manager` | `1:379503088311:web:5774bcc84597b656133332` | Google + email/password + Access Manager entitlement | Yes | No | `schoolFestProUsers/{uid}/data/main`; secondary settings service at `schoolFestProUsers/{uid}/appData/settings`; automatic legacy fallback reads `users/{uid}/schoolFestData/main` | None | Current reset deletes only `schoolFestProUsers/{uid}/data/main`. Historical initial implementation deleted only `users/{uid}/schoolFestData/main`; no source/history evidence that it deleted `users/{uid}/students`, `users/{uid}/settings`, or `users/{uid}` | Current business root is unique but noncanonical; automatic legacy fallback/copy violates migration safety | Move to `apps/schoolFestPro/users/{uid}/...`; remove automatic legacy read/copy; bind backups to app key |
| `photo-resizer-framefit` | `photoResizerFramefit` | `inter-level-progress-manager` | `1:379503088311:web:d11054f3461a0c26133332` | ChatGPT/dispatch auth, not Firebase Auth | No application Firestore | No application Storage | None | None | None | None | No business-data namespace change required |
| `school-bell-manager-v7` | `schoolBellManager` | `inter-level-progress-manager` | `1:379503088311:web:fcceb6fef8415889133332` | Email/password | Yes | Yes | `users/{uid}/profiles`, nested `bells`, `sounds`, `settings/app` | `users/{uid}/sounds/{soundId}/{fileName}` | Profile deletion cascades its bells; sound deletion deletes its Storage object; local migration can clear IndexedDB | High: generic user and Storage roots | Move Firestore and Storage to `apps/schoolBellManager/users/{uid}/...`; correct canonical Storage rules syntax |
| `Gym-Tracker` | `gymTracker` | `inter-level-progress-manager` | `1:379503088311:web:f430dcb999873898133332` | Google | Yes | No | `users/{uid}/settings/bodyParts`, `users/{uid}/workouts/{date}` | None | Deletes individual workouts; body-part removal rewrites settings | High: generic `settings` and user root | Move to `apps/gymTracker/users/{uid}/...` |
| `Collage-Maker-App` | `collageMaker` | `inter-level-progress-manager` | `1:379503088311:web:6a63dfcd8523e9f8133332` | Google + email/password + Access Manager entitlement | Yes | Yes | `users/{uid}/{students,categories,items,participations,results,frameTemplates,settings}` | `users/{uid}/photos/{id}.jpg`, `users/{uid}/frames/{id}.png` | Clear Cloud enumerates and batch-deletes all app table documents; pending deletes remove individual cloud records; local restore may replace local data | Critical: shared `students`, `settings`, generic user and Storage roots | Move Firestore/Storage to `apps/collageMaker/users/{uid}/...`; bind backups to app key |
| `School-Election-Manager` | `schoolElectionManager` | `school-election-soft` | `1:130401633543:web:dca6221c49fe51779871a2` | Email/password admin; public voting/polling reads and constrained vote creates | Yes | Yes | `elections/{electionId}` plus `positions`, `candidates`, `votes`, `notifications` | `election-symbols/{electionId}/{fileName}` | Deletes positions, candidates, and vote batches inside one election | Separate project, but business data is still noncanonical/global | Move to `apps/schoolElectionManager/users/{uid}/elections/{electionId}` (owner ID is the current election ID) and matching Storage namespace; update that project's rules but do not move projects |
| `Attendance-Manager-with-WA-Sender` | `attendanceManagerWithWaSender` | `inter-level-progress-manager` | `1:379503088311:web:e046f96ed629ffd4133332` | Google + email/password + Access Manager entitlement | Yes | No | `attendanceManagerUsers/{uid}/{classes,students,attendance,holidays,holidayOverrides,settings}` | None | Class/student cascades; attendance/holiday replacement; full restore deletes/replaces all listed collections under the unique root | Unique but noncanonical | Move to `apps/attendanceManagerWithWaSender/users/{uid}/...`; bind backups to app key |
| `Teachers-Exam-Duty-Allotment-Software` | `teachersExamDutyAllotment` | `inter-level-progress-manager` | `1:379503088311:web:f35119299a0594fc133332` (configured in source; not returned by the active-app CLI listing) | No Firebase Auth | Yes | No | application-wide `plannerData/default` | None | No delete/reset found; writes merge into the singleton planner document | Global application data without app owner | Move to `apps/teachersExamDutyAllotment/data/planner`; preserve the current unauthenticated behavior explicitly pending a separate auth hardening decision |
| `Labmetrics-Final` | `labMetrics` | `inter-level-progress-manager` | `1:379503088311:web:b37328f071189e18133332` | Google + email/password + Access Manager entitlement | Yes | No | `users/{uid}/{students,experiments,grades,settings/default}` | None | Student/experiment deletes cascade grades; restore and Reset All enumerate and batch-delete generic collections | Critical: confirmed mixed `users/{uid}/students`; generic settings/user root | Move to `apps/labMetrics/users/{uid}/...`; bind backups to app key; defensively normalize malformed fields |
| `Certificate-Printer-Software` | `certificatePrinter` | `inter-level-progress-manager` | `1:379503088311:web:e2dc87d55f9fc66c133332` | No Firebase Auth usage found | No application Firestore | No application Storage | None | None | Local-only deletion/clear behavior; no Firebase destructive operation found | None | No business-data namespace change required |
| `Attendance-WA-Sender` | `attendanceWaSender` | `inter-level-progress-manager` | `1:379503088311:web:e195c3e65eb8adaf133332` | Email/password | Yes | No | profile document `users/{uid}` and `users/{uid}/{settings,classes,students,absentees,backups}` | None | Class/student replacements and Reset All batch-delete generic collections and settings | Critical: shared `students`, `classes`, `settings`, and generic root | Move profile and all collections to `apps/attendanceWaSender/users/{uid}/...` |

## Firebase services

- Fourteen repositories target `inter-level-progress-manager`.
- `School-Election-Manager` targets the separate `school-election-soft` project and must remain there.
- Cloud Functions were found only in `Firebase-Access-Manager`; they operate on intentional shared control-plane collections.
- Every repository declares Firebase Hosting except `School-Election-Manager`, whose `firebase.json` contains Firestore/Storage configuration rather than a named Hosting site.
- Firestore indexes are checked in by `school-exams-manager` and `School-Election-Manager`. Existing indexes will be preserved.

## Cross-application collision table

| Legacy path | Applications | Risk/status | Legacy data treatment |
|---|---|---|---|
| `users/{uid}/students` | School Academics Manager, LabMetrics, Collage Maker, Attendance WA Sender | Confirmed schema collision between SAM and LabMetrics; the other two apps also use the same physical collection | Preserve untouched; read-only classification only; no automatic migration |
| `users/{uid}/classes` | School Academics Manager, Attendance WA Sender | Same physical collection with unrelated schemas/semantics | Preserve untouched; no automatic migration |
| `users/{uid}/settings/*` | School Academics Manager, LabMetrics, School Bell Manager, Gym Tracker, Collage Maker, Attendance WA Sender | Same collection; some document IDs differ, but clears/restores can enumerate or delete across apps | Preserve untouched; no automatic migration |
| `users/{uid}/...` generic root | SAM, School Exams, School Bell, Gym Tracker, Collage Maker, LabMetrics, Attendance WA Sender, historical School Fest | Any app-level enumeration/reset can reach unrelated business data where child names overlap | New code must stop using this root; legacy access remains temporarily rules-gated |
| `users/{uid}/sounds` and `users/{uid}/photos|frames` in Storage | School Bell Manager and Collage Maker | Different current child folders but no application-owner boundary | New objects move to fixed app namespaces; legacy objects remain untouched |
| `schoolFestProUsers/{uid}` | School Fest Pro only | Isolated but outside canonical architecture | New code moves to `apps/schoolFestPro/users/{uid}`; old documents preserved |
| `ascensionManagerUsers/{uid}` | Ascension Manager only | Isolated but outside canonical architecture | New code moves to `apps/ascensionManager/users/{uid}`; old documents preserved |
| `attendanceManagerUsers/{uid}` | Attendance Manager only | Isolated but outside canonical architecture | New code moves to `apps/attendanceManagerWithWaSender/users/{uid}`; old documents preserved |
| `plannerData/default` | Teachers Exam Duty Allotment | Global unowned business document | New code moves to `apps/teachersExamDutyAllotment/data/planner`; old document preserved |

## School Fest deletion investigation

Git history shows the initial implementation (`d585d591679fa7f205d9220441a859b583386e84`) reset cloud data by deleting exactly:

`users/{uid}/schoolFestData/main`

Commit `a58ff80658acb1eff1a3e8dde25b622d85aaab8f` changed that delete target to:

`schoolFestProUsers/{uid}/data/main`

The current implementation deletes only the latter document. No current or historical source evidence was found that School Fest's reset deleted `users/{uid}/students`, `users/{uid}/settings`, or the whole `users/{uid}` document/tree. This does not prove what happened in production; it defines only what the audited source could affect.

## Shared-rules ownership

`Firebase-Access-Manager` is the canonical repository for the shared `inter-level-progress-manager` Firestore and Storage rules. Application repositories must not independently deploy partial rulesets to the shared project. The canonical rules must explicitly name each app namespace and retain the Access Manager control-plane protections, invited-email behavior, entitlement differences, and `inaugurationSessions` behavior.

