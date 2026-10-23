# Phase 2H completion action matrix

Baseline: `484beebcbc4ca0e9d95c88e69ebb1c78418727ea`. This matrix describes the local completion branch, not a production release. A passing hosted RPC fixture does not establish a browser-executable action.

| Phase | Customer action | Authoritative command | Browser / My Work status |
| --- | --- | --- | --- |
| Discover | Create connected Work; independent intake and handoff | Hosted connected Work and pursuit commands | Work creation existed; intake/handoff remain fixture RPC actions |
| Define | Save bounded scope draft, submit, commercial and delivery reviews, approved-scope handoff | `d5o_hosted_prototype_save_v1` for draft; `d5o_hosted_define_command_v1` for decisions | Two-tenant browser path exercised; policy denial and successful submission verified |
| Design | Prepare package, document, reviews and release | Existing Design package, document, review and release commands | Preparation/release remain fixture RPC actions; independent receipt added to My Work and browser qualification is recorded separately |
| Develop | Solution preparation, workforce readiness, schedule, authorization and field start | Existing solution, crew, scheduling and authorization commands | Fixture RPC only; no claimed browser completion |
| Deploy | Field facts, evidence review, customer acceptance and completion | Existing field fact, evidence and acceptance commands | Fixture RPC only; no claimed browser completion |
| Operate | Handoff, documentation review and support activation | `d5o_hosted_operate_command_v1` and related commands | Existing limited handoff/activation controls; complete browser progression not qualified |

The fixture deliberately keeps the same connected Work through all hosted command checks, but later-phase fixture calls are not counted as user-facing execution. The minimum remaining work is bounded Design package preparation/release, Develop scheduling and authorization, Deploy field and acceptance actions, and Operate documentation/support actions with separate signed-in actors.
