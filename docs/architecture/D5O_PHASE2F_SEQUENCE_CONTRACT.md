# Phase 2F sequence contract

Source baseline: `8d536b4ce74282fe6c3a0e2dbb66b1752ca51ec2`.

The customer-facing order is **Discover → Define → Design → Develop → Deploy → Operate**. The existing connected command graph still requires a selected solution, independent solution approval, approved estimate, reviewed offer and recorded customer award before `d5o_hosted_design_handoff_command_v1` accepts Design work. The early solution decision is therefore a **preparation milestone**, not proof that the customer-facing Develop phase is complete. Design completion requires accepted package release. Develop execution readiness additionally requires an eligible bound resource, a current published and acknowledged crew booking, approved economic authority, and field-start authorization. Field execution and acceptance then precede Operate handoff.

The Phase 2F Work navigation displays the product order and explicitly describes early solution approval as preparation while Design is pending. No historical solution event, phase state, Work pin, accepted package, approval, financial record or audit event is rewritten. This projection does **not** itself prove a formally persisted six-phase completion state. A dedicated phase-status contract remains necessary before claiming a fully aligned product lifecycle; see the release recommendation.

```text
Discover connected Work and intake
→ Define scope, reviews, handoff
→ early solution preparation and independent approval
→ estimate, offer, customer award
→ Design handoff, package, reviews, release and receipt
→ Develop resource eligibility, crew publication/acknowledgment and work authorization
→ Deploy measured execution, inspection, evidence review and customer/Operations acceptance
→ Operate handoff, support documentation review, support acceptance and activation
```

The disposable fixture exercises these commands on one Work record per tenant. The product order is a customer-facing completion model; the graph records actual command prerequisites. Historical compatibility relies on retaining those distinct meanings, not relabeling stored events.
