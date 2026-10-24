# Phase 2H-T feature boundary regression

`connected_work` owns connected Work mutations, connected service and Develop execution. It does not own vendor provisioning, customer organization and membership administration, tenant configuration publication, or ordinary Work creation. Tenant lifecycle, membership and role checks still apply independently.

The disposable Gate A test disables Tenant B's `connected_work` flag through the vendor command, then attempts the authenticated Develop API and direct workforce impact RPC. Both must deny and leave the workforce revision unchanged. While the flag is disabled, the same run invokes authorized organization, configuration, ordinary Work, vendor provisioning and membership commands. It restores the flag through the vendor command and verifies later tenant and pilot checks.

The assertions and exact command responses are in `evidence/phase2ht-gate-a-results.json` under `feature_scope`. A capability denied for its own business prerequisites is not counted as proof that the feature boundary is correctly scoped.
