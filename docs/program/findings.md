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
- **Phase 1: one reader, two sources (2026-09-26).** The plan asked for "one
  record as of T with the same shape the live loaders give them". The live
  loaders return a mix: Drizzle rows (Dates), snapshots (activities) and
  hand-picked columns. So the shape both give is snapshots, behind a
  `RecordReader` interface listing only what the views ask: find by
  identifier, get by ids, all of a kind, `self`, active activities with four
  filters, agreements in force. `liveRecord` keeps the SQL and the §6.4
  indexes; `recordAsOf` runs DB §6.3 once and filters in memory.
  - **The contract test is the proof.** As of today, both readers must answer
    every question identically on the seeded record, timestamps and order
    included. It caught nothing wrong, but it's what makes Phase 2 a
    rewiring instead of a second implementation of each view.
  - **Order is compared in code units, not `localeCompare`.** ICU collation
    can ignore the hyphens in a UUID; two readers sorting by id must agree
    to the character.
  - **Slugs are matched as spelled at T.** `?client=aurelia&asOf=…` looks for
    the slug in the snapshots of the time, consistent with names coming from
    the revision of the date (DB §6.2). A slug renamed since would need its
    old spelling, or the id. No slug changes in the story.
  - **The whole record is loaded per `asOf` read.** One `DISTINCT ON` query,
    every aggregate: trivial at the story's size (tens of records), and the
    cost of a truly general "as of T". Noted in DB §6.3 as the thing to
    revisit for a large record.
  - `readSnapshot` now serves `/revisions/{version}` too, so every read of
    history takes the upgrade path. The registry is empty; a made-up v0→v1
    upgrader in the unit test proves the chain, the step check and the
    refusals (no upgrader, newer than the code, no `schemaVersion`).
  - **Breaking it on purpose:** 22 mutations across `resolveAsOf`,
    `recordAsOf`, `liveRecord` and `readSnapshot`; one survived at first (the
    live reader's `status = 'active'`, since today's story has no drafts or
    retired activities), so a test now retires C3 in a rolled-back
    transaction. The story also ends no agreement, so another rolled-back
    test ends Northwind's and backdates a signing to check `signed_at` and
    `ended_at` against the day.
- **`npm run check` took over ten minutes once** with the suite itself at
  18s: `tsc --build` ran at 9% CPU (77s wall for 6.6s of work), waiting on
  the disk. Not the code; worth knowing before blaming a change.
- **Phase 2: the rewiring was a refactor, and the old tests said so
  (2026-09-26).** The five builders moved from `(tx, …, now)` to
  `(read: ViewRead, …)`, where `ViewRead` is the reader plus what the
  response stamps (`generatedAt`, the `asOf` asked for). The view logic
  didn't change; the whole suite passed on the first run except the four
  tests that expected `asOf` to be refused. `activeAgreementsOf`,
  `clientsByOffering`, `clientAgreementsFor` and `vendorTermsIdsOf` left
  `domain/agreements.ts`; what they did is now a filter on
  `agreementsInForce`, and "most recently signed per client" lives in
  `api/views/scope.ts`.
  - **Two parts of "as of": which revisions, and which day.** The reader's
    cut-off decides what the record said; `record.day` decides what was in
    force. The seeded story can't tell the second from today's date,
    because it never records anything ahead of its day, so mutating the
    builders to judge on today passed every test. Rolled-back tests now
    record an agreement before it's signed and an engagement before it
    starts, and ask each builder on either side of the date.
  - **An old gap surfaced:** nothing tested that a client with two
    agreements for one offering is grouped under the newer terms (§5.3),
    before or after this phase. Now tested.
  - **A record that didn't exist yet is unknown, not empty.** Aurelia on
    1 March is `unknown_reference`; Scribe AI's impact on 1 March is a
    `404`. The messages say "as of 2026-03-01", so the answer isn't read
    as "no such party, ever".
  - Response `asOf` is `AsOf` (date or timestamp) and echoes the query as
    written, offset included; the shared `AsOf` description now says a
    date is the end of the day, UTC.
  - Test slip worth remembering: "subscribers" contains "scribe". Match
    `scribe-ai`, not `scribe`.
