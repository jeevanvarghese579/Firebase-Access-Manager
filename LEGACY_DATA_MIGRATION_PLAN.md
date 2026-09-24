# Legacy Firebase Data Migration Plan

Date: 2026-09-24

This is a plan only. The namespace-isolation change does **not** copy, update, normalize, move, or delete any production Firestore document or Storage object.

## Preconditions

1. Keep the canonical application code on `apps/{appKey}/users/{uid}/...` (or `apps/{appKey}/data/...` for app-wide data).
2. Retain the temporary legacy rules until every owner has reviewed an inventory and a verified backup exists.
3. Export Firestore and Storage through supported Firebase/Google Cloud backup tooling before any future migration.
4. Run the read-only analyzer for each known UID from the Access Manager `functions` directory:

   `npm run analyze:legacy -- --uid <uid> --project inter-level-progress-manager`

5. Human-review every `LOW` confidence or `ambiguous` result. Field names alone are not proof of ownership.

## Classification evidence

| Candidate owner | High-confidence evidence |
|---|---|
| School Academics Manager | `classId`, `rollNumber`, and `name` are non-empty strings; optional `admissionNumber`, `notes`, `createdAt`, and `updatedAt` strengthen the match; no snake-case LabMetrics markers are present. |
| LabMetrics | At least three of `roll_number`, `batch_number`, `bought_record`, `submitted_record`, and `signs_obtained`, without the complete SAM shape. |
| Ascension Manager | Document lives below the app-specific legacy root `ascensionManagerUsers/{uid}`. |
| School Fest Pro | Document lives below `schoolFestProUsers/{uid}`. Historical source only proves the earlier `users/{uid}/schoolFestData/main` document and does not justify claiming other generic collections. |
| Attendance Manager with WA Sender | Document lives below `attendanceManagerUsers/{uid}`. |
| Other generic-path apps | Collection name plus a coherent app-specific schema and related documents. Generic `users/{uid}` location or a `name` field alone is insufficient. |

Mixed documents that satisfy more than one application signature remain ambiguous. In particular, LabMetrics-style fields must never be treated as SAM merely because a document also has `classId` or `name`.

## Proposed future migration sequence

For each app and UID, in a separately approved maintenance window:

1. Produce and archive the analyzer output and an immutable source export.
2. Select only high-confidence documents approved by a human reviewer.
3. Dry-run a purpose-built copier against an emulator using the production export.
4. Copy documents to `apps/{appKey}/users/{uid}/...` while preserving document IDs, field values, Firestore value types, and Storage object metadata.
5. Never overwrite an existing canonical document. Treat every destination collision as a manual exception.
6. Compare source/destination document counts, IDs, hashes of normalized exports, and Storage checksums.
7. Exercise each application's read, create, update, backup, restore, and app-scoped erase flows against the copied data.
8. Keep legacy data unchanged through an agreed observation period.
9. Remove legacy rule exceptions only after all owners sign off. Legacy deletion, if ever desired, is a distinct explicitly approved operation with its own backup and rollback plan.

## Rollback

Application rollback means redeploying the previous application build and the previously exported ruleset. Since the isolation release does not mutate legacy data, rollback does not require a Firestore restore. A future data-copy migration must be additive and idempotent; rollback should disable reads from the canonical destination, not delete either copy.

## Known manual decisions

- The generic `users/{uid}/students`, `settings`, and `classes` collections are collision zones and require record-level review.
- Teachers Exam Duty Allotment currently has no Firebase Authentication and uses one public app-wide document. Authentication hardening is required before stronger ownership rules are possible.
- Firebase Authentication tokens do not identify which Firebase Web App initiated a request. Rules can enforce UID ownership and Access Manager entitlements, while application-origin isolation for owner-only apps is provided by namespaced code paths rather than a trustworthy client app ID claim.
- Photo Resizer / FrameFit and Certificate Printer have no business Firestore or Storage data to migrate.
- School Election Manager is in a separate Firebase project and must be handled with that project's own backup and deployment approval.
