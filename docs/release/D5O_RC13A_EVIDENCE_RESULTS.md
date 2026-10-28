# RC13-A private evidence qualification

The approved contract remains **server-mediated retrieval**. No direct user Storage SELECT policy was added. In the isolated production-mode build at `d2a06ed796789dc8395386f067ef85545acf586a`, genuine fictional GoTrue sessions exercised the application routes against the upgraded historical database.

| Operation | Result |
| --- | --- |
| Upload a fictional Design document | HTTP 200; authoritative registration receipt present; persisted SHA-256 matches uploaded bytes. The Draft document itself was synthetic fixture setup, not an employee decision. |
| Download that document through the app | HTTP 200; byte SHA-256 matches; `Cache-Control: private, no-store`. |
| Download a retained historical customer-decision document through the app | HTTP 200; byte SHA-256 matches its retained receipt; `private, no-store`. No historical record changed. |
| Wrong Work / foreign tenant / anonymous | HTTP 403 / 403 / 401, without evidence bytes. |
| Suspended / removed member using an existing session | HTTP 403 / 403. Active control was 200; fictional membership was restored for later testing. |
| Forged Storage path | App ignored the path and returned the authorized receipt's original bytes. |
| Missing document / deleted synthetic object | HTTP 403 / 404; no bytes. Only the synthetic uploaded object was deleted. |
| Client capability | Evidence index exposed an application-relative route, with no signed URL or Storage token. The service credential remained in the server runtime. |

The 23 retained protected objects were rehashed after testing and all matched. Storage RLS remains enabled with zero user SELECT policies. These checks qualify the tested route behavior; they do not establish a coordinated production Storage checkpoint or an actual hosted deployment. Earlier diagnostic HTTP 404 was traced to the disposable Storage volume path and corrected before the passing route test.

Machine evidence: [HTTP](evidence/D5O_RC13A_EVIDENCE_HTTP.json), [revocation and missing object](evidence/D5O_RC13A_EVIDENCE_BOUNDARIES.json), [private byte integrity](evidence/D5O_RC13A_PRIVATE_VOLUME_INTEGRITY.json).
