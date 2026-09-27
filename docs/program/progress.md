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
- Phase 1 committed (`846e9be`, docs `2f2db99`); pushed with Phase 3
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
- Phase 2 committed (`b73b509`, docs `edc0ab1`); pushed with Phase 3
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
- Phase 3 committed (`fa1134c`, docs `a3c397c`). Phases 1–3 pushed through
  `fa1134c` on their own, so the push ended on code; CI passed and the
  deploy was live about 70s later (migrations `0008` and `0009` applied);
  docs pushed after
- Verified on the live, seeded service: `/changes?from=2026-03-01` lists the
  story's 15 changes in order on one page; `/report?view=all&asOf=2026-03-01`
  holds C1–C4 and P1; §5.2's `asOf` example answers as documented. The live
  record has no review items, so the backfill had nothing to copy
- Phase 4 (`subprocessors.changed`):
  - Three questions the plan left open, asked and decided: planned means
    every recorded date applied, with `effectiveFrom`; the offering event
    includes opt-in modules, marked; client events for every client whose
    agreement hasn't ended, with their terms
  - `domain/subprocessor-changes.ts` (pure diff) and
    `domain/subprocessor-events.ts` (the save's step 5); `afterRevision` on
    the aggregate spec; `EVENT_ROUTES` in `domain/events.ts`
  - Test-first; 18 mutations, all caught after two more tests (countries
    alone, and a deletion at the domain layer)
  - API §6 and §8, DB §6.1 updated

## Session: 2026-09-27
- Phase 4 committed (`70ce297`, docs `3517ec3`), pushed on its own; CI
  passed and the service restarted on it about 70s later; docs pushed after.
  The outbox isn't exposed, so the new events can't be seen live; none were
  written for the seeded history, which was not replayed
- Phase 5 (the dispatcher) started. Four questions the plan left open,
  asked and decided (findings, "Phase 5's questions"): claim with a lease
  and send outside any transaction; one address variable per destination,
  wired by `fromService`; the envelope's frame as a contract in the schemas
  package, the receiver on `node:http`; a failing event retried forever,
  loudly
- Phase 5 built, test-first:
  - Package: `EventEnvelope` (`@rulemark/ropa-schemas/events`); the API's
    builders tested against it, its interface replaced by the package type
  - Config: `EVENT_DESTINATION_AUDIT_LOG`, `EVENT_DESTINATION_MONITOR`
    (`host:port` or a URL); a test that every routed destination has one
  - `src/delivery/`: `backoff.ts`, `dispatcher.ts` (claim with a lease,
    send, record, cleanup), `runner.ts`; `index.ts` starts it when a
    destination is configured and stops it before the pool
  - `test/db/dispatcher.test.ts` (24 tests, real Postgres and HTTP),
    `test/scripted-receiver.ts`, runner tests, a bootstrap test delivering
    from the running service
  - `apps/audit-log`: receiver, summary, entry point; startup tests from
    source and from `dist/`
  - `render.yaml`: `audit-log` as a `pserv` (`0.5c-512mb`), `ropa-api`'s
    `EVENT_DESTINATION_AUDIT_LOG` from its `hostport`
  - 50 mutations, all caught but two equivalents
  - Run locally from `dist/`: the development database's 2,045 pending
    events delivered in 2.4 s, each once, per-record order held; both
    processes exit cleanly on `SIGTERM`
  - DB §7 and API §6 as built; DM §3.13; `ropa-packages.md` (layout, the
    `events` module, the private service); README (Deployment, Layout,
    Events)
- Phase 5 committed (`2261454`, docs `7af5f45`), not pushed: the user holds
  the push; the live check comes with it
- Phase 6 (the coverage cron job) started. Two questions the plan left
  open, asked and decided: `GET /review-items?key=`; `svc:schedule` added
  to `PRINCIPALS` by hand
- Phase 6 built, test-first:
  - Package: `service:schedule`; `ReviewItemsQuery.key`
  - Permissions: `service:schedule`, and `review:read` for the Snapshot
  - `GET /review-items?key=` (`details->>'key'`); OpenAPI; `openapi.json`
    regenerated
  - `loadCoverageJobConfig`; `src/jobs/coverage-job.ts` and `coverage.ts`;
    `npm run job:coverage`
  - `test/db/coverage-job.test.ts` (9 tests), the job's process in
    `bootstrap.test.ts` (runs, unknown subject, bad config) and from `dist/`
  - `render.yaml`: `coverage-job` (`type: cron`, 02:00 UTC), its API address
    and mint secret from `ropa-api`
  - 12 mutations of the job, 2 of the key filter, 1 of the entry point: all
    caught, one after a new fixture
  - Run locally from `dist/`: three findings opened, then skipped
  - API §1.9, §2, §5.5 and §8; `ropa-packages.md`; README; `.env.example`

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 3 | `npm run check` | 891 tests pass | 891 pass | ✅ |
| Phase 1 | `npm run check` | all pass | 931 pass (684 api, 242 schemas, 5 dist) | ✅ |
| Phase 2 | `npm run check` | all pass | 956 pass (705 api, 246 schemas, 5 dist) | ✅ |
| Phase 3 | `npm run check` | all pass | 994 pass (735 api, 254 schemas, 5 dist) | ✅ |
| Phase 4 | `npm run check` | all pass | 1021 pass (762 api, 254 schemas, 5 dist) | ✅ |
| Phase 5 | `npm run check` | all pass | 1088 pass (805 api, 261 schemas, 14 audit-log, 8 dist) | ✅ |
| Phase 6 | `npm run check` | all pass | 1108 pass (823 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-09-26 | Phase 3: the new table's append-only tests still failed after `0009` was written | 1 | The empty `0009` from `drizzle-kit generate --custom` had been applied by an earlier test run and was never re-run. Dropped `ropa_test`; the global setup rebuilt it. DB §8.1 now warns |
| 2026-09-26 | Phase 3: `/changes` answered 500 | 1 | Raw SQL through Drizzle returns timestamps as strings; `occurred_at.toISOString` is not a function. Parsed with `new Date(…)` |
| 2026-09-26 | Phase 3: `typecheck:tests` failed on a test helper's parameter type | 1 | Widened it to `object` |
| 2026-09-26 | Phase 1: `npm run check` took over ten minutes once | 1 | Not the code: `tsc --build` waited on the disk (9% CPU). Recorded in findings |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 4, Phases 1–4 complete and pushed; Phases 5 and 6 built, their live checks waiting for the push (Phase 7) |
| Where am I going? | The dispatcher and the audit-log receiver (Phase 5), the coverage cron job (Phase 6), then the final deploy and the README tour (Phase 7) |
| What's the goal? | The record's past answerable (Ch8) and its changes heard: events delivered, findings carried to a person on a schedule |
| What have I learned? | See findings.md, and `plan-archive/4/findings.md` for step 3 |
| What have I done? | Steps 1–3 complete and deployed. Step 4 Phases 1–4 deployed: the record as of a date, `asOf` on four views, `GET /changes` with review items' own history, and `subprocessors.changed` |
