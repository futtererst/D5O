# D5O production release decision

**RELEASE PREPARATION PARTIAL. NOT READY FOR PRODUCTION AUTHORIZATION.** Production migration, deployment, write freeze and customer invitations are not approved or performed. There is no evidence of a current production security or historical-data failure, but required application, hosted, readiness and coordinated recovery gates remain incomplete.

The selected source is integration commit `4c8050f3a643bb0e92565fcbd8e1d5df3744d9ea`, with unchanged `app/` tree `84f2081b3b6266abf7d89906b04f816622838f2c` and one narrow `proxy.ts` correction: admit the existing authenticated `/work/invitation` page in hosted mode. The original source was `6f0bbc8d9ba916c75bf2149a8eaef6e667896072`. The first extended fictional run proved the invitation request reached the database but the page was blocked by the proxy; two other browser onboarding checks timed out. The correction passed the 18-case guard regression, TypeScript, targeted ESLint and production build. The end-to-end employee rerun remained incomplete when the existing local Docker daemon stopped responding. **Do not count employee acceptance or downstream lifecycle as passed.** The first run cleaned its disposable project. After Docker recovered, the two interrupted projects were identified by their exact labels, their 16 containers, three volumes, two networks and two verified temporary directories were removed, and both project container inventories were empty. An unrelated local project was left untouched.

Historical migration qualification remains bounded but positive: the authorized no-network copy upgraded 177→202 with all 25 reviewed orders and atomic 215 bridge, original-row hashes and 23 private-object hashes/associations passed. Read-only current production checks still show 177 entries. RC19's active catalog difference dispositions did not justify new SQL. A consistent live database-and-Storage checkpoint/restore has not been demonstrated.

| Required release gate | Decision |
| --- | --- |
| Immutable application and migration source | **PASS for identity/build**; candidate changed only by reviewed route fix. |
| Local vendor onboarding | **PASS on prior source; affected new candidate regression PARTIAL** because two browser checks timed out in the first extended run. |
| Employee invitation, My Work, Design-to-Finance | **PARTIAL / NOT EXECUTED** after route correction. See [matrix](D5O_RELEASE_ACCEPTANCE_MATRIX.json). |
| Tenant security and private evidence | **PARTIAL**: prior focused evidence retained; new employee and later command denials remain unexecuted. Server-mediated Storage contract remains accepted. |
| Historical preservation and migration | **PASS within isolated local scope**; direct original-customer business-command execution is intentionally excluded. |
| Actual hosted candidate and operational readiness | **OPEN**: deployed SHA differs, effective binding unverified, production readiness configuration/schema/scanner gaps remain. |
| Coordinated recovery | **OPEN**: previous DB and Storage copies were not atomic. |
| Cutover approval | **ABSENT** by design; no production action allowed. |

**Product-owner decision required:** accept or reject this wording: “A delivery Scope change modifies the existing parent Work and may hold its field execution until independent review, customer authorization and revised Design acceptance. A connected-service request begins only after Support Active and creates a separately authorized child Work. Finance follow-up is independent of support activation.” This matches the implemented two-domain contract but does not replace formal acceptance.

Before requesting cutover authorization, engineering must finish the finite fictional employee/browser/command matrix and targeted denials, qualify an isolated hosted candidate with effective bindings, clear the actual production readiness contract and operational invitation/spending prerequisites, and demonstrate a matched write-quiescent database/Storage restore. Then present the exact production commands, target identities, expected downtime, restore point, measured recovery exposure and named release owner for one explicit approval.
