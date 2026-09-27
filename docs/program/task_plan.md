# Task Plan: RoPA Build Step 4 — History and delivery

## Goal
Make the record's past answerable and its changes heard. Steps 1–3 wrote every
revision and outbox row and answered questions about today; this step reads
them: the record as it stood on a date (the regulator, Ch8), what changed since
then, events delivered to the services that act on them, and a scheduled job
that carries coverage findings to a person without anyone having to ask.

Build step 4 from `docs/ropa/ropa-api.md` §8. **Enough for Ch8, the audit log,
and a finding reaching a person on its own.**

## Current Phase
Phase 5 (the dispatcher) built; its live check waits for the push. Phases 1–4 complete

## Definition of done for step 4
- `GET /report?view=all&asOf=2026-03-01` on the seeded record answers Chapter 8:
  C1–C4 and P1 as they stood then, no P3 and no Scribe AI, Aurelia not yet a
  client. Without `asOf`, P3 is there. Names come from the revisions of the
  same date, not today's.
- `GET /subprocessors?client=aurelia&asOf=2026-05-01` answers as §5.2's example
  shows; impact and the data map accept `asOf` too. Coverage keeps refusing it.
- `GET /changes?from=2026-03-01` lists what changed since March, with who and
  why: Aurelia signing, P2, P3 on 2026-04-14, the Ch6 edits, and review-item
  events.
- Saving P3 writes `subprocessors.changed` with Scribe AI added, for the offering
  and for each client whose list changed.
- The dispatcher delivers pending events to a configured destination, one
  record's events in version order, retrying with increasing delays, and a
  delivered event is never sent again. On Render, the audit-log receiver (a
  private service) receives the whole backlog since the first deploy.
