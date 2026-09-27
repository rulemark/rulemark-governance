# Plan archive 5 — build step 4 (2026-09-27)

Planning files from the fourth build step: history and delivery. Steps 1–3
wrote every revision and outbox row and answered questions about today; this
step read them back: the record as it stood on a date, what changed since then,
events delivered to the services that act on them, and a finding reaching a
person on a schedule.

Seven phases: reading the record as of a date, `asOf` in the views,
`GET /changes` (with review items' own history, `review_item_event`),
`subprocessors.changed`, the outbox dispatcher and an audit-log receiver on
Render, the coverage cron job, and the deploy. Seven open questions were
settled before any code was written; Phases 4, 5 and 6 raised nine more when
building, each settled before its code. Every one is recorded, with its
reasoning, in `findings.md`.

`findings.md` is the part worth re-reading. It records:

- **Why `asOf` is the end of the day, in UTC**, and why a future date is
  refused rather than answered as a prediction.
- **Why review items got a history table of their own**: the outbox is a
  delivery queue, per destination and purged after 30 days, so history read
  from it would depend on routing and expire.
- **What `subprocessors.changed` is for** (Art. 28(2) notices, before a change
  takes effect), and so why lists are compared as planned, with
  `effectiveFrom` and a `changed[]`.
- **Why the dispatcher claims with a lease** and sends outside any
  transaction, why a failing event is never given up on, and why addresses
  are one variable per destination.
- **Why the cron job opens and never decides**: a dismissal stands, a
  resolution doesn't block, and it closes nothing.
- **What deploying taught**: a Blueprint sync that creates a service runs its
  steps in order and can stall, so a variable pointing at a new service
  arrives after it; and delivery is proven in the outbox, from the Shell, not
  in logs that restart.

The decisions themselves live in `docs/ropa/*` (see `ropa-api.md` §5, §6 and
§8, and `ropa-database.md` §6.3 and §7), the code and the migrations; these
files record how they were reached, and what had to be corrected on the way.
