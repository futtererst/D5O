# PM workforce and scheduling synthetic check — 2026-10-16

This is a technical check with fictional pilot accounts against disposable local persistence. It is not a Rybex-user usability observation or a production scheduling result.

- Application build tested after correction: `bebf8218bec2876bcf5d3548b660cde8d68197c9` at `http://127.0.0.1:61656/work?workspace=rybex`.
- PM signed in through the browser, opened People from the rail, then opened Crew schedule. The committed roster showed six people, including qualified bound workers and one unbound planning-only person. The PM had no workforce-administration controls in the People view.
- The only unfilled configured package slot in the current week was `2026-10-12 07:00–15:30` for package `wp-de48eaa09e304de7a5aa4a8657b36d11` on Work `rybex-9e4f1e5f9e6b4e429142d3b01e1825e5`. All qualified bound workers were already booked on that shift; the other qualified person was unbound. This is an expired fixture on October 16, not an available current booking.
- Before correction, the crew page briefly showed eight false “Work/package unavailable” issues while Work Records loaded. It then resolved. The editor also claimed that moving the booking would update the required Design slot, although the typed booking command checks the exact retained demand and cannot make that change.
- After correction, Crew waits for Work Records before assessing bookings. The past unfilled slot says “Past required date” and offers **Review package plan**, which opened the exact Work Record in Design. The editor explained that a different date requires a Design basis change.
- An authenticated PM selected Friday October 16 and a qualified, bound worker in the generic booking editor. Saving produced “This booking is outside the Work Package required dates: 2026-10-12.” Schedule revision remained `22` before and after; no booking was created.
- A separately signed-in fictional worker saw one October 12 booking as past without response, with no late Accept action, and a distinct October 13 booking already accepted historically. No new worker response was recorded in this check.
- TypeScript, scoped ESLint, and production build passed. No migration or database mutation was required for the correction.

**Limit:** A fresh PM booking → publication → worker acknowledgment was not demonstrated. The current disposable fixture has no future-dated, accepted Design package with available qualified crew. The next positive check needs a separate mutable fictional fixture prepared through governed Design commands; it must not relabel a past booking as current or alter the established accepted delivery history.
