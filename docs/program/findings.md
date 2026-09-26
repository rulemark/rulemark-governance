# Findings & Decisions — Build Step 4

> Step 3's findings are archived in `plan-archive/4/findings.md`, step 2's in
> `plan-archive/3/findings.md`, step 1's in `plan-archive/2/findings.md`. They
> record what the tools and the platform actually did, and several conclusions
> are load-bearing.

## Reference documents
- `docs/ropa/ropa-api.md`: history endpoints §2, views and `asOf` §5, events and delivery guarantees §6, the build order and every later-step decision §8
- `docs/ropa/ropa-database.md`: the save §6.1, snapshot format §6.2, `asOf` reads §6.3, the outbox dispatcher §7
- `docs/ropa/ropa-data-model.md`: versioning §6, `revision` §3.12, `event_outbox` §3.13
- `docs/ropa/ropa-story.md`: Chapter 8 (the regulator) is this step's acceptance scenario; Chapters 5–6 for the events
- `render.yaml`: the deployed stack, where the cron job's resource will go

## What steps 1–3 left ready
- **Every revision is already written**, backdated by the seed to its moment in the story (`valid_from`), and `revision_as_of` indexes `(entity_type, entity_id, valid_from DESC)` for the DB §6.3 query. `GET /{resource}/{ref}/revisions` exists (step 1).
- **Every save has written `record.changed` outbox rows since step 1**, and review items write `review_item.changed` since step 3. Nothing has ever delivered them: the outbox on the live service holds every event since the first deploy, undelivered.
- **The views are pure functions over snapshots:** `standardSubprocessors`, `clientSubprocessors`, `scopeProcessorActivities` (report), `partyImpact`, `dataMap`, `coverage`. Each takes `day`. What changes for `asOf` is the loading, in `api/views/*.ts`: `liveActivities`, `clientAgreementsFor`, `vendorTermsIdsOf`, `activeAgreementsOf`, the terms and ref loaders.
- **Snapshots are validated on write and on read** (`snapshotSchemaFor`), stamped `schemaVersion: 1`, and hold ids, not names.
- **`enqueueEvent`** (`domain/events.ts`) writes one outbox row per destination and is shared by the aggregate save and review items. `DEFAULT_EVENT_DESTINATIONS` is `['audit-log']`.
- **The review-item endpoints** exist, with a `?targetType=&target=` filter but none on `details.key`; the cron job either lists open items by reason and compares keys, or gets a filter.
- **`service:snapshot` lacks `review:read`** (step 3 finding), so it cannot dedupe; Phase 6 adds it.

## Carried-forward cautions
- Render judges a push by its **newest commit**: a push ending in a docs commit deploys nothing, silently. Push up to the last code commit first (`git push origin <sha>:main`), then the rest.
- **The Blueprint auto-syncs.** A `render.yaml` change applies on push, separately from the service's deploy (`render.yaml` is outside the build filter). A new cron resource will appear on the push that adds it.
- `ropa-db` takes no external connections. Anything run against production runs from the `ropa-api` Shell.
- Seed tests and the seeded acceptance tests reset the test database before and after, because the story brings a `self` party.
- Prettier reformats after writing, so an exact-text edit can miss; match on current text.
- Postgres reports the alphabetically first failing CHECK; fixtures must pass every other check to reach the one under test.
- A new export in `@rulemark/ropa-schemas` needs `npm run build -w packages/ropa-schemas` before the app type-checks without the `development` condition.
- The root `db:generate` script doesn't pass `--name` through: rename the generated file and its `_journal.json` tag by hand.
- A test written after the code passes on the first run by construction: break the code on purpose before trusting it.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->
-

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
