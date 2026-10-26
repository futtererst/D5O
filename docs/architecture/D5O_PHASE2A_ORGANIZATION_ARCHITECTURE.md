# Phase 2A organization architecture

## Authoritative identities

`d5o_hosted.workspaces.id` is the stable organization/tenant identity. Phase 2A extends that row with legal name, contact email, time zone, currency preference, branding JSON, revision and update time. It does not create a second organization root. `org_units`, `org_locations` and `org_teams` have immutable UUIDs, tenant-scoped codes, revisions and active/retired status. A unit can have a parent unit; the command rejects cycles. Locations and teams can refer to a unit, and teams can refer to a primary location and active manager membership. Composite foreign keys prevent cross-tenant references even if a privileged caller bypasses the UI.

`org_team_members` supports multiple assignments per person or user and retains ended assignments with effective dates. It can reference an existing tenant membership, an existing connected workforce profile, or both when they identify the same person. `connected_crew_profiles` gains optional primary unit and location references; its existing stable person ID, qualifications, capacity, booking identity and history remain authoritative. Retirement retains rows and rejects active dependents. No destructive organization command is exposed.

The earlier [workforce qualification](../evidence/d5o-workforce-availability-20261016.md) establishes that a roster person may exist without login and that a bound worker needs a confirmed account plus active field-worker membership for a worker-visible booking. Phase 2A preserves those prerequisites. Removing ordinary tenant access ends that user's active team assignments, while retained workforce and scheduling records keep their historical identity.

The authenticated `d5o_hosted_org_admin_command_v1` checks active tenant admin membership, expected revision, references, a bounded command ID, and a reason. It serializes tenant changes with a transaction advisory lock, stores before/after audit and an idempotent receipt, and returns the resulting row. `d5o_hosted_org_admin_read_v1` gives a paged tenant-only projection. Private tables have RLS enabled and no direct API role grants. The separate vendor tenant directory remains read-only and has no implicit customer command authority.

## Reuse across phases

Existing Work IDs and pinned configuration versions do not change. Business units, teams and locations are available as stable references for opportunity ownership, project and package responsibility, schedule resources, allocation, approval authority and reporting. Phase 2A attaches these references to the existing workforce profile and team assignment boundary. It does not silently migrate historical opportunity, Work or schedule snapshots. Those command integrations require explicit versioned changes in later packages. Team membership alone does not grant a D5O business role.

The migration is `20261023123751_d5o_phase2a_organization_people.sql`, after Phase 1B. It was applied only to disposable loopback projects. Hosted staging review must check existing workspace rows and grants before any deployment. No production migration was applied.
