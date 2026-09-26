# Findings & Decisions — Build Step 3

> Step 2's findings are archived in `plan-archive/3/findings.md`, step 1's in
> `plan-archive/2/findings.md`. Both are worth re-reading: they record what the
> tools and the platform actually did, and several conclusions are load-bearing.

## Reference documents
- `docs/ropa/ropa-api.md`: impact §5.3, data map §5.4, coverage §5.5, review items §2 and §1.8, build order and later-step decisions §8
- `docs/ropa/ropa-data-model.md`: review items §3.11, client scoping §3.8 (with "active" defined), rules §5, views §7
- `docs/ropa/ropa-database.md`: `review_item` §4.5
- `docs/ropa/ropa-story.md`: Chapters 5–7 are this step's acceptance scenarios
- `render.yaml`: the deployed stack

## What step 2 left ready
- **The seeded record already holds this step's cases.** Aurelia's EU-only terms (`allowedRegions: ["EEA"]`) and the Ch6 onward transfer to India on Mailcrest's EU region are there, so `region_violation` has something to find. C1 lives in Peoplehub, a case coverage must not flag. Mailcrest has four engagements, P1's two among them. C1 has the retention rules Ch7 needs. Load it with `npm run db:seed -- --reset` (local) or from the Render Shell (production).
- **"Who is this for" is solved once:** `scopeProcessorActivities`, `isEffectiveFor` and `coversClient` in `domain/views/subprocessors.ts`; `clientsByOffering` and `activeAgreementsOf` in `domain/agreements.ts`. Impact's client groups and the data map's client scope should use them.
- **The view scaffolding:** `api/views/` (scope, builders, Markdown) and `api/routes/views.ts`, which reads each answer in one repeatable-read, read-only transaction. `loadActivitySnapshots` loads a page of aggregates in about ten queries.
- **Review items were half-prepared in step 1:** the `RI` code counter row, `REVIEW_SOURCES`/`REVIEW_REASONS`/`REVIEW_STATUSES` in the package, the permissions and principal roles, and `forbid_immutable_change`, written generically for `review_item.code`.
- **The router** takes custom saves, lifecycle actions (`defineAction`) and filters of four kinds (`equals`, `reference` via `matches`, `value`, `flag`); the OpenAPI document is built from the same declarations. Resolve and dismiss are actions, but they are guarded by status, not `If-Match`.
- **`inputFromSnapshot` (domain) and `inputFromActivity` (package)** turn a stored or returned activity into the `PUT` body that saves it unchanged.

## Carried-forward cautions
- Render judges a push by its **newest commit**: a push ending in a docs commit deploys nothing, silently. Push code first, on its own.
- **The Blueprint auto-syncs.** A `render.yaml` change applies on push with no manual sync; confirmed 2026-09-26, when `3a4f7c5` (`ipAllowList: []`) showed as the Blueprint's latest sync. It is a separate path from the service's deploy: `render.yaml` is outside the build filter.
- `ropa-db` takes no external connections. Anything run against production runs from the `ropa-api` Shell.
- Seed and `demo:data` tests reset the test database before and after, because the story brings a `self` party; a new test file that needs one must do the same, or use a prefix and clean up.
- Prettier reformats after writing, so an exact-text edit can miss; match on current text.
- Postgres reports the alphabetically first failing CHECK; fixtures must pass every other check to reach the one under test.
- A new export in `@rulemark/ropa-schemas` needs `npm run build -w packages/ropa-schemas` before the app type-checks without the `development` condition.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->
-

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
