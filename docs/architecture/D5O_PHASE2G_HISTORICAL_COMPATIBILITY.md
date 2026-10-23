# Phase 2G historical compatibility

The migration adds a projection and trigger only. It does not update canonical Work, configuration versions, approval decisions, packages, Deploy facts, Operate records or audit events. Backfill runs only for Work with connected decision evidence. Records without enough evidence remain `unresolved` and need a controlled reconciliation; the UI does not invent completion.

The fixture proved early solution approval remains Develop preparation, not completion. Both final Work records retained their original configuration pins after a newer configuration was published, and `replayMatches=true` against the persisted phase projection. Support activation remained distinct from pending financial closeout. The Phase 2F preexisting connected journey passed 45/45 with the new migration before Phase 2G-specific checks were added.

Remaining qualification: replay representative historical pilot Work and accepted Design packages in an approved staging copy, including records predating connected event tables. The disposable fixture cannot establish provenance of the missing sealed M1 environment.
