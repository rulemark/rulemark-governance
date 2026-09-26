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
- **Where events go (open question 1, 2026-09-26).** Two questions in one.
  *Who should hear what* is routing, in code: an outbox row is a promise that
  a consumer will get the event whenever it exists. *Where it lives* is
  configuration (`EVENT_DESTINATIONS`); an unconfigured destination's events
  stay pending, and configuring it later delivers the backlog in order, which
  is what an audit log wants.
  - Something must receive on Render, or delivery is visible only in tests.
    A minimal audit-log receiver as a **private service**: reachable only over
    the private network (a Render feature the demo didn't show yet, and one
    the Phase 6 cron job also uses). About $7/month: Render's docs confirm
    private services can't use free instances; the figure is from
    `service-ideas.md`, not checked live.
  - Sized down: it logs and dedupes in memory. Its own Postgres waits for the
    real service #1. `ropa-db` was ruled out: an audit log shouldn't share
    storage with what it audits.
  - Rejected: a free public web service (anyone could post fake events while
    service auth is deferred), and an external webhook tester (the record's
    history sent to a third party).
- **The dispatcher runs in the web service (open question 2, 2026-09-26).**
  Free, and what DB §7 and API §6 already planned for the demo. The shape
  keeps the choice cheap: `dispatchOnce()` holds all the logic, the runner
  only loops it, so a Render background worker later is a new resource with a
  different start command. The one thing to get right is shutdown: Render
  sends `SIGTERM` on deploy; stop claiming, finish the batch in flight.
- **Review-item history gets its own table (open question 3, 2026-09-26).**
  Step 3 left the outbox as the only store of review-item history, which
  conflicted with DB §7's 30-day cleanup: `/changes` could replay a month, and
  API §6's promise that the audit log can backfill anything it missed would
  break for review items. A second problem: outbox rows exist per destination,
  so history read from them depends on routing. `review_item_event`,
  append-only under `revision_append_only`'s kind of trigger, fixes both, and
  gives the Ch8 regulator the same guarantee for review items as for the
  record. The cost: one table, and each event written twice (history and
  delivery), in one transaction.
- **`asOf` is the end of the day, UTC (open question 4, 2026-09-26).** A date
  answers for two kinds of data: revisions carry instants (`valid_from`), so
  it needs a cut-off; business dates (`signed_at`, scope and engagement dates)
  are dates, and the pure views already take a `day`. "As it stood on
  1 March" includes that day's changes, hence the end of it. UTC because
  `isoDate` already decides "today" in UTC, so `asOf` today and no `asOf`
  agree. Time zones on the `self` party were weighed and left out: a
  regulator asks by the day, and a timestamp gives the hour. Future dates are
  refused rather than answered as a prediction.
- **Which saves emit `subprocessors.changed` (open question 5, 2026-09-26).**
  Read from the event's purpose: Art. 28(2) notices, due before a change takes
  effect. Three consequences:
  - Only activity saves. An agreement signed takes a client's list from
    nothing to everything, but that's onboarding: they saw the list before
    signing (Ch4), and notices of it would be noise.
  - Compared as planned, with `effectiveFrom`. Comparing today's lists misses
    a future-dated change (Ch5's Scribe AI, effective 2026-05-15) when it is
    recorded, and nothing saves on the day it lands.
  - `changed[]` as well as `added[]`/`removed[]`. Ch6 adds no party: Mailcrest
    stays, with an onward transfer to India. The story's operations line
    ("PUT adds transfers → GET /subprocessors changes → outbound notices")
    needs that to be an event.
- **The cron job opens, never decides (open question 6, 2026-09-26).**
  - "No open item" as the dedupe rule had a flaw: a dismissed finding would
    reopen every night, overriding the person who dismissed it. A dismissal
    blocks its key; a resolution doesn't, because a finding that recurs
    after it means the fix didn't hold.
  - It doesn't resolve items whose finding disappeared. The person who fixed
    the record resolves the item and says what they did; "no longer reported"
    says nothing about why, and a finding can vanish for a bad reason (the
    activity retired). So its role has no `review:resolve`.
  - The mint secret and the API's private address both come from `ropa-api`
    through the Blueprint (`fromService`), so neither exists outside Render.
- **Testing the dispatcher (open question 7, carried from step 2, 2026-09-26).**
  Its transactions are the behaviour under test, so the harness's
  rolled-back transaction can't hold it, and the test database's outbox holds
  hundreds of committed rows from other files. The answer came from open
  question 1: the dispatcher serves only configured destinations, so a test
  that configures a unique one sees only its own rows. `now` as a parameter
  turns the retry schedule into arithmetic; a real local receiver keeps the
  "no mocks" rule; separate connections make `SKIP LOCKED`, ordering and
  at-least-once directly observable.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
