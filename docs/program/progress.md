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

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 4 | `npm run check` | 1108 tests pass | 1108 pass (823 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 1 | `npm run check` | all pass | 1137 pass (852 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |
| Phase 2 | `npm run check` | all pass | 1149 pass (864 api, 262 schemas, 14 audit-log, 9 dist) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 5, Phase 3 (writing engagements), not started; Phases 1–2 complete, not pushed |
| Where am I going? | The CSV report, reading engagements, writing engagements, then deploy |
| What's the goal? | The record easy to use: a spreadsheet export, and one vendor changed on its own while the activity stays one aggregate |
| What have I learned? | See findings.md, and `plan-archive/5/findings.md` for step 4 |
| What have I done? | Step 5 Phases 1–2: the CSV report, reading engagements. Steps 1–4 complete and deployed: records and activities, the subprocessor list and report, governance views, history (`asOf`, `/changes`), event delivery and the coverage cron job |
