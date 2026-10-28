# RC10 application schema requirements

**Finding: the six RC9 missing-table findings do not establish a blocker for the intended hosted D5O runtime.** This conclusion depends on `D5O_HOSTED_ENABLED=1` and `RYBEXOS_RUNTIME_MODE=production`; the deployed environment has not been verified. The frozen `/work` page chooses `d5o_hosted` configuration RPCs in hosted mode (`app/work/page.tsx`). Its public `config_*` loader is behind `assertProofEnvironment`, which requires the old local proof URL and test mode. The production proxy denies the legacy pipeline, evidence, closeout, and field routes with HTTP 503, and the opportunity repository rejects production database use. The synthetic route-contract evidence records six representative 503 results.

| Missing public relation | Source | Frozen source reference and hosted disposition |
| --- | --- | --- |
| `config_tenants` | `0017_configuration_foundation_core.sql` | Legacy configuration server; proof-only path. Hosted configuration inventory uses `d5o_hosted` RPCs. |
| `config_tenant_configurations` | `0019_configuration_tenant_activation_versions.sql` | Same proof-only configuration path. |
| `config_configuration_versions` | `0019_configuration_tenant_activation_versions.sql` | Proof-only configuration reads/actions. Hosted versions and Work pins live in `d5o_hosted`. |
| `evidence_objects` | `0006_shared_command_audit_evidence.sql` | Legacy evidence/field/closeout paths denied by hosted production proxy. Hosted private evidence uses separate D5O functions and metadata. |
| `opportunity_bid_submission_events` | `0016_p1_01b_2_bid_submission_outcome.sql` | Legacy pipeline repository; production path denied. |
| `opportunity_bid_evidence_satisfactions` | `0030_cfg_runtime_03_evidence_persistence_authority.sql` | No direct frozen application literal reference; depends on the legacy bid/evidence graph. |

The [machine-readable six-object matrix](evidence/D5O_RC10_OBJECT_DEPENDENCY_MATRIX.json) records source hashes, direct declared dependencies and every literal frozen-app reference found. It does not claim a full legacy graph or historical SQL equivalence. We did not copy these tables or their dependent graph into the hosted database.

For the hosted surface, the isolated upgraded catalog contains all 112 literal RPC names used by allowed hosted modules. A rollback-only synthetic authenticated actor read its own workspace and published configuration through those RPCs. This is a bounded dependency check, not proof that every dynamic RPC or business command operates correctly. The frozen source has 237 `.sql` files because one duplicate `-ShawnT13.sql` is excluded; the executable manifest has 236 files, and every listed SHA-256 matches. Final permit-order file hash: `6fe726239c15941201f3026ab1a0bb5f42ab89d04fc95b294d54164c5ab4cea8`.

**Stop condition:** if the deployment serves an ungated legacy route or lacks the hosted-mode environment binding, this scope disposition is invalid and the missing tables again block release.
