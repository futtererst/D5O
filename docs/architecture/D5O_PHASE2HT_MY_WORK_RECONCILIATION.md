# Phase 2H-T My Work reconciliation

The tenant-neutral My Work API now derives connected-service responsibilities from the authoritative parent Operate state and service approval read command. It does not write task rows or mark tasks complete independently.

The implemented projection gives a project manager an open-request task while no request exists. A new request creates an operations triage responsibility. A triaged chargeable or partially covered request creates project-manager estimate work. Submission creates independent pricing review. The approval read command controls threshold request, decision, authorization, and job tasks. Exact customer authorization should resolve that responsibility and create a job task for the authorized project manager; the task should disappear once a non-cancelled job exists. These later transitions remain unverified by the incomplete Gate B browser run.

Every task links to the same tenant-neutral parent Work page and phase. Task visibility is advisory. The server route and database command recheck current membership, role, tenant, lifecycle, feature, configuration, Work, and request authority at execution time. Stale task cards cannot confer permission.
