# Phase 2H-U evidence and review

The assigned worker uses the existing private `d5o-deploy-evidence` bucket through the worker adapter. The adapter checks the active tenant, bound employee, current published booking, exact Work and package, file type and size, expected revision, and `connectedWork` availability. It writes a tenant/Work-hash/evidence-ID object, then registers its metadata and SHA-256 checksum through `d5o_hosted_field_evidence_command_v1`. Failed registration removes the uploaded object. An upload is never an approval.

Worker reads recheck membership, assignment, Work, uploader and checksum. Manager reads use the existing Deploy adapter with tenant-neutral customer scope, exact Work/evidence lookup and checksum verification. Both responses are private and uncached. The reviewer opens the file and records **Reviewed** or **Returned** with a reason through the same hosted evidence command. SQL verifies independent reviewer authority and the pinned policy. Report and inspection reviews remain separate decisions through `d5o_hosted_field_fact_command_v1`.

The existing connected field-change command is the issue domain. The field UI can raise a condition with impact, report and evidence references; independent management assessment and resolution are separate audited commands. The tenant-neutral field-change adapter now validates the workspace and capability before invoking its tenant-aware RPC. Open changes remain a completion/acceptance hold under the hosted command.

The exact executed positive, negative and cross-tenant cases are listed in the two-tenant and security result documents. Unexecuted cases are not counted as passing.
