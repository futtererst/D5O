# Phase 2H-TC service adapter security

The disposable authenticated browser run exercises the tenant-neutral approval, customer-evidence and prototype Operate adapters after creating one actual service job per tenant. The authoritative RPC test also attempts a nonmember read and a wrong-role approval while the request is pending. [Machine evidence](evidence/phase2htc-two-tenant-results.json) identifies the exact test `service adapters reject forgery and replay without additional jobs`.

| Probe | Observed response in a passing run |
| --- | --- |
| Anonymous approval read | HTTP 401 |
| B actor reading A approval and customer evidence | HTTP 403, 403 |
| Forged request, parent Work, evidence and evidence/Work pair | HTTP 409, 403, 404, 404 |
| Nonmember approval RPC | PostgreSQL `42501` |
| Wrong-role approval RPC while pending | PostgreSQL `42501` |
| Foreign actor at connected-service job RPC | PostgreSQL `42501` |
| Customer authorization with forged evidence | Rejected; Operate revision unchanged |

The positive adapters are used through authenticated browser controls in the same runner: pricing review, PDF retention, customer authorization, independent threshold decision for Tenant A, service authorization and executable job creation. The test verifies the pinned configuration, exact Work and child request, USD 15,000 price, and one executable job per tenant. A denied API response is followed by an unchanged-state check where the protected mutation is in scope.

The runner does not yet execute every requested membership, tenant lifecycle, feature-disable or deleted-object case through these particular service adapters. Existing phase and feature suites establish some underlying guards, but cannot substitute for the distinct adapter boundary. These are local closure gaps until an executed service-specific test supplies evidence.
