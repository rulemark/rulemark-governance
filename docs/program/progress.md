# Progress Log — Build Step 4

> Step 3's log is archived in `plan-archive/4/progress.md`.

## Session: 2026-09-26
- Closed build step 3: all five phases complete, deployed and verified on
  `ropa-api.onrender.com`
- Wrote step 3's decisions that shape step 4 into `ropa-api.md` §8: the cron
  job moves into step 4, `asOf` for impact and the data map needs no new view
  logic, and the outbox cleanup conflicts with review-item history
- Archived step 3's planning files to `docs/program/plan-archive/4/`
- Wrote the build step 4 plan (7 phases, 7 open questions) in `task_plan.md`
- Resolved all seven open questions:
  1. Events: routing in code, addresses in `EVENT_DESTINATIONS`; a minimal
     audit-log receiver as a Render private service (about $7/month)
  2. The dispatcher runs inside `ropa-api`, as `dispatchOnce()` plus a runner
  3. Review-item events get their own append-only table, `review_item_event`;
     the outbox is only a delivery queue
  4. `asOf` as a date is the end of that day, UTC; future dates refused
  5. `subprocessors.changed`: activity saves only, compared as planned with
     `effectiveFrom`, and a `changed[]` for Ch6's onward transfer
  6. The cron job: `svc:schedule`, opens never closes, a dismissal blocks its
     key, nightly at 02:00 UTC over the private network
  7. The dispatcher tested with real Postgres and HTTP, isolated by
     destination name, with time as a parameter

- Phase 1 (reading the record as of a date), test-first, each guard checked
  by breaking it (22 mutations, all caught):
  - `resolveAsOf`: a date is the end of that day, UTC; a timestamp as given;
    the future refused, `422 in_the_future`
  - `readSnapshot` and an empty `SNAPSHOT_UPGRADERS`; `/revisions/{version}`
    reads through it
  - `domain/record/`: the `RecordReader` interface, `liveRecord` (the SQL),
    `recordAsOf` (DB §6.3, in memory); `agreementInForce` exported from
    `domain/agreements.ts`
  - `test/db/record-as-of.test.ts`: Ch8's 1 March on the seeded story, the
    day's boundaries, agreements signed and ended, a rename, a retirement, a
    deletion, the upgrade path, and live = as of today for every question
  - DB §6.2 and §6.3 "As built"; Phase 2 gains the rewiring onto the reader

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 3 | `npm run check` | 891 tests pass | 891 pass | ✅ |
| Phase 1 | `npm run check` | all pass | 931 pass (684 api, 242 schemas, 5 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 4, Phase 1 complete (not yet committed); Phase 2 (`asOf` in the views) next |
| Where am I going? | `asOf` loading, `asOf` in the views, `/changes`, `subprocessors.changed`, the dispatcher, the coverage cron job, then deploy |
| What's the goal? | The record's past answerable (Ch8) and its changes heard: events delivered, findings carried to a person on a schedule |
| What have I learned? | See findings.md, and `plan-archive/4/findings.md` for step 3 |
| What have I done? | Steps 1–3 complete: foundation records, activities, the subprocessor list and report, review items, impact, data map and coverage, all deployed with the story seeded |
