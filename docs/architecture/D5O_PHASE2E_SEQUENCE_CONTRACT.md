# Phase 2E sequence contract

Baseline: `224c9b62dcdfc7ab45ddd00d2372dd8f0c9e89b2`. Product order remains **Discover → Define → Design → Develop → Deploy → Operate**. The connected command dependency graph is currently:

```text
Discover intake and pursuit → independent commercial review → Discover/Define handoff
→ Define scope, risk, two reviews and Define/Develop handoff
→ Develop selected solution and independent review
→ approved pricing policy and detailed estimate
→ offer review, customer submission and recorded award
→ Design handoff and independent receipt
→ Design package, document custody, reviews and release
→ Deploy schedule, field evidence, completion and customer acceptance
→ Operate handoff, documentation review, support acceptance and closeout
```

The published prototype phase contract also lists Develop before Design. `d5o_hosted_design_handoff_command_v1` requires an approved solution, approved estimate, submitted offer, customer award and exact revision matches. `d5o_hosted_create_connected_package_v2` requires the accepted Design handoff. The solution is recorded in Develop, so this is an actual business prerequisite, not merely a test fixture or visual ordering error. The fixture proved these edges using the same commands for two tenants.

**Decision:** no phase state relabeling, event rewrite, automatic repinning, or unsafe prerequisite removal. This package retains the existing command graph and reports PARTIAL. Product/workflow owners must distinguish pre-Design solution preparation from completed Develop, or approve a compatible transition redesign with explicit migration and full pilot qualification. Existing Work, pins, reviews, awards, releases and audit events are untouched.
