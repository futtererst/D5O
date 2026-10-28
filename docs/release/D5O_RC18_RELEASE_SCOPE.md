# RC18 release scope

The product owner explicitly approved the proposed commercial scope in this task: the existing authorized Rybex/Rotork pilot, vendor-controlled provisioning of additional customers, customer administrator onboarding, tenant-specific configuration and membership, and protected Work and My Work access. Public self-service **customer tenant provisioning** is outside this approval. The approval authorizes a narrow local hosted-routing correction and tests; it does not authorize deployment, production migration, production data changes or cutover.

The existing public Auth account-creation route remains an account route; it creates no tenant, membership or Work authority. Vendor-only tenant provisioning remains enforced in the authoritative RPC. The distinct delivery-change versus post-handover connected-service contract is still **DECISION REQUIRED**.

Candidate source commit: `6f0bbc8d9ba916c75bf2149a8eaef6e667896072`. Whole tree: `0a480fc7575e7a307f2b6c57f30ef10a8f6142ff`. `app/` tree remains `84f2081b3b6266abf7d89906b04f816622838f2c`, equal to the selected prior application tree. The change is in `proxy.ts` and an opt-in disposable rehearsal runner.

The 236-file frozen migration manifest was rehashed with zero mismatches. Final file: `20261027190000_d5o_field_fact_latest_permit_order.sql`. The approved RC8 bridge remains unchanged.
