# Phase 2C feature entitlement and flag contract

The initial governed capability is `connected_work`, the existing connected Work creation command. Entitlement and rollout flag are separate tenant-owned rows. A newly provisioned tenant needs both a vendor grant and a vendor flag enablement. Existing pilot workspaces, which have no provisioning row, retain their current capability. The flag cannot grant membership, change tenant ownership or bypass approval.

Vendor changes use `d5o_platform_capability_command_v1` with explicit authority, tenant key, expected revision, command ID, reason, audit and receipt. Customer administrators cannot call it. The effective decision is made by `d5o_hosted.capability_available_v1`, which also requires an active tenant lifecycle, and checked in `d5o_hosted_create_connected_work_v1` before the preserved core command runs. The pilot API creation route and the narrow membership-backed `/api/d5o-hosted/connected-work` route also check the authenticated tenant capability before dispatch. Direct calls to the renamed core are revoked from Data API roles.

The vendor tenant page displays entitlement, flag and effective state separately, with confirmed, reasoned actions. The customer capability read RPC is tenant-member scoped. No percentage rollout, billing or plan inference is introduced.

This initial feature gate covers connected Work creation, not every generic Work creation path. Customer administration shows the Connected Work link only when available. The dedicated start page explains unavailability, and its API and RPC reject bypass attempts. The broader general-customer six-phase route remains an inherited qualification dependency.
