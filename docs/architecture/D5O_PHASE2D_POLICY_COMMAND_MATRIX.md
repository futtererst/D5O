# Phase 2D policy to command matrix

Baseline: Phase 2C commit `6524c7aa3b406bae82fdba7f78f007c9710b7417`. The hosted `configuration_versions.manifest_json` is the only runtime configuration store. Work records carry a configuration version ID and digest. All five selected controls operate on that pin; omission keeps historical behavior.

| Phase | Bounded policy | Existing source and command | Schema change | Enforcement point | Qualification case | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| Define | Require a risk narrative of at least ten characters | Connected Work `definition.risks`; `d5o_hosted_define_command_v1` | Optional `phase2dRequirements.defineRiskNarrative` boolean | Submit and independent review, before preserved writer | Missing risk rejected; documented risk proceeds to existing readiness checks | Medium |
| Design | Require a method of procedure for package release | Existing package `method`; `d5o_hosted_design_release_command_v1` | Editor exposure of existing `designControls.requireMop` boolean | Existing package release check, pinned work type contract | Missing method rejected when required; current package can be released only when other mandatory checks also pass | Low |
| Develop | Require evidence for the selected solution option | Connected Work `develop.options[].evidence`; `d5o_hosted_solution_command_v1` | Optional `phase2dRequirements.developOptionEvidence` boolean | Solution submit and independent approval | Empty source rejected; documented source proceeds to existing feasibility checks | Medium |
| Deploy | Require reviewed evidence for completion review | Existing package evidence ledger; `d5o_hosted_field_fact_command_v1` | Existing `deployControls.requireReviewedEvidence` boolean | Existing completion review against release ID | Missing reviewed evidence rejected when required | Low |
| Operate | Require a documentation review for support acceptance | Existing support acceptance input; `d5o_hosted_operate_command_v1` | Editor exposure of existing `operateControls.requireDocumentationReview` boolean | Existing accept-support check | Missing documented review rejected when required | Low |

The Design, Deploy, and Operate controls already had authoritative consumers. This package brings them into phase-specific customer administration and qualifies the customer publication path. It does not add a new engine or relax the existing release, evidence provenance, customer acceptance, qualification, tenant, or financial requirements.

The requested product sequence is Discover → Define → Design → Develop → Deploy → Operate. The inherited prototype contract currently validates Discover → Define → Develop → Design → Deploy → Operate and its connected commands follow that sequence. The customer navigation uses the requested display order; runtime sequencing is an explicit compatibility and release issue, not silently rewritten by this package.

Deferred: work-type-specific Define and Develop policies, generic evidence categories, broader workforce qualification rules, billing and financial closeout policies. Their safe command/data contracts need independent qualification. The five selected controls are a bounded first slice, not complete policy coverage for any phase.
