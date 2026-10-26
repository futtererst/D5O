# Phase 2H-TB: SLA calendar and deterministic execution

## Observed defect

The previous Gate B browser run received `sla_calendar_unresolvable` when triaging a child service request. The authoritative connected Operate command counts eligible business hours with a holiday exclusion. If a pinned policy omits `holidayDates`, `v_policy->'holidayDates' ? date` evaluates to SQL `NULL`; `NOT NULL` is still `NULL`, so no candidate hour is counted. After 120 days the command raises the observed error. The later browser fixture selected `Continuous`, but that change had not been qualified after the failure.

The local migration `20261024010000_d5o_service_sla_calendar_validation.sql` treats an omitted holiday list as empty and rejects missing or unknown response calendar values. It changes neither business hours nor the continuous-calendar rule. It has **not** been applied to a hosted or production database.

## Disposable qualification clock

The P0-A fixture installs a clock only in its disposable database and sets it to 2026-10-26 14:00 UTC (Monday 10:00 in New York). Only the existing field-start and connected Operate commands read that clock during the fixture run. No browser request accepts a timestamp. The clock table and schema grant no access to `authenticated`; the disposable stack is deleted by the existing cleanup procedure. Economic and labor authority validity begins on the database's actual current date, because their unchanged commands use `current_date`; the scheduled field shift remains the fixed Monday window.

## Calendar checks

`scripts/p0a/run-phase2htb-calendar.mjs` checks the locally migrated command source and evaluates its SQL hour-selection predicate for normal hours, before and after opening, weekends, a configured holiday, both daylight saving transitions, and Friday-to-Saturday continuous coverage. It also checks that an ordinary authenticated role cannot use or update the qualification clock. Results: [calendar results](evidence/phase2htb-calendar-results.json).

These predicate checks characterize the command's calendar calculation; the browser triage in Gate B is the end-to-end command test. Direct command cases for invalid and missing calendars, wrong-tenant calendars, and overnight shift eligibility remain separate qualification checks until executed and should not be inferred from the predicate checks.