- **Phase 3: `/changes` and review items' own history (2026-09-26).**
  - **One list, one shape.** Revisions and review-item events share
    `{ id, entityType, entity, version, changeType, occurredAt, actor,
    changeNote }`; a review item has `version: null`, `opened`/`resolved`/
    `dismissed`, and its resolution note as the note. `occurredAt` rather
    than `validFrom`: it's the envelope's word for both kinds. The schema is
    a union, so each kind keeps its own change types.
  - **Ordered by when a change took effect, not when it was written.** The
    seed backdates revisions, so id order is not time order, and the cursor
    carries `(time, id)`. The story hid this: it's replayed in time order,
    so ids ascend with `valid_from` and ordering by id passed every test.
    A backdated save recorded last now proves it.
  - **The cursor keeps microseconds.** Postgres stores them; a JavaScript
    `Date` rounds to the millisecond, and a page boundary between two
    changes in one millisecond would repeat one. The app itself writes whole
    milliseconds today, so only rows written in SQL show it; the test does
    that.
  - **Names from the change's own snapshot**, through each aggregate's
    `toRef`, so the naming rules stay in one place. A review item has no
    name: it's named by reason and target ("Region violation on P1").
  - **`review_item_event` has no foreign key**, like `revision.entity_id`,
    and reuses `revision_append_only`, rewritten to name its table
    (`TG_TABLE_NAME`), so revision's message is unchanged. History is
    written whatever the destinations: tests that route events nowhere
    still get it.
  - **The backfill is tested as the migration runs it:** the test reads the
    `INSERT` out of `0009` and runs it against outbox rows, twice. One row
    per `event_id` from any destination, not only `audit-log` rows as the
    plan said: every destination's row carries the same payload, and a
    review item queued only for another consumer is still history.
  - **Accepted:** migrations run before the new code goes live (DB §8.2).
    A review item opened or closed in the minute between the backfill and
    the switch-over would be in the outbox but not the history. Nobody
    touches review items during a demo deploy; noted rather than handled.
  - **An empty custom migration is a trap.** `drizzle-kit generate --custom`
    writes an empty file; the next test run applied it, recorded it as
    done, and never ran the SQL written into it afterwards. Dropping the
    test database fixed it; DB §8.1 now says so.
  - Raw SQL through Drizzle returns timestamps as strings, not `Date`s.


- **Phase 4's three questions (2026-09-27),** raised when building, not in
  planning: the plan said "compared as planned" and "with `effectiveFrom`"
  without saying how.
  - **Planned means every recorded date applied.** A future start is heard
    as added, a future end as removed, when recorded. `effectiveFrom` is the
    first day, from the save's day, on which the saved record shows the entry
    as planned, found by asking the same list functions on each date the
    record holds. Rejected: comparing on the save's day (Scribe AI from 15 May
    would never be heard) and counting only future starts (ends would behave
    differently from beginnings for no reason a client would see).
  - **The offering event includes opt-in modules, marked.** It mirrors
    `GET /subprocessors?offering=`, so a list published from events can't
    disagree with the one the API serves. Rejected: standard list only
    (module changes lost to prospects), and an event per module (a third
    scope no chapter needs).
  - **Client events for every client whose agreement hasn't ended**, a
    future-signed one included, **with the terms they signed**
    (`authorizationType`, `noticeDays`): whether a change needs a notice or
    an approval is the Monitor's first question, and `/subprocessors?client=`
    already answers with the terms. Rejected: today's clients only (a client
    starting next month misses changes to the list they signed up to), and
    Refs only (one more call per event).
- **Phase 4: `subprocessors.changed` (2026-09-27).**
  - **The story is the acceptance test.** Replaying it writes twelve events,
    and the test lists all twelve: P1 live (offering, Northwind, Fjord);
    Aurelia's own P1 edit (Glitchlog removed, Mailcrest moved to Ireland, for
    her alone); P2 live (the offering, Render as a module; Aurelia had Render
    already); P3 live (Scribe AI for everyone but Aurelia); Ch6 (Mailcrest
    changed for the offering and all three clients). It passed on the first
    run, which is also why every guard was then broken by hand.
  - **"Before" is the previous revision**, read in the save's transaction;
    "after" is the live record, which already sees the save's writes. The
    other activities of the offering are the same on both sides. The hook
    is `afterRevision` on the aggregate spec, so create, `PUT`, activate,
    retire and delete all go through it without each call site knowing.
  - **"Planned" is a day, not a mode.** The list as planned is the list
    judged on `9999-12-31`; `effectiveFrom` asks the same functions on each
    date the saved record holds from the save's day on. So is "clients as
    planned": the live reader judged on that day, joined with today's.
  - **Routing arrived early.** `EVENT_ROUTES` (per event type) replaced the
    single default destination, because this is the first event with a
    different consumer. Phase 5 adds the addresses.
  - **A guard the API can't reach, tested anyway.** Only drafts can be
    deleted through the API, and a draft is on no list, so treating a
    deletion as "still listed" passed every test. The domain allows any
    deletion, so a test deletes P3 there, in a rolled-back transaction.
  - **Countries and transfers, not services.** A service renamed is not a
    change (the Ch4 edit renames Mailcrest's service to "(US region)"
    without an event for Northwind); only where data goes is.

