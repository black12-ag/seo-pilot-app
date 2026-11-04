# Legacy AI setup cutover

The old AI setup Workflow uses `ai-research-setup-${projectId}`. The Workers binding has no documented typed error that distinguishes a missing instance from a lookup failure. New paid research therefore treats an unclassified lookup as unavailable. It must not infer absence from an error message, a project timestamp, an empty database, or a missing application receipt.

`projects.legacy_setup_absence_proven` is an internal proof for project IDs created after a controlled cutover. Its migration default is `0`, with no backfill. The two canonical project inserts set `1` in the same SQL insert only when Better Auth is active and the operator has set `LEGACY_SETUP_CUTOVER_VERIFIED=true`. The setting defaults to false and is not a user capability. A marked project skips the old Workflow lookup for a new paid start; old project-ID Workflow launch, restart, and execution paths must refuse marked projects even if the auth mode later changes. Existing, imported, restored, and direct SQL projects remain unmarked. The public project DTO omits the proof field.

## Activation prerequisites

The operator must establish a single-version, write-quiescent boundary before enabling the setting:

1. Stop old entry traffic and runtime starts, and drain in-flight old request handlers and queued legacy setup start dispatches. Back up the persistent application and Workflow state.
2. Apply the false-default migration and deploy the new code with the flag still false. Verify the new pre-admission gates, the canonical project inserts, legacy launch refusal, and application health in a controlled environment.
3. Only after old handlers can no longer start a Workflow for a newly created project ID, set `LEGACY_SETUP_CUTOVER_VERIFIED=true` and reopen project creation and paid setup. Keep the verified deployment and its Workflow binding on the same version for this transition.

The standalone release can automate this stopped cutover separately. The Compose configuration alone does not establish the drain or activate the flag. A hosted rolling deploy that serves old and new Workers concurrently **must leave the flag false**. Do not set it merely because a new build is live.

## Existing projects

The gate cannot tell a missing instance from a failed lookup, so existing, imported and restored projects stay blocked from new paid research until an operator reconciles them. There is no automatic path. During the stopped cutover above, for each project:

1. List its old Workflow instance `ai-research-setup-${projectId}` with your platform's tooling. On Cloudflare, use `wrangler workflows instances list`.
2. If an instance is still running, wait for it to end. If it finished with an unsaved review, save or discard that review first.
3. Only when no instance can start or finish for that project, set `projects.legacy_setup_absence_proven` to `1` for that exact ID.

A completed instance with saved setup, an explicit `review: null`, or an errored or terminated status already clears the gate and needs no marker. Never mark a project because a lookup failed.

## Import and restore

The portable standalone importer forces this proof to `0` for each project row, including rows that explicitly supply `1`. A full database backup restore or cross-environment copy can bypass that importer. Before serving traffic after such a restore, disable the activation flag and reset every project's proof to `0`; then re-establish the single-version cutover before enabling it again. A backup or restore is not itself evidence of Workflow absence.

Unmarked projects with an unavailable legacy lookup remain blocked for new paid work until an authoritative instance reconciliation is available. A known terminal Workflow status only clears the current start decision; it never persists a proof. Existing exact-request receipts remain readable without starting another paid operation.
