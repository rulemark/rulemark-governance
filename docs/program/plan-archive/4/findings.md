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
- **Review items get events, not revisions (open question 1, 2026-09-26).** A
  revision is a snapshot for rebuilding state "as of" a date; nothing asks that
  of a review item. What matters about it is its lifecycle (opened, then
  resolved or dismissed), which is a sequence of events. Forcing it into
  `record.changed` would leave `version` and `validFrom` empty and stretch
  `changeType` over values that don't fit. So: `review_item.changed`, carrying
  the full item, because with no revision behind it the event is the only
  history the audit log gets.
  - Ordering needs no work: the `WHERE status = 'open'` guard means an item has
    at most two events, `opened` then one close, so `occurredAt` suffices.
  - The Monitor opens items but acts on resolution through `PUT /activities`,
    so it is not a destination. Adding it later is configuration.
  - `/changes` reads `revision` and won't replay these. Outbox rows are kept
    after delivery, so step 4 can use the outbox as their replay source
    (noted in `ropa-api.md` §8).
- **The EEA lives in the package; adequacy is not an exemption (open question 2,
  2026-09-26).** Nothing expanded `'EEA'` yet, though `RegionCode`'s comment
  says it does. The package owns that literal, so it owns the list, and other
  consumers (the Monitor) can reuse it. Membership changes about once a decade,
  so a released constant is proportionate; a table would be over-built.
  - An adequacy decision (Art. 45) is a lawful basis for a third-country
    transfer, not EEA membership, and Art. 30 still expects the transfer
    recorded. The model already says so: `transfer.mechanism` includes
    `adequacy`. So the code needs no adequacy list at all.
  - `region_violation` follows the contract, not the law: Aurelia agreed on
    the EEA, and adequacy doesn't widen that.
  - Coverage reads current state only, so the list needs no dates, even once
    step 4 gives the report `asOf`.
- **Coverage severity is fixed per type (open question 3, 2026-09-26).** Coverage
  never blocks, so severity only orders attention for the Snapshot and the job
  that opens review items. Judging each finding (e.g. raising it for special
  categories) would make severity hard to predict and to test, and the story
  doesn't need it. `unmapped_system` stays `medium`, not `high`: Ch5's
  `cv-parser` is serious, but most unmapped systems will be a cron job or a
  cache, not a new vendor.
- **Findings get a `key`; the cron job waits (open question 4, 2026-09-26).**
  §5.5 leaves opening review items to "a scheduled job or the Snapshot", and
  `review_item.source` already has both `schedule` and `snapshot`. They divide
  naturally: the Snapshot knows systems (`unmapped_system`); only a schedule
  notices time (`review_overdue`). Either needs to know whether a finding is
  new, and nothing enforces that: "one per target" in DB §4.5 means one index
  per target column, not uniqueness. `(reason, target)` isn't an identity
  either, because one activity can have a `transfer_missing` per engagement or
  country. So `/coverage` gives each finding a stable `key` now, while its
  response shape is being built. The cron job (new resource, principal, token,
  private-network route) is planned in `ropa-api.md` §8 for after step 3.
- **`vendorTerms` is a list (open question 5, 2026-09-26).** Inbound agreements
  have no `offering_id` and engagements don't point at an agreement, so with
  two in force the record can't say which governs. Two in force is ordinary: a
  renewal overlap (often at the same moment as a Ch6-style vendor change), or a
  DPA per product. A `422` would fail the Monitor's key call when it matters
  most, with nothing the caller could change; "most recently signed" would hide
  a per-product DPA. So: list them all, and judge `noticeConflict` on the
  shortest notice. No vendor DPA at all (itself an Art. 28(3) gap) gives
  `noticeConflict: null`, which is more honest than `false`.
  - `inForce` in `domain/agreements.ts` hard-codes `direction = 'outbound'`;
    Phase 2 parameterises it.
