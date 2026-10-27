# Phase 2H-V My Work execution

`customer-work` now projects existing `supportRoleActions` into the tenant-neutral My Work list. The accepted Deploy receipt creates a handoff task for the exact receiving actor. After handoff, the queue presents asset identification, documentation supply/review, support acceptance and activation from persisted Operate state. A completed action disappears on queue refresh. The task link opens the relevant Work in Operate; it does not grant command authority.

The routing fix allows documentation supply and independent review after the Operate source is recorded, before support acceptance. Previously the task projector waited for an accepted support state, which deadlocked a tenant whose published policy requires document review first. The browser also reads the Work's pinned published Operate policy and shows its actual review requirement.

The receiving page uses the existing hosted Operate command adapter and existing private document panel. It displays support and financial state separately. A pending finance obligation remains visible after support activation and creates a Billing lead task to invoke the existing `update-finance` command with `In review`. That task resolves when the review starts; the obligation remains open. This package creates no billing or receivables workflow.

Executable evidence: `evidence/phase2hv-two-tenant-results.json` and authenticated desktop/mobile images in `evidence/phase2hv-browser/`.
