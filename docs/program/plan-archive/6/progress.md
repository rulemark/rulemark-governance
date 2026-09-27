# Progress Log — Build Step 5

> Step 4's log is archived in `plan-archive/5/progress.md`.

## Session: 2026-09-27
- Closed build step 4: all seven phases complete, deployed and verified on
  `ropa-api.onrender.com` (docs `0c77ea0`)
- Archived step 4's planning files to `docs/program/plan-archive/5/`
- Wrote the build step 5 plan (4 phases, 5 open questions) in `task_plan.md`
- Settled the five open questions, one at a time: the CSV as one table
  with `asOf` on every row; neutralised formula cells and a BOM;
  `record:write` for engagement writes; `If-Match` on `POST`, a `DELETE`
  body for the change note, writes answering with the engagement; the
  party-kind check joins Phase 3
- **Phase 1 (CSV report) complete.** `api/views/csv.ts` renders the JSON
  report (`renderReportCsv`, `reportCsvFilename`); `GET /report?format=csv`
  answers `text/csv` as an attachment. The sample report moved from
  `markdown.test.ts` to `test/fixtures/report.ts`, shared by both renderings;
  `test/fixtures/csv.ts` reads a CSV back strictly (RFC 4180) and compares its
  rows with the JSON. Ten deliberate breaks (formula guard, tab/CR guard, BOM,
  CRLF, quote doubling, the row for an activity with no engagements, `asOf`
  per row, the filename, a timestamp's UTC date, the client in the filename)
  each failed a test. OpenAPI: the `format` parameter, a `text/csv` response
  and `Content-Disposition`; `openapi.json` regenerated. API §5.1 documents
  the CSV and its columns
- **Phase 2 (reading engagements) complete.** `api/routes/engagements.ts`
  (`engagementsRouter`, mounted in `recordsRouter`) answers
  `GET /activities/{ref}/engagements` and `/{id}` from `toActivityOutputs`,
  so the shape is the activity's own, read in one repeatable-read
  transaction with the version for the `ETag`. `@rulemark/ropa-schemas`
  exports `ControllerEngagement`, `ProcessorEngagement` and `Engagement`
  (discriminated by `role`); OpenAPI names all three, so `Activity` now
  refers to the first two. Tests over the replayed story
  (`test/db/engagements.test.ts`): P1's two Mailcrest engagements one by one,
  P3's Scribe AI under P1 `404`, a monitor token `403`. Four deliberate
  breaks (permission, the foreign-id `404`, the `ETag`, the list shape) each
  failed a test. API §3.5 documents the reads
- **Phase 3 (writing engagements) complete.** Asked one new question first
  (error paths; body-relative chosen). `domain/activity/engagements.ts`
  (`changeEngagement`) reads the stored activity as its `PUT` body, adds,
  replaces or removes one engagement, parses it as `ActivityInput` and saves
  it through `replaceActivity`; errors are relocated into the body or under
  `/activity`. `POST`, `PUT` and `DELETE` routes in `api/routes/engagements.ts`.
  The party-kind check (`partiesOfTheRightKind` in `rules.ts`) runs on every
  activity save; the replayed story passes it. `EngagementInput` and
  `RemoveEngagementInput` in the schemas package, documented in OpenAPI.
  `test/db/engagement-ch6.test.ts` replays the story without P1's Ch6 edit and
  shows the sub-resource and the whole-activity `PUT` write the same revision
  and events. 13 deliberate breaks each failed a test; two tests were
  tightened first (the viewer for `403`, stale-before-content). API §3.5
  rewritten
- **Phase 4 (deploy and verify) complete.** The first push attempt failed
  with an access error after hanging for two minutes; a diagnosis through the
  SSH agent wrongly blamed the account (the repo's `core.sshCommand` uses its
  own key, which signs in as `mattmeiske`). A retry of the same push worked:
  `git push origin 5b3003b:main` (Phases 1–3 together, since the earlier
  Phase 1 push ended in a docs commit and deployed nothing). CI green,
  `/healthz` uptime reset. Live: `?view=all&asOf=2026-03-01&format=csv` is
  `text/csv`, `ropa-all-2026-03-01.csv`, a BOM and CRLF, 11 rows of C1–C4 and
  P1 matching its JSON, `asOf` on every row, no P3 or Scribe AI;
  `/activities/P1/engagements` equals P1's own under `ETag` 4, both Mailcrest
  engagements read one by one (US: DPF and India; EU: India); P3's id under P1
  `404`; an anonymous `POST` `401`. README tour: engagements, the CSV, and a
  step for changing one vendor
- **After closing: the organisation on every CSV row.** An `organisation`
  column after `generatedAt`, the `self` party's legal name (Art. 30(1)(a)),
  empty until recorded. Tests first (the golden rows, a null organisation, the
  March CSV), one deliberate break caught. Code `0517fcd` pushed alone, CI
  green. The uptime watcher fired early (the previous deploy was only minutes
  old) and the old code answered for another ~80s; confirmed by the header
  itself: the live March CSV names Hireloop B.V. on all 11 rows

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 4 | `npm run check` | 1108 tests pass | 1108 pass (823 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 1 | `npm run check` | all pass | 1137 pass (852 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 2 | `npm run check` | all pass | 1149 pass (864 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 3 | `npm run check` | all pass | 1174 pass (889 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Organisation column | `npm run check` | all pass | 1175 pass (890 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 5 complete, deployed and verified; the build order in `ropa-api.md` §8 is finished |
| Where am I going? | Nothing scheduled: the Monitor, the Snapshot and the DSAR tracker are separate services |
| What's the goal? | The record easy to use: a spreadsheet export, and one vendor changed on its own while the activity stays one aggregate |
| What have I learned? | See findings.md, and `plan-archive/5/findings.md` for step 4 |
| What have I done? | Step 5: the CSV report, reading and writing engagements, the party-kind check, deployed. Steps 1–4 complete and deployed: records and activities, the subprocessor list and report, governance views, history (`asOf`, `/changes`), event delivery and the coverage cron job |
