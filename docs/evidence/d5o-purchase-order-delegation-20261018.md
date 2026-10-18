# D5O purchase-order reviewer delegation — local qualification

18 October 2026. This is the first bounded correction from the hard-coded business-decision review. It extends the existing administrator-managed spending-delegate model to exact prepared Graybar POs. It does not appoint a production delegate or sponsor, approve a budget, submit a supplier order, or change the existing PO cap and source checks.

## Effective behavior

Forward file `20261018180000_d5o_purchase_order_delegation.sql` adds the `purchase_order` category to the established rule command and administrator screen. PO approval still requires the active `admin` command role, a different preparer, current BOM/quote/Work purchasing authority, and available parent and purchasing headroom. If the category was configured before a PO was prepared, the server selects one eligible independent administrator by Work Type, amount, currency and effective period. A sponsor fallback uses the existing rule ordering. No eligible rule holds approval. Earlier prepared POs retain the old independent-administrator contract. The selected-actor trigger runs in the PO approval transaction; a rejection rolls back any inserted reservation and command receipt. My Work filters the exact PO card through the same selector, and the focused PO surface fetches its exact route before showing the approval control.

This is human decision routing. It does not grant an administrator purchasing rights to another role, authorize an AI agent, or turn a draft into a commitment.

## Focused technical checks

- The SQL applied with `ON_ERROR_STOP=1` in one transaction to the verified empty `d5o-delegation-137-replay-20261018` target. Its project ID and ports were checked, and it had zero Work, Auth-user and Storage-object rows.
- The exact new file SHA-256 matched between the source checkout and the curated replay target: `CDF691C7EE69CFEF360B7FEC1C48C002DB742404952CAFF0093CD7F24E29CB75`.
- `supabase db reset --local --no-seed` then replayed all 141 curated files in order, ending at `20261018180000`, exit 0. The target retained zero Work and Auth users after replay.
- The rolled-back `scripts/qa-d5o-purchase-delegation.sql` probe used fictional Auth/membership/Work/PO rows. An administrator configured a named rule through the authenticated typed command. The nonselected administrator had no PO card or decision right; the selected administrator had the exact card and right. The installed trigger function rejected the wrong actor and accepted the selected actor on a temporary table. This is an isolated **database probe**, not a successful business PO approval.
- The same forward file applied transactionally to the existing isolated populated clone `d5o-graybar-final-full-replay-20261016` at local API `58521` / DB `58522`. Before application it had 22 Work records, five Graybar state records, three purchasing reservations and 78 private Storage-object metadata records. Its historical partial migration ledger was not backfilled. No accepted PO, reservation, invoice or private file was intentionally changed.
- TypeScript, scoped ESLint and the production build passed on the uncommitted source. A browser decision and exact final-build preview remain to be recorded below.

## Qualification boundary

The ordered migration, typed configuration, route/queue projection and isolated guard probe passed. A real authenticated browser PO approval with independent fictional administrators, reload, saved-link behavior, and full commercial-cap trigger interaction has **not yet been observed on the final build**. Do not present this as complete purchasing-delegation qualification or as production policy. The original Work/Design delegation, Graybar procurement and Finance evidence retain their earlier source-specific scope.

Production still needs named delegates/sponsor, approved limits, funding and delegation terms, and a populated release/rollback rehearsal. Live Graybar and AI authority remain unconfigured.
