# Progress Log — Build Step 2

> Step 1's log is archived in `plan-archive/2/progress.md`.

## Session: 2026-09-21
- Archived build step 1's planning files to `docs/program/plan-archive/2/`
- Wrote the build step 2 plan (8 phases) in `task_plan.md`
- Step 2 is the design's own step 2 (`ropa-api.md` §8): activities, then
  `/subprocessors` and `/report` — enough for story chapters 2–4. `asOf`,
  `/changes` and the dispatcher stay in step 4; the other views in step 3

## Session: 2026-09-26
- Resolved open question 1: the activity is a discriminated union on `role`,
  with forbidden-by-role as field-level checks. Tested against Zod 4.6.5
  first; the evidence is in findings.md. Phase 1's checklist now spells out
  the shape
- Renamed permission roles to `PRINCIPAL_ROLES` / `PrincipalRole` /
  `PRINCIPAL_ROLE_PERMISSIONS` (`9406ac5`), so a bare "role" means the GDPR
  sense. No database or wire change; the OpenAPI document regenerates
  identically
- **Phase 1 complete.** In `@rulemark/ropa-schemas`: `ActivityInput` /
  `Activity` with nested engagements, transfers, retention rules and both
  client scopes (`resources/activity.ts`); the DM §5 table,
  `describeRoleRules` and `canActivate` (`resources/activity-role-rules.ts`);
  `validateActivityShape`. `fieldErrorsFromZod` moved from the API app into
  the package and reads a rule's own code. Tests written first

## Test Results
| Test | Command | Expected | Actual | Status |
|---|---|---|---|---|
| Inherited from step 1 | `npm run check` | 422 tests pass | 422 pass | ✅ |
| Principal role rename | `npm run typecheck && npm run lint && npm test` | Clean, all pass | Clean; 314 + 104 pass | ✅ |
| Phase 1: the activity shape | `npm run check` | Clean, all pass | Clean; 311 + 180 + 4 pass (3 tests moved from the app to the package) | ✅ |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|---|---|---|---|
| | | | |

## 5-Question Reboot Check
| Question | Answer |
|---|---|
| Where am I? | Build step 2, Phase 2 (the activity tables); Phase 1 complete |
| Where am I going? | Activities and their rules, then `/subprocessors` and `/report`, then the Hireloop seed |
| What's the goal? | Make the record a record: an Art. 30 entry that can be drafted, activated and read |
| What have I learned? | See findings.md, and `plan-archive/2/findings.md` for step 1 |
| What have I done? | Step 1 complete: the foundation records, auth, history and events, deployed on Render from a Blueprint |
