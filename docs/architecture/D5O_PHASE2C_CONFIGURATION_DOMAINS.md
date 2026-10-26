# Phase 2C configuration domains

Phase 2C extends `d5o_hosted.configuration_versions.manifest_json`; it does not add a configuration store. The selected new operating control is **Discover initial intake for connected Work**. The policy is `discoverIntake: { schemaVersion: 1, requireInitialDiscovery: boolean }`. Omission preserves the existing optional intake behavior for historical versions and pilots.

The existing customer configuration command edits this field only in a draft. Publication checks the exact shape and boolean type. Activation makes the published version the default for new Work. The connected Work creation RPC checks the requested version and policy before calling its preserved core command in the same transaction. When required, the existing discovery object must be present and satisfy the core command's source, need, procurement and close-date validation. Existing Work keeps its pinned configuration ID; no existing record is repinned.

The existing service-work USD approval threshold, Work Types, creation rights, handoff roles, and supported phase contract fields continue under the same hosted configuration lifecycle. Existing Design, Deploy and Operate fields are shown by the editor; their prior runtime contracts remain unchanged.

| Domain | Phase 2C status | Runtime boundary |
| --- | --- | --- |
| Discover intake | Implemented | `d5o_hosted_create_connected_work_v1` |
| Shared service approval | Preserved | Phase 1B connected authorization and job commands |
| Work Types and handoff roles | Preserved | Hosted creation and handoff commands |
| Define, Design, Develop, Deploy, Operate additions | Deferred | No new controls are exposed without an identified command consumer |
| Notifications and work-type overrides | Deferred | No Phase 2C runtime consumer |

A narrow membership-backed Connected Work start page and API now exercise this policy for provisioned tenants. The complete general-customer six-phase Work route remains an inherited release gate; the pilot UI allowlist is unchanged.
