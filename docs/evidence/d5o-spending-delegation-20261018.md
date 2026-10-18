# D5O spending reviewer delegation — isolated qualification

18 October 2026. This implements Shawn's direction that an administrator configures eligible human delegates and the system chooses the reviewer from the circumstances. It does not create AI approval rights or choose production delegates, funding, limits or rate policy. Existing command roles remain authoritative.

## Implemented boundary

Forward migration `20261018020000_d5o_spending_delegate_selection.sql` adds versioned administrator commands and audit receipts for three existing decision categories: Work economic authority, internal Design spending windows, and Design effort commitments. Active rules identify an existing active member and existing command role, maximum decision amount, currency, optional Work Type, effective interval, priority and retained policy reference. An eligible delegate wins over a sponsor; among eligible rules selection is deterministic by maximum amount, priority and rule ID. The preparer cannot be selected. A category with no configured rule continues its historical command-role behavior; after first configuration, no eligible rule means a held decision. Reviews prepared before configuration retain their original role contract. Removing a rule does not create an unrestricted fallback.

The administrator screen in Workspace configuration creates and revokes these rules through authenticated typed commands. Work and Design review controls query the exact pending decision before rendering an action; My Work filters review cards through the same selection. The decision trigger rejects a different actor even if that actor has the underlying role. The existing Work and Design commands continue to enforce tenant, source, revision, independent review, money cap, audit and replay checks. Rule configuration cannot grant a new workspace role.

## Current technical observations

- The additive SQL completed with `ON_ERROR_STOP=1` and one transaction on a disposable copy of the 135-file database-only schema, then on the populated isolated clone `d5o-graybar-final-full-replay-20261016` at `127.0.0.1:58521/58522`. The latter's pre-existing partial migration ledger was not rewritten. No shared target was touched.
- In one rolled-back authenticated administrator transaction on the clone, a fictional USD 1,000 delegate and USD 2,000 sponsor rule were saved at configuration revisions 1 and 2. A USD 500 Work decision selected the delegate; USD 1,500 selected the sponsor; USD 2,500 had no selector and was held. The transaction rolled back; these are command/database probes, not browser decisions or approved business policy.
- The existing wrapped Work and Design My Work queue functions returned without SQL errors for an authenticated fictional administrator before any category was configured. No pending review was present in that sample.
- TypeScript and scoped lint passed after component corrections. The production build compiled, but that first build did not contain the disposable target's environment configuration; it is not a data-backed preview result. A target-configured build and authenticated browser journey remain to be recorded below.

## Remaining qualification

Observe administrator rule creation, exact reviewer queue routing, wrong selected actor denial, sponsor fallback and held state, independent decision, stale link, replay and reload on a fictional pending Work/Design decision. Run the ordered 136-file replay on a separate fresh disposable target before shared-release consideration. Do not treat these open checks as passed from source inspection or rolled-back SQL probes.
