# RC4-B.1 completion, turnover and acceptance

Application and forward correction: `9c0be3569fb88bf21ba8ced24a58a8804cbeda47` on `codex/d5o-rc4b1-integrity-closure`. Source baseline: `96f1b7bccec690c1dec26cf66a55e9526f1619f9`. Evidence: [final machine result](evidence/D5O_RC4B1_INTEGRITY.json) (SHA-256 `e45a6228150162a59e2acb0495552fb6b0b166070668c4019f0aaa8758c7ca49`), [browser captures](evidence/rc4b1-browser), and the [preserved failing run](evidence/D5O_RC4B1_PERMIT_FAILURE.json). The final disposable run passed **47/47**, with `setupError=false` and `cleanup.clean=true`.

## Causal controls

For each tenant and each applicable command below, the exact authorized command succeeded inside a transaction rolled back before any state was consumed. The browser then raised, independently assessed and priced a synthetic unresolved commercial Scope change. The same RPC, with current actor, Work, package, revisions, evidence and pin, returned `23514 open_field_change_blocks_completion`. Each denial left Deploy state, event and receipt counts, evidence associations, pin and phase projection unchanged. The synthetic change's three tables were then restored to the checkpoint before the legitimate browser action continued.

| Command | Tenant A | Tenant B | Subsequent browser decision |
| --- | --- | --- | --- |
| `review-completion` | eligible; Scope denial | eligible; Scope denial | reviewed completion recorded |
| `assemble-turnover` | eligible; Scope denial | eligible; Scope denial | turnover assembled |
| `accept-client` | eligible; Scope denial | eligible; Scope denial | exact private PDF and package acceptance |
| `respond-operate` | eligible; Scope denial | eligible; Scope denial | independent package receipt |
| `accept-work` | eligible; Scope denial | eligible; Scope denial | exact private PDF and whole-Work acceptance |

`respond-operate-work` is not an applicable new Scope-open checkpoint: once Work acceptance exists, the Scope command rejects a new change with `accepted_work_requires_service_or_amendment`. The independent whole-Work receipt completed through the browser for both tenants. Factual field reporting and inspection review do not carry a direct unresolved-Scope trigger; authorization for new execution is controlled by the field permit. RC4-B already proved eight causal field-start denials, and this run retained the old permits as Held.

## Revised execution

| Tenant | Work | Revised Design release | New permit | Reviewed completion | Whole-Work acceptance |
| --- | --- | --- | --- | --- | --- |
| A | `tenant_a_test-6d9f28ad375140819e066e8f74d32af3` | `7bc3a628-4bed-4f4d-8aa0-68e727fe435b` | `914146ad-0bf4-4ef6-8a25-a20540c51db6` | `a1fbe33a-1c8f-4e35-a97c-879681a18fa4` | `b8adc421-8a46-4beb-a81f-b9c0cecb4c41` |
| B | `tenant_b_test-fa8b1e2e9cae4c1cbdb0eb75d66e2f18` | `27c51825-cee8-4eb1-bc69-2b4eaf721999` | `b37a11b6-37df-4857-87c3-b416ce2be28b` | `be199a86-e462-4452-b56a-b767facd7947` | `0fdd7f42-f783-42b0-a42a-0bda1118e8e1` |

Field report submission, independent report and inspection review, evidence review where pinned policy required it, reviewed completion, turnover, package acceptance and whole-Work acceptance all succeeded through authenticated browser controls. Old permit IDs `9e5dd811-6cbd-4f03-b7d9-9bfcefe6a4b9` and `ca6cc949-1e6d-4f6d-97a9-120acefa0c29` remained Held. The final assertion tied new permits, completion, turnover and acceptance to the revised accepted releases, preserved each tenant's configuration pin, and obtained `phaseReplayMatches=true`.

The first continuation run exposed `current_start_and_author_required` at field-report submission. The field-fact function sorted permits only by timestamp; the qualification clock gave the old Held permit and new Authorized permit the same time. The forward-only migration selects the last appended permit by JSON ordinality, preserving the existing command checks, RLS boundary, grants and receipts. The failure is retained; the final run demonstrated the corrected worker submission and downstream acceptance.