- The coverage cron job runs on Render, opens one review item for Aurelia's
  region violation (`source: schedule`, the finding's `key` in `details`), and
  a second run opens none.
- Deployed and verified on the live, seeded service, pushed code-first.

## Scope note
CSV and the engagement sub-resource stay in step 5. The Monitor, the audit log,
the DSAR tracker and the Snapshot are separate services and not built here;
this step delivers to them (open question 1). See `ropa-api.md` §8, "Decided
during build step 2" and "Decided during build step 3".

## Phases

### Phase 1: Reading the record as of a date
Reference: DB §6.2, §6.3; DM §6
- [x] `asOf` resolved to a cut-off instant and a day: a date is the end of that day, UTC (`valid_from < next day 00:00Z`), and its own day for business dates; a timestamp is taken as given, its day its UTC date; a future `asOf` answers `422`
- [x] Load every aggregate's latest revision at or before the cut-off (`revision_as_of`), dropping `deleted` ones
- [x] Snapshots upgraded on read if an old `schemaVersion` ever exists (none yet: prove the path is there, don't build upgraders)
- [x] One "record as of T" the views read, with the same shape the live loaders give them: activities, agreements and terms, parties, systems, taxonomies
- [x] Names in Refs resolved from each record's own revision at T (DB §6.2), so a renamed party reads under its old name
- **Built as** a `RecordReader` (`domain/record/`) with two sources, `liveRecord` and `recordAsOf`, answering in snapshots; as of today they answer the same (DB §6.3 "As built"). Phase 2 moves the views onto it
- **Done when:** loading as of 2026-03-01 on the seeded record gives C1–C4 and P1 in their March state, and Aurelia is not a client
- **Status:** complete

### Phase 2: `asOf` in the views
Reference: API §5, §5.1, §5.2, §5.3, §5.4
- [x] The view builders take a `RecordReader` instead of a transaction (Phase 1); the loaders it replaces (`liveActivities`, `termsRef`, the agreement queries in `domain/agreements.ts` the views use, `loadRefs` in the views) go, and the existing view tests hold the rewiring to its word
- [x] `/report` (JSON and Markdown), `/subprocessors`, `/parties/{ref}/impact` and `/data-map` take `asOf`; `422 not_yet_supported` goes away
- [x] The response's `asOf` echoes what was asked for, date or timestamp (the schemas widen from `IsoDate`); `generatedAt` stays now
- [x] API §5 says it plainly: a date means the end of that day, UTC
- [x] "Active" and "in force" judged on the `asOf` day, not today (the pure functions already take `day`)
- [x] `/coverage` keeps refusing `asOf` (`not_supported`)
- **Built:** a future `asOf` answers `422 in_the_future`; a record that did not exist yet on the date is `unknown_reference` (a `404` for the party in the impact path), with the date in the message. `buildCoverage` reads through `liveRecord` too, so every view has one way in
- **Done when:** Ch8's two reports and §5.2's `asOf` example answer as the documents say
- **Status:** complete

### Phase 3: `GET /changes`
Reference: API §2 (history), §6 (reconciliation); step 3 open question 1
- [x] `from`, `to`, `entityType`; every revision in the range across the record, with `actor`, `changeNote`, `changeType`, `version`, `validFrom`
- [x] `review_item_event`: one row per open, resolve or dismiss, written in the same transaction as the change and the outbox row; append-only under the same trigger as `revision`; backfilled from the outbox's `audit-log` rows by the migration
- [x] Review-item events read from `review_item_event`, ordered by `occurredAt` (they have no revision)
- [x] Paged like every list (§1.3)
- **Built:** one list, oldest first, by when each change took effect, ties on id; each change `{ id, entityType, entity, version, changeType, occurredAt, actor, changeNote }`, named from its own snapshot; review items with `version: null` and the resolution note; `from`/`to` dates as whole UTC days; a cursor to the microsecond. `revision_append_only` now names its table and guards both history tables. Migrations `0008` (generated) and `0009` (trigger and backfill)
- **Done when:** "what changed since March" (Ch8) lists the story's changes in order, review items included
- **Status:** complete

### Phase 4: `subprocessors.changed`
Reference: API §6; DB §6.1 step 5; step 2's decision in API §8
- [x] Only activity saves emit, and only when a list changes: never a draft save (drafts are on no list), never an agreement signed or ended (onboarding, not a change)
- [x] Lists compared **as planned**: future-dated engagements and scope rows count, so a change is heard when it is recorded, not when it takes effect; nothing fires when a date arrives
- [x] The save computes the offering's and each affected client's list before and after, with the functions `GET /subprocessors` uses, and writes `added[]`, `removed[]` and `changed[]` (a subprocessor still listed whose countries or transfers changed), each entry with its `effectiveFrom`
- [x] API §6's payload updated to match
- [x] In the same transaction as the save; destination `monitor`
- **Built:** an aggregate's `afterRevision` hook in the generic save; the activity's reads its previous revision and the offering's other live activities, and writes one event per list that changed (`domain/subprocessor-events.ts`), from a pure diff (`domain/subprocessor-changes.ts`). Events carry `terms` and `cause`, and are routed by `EVENT_ROUTES` (`monitor`). The story's replay writes twelve, each checked
- **Done when:** saving P3 writes Scribe AI added; excluding Aurelia from P3 writes it removed for her alone; the Ch6 edit to P1 writes Mailcrest `changed` (India, via Helpdesk Partners) for the offering and each client
- **Status:** complete

### Phase 5: The dispatcher
Reference: DB §7; API §6 (delivery guarantees); Phase 5 questions in "Decisions carried forward"
- [x] Pending events sent by `POST` to each destination's URL; `delivered_at` on a `2xx`
- [x] Failures retried at 1 min, 5 min, 30 min, then hourly; each attempt's error kept; never given up on, logged at `warn`, from the 24th attempt at `error` (Phase 5 question 4)
- [x] One record's events in version order; rows with no `revision_id` (review items) ordered by `occurredAt`
- [x] `FOR UPDATE SKIP LOCKED`, so two dispatchers never send one event at once
- [x] Testable as decided (open question 7): the claim query and backoff take `now` as a parameter, not Postgres's `now()`; tests configure a unique destination (`test-<random>`) and see only its rows; a scriptable local receiver answers `2xx`, `500` or times out; real transactions on the test's own connections prove no double send (two `dispatchOnce()` at once), per-record order (v2 waits for v1), and at-least-once (a crash between send and record resends)
- [x] Runs inside `ropa-api`: `dispatchOnce()` (claim a batch, send, record) and a runner that loops it; on `SIGTERM` the runner stops claiming and lets the batch in flight finish
- [x] Cleanup of delivered rows older than 30 days (DB §7): safe now, since no history lives in the outbox
- [x] Routing in code (which destinations each event type is written for); addresses one variable per destination (`EVENT_DESTINATION_AUDIT_LOG`: a `host:port` or a URL; Phase 5 question 2). A destination with no address is skipped, its events left pending, not failed
- [x] The envelope's frame as a Zod schema in `@rulemark/ropa-schemas` (`id`, `type`, `source`, `occurredAt`, `data`); the API's events parse against it (Phase 5 question 3)
- [x] **The audit-log receiver:** a thin `apps/audit-log` workspace (`node:http`, pino, the package's envelope), `POST /events`, answering `2xx`, `400` to a malformed body, ignoring an `id` it has already seen (in memory), logging a one-line summary of each event. The stub of service #1, not the audit log itself
- [x] A `pserv` (private service) in `render.yaml`, smallest paid instance; `ropa-api`'s `EVENT_DESTINATION_AUDIT_LOG` wired to its `hostport` by `fromService`
- **Built:** `src/delivery/` in `ropa-api`: `claimBatch` (DB §7's query, leased), `dispatchOnce`, `cleanupDelivered`, `startRunner`; started by `index.ts` when a destination is configured, stopped before the pool on `SIGTERM`. `EventEnvelope` in the package's new `events` entry point. `apps/audit-log` (`node:http`, pino). Batch 10, timeout 5 s, lease 2 min, idle 5 s, cleanup hourly. Locally, the development database's backlog (2,045 events, 1,694 records) went out in 2.4 s, each once, none out of order
- **Done when:** events reach a destination, a failing one is retried on schedule, and none is delivered twice; on Render, the receiver's logs show the backlog since the first deploy arriving in order
- **Status:** built; to commit, then the live check (the receiver's logs on Render) after the push

### Phase 6: The coverage cron job
Reference: API §8 ("Decided during build step 3"), §5.5
- [ ] Principal `svc:schedule`, new principal role `service:schedule`: `view:coverage`, `review:read`, `review:create`, and deliberately not `review:resolve`
- [ ] Mints a fresh token each run (`POST /v1/tokens`); `TOKEN_MINT_SECRET` passed from `ropa-api` by the Blueprint (`fromService`), so it never leaves Render
- [ ] Calls `GET /coverage`, opens a review item with `source: schedule` for each finding whose `key` has no **open or dismissed** item (a dismissal is a person's decision; a resolved item doesn't block, since a recurring finding means the fix didn't hold); the key goes in `details`
- [ ] Never resolves or dismisses: a disappearing finding is closed by the person who fixed it, with a note saying why
- [ ] Code in `apps/ropa-api/src/jobs/`, same build, its own start command
- [ ] Reaches the API over Render's private network (`fromService`, `hostport`)
- [ ] A `cron` resource in `render.yaml`, nightly at 02:00 UTC; verified with the dashboard's "Trigger run"
- [ ] `service:snapshot` gains `review:read`, so the Snapshot can dedupe the same way
- **Done when:** on Render, the job opens Aurelia's region violation once, and a second run opens nothing
- **Status:** pending

### Phase 7: Deploy and verify
*Phases 1–4 are already deployed, code first, each verified (see `progress.md`); Ch8's `asOf` and `/changes` answer on the live service.*
- [ ] Push code commits on their own, docs separately
- [ ] Ch8 answered on the live, seeded service; the cron job's run visible in Render
- [ ] README tour: the regulator's question, `/changes`, and the cron job

## Open questions
1. ~~**Where do events go?**~~ **Resolved (2026-09-26):** who hears what is routing, in code; where each destination lives is configuration (`EVENT_DESTINATIONS`, name → URL), and an unconfigured destination's events wait. A minimal audit-log receiver runs as a Render private service. See "Decisions carried forward" and `findings.md`. *Phase 5.*
2. ~~**Where does the dispatcher run?**~~ **Resolved (2026-09-26):** a loop inside `ropa-api`, written as `dispatchOnce()` plus a runner, so moving it to a background worker later is a `render.yaml` change, not a code change. See "Decisions carried forward". *Phase 5.*
3. ~~**Outbox cleanup against review-item history.**~~ **Resolved (2026-09-26):** review-item events get an append-only history table of their own, `review_item_event`; the outbox goes back to being only a delivery queue, and can be purged. See "Decisions carried forward" and `findings.md`. *Phases 3 and 5.*
4. ~~**What `asOf=2026-03-01` means.**~~ **Resolved (2026-09-26):** the end of that day, UTC; a timestamp as given; a future `asOf` refused. See "Decisions carried forward". *Phase 1.*
5. ~~**Which saves emit `subprocessors.changed`.**~~ **Resolved (2026-09-26):** activity saves only, lists compared as planned with `effectiveFrom`, and a `changed[]` beside `added[]`/`removed[]`. See "Decisions carried forward" and `findings.md`. *Phase 4.*
6. ~~**The cron job's identity and schedule.**~~ **Resolved (2026-09-26):** `svc:schedule` with a `service:schedule` role (no `review:resolve`), minting its own token, over the private network, nightly at 02:00 UTC; an open **or dismissed** item blocks a key; the job never closes anything. See "Decisions carried forward" and `findings.md`. *Phase 6.*
7. ~~**Testing the dispatcher**~~ **Resolved (2026-09-26):** real Postgres and real HTTP, no mocks: isolation by a unique destination name, time passed in as a parameter, a scriptable local receiver, and real transactions on the test's own connections. See "Decisions carried forward". *Phase 5.*

## Decisions carried forward
| Decision | Where it came from |
|---|---|
| Test-driven throughout; tests are written before the code they cover, and checked by breaking the code on purpose | Steps 1–3 |
| Packages stay source-only, with a `development` export condition; rebuild the package before `tsc` reads it without the condition | Step 1 |
| Snapshot schemas are written by hand and never generated from the tables | Step 1 |
| Database tests run against `<database>_test`; test files run one at a time; each file starts one HTTP server | Step 1 |
| The dashboard is not where infrastructure changes are made; `render.yaml` is. The Blueprint auto-syncs on push | Steps 1, 3 |
| A bare "role" means the GDPR sense; permission bundles are `PrincipalRole` | Step 2 |
| **Views are pure functions over aggregates**; SQL only chooses what to load, so `asOf` feeds them snapshots. `partyImpact`, `dataMap` and `coverage` joined the step 2 views in step 3 | Steps 2–3 |
| "Active agreement": outbound (or, for a vendor's DPA, inbound) terms, signed on or before the day, not ended by it | Steps 2–3 |
| Not-yet-supported parameters answer `422 not_yet_supported`; a parameter that will never be supported answers `not_supported` (`asOf` on coverage) | Steps 2–3 |
| Postgres runs CHECK constraints alphabetically and reports the first failure | Step 2 |
| **Deploying:** Render judges a push by its newest commit. Push code up to the last code commit (`git push origin <sha>:main`), then docs. Production data is loaded from the service's Shell | Steps 2–3 |
| **Review items emit `review_item.changed`**, carrying the whole item; no revisions. `openedBy`/`closedBy`/`closedAt` from the token; `createdAt` is when it was opened | Step 3 |
| **The EEA is a constant in the package**; adequacy is a transfer mechanism, not an exemption | Step 3 |
| **Coverage findings carry a stable `key`**, a fixed severity per type, and the `targetType` + `target` a review item would point at. Every finding type is a review-item reason | Step 3 |
| `vendorTerms` is a list; `noticeConflict` uses the shortest vendor notice, `null` without a vendor DPA | Step 3 |
| The data map's vendor categories are an upper bound | Step 3 |
| **Events: routing in code, addresses in configuration.** Outbox rows are written for every consumer that should hear an event, whether or not it is running; `EVENT_DESTINATIONS` maps a name to a URL (since Phase 5, one variable per destination), and an unconfigured destination's events wait. **A minimal audit-log receiver runs as a Render private service** (about $7/month, the smallest paid instance; private services have no free tier): it logs and dedupes in memory, its own storage deferred to service #1. Not a free public web service: with service auth deferred, anyone could post fake events to an audit log | Step 4, open question 1 |
| **The dispatcher runs inside `ropa-api`**, free, as DB §7 and API §6 plan for the demo; `SKIP LOCKED` keeps several instances safe, and at-least-once delivery makes a restart mid-send one duplicate the receiver ignores. Written as `dispatchOnce()` plus a runner, so a background worker later is a new `render.yaml` resource with the same code. Not a worker now (a second paid instance for a few events a day), nor a cron job every minute (a minute's latency, and start-up paid 1,440 times a day) | Step 4, open question 2 |
| **Review-item events have a history table of their own**, `review_item_event`, append-only like `revision`. The outbox is only a delivery queue: its rows exist per destination, so history read from it would depend on routing, and its cleanup would cut `/changes` to a month. Step 3's decision stands (events, not revisions); they get a proper home | Step 4, open question 3 |
| **`asOf` as a date means the end of that day, in UTC**: revisions with `valid_from` before the next day's midnight UTC, and that day for business dates (agreements, scopes, engagements). A timestamp is taken as given. A future `asOf` is refused: the record can't know tomorrow, and judging "in force" on a future day reads as a prediction. UTC matches how the code already decides "today", so `asOf` today equals no `asOf`. Accepted: a save at 23:30 UTC counts as that day though it was past midnight in Amsterdam; a timestamp gives the hour when it matters | Step 4, open question 4 |
| **`subprocessors.changed` is for changes clients have agreed to hear about** (Art. 28(2): before they take effect). Only activity saves emit, and only when a list changes; agreements signed or ended don't (the client got the list before signing). Lists are compared as planned, future-dated rows included, and each entry carries `effectiveFrom`. The payload gains `changed[]`: a subprocessor still listed whose countries or transfers changed (Ch6: Mailcrest's onward transfer to India) | Step 4, open question 5 |
| **The coverage cron job opens, never decides.** `svc:schedule`, role `service:schedule` (`view:coverage`, `review:read`, `review:create`; no `review:resolve`), a token minted per run with the secret passed by the Blueprint, the API reached over the private network, nightly at 02:00 UTC. A key with an open or dismissed item is skipped: a dismissal stands. It never closes an item: the person who fixes a finding says why | Step 4, open question 6 |
| **The dispatcher is tested against real Postgres and real HTTP.** A unique destination per test isolates its rows from every other file's committed events (unconfigured destinations are ignored); `now` is a parameter, so the retry schedule is tested by advancing a clock, not by sleeping; a local receiver is scripted to succeed, fail or time out; real transactions on the test's own connections make double sends, ordering and at-least-once observable. The runner's loop and shutdown are tested without a database | Step 4, open question 7 |
| **`subprocessors.changed`, as built (Phase 4 questions, 2026-09-27):** (1) the planned list is the list once every start and end date recorded has arrived; each entry's `effectiveFrom` is the first day, from the save's own day, on which the saved record shows it as planned. (2) The offering event mirrors `GET /subprocessors?offering=`: standard entries and opt-in module entries, each marked with its `module` (null, or the activity). (3) Client events go to every client holding an agreement for the offering that has not ended, a future-signed one included, and carry the terms that client signed | Step 4, Phase 4 |
| **The dispatcher, as built (Phase 5 questions, 2026-09-27):** (1) a batch is claimed with a lease in a short transaction (`next_attempt_at` pushed forward, `attempts + 1`) and sent with no transaction open, each result written as it lands; the lease outlasts the batch. (2) One optional variable per destination named in routing (`EVENT_DESTINATION_AUDIT_LOG`, `EVENT_DESTINATION_MONITOR`), not a JSON map: `host:port` (what `fromService` gives) becomes `http://host:port/events`, a URL is used as given. (3) The envelope's frame is a Zod schema in `@rulemark/ropa-schemas` (per-event `data` schemas wait for the Monitor); the receiver is `node:http` and pino, validates against it (`400` otherwise), and redeploys when `packages/**` changes. (4) A failing event is retried forever, never skipped: each failure logged at `warn`, from the 24th attempt at `error`; a stuck event holds only its own record's later events, for that destination | Step 4, Phase 5 |
| The seeded-story acceptance tests share one replay per file (`governance-views.test.ts`); pure-view tests share `test/fixtures/story-snapshots.ts` | Step 3 |
| **The views read a `RecordReader`**, live or as of a date, and get snapshots either way; a slug is matched as the record spelled it at *T*; an `asOf` read loads the whole record at *T* once | Step 4, Phase 1 |

## Known gaps, not scheduled
- A client with agreements for several offerings (`ropa-api.md` §9, question 6).
- Engagement parties are not checked to be `vendor`/`other`, nor scope clients `client`.
- A `PUT` that swaps a unique value between two nested rows can collide mid-update.
- `mechanism: adequacy` is not checked against the countries that have an adequacy decision.
- Data categories aren't linked to subject categories within an activity.
- Review items have no `openedAt` separate from `createdAt`, so they can't be backdated by the seed.

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
| An empty custom migration (`0009`) was applied by a test run before its SQL was written, and never re-run | 1 | Dropped the test database; DB §8.1 warns (details in `progress.md`) |
| `/changes` answered 500: raw SQL returns timestamps as strings | 1 | Parsed with `new Date(…)` |
