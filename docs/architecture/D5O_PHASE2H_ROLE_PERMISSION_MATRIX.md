# Phase 2H role and decision matrix

| Decision | Existing roles | Additional authority |
| --- | --- | --- |
| Define commercial review | Admin, billing/commercial lead | Different actor from submitter and delivery reviewer |
| Define delivery review | Admin, operations leader, project manager | Different actor from submitter and commercial reviewer |
| Submit approved Define handoff | Admin, project manager, operations leader | Approved baseline, current revision |
| Receive Define handoff | Admin, project manager, operations leader | Different actor from sender; exact submitted revision |
| Receive Operate handoff / activate | Operations leader | Accepted Work, current revisions and pinned policy |

The UI filters actions from the current actor and decision history. Server-side role and separation checks remain in `d5o_hosted_define_command_v1` and `d5o_hosted_operate_command_v1`. Assignment or task visibility does not grant permission.
