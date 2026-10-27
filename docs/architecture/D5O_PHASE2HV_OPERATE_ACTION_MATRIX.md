# Phase 2H-V Operate action matrix

The integrated application at `cf781d39e831a6d396f0116326aac59173fd43f4` is the source baseline; the corrected application commit is `776bc00e2ea93a21c7f9e496fc6c67fd9adcaad8`. This package adds browser controls and My Work routing around the existing Operate and support-document commands. It adds no migration or new business command.

| Responsibility | Browser actor and control | Authoritative boundary | Persisted result |
| --- | --- | --- | --- |
| Receive accepted Deploy handoff | Exact Operations receiver opens My Work and records remaining conditions | `d5o_hosted_operate_command_v1` `receive-handoff`; exact Work and accepted Deploy receipt | Operate source, actor, revision and audit |
| Identify supported system | Project manager or Operations leader records asset identity | Existing `add-asset` action | Supported asset and audit |
| Supply as-built document | Project manager submits a retained PDF for the exact turnover | Existing private evidence upload and `d5o_hosted_support_document_command_v1` | Evidence reference and submission |
| Independently review document | Separately authenticated Operations reviewer records decision and reason | Existing `review-document` action and separation rules | Reviewed document and audit |
| Accept support responsibility | Operations leader reviews contact, intake, warranty, service coverage and obligations | Existing `accept-support` action; pinned tenant policy | Support receipt and owner |
| Activate support | Authorized Operations leader invokes `activate` | Existing Operate command and revision checks | Support Active, phase projection and audit |
| Financial follow-up | Billing lead opens the separate My Work task and starts a review | Existing `update-finance` command; `In review` only | Financial obligation remains open; support stays Active |

The page displays the accepted Design release, field completion, Operations receipt, outstanding turnover obligations, retained customer acceptance link and pinned documentation policy. The task list routes responsibility; the command remains the authority. Tenant A's required independent as-built review is a prerequisite to support acceptance. Tenant B's additional review is optional. Finance may start its separate review after activation; neither this action nor support activation records financial closeout.
