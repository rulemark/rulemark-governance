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
- Phase 1 committed (`846e9be`, docs `2f2db99`), not pushed
- Phase 2 (`asOf` in the views), test-first, 17 mutations, all caught:
  - The five view builders take a `ViewRead` (reader, `generatedAt`,
    `asOf`); the routes read live or `recordAsOf`; `refuseAsOf` gone;
    coverage still refuses
  - Loaders the reader replaced removed from `domain/agreements.ts`
  - Package: response `asOf` widened to `AsOf`; `AsOf` described as the
    end of the day, UTC; OpenAPI `asOf` parameters described;
    `openapi.json` regenerated
  - `test/db/history-views.test.ts`: Ch8's two reports (JSON and
    Markdown), §5.2's example, impact and data map as of 1 March, unknown
    records of the time, a timestamp echoed, and rolled-back tests for
    business dates and the newest-terms grouping
  - API §5 says what `asOf` means; §5.1–§5.4 and §8 "As built" updated
- Phase 2 committed (`b73b509`, docs `edc0ab1`), not pushed
- Phase 3 (`GET /changes`), test-first, 16 mutations, all caught:
  - `review_item_event` (migration `0008`), and `0009`: `revision_append_only`
    names its table and guards both; the backfill from the outbox
  - `openReviewItem` and `closeReviewItem` write the history row with the
    outbox rows, sharing the event id, whatever the destinations
  - Package: `CHANGE_ENTITY_TYPES`, `Change`, `ChangesQuery`,
    `ChangesResponse`; a position cursor in `domain/pagination.ts`
  - `domain/changes.ts` and `api/routes/changes.ts`; OpenAPI path and a
    `history` tag; `openapi.json` regenerated
  - `test/db/changes.test.ts`: Ch8's "since March" in order with a review
    item on top, ranges, filters, paging one row at a time, names of the
    time, a backdated save, microsecond neighbours
  - API §2 and §6, DM §3.11 and §3.13, DB §4.5, §4.6 and §8.1 updated
- Phase 3 committed (`fa1134c`), and Phases 1–3's code pushed through it on its own, so the push ended on code; docs pushed after the deploy

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 3 | `npm run check` | 891 tests pass | 891 pass | ✅ |
| Phase 1 | `npm run check` | all pass | 931 pass (684 api, 242 schemas, 5 dist) | ✅ |
| Phase 2 | `npm run check` | all pass | 956 pass (705 api, 246 schemas, 5 dist) | ✅ |
| Phase 3 | `npm run check` | all pass | 994 pass (735 api, 254 schemas, 5 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 4, Phases 1–3 complete, committed and pushed; Phase 4 (`subprocessors.changed`) next |
| Where am I going? | `asOf` loading, `asOf` in the views, `/changes`, `subprocessors.changed`, the dispatcher, the coverage cron job, then deploy |
| What's the goal? | The record's past answerable (Ch8) and its changes heard: events delivered, findings carried to a person on a schedule |
| What have I learned? | See findings.md, and `plan-archive/4/findings.md` for step 3 |
| What have I done? | Steps 1–3 complete: foundation records, activities, the subprocessor list and report, review items, impact, data map and coverage, all deployed with the story seeded |
