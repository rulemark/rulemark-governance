# Progress Log — Build Step 3

> Step 2's log is archived in `plan-archive/3/progress.md`.

## Session: 2026-09-26
- Closed build step 2, including the three items carried over from step 1
- Wrote the decisions that affect later steps into the design documents
  (`ropa-api.md` §5.1, §5.2, §8, §9; DM §3.8), so they outlive the plan files
- Archived step 2's planning files to `docs/program/plan-archive/3/`
- Wrote the build step 3 plan (5 phases) in `task_plan.md`
- Resolved open question 1: review items emit their own `review_item.changed`
  event; Phase 1 gained the event and its documentation; step 4's backfill
  note added to `ropa-api.md` §8
- Resolved open question 2: the EEA list goes in the package; adequacy
  countries need a transfer row (`mechanism: adequacy`); DM §5 clarified
- Resolved open question 3: coverage severity is fixed per finding type
- Resolved open question 4: findings carry a stable `key`; the cron job that
  opens review items is planned in `ropa-api.md` §8 for after step 3
- Resolved open question 5: `vendorTerms` is a list; `noticeConflict` uses the
  shortest notice, `null` with no vendor DPA
- Resolved open question 6: the data map lists each engagement's categories as
  recorded, an upper bound; all six open questions now resolved
- Phase 1 (review items), test-first, each guard checked by breaking it:
  - Package: `ReviewItemInput`, `ReviewItem`, `CloseReviewItemInput`,
    `ReviewItemsQuery`; `REVIEW_TARGET_TYPES`, `REVIEW_CHANGE_TYPES`;
    `review_item.changed` in `EVENT_TYPES`
  - Migrations `0005_review_items` (generated: table, checks incl. a new
    `review_item_closed`, indexes, widened outbox CHECK) and
    `0006_review_item_triggers` (hand-written: immutable code, updated_at)
  - `domain/review-items.ts` (open, close, output, event) and its own router,
    `api/routes/review-items.ts`; `enqueueEvent` shared with the aggregate save
  - OpenAPI paths and schemas; `openapi.json` regenerated
  - DM §3.11, §3.13, DB §4.5, API §2 and §6 updated

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 2 | `npm run check` | 707 tests pass | 707 pass | ✅ |
| Phase 1 | `npm run check` | all pass | 777 pass (553 API, 219 package, 5 dist) | ✅ |
| Phase 1 | `npm run db:generate` | no drift | "No schema changes" | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| 2026-09-26 | Commit `4148210` shipped step 2's plan files under the step 3 message: the three new-file writes were refused (files changed since last read) and the commit went ahead | Read the files, confirmed the archive held them exactly, wrote the step 3 files | Follow-up commit |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 3, Phase 2 (`/parties/{ref}/impact`), not started |
| Where am I going? | Review items, then `/impact`, `/data-map`, `/coverage`, then deploy |
| What's the goal? | Answer the questions the record exists for: the Monitor's, the DSAR tracker's and the Snapshot's (Ch5–Ch7) |
| What have I learned? | See findings.md, and `plan-archive/3/findings.md` for step 2 |
| What have I done? | Steps 1–2 complete: foundation records, activities with their rules and lifecycle, `/subprocessors`, `/report`, the story seeded and deployed |
