# Billing v2 Guided UI Replacement Report

## Summary

Billing v2 guided workflow replacement implemented for the existing Billing focused task route:

`/billing?focus=billing-billing-backup-cash-recovery&pilot=1#focused-task`

The rejected forms/buttons UI remains rejected. This pass does not use or restore the failed Billing v2 UI stash and does not recreate the stacked form/card dashboard pattern.

## What Changed

- Added a guided Billing v2 focused workflow using the accepted Phase 1A domain layer.
- Added a process rail, active step workspace, and readiness/context panel.
- Rendered one active step at a time instead of showing all data sections at once.
- Added structured evidence package interaction with references and local demo attachment metadata only.
- Added commercial review handoff interaction through the Billing v2 domain review task.
- Added blocker clearance through domain commands only after approval and resolution note.
- Added business-specific outcome and historical record display.

## Boundaries Preserved

- Billing v2 remains local/demo only.
- No production pay app submission was added.
- No external GC submission was added.
- No production document upload claim was added.
- No persistence, auth, RLS, or Supabase schema changes were added.
- Field and Closeout not refactored.
- Pilot Mode was not redesigned.

## Implementation Notes

React components render Billing v2 domain state and dispatch Billing v2 domain commands. Readiness, evidence satisfaction, commercial review approval, blocker clearance, outcome generation, and historical record generation remain owned by the Billing v2 domain layer.

The guided route may update the existing Billing pilot card completion through the shared workflow completion provider after the Billing v2 blocker is cleared. This preserves the existing pilot integration boundary without creating a second workflow engine.

## QA Added

- `npm run billing-v2:qa`
- `npm run billing-v2:verify-ui`
- `npm run cta-outcome:qa`
- `npm run cta-outcome:verify`

The browser QA verifies the guided process rail, single active step, package details, evidence package, commercial review task, approval gating, blocker clearance, business-specific outcome, historical record, and runtime console stability.

CTA Outcome QA now accepts Billing v2 by its guided workflow contract instead of the legacy generic `FocusedTaskPanel` copy. The primary `Add missing billing backup` CTA from both `/command-center` and `/billing` opens the Billing v2 focused route and shows the guided workflow, process rail, active step, readiness context, Pay App 003, and the $84,000 cash impact.

## Acceptance Status

Automated QA is required before acceptance. Manual acceptance still required because the previous Phase 1B UI failed manual review even though it could be mechanically executed.