- **Data map vendor categories are an upper bound (open question 6,
  2026-09-26).** "∩ the activity's categories" is a no-op (the save rules
  guarantee the subset), and "∩ the subject category" is impossible: an
  activity's subject and data categories are two unlinked sets. It shows in
  Ch7 on one row: C4 concerns recruiters and candidates and sends `telemetry`
  and `identity` to Glitchlog, but only identity (emails in stack traces) is
  really about Lena. Listing both costs her handler a search that finds
  nothing; listing too little would leave her data where nobody looked. Same
  for an Art. 15 access request: too broad is caught by a person, too narrow
  is an incomplete answer. The story already says "possibly".
  - The record gets precise through what's recorded: when the Redaction
    service ships (Ch2's backlog), Priya drops `identity` from C4's Glitchlog
    engagement, and the data map stops pointing at Glitchlog for candidates.
  - The §5.4 example predates the seed: it narrows Glitchlog to `identity` and
    omits Render (P1, P3, C4) and Glitchlog on P1. Render is listed anyway: the
    story reaches it through `hireloop-db`, but it is a recorded engagement.

- **Phase 1: what review items taught (2026-09-26).**
  - `Identifiable.table` was `RootTable`, which demands a `version`. Review
    items are found by code but aren't versioned, so it is now `KeyedTable`
    (`id` only); `findByIdentifier` never used anything else.
  - Express sets a weak `ETag` (`W/"…"`, a content hash) on every JSON
    response. It is for caching and harmless, but a test asserting "no ETag"
    fails on it; assert "no version ETag" (`"n"`) instead.
  - `review_item_closed` sorts before `review_item_status`, so a bad-status
    fixture must be closed in every other respect to reach the status check.
  - The root `db:generate` script doesn't pass `--name` through; rename the
    file and its `_journal.json` tag by hand, as earlier migrations were.
  - For the cron job and the Snapshot (after step 3): `service:snapshot` has
    `review:create` but **not `review:read`**, so it cannot look up open items
    to dedupe on a finding's `key`. Add it when that job is built.

- **Phase 2: the impact view (2026-09-26).**
  - The acceptance test replays the whole story (`replayStory`) into the test
    database, like `seed.test.ts`. One file, `governance-views.test.ts`, does it
    once for Phases 2–4, so the reset cost is paid once.
  - The pure-view fixtures (P1–P3 as snapshots) were local to
    `subprocessors.test.ts`; they now live in `test/fixtures/story-snapshots.ts`.
    Phases 3–4 should add C1–C4 there rather than build their own.
  - The seeded record has two Standard DPA clients (Northwind, Fjord), not 399,
    so no seeded group is large enough to omit its clients. That rule was
    untested until it became `listsClients`, tested on its own; a check on
    the seed alone would have passed with the rule broken.

- **Phase 3: the data map (2026-09-26).**
  - Grouping vendors by party hides per-engagement scoping for a client whose
    engagements are all with parties already listed (Northwind: Mailcrest US
    and EU merge into one "Mailcrest"). Only the Aurelia case (Glitchlog
    absent) catches a missing `isEffectiveFor`; keep that test.
  - The §5.4 example predated the seed in more ways than Q6 found: Scribe AI
    receives only `cv`, and P1 runs on four systems. It is now written from
    the seed.

- **Phase 4: coverage (2026-09-26).**
  - `external_saas_mismatch` was a finding type but not a review-item reason,
    so a caller could never have opened an item for it. Now it is, and a test
    holds every `FINDING_TYPES` value to be in `REVIEW_REASONS`.
  - A per-type test that passes one activity leaves the rest of the record's
    Render systems unused, so `unmapped_system` fires on them. Per-type tests
    filter to their own type; exact whole-list checks use the whole record.
  - The shared fixture's C4 lacked its Glitchlog transfer to the US, which the
    seed has: coverage would have reported a false `transfer_missing`.
  - DM §7's reverse SaaS rule, read literally, flags a host with two tools of
    which the activity uses one. Implemented and documented as "lists none".

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
