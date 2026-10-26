# Phase 2H-R shared Work action contract

The tenant-neutral Work page and My Work list use the same hosted Work projection. An actionable list item links to the phase section of that Work record; it does not store a separate completion flag. The bounded Design adapter is `POST /api/d5o-hosted/customer-design-action`. It invokes the existing hosted package, Design draft, demand, review, and release commands. The existing Define and Design receipt adapters remain on `customer-work`.

| Contract part | Phase 2H-R implementation |
| --- | --- |
| Identity | Workspace key, presentation Work ID, action ID, package/document/review ID in typed action input. |
| Responsibility | `customerWorkScope` checks authenticated active membership, tenant lifecycle, and `connectedWork` capability. `designActionRole` limits the bounded adapter. Hosted commands check exact role, ownership and separation of duties transactionally. |
| Availability | My Work Design tasks derive from hosted Work Design state and the connected package projection. The form uses that projection; hosted commands remain the final prerequisite authority. |
| Inputs | Specialized Design forms capture package basis, controlled document, dated demand, review decision and release reason. The endpoint rejects unknown actions and malformed top-level contracts. Hosted commands validate business fields. |
| Evidence | Existing private Design PDF endpoint retains bytes and checksum, registers the exact document revision, and serves authenticated same-origin reads. Upload does not approve the document. |
| Execution | A client command UUID, source revision, Design decision revision, and package creation catalog/handoff basis are passed to the existing hosted command. The hosted receipt decides idempotent replay before transactional revision checks. |
| Outcome | Successful commands refresh Work and My Work from hosted projection. Hosted Design events contain actor, tenant, Work, source handoff revision, decision revision, and command ID. |

The package creation basis is taken from the displayed Work and catalog snapshot. The adapter passes that original basis on retries. It does not recalculate a new package count for an identical command ID. All user-facing actions remain subject to hosted authorization even if a browser control is hidden or disabled.

The PDF endpoint's tenant-neutral read allowance applies only to the existing isolated local pilot runtime and exact loopback origin. Production general-customer evidence routing remains a release dependency. No hosted migration is part of this change.