- **Phase 5's questions (2026-09-27),** raised when building, not in planning.
  - **Claim with a lease; send outside any transaction.** A short
    transaction claims a batch with DB §7's query (`FOR UPDATE SKIP LOCKED`,
    `now` passed in), pushes each row's `next_attempt_at` forward by a lease
    and adds one to `attempts`, and commits. Sends happen with no transaction
    open; each result is written by its own short update. A claimed row is
    still undelivered, so the ordering rule holds a record's v2 until v1 is
    delivered. The lease must outlast the batch (10 rows, sent one at a time,
    5 s timeout: 50 s at worst, against 2 min). Rejected: one transaction
    across the sends, as §7 was written: a connection and row locks held
    through network I/O, a crash mid-batch resending everything already
    delivered in it, and a slow receiver stretching shutdown past the 10 s
    grace on every deploy. Cost: a crashed dispatcher's rows wait out the
    lease.
  - **One variable per destination, wired by the Blueprint.** The plan's
    single JSON `EVENT_DESTINATIONS` can't be built by `fromService`, which
    gives one value (a private service's `hostport`). Routing already names
    every destination in code, so config declares one optional variable
    each: `EVENT_DESTINATION_AUDIT_LOG`, `EVENT_DESTINATION_MONITOR`. A
    `host:port` becomes `http://host:port/events`; a full URL is used as
    given (local development); unset means that destination's events wait.
    Rejected: the JSON set by hand in the dashboard (a private hostname
    copied by hand, stale on a rename), and `${VAR}` placeholders inside the
    JSON (a templating language for one use). Tests are unaffected:
    `dispatchOnce()` takes its destinations as a parameter.
  - **The envelope is a contract in `@rulemark/ropa-schemas`; the receiver
    is `node:http` and pino.** `EventEnvelope` existed only as an interface
    inside the API, and every consumer (the Monitor next) needs it, which by
    `ropa-packages.md`'s rule puts it in a package, beside the OpenAPI
    document. Only the frame (`id`, `type`, `source`, `occurredAt`, `data`
    an object); each event's `data` schema waits for the Monitor. The
    receiver answers `400` to a malformed body, so a dispatcher bug is a
    logged, retried failure, and logs a one-line summary with the whole
    event as a field. Its build filter includes `packages/**`: a contract
    change redeploys its consumer. Rejected: the frame checked by hand in
    the receiver (two definitions), and Express with the API's config and
    startup modules for one route.
  - **A failing event is retried forever, loudly.** Every failure is logged
    at `warn` (destination, event, record, attempt, error), from the 24th
    attempt (about a day of hourly retries) at `error`. Nothing is skipped:
    once the cause is fixed, the stuck event and everything queued behind it
    go out in order. Ordering makes a stuck event hold its record's later
    events for that destination, and only those. Rejected: giving up after
    N attempts (a gap and reordering in the audit log, which it can only
    backfill from `/changes` if it knows), and treating `4xx` as permanent
    (a misconfigured receiver answering `404` would lose events rather than
    delay them). Dead-lettering can come per destination if the Monitor
    ever needs it.
- **Phase 5: the dispatcher (2026-09-27).**
  - **Review items are ordered through `review_item_event`,** joined on the
    shared `event_id`: it gives the item and `occurred_at`, so their outbox
    rows need no new column. Written out of order in the test, and ordered
    by when they happened, not when they were queued.
  - **`FOR UPDATE` refuses window functions,** so the claim can't number its
    rows; `RETURNING` has no order of its own, so the claim returns each
    row's old `next_attempt_at` and sorts in code.
  - **The lease guard is the one place double sends could come from.** A
    lease shorter than a batch's worst case is refused at the call; the
    result updates are guarded (`delivered_at IS NULL`, the claim's
    `attempts`) for a dispatcher that outlived its lease anyway, and both
    guards have tests that pause a send past its lease.
  - **A record's next version needs another pass,** so the runner goes again
    at once after any pass that found work. The local backlog of 2,045
    events took about 200 passes and 2.4 s.
  - **Test isolation by destination worked as planned;** the file resets the
    database afterwards only because its fixture revisions have no records
    behind them, which the `asOf` readers would trip over.
  - **24 mutations of the dispatcher, 11 of the runner, 15 of the receiver:
    all caught but two equivalents** (`parsed.data` after a successful parse,
    and code before slug on a Ref that never has both). Two tests were
    tightened on the way: `stop()` was checked after the batch had already
    finished, and the stale-lease guards had no test at all.
  - **Locally, a port already held by another process** (a stray
    `next-server` on 3100) made the service's listening socket vanish on
    macOS: it exited 0 on its own without a dispatcher, and with one, a
    `SIGTERM` found no server to close. Nothing to do with Phase 5; on Render
    `PORT` is assigned.
