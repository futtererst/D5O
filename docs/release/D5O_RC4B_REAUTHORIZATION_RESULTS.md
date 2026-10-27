# RC4-B revised authorization

**Verified for field start in both tenants.** The initial browser-issued permits were tied to accepted release `09884496-c9a4-4f9f-966e-cb3b6690105d` for Tenant A and `b24414b4-ee63-4059-afd5-25f047f649e7` for Tenant B. The published schedule revisions were 7 and 9. The initial permits were held through the authenticated Operations browser before the commercial changes.

| Tenant | Work | Original permit | Revised accepted release | New browser-issued permit |
| --- | --- | --- | --- | --- |
| A | `tenant_a_test-1eae322cce22499393dc873753a8ebbb` | `715f80f9-3246-4596-8aa9-19b794c23e8c` | `e821db53-1064-4d56-bae8-8d78eb1a51e2` | `e24fb46e-c5a4-49e1-b08e-bc4d64d360ac` |
| B | `tenant_b_test-efa311e3bd9b4d43a57f9254cc2e3383` | `0dc166d1-fe20-4edf-9164-fc30e0d46a0f` | `43af81b2-e8ab-44cc-afdc-fea93bcb9425` | `0c66e518-3e69-42ba-830c-782567a5b551` |

After the customer-authorized Design change was recorded and independently received, the unresolved commercial change still blocked `authorize-start` with `23514 open_field_change_blocks_start`. An independent Operations employee resolved the commercial change from the assigned My Work task. The same Operations role then used the existing Develop browser control to authorize field start. The command created a **new** permit linked to the revised accepted release. It did not revive the old held permit.

The Work configuration pins remained `d4ec4b1d-6d26-4b08-95f3-c7e012e9c7f2` (A) and `097f9a56-4f8a-47cd-944c-628fbc47b047` (B). The accepted revised release and completed Scope task remained visible after the existing runner's reload and queue reconciliation. No application source or migration correction was needed for this field-start path.

This proves release of the **field-start** hold. It does not prove completion or customer acceptance after revised authorization. The second retry also observed that the Deploy page's “Authorize resume” control did not dispatch while a permit was held; the run used the supported Develop “Authorize field start” path against the new release. That UI observation needs a focused diagnosis before treating same-release resume as qualified.
