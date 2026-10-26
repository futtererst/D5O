# Phase 2H completion role matrix

| Action | Eligible browser role | Independent actor rule | Server authority |
| --- | --- | --- | --- |
| Define draft and submission | Tenant administrator, project manager, operations leader | Reviews require another actor | Hosted save and Define command validate tenant, role and revision |
| Define commercial review | Tenant administrator or billing/commercial lead | Not submitter or delivery reviewer | `d5o_hosted_define_command_v1` |
| Define delivery review | Tenant administrator, operations leader or project manager | Not submitter or commercial reviewer | `d5o_hosted_define_command_v1` |
| Define handoff receipt | Tenant administrator, operations leader or project manager | Not handoff submitter | `d5o_hosted_define_command_v1` |
| Design release receipt | Tenant administrator, operations leader or project manager | Not release issuer | `d5o_hosted_design_release_command_v1` |

Task visibility is a usability layer. Hosted RPC authorization remains decisive for every direct API or RPC call. Other phase roles are not declared browser-qualified here.
