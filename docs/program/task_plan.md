# Task Plan: RoPA Build Step 5 — Conveniences

## Goal
Two things the record already supports, made easy to use. A **CSV export** of
the Art. 30 record, one row per activity × engagement, for the people who
answer questionnaires and regulators in a spreadsheet. And an **engagement
sub-resource**, so a caller can change one vendor on an activity (Ch6: the
onward transfer to India) without sending the whole activity, while it stays
one aggregate: one version, one revision, the same rules and events.

Build step 5 from `docs/ropa/ropa-api.md` §8, the last in its build order.

## Current Phase
Phase 4 (deploy and verify), in progress. Phases 1–3 complete and committed

## Definition of done for step 5
- `GET /report?format=csv` answers `text/csv`, one row per activity ×
  engagement, for every view and scope `format=json` takes, `asOf` included:
  `?view=all&asOf=2026-03-01&format=csv` holds the rows of C1–C4 and P1 as
  they stood, and no P3. `422 not_yet_supported` is gone.
- It opens cleanly in a spreadsheet, and a value can't run as a formula there.
- `GET /activities/{ref}/engagements` and `/{id}` read an activity's
  engagements, as the activity holds them (§3.5).
- Chapter 6's edit through the sub-resource: `PUT /activities/P1/engagements/{id}`
  adding Mailcrest's onward transfer to India writes one activity revision
  (`If-Match` and `ETag` the activity's version), `record.changed`, and
  `subprocessors.changed` for the offering and each client, exactly as the
  whole-activity `PUT` does. Adding and removing an engagement likewise.
- Deployed and verified on the live, seeded service, pushed code-first.

## Scope note
The Monitor, the Snapshot and the DSAR tracker stay separate services, not
built here. Known gaps (below) stay unscheduled; open question 5 brought one, the
engagement party-kind check, into Phase 3. See `ropa-api.md` §3.5, §5.1 and §8.

## Phases

### Phase 1: CSV report
Reference: API §5.1; DB §6.3
- [x] `format=csv` on `GET /report`: every view, scope and `asOf` the JSON
      takes, from the same report builder, so the two can't disagree
- [x] One row per activity × engagement (open question 1): the activity's columns repeated per engagement, one row for an activity with none; `activityRole` and the union of both roles' columns; lists joined with `; `; `asOf` and `generatedAt` on every row
- [x] Spreadsheet-safe (open question 2): formula cells neutralised with a leading `'`; a UTF-8 BOM; RFC 4180 quoting and CRLF
- [x] `Content-Type: text/csv`, a `Content-Disposition` filename naming the
      scope and date
- [x] OpenAPI: the `format` parameter and a `text/csv` response;
      `openapi.json` regenerated
- **Done when:** the regulator's report as of 1 March downloads as CSV and
  holds the same activities and engagements as its JSON
- **Status:** complete (2026-09-27). 1137 tests pass; each new test was checked by breaking the code on purpose

### Phase 2: Reading engagements
Reference: API §3.5; DM §3.2, §3.3, §3.8
- [x] `GET /activities/{ref}/engagements`: the activity's engagements, in the
      activity's output shape; `ETag` the activity's version
- [x] `GET /activities/{ref}/engagements/{id}`: one, by `id` only
      (engagements have no code or slug, DM §3.0); `404` for an id the
      activity doesn't hold, another activity's included
- [x] Reading needs what reading the activity needs; OpenAPI paths
- **Done when:** P1's two Mailcrest engagements read one by one, and an id
  from P3 under P1 answers `404`
- **Status:** complete (2026-09-27). 1149 tests pass; four deliberate breaks each failed a test

### Phase 3: Writing engagements
Reference: API §3.5, §1.8; DB §6.1
- [x] `POST`, `PUT` and `DELETE`, each a read-modify-save of the whole
      activity through the existing save (`inputFromSnapshot`, the activity's
      `PUT` path), so versioning, validation, revisions, `record.changed` and
      `subprocessors.changed` (`afterRevision`) come for free
- [x] `If-Match` and `ETag` are the activity's version (§3.5); writing needs
      `record:write` (open question 3); `If-Match` on `POST` as well, a
      `DELETE`'s `changeNote` in an optional body, and each write answering
      with the engagement: `201` with `Location`, `200`, `204` (open
      question 4)
- [x] The activity validated as a whole after the change: structural checks
      always, role rules when it is `active`
- [x] An engagement's party must be a `vendor` or `other`, a scope's client
      a `client`: structural validation in the activity save, so every write
      path gets it (`422` naming the field); the seeded story passes it
      first (open question 5)
- [x] API §3.5 updated: the actor comes from the token (not `X-Actor`, which
      it still says), and it is for anyone changing one vendor, not the
      Monitor and the Snapshot (open question 3)
- **Done when:** Ch6's onward transfer, added through the sub-resource on a
  replayed story, writes the same revision and events as the whole-activity
  `PUT`; a stale `If-Match` answers `412`
- **Status:** complete (2026-09-27). 1174 tests pass; 13 deliberate breaks each failed a test

### Phase 4: Deploy and verify
- [ ] Push code commits on their own, docs separately
- [ ] On the live, seeded service: the CSV as of 1 March; an engagement read
- [ ] README tour: the CSV download, and one engagement edited on its own
- **Status:** in_progress

## Open questions
1. ~~**The CSV's shape.**~~ **Resolved (2026-09-27):** one table, a row per activity × engagement, `activityRole` and the union of both roles' columns, lists joined with `; `, `asOf` and `generatedAt` on every row, the scope and date in the filename. See `findings.md`. Was: "One row per activity × engagement" (§5.1) leaves the
   columns open: controller and processor activities side by side in one file
   (`view=all`) or not, an activity with no engagements, fields with many
   values (categories, countries, transfers), and where `asOf`, the scope and
   `generatedAt` go in a format with no header block. *Phase 1.*
2. ~~**The CSV in a spreadsheet.**~~ **Resolved (2026-09-27):** a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` (OWASP); a UTF-8 byte-order mark; otherwise RFC 4180. See `findings.md`. Was: It will be opened in Excel by a DPO or a
   regulator. Cells from the record (names, service descriptions, notes)
   could start with `=`, `+`, `-` or `@` and run as formulas; and Excel reads
   UTF-8 without a byte-order mark as the local code page. *Phase 1.*
3. ~~**Who may write engagements.**~~ **Resolved (2026-09-27):** `record:write`, as for any change to an activity; no service role gains it, and §3.5's motivation is rewritten. See `findings.md`. Was: §3.5 names the Monitor and the Snapshot as
   the callers it's for, but their roles hold no `record:write`, and step 4's
   cron job settled that services open review items and people decide. The
   sub-resource could stay `record:write` (people), or give a service a
   narrower write. *Phase 3.*
4. ~~**The write conventions.**~~ **Resolved (2026-09-27):** `If-Match` on `POST` too; a `DELETE` carries an optional `{ changeNote }` body; writes answer with the engagement (`201` with `Location`, `200`, `204`), `ETag` the activity's version. See `findings.md`. Was: Whether adding an engagement (`POST`) needs
   `If-Match` like every other change to an existing record; how a `DELETE`
   carries its `changeNote` (the record's own `DELETE` takes none, since it
   removes drafts only, but removing a vendor from a live activity is exactly
   what a change note is for); and whether a write answers with the
   engagement or the whole activity. *Phase 3.*
5. ~~**What else, if anything, joins step 5.**~~ **Resolved (2026-09-27):** the engagement party-kind check joins Phase 3; `@rulemark/ropa-client` waits for its first consumer; the other gaps stay unscheduled. See `findings.md`. Was: The known gaps below, one of
   which touches this step (engagement parties aren't checked to be
   `vendor`/`other`); and `@rulemark/ropa-client`, which `ropa-packages.md`
   §5 designs and is still an empty package. *Scope.*

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
| **The coverage job, as built (Phase 6 questions, 2026-09-27):** (1) `GET /review-items?key=` matches `details->>'key'`; the job asks once per finding and skips when an open or dismissed item comes back. (2) `svc:schedule` is added to `PRINCIPALS` in the dashboard by hand, like every subject; a `401` from minting names it | Step 4, Phase 6 |
| The seeded-story acceptance tests share one replay per file (`governance-views.test.ts`); pure-view tests share `test/fixtures/story-snapshots.ts` | Step 3 |
| **The views read a `RecordReader`**, live or as of a date, and get snapshots either way; a slug is matched as the record spelled it at *T*; an `asOf` read loads the whole record at *T* once | Step 4, Phase 1 |
| **The CSV report (step 5, open questions 1–2):** (1) one table, a row per activity × engagement, `activityRole` and the union of both roles' columns, lists joined with `; `, `asOf` and `generatedAt` on every row, the scope and date in the filename; no closing subprocessor list. (2) Spreadsheet-safe: a leading `'` on a cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return; a UTF-8 BOM; RFC 4180 | Step 5 |
| **The engagement sub-resource (step 5, open questions 3–4):** (3) writing needs `record:write`, as for any change to an activity; no service role gains it. Services open review items; people record changes. (4) `If-Match` on every write, `POST` included; a `DELETE`'s `changeNote` in an optional JSON body; writes answer with the engagement (`201` + `Location`, `200`, `204`), `ETag` the activity's version | Step 5 |
| **Scope (step 5, open question 5):** the engagement party-kind check joins Phase 3; `@rulemark/ropa-client` waits for its first consumer | Step 5 |

## Known gaps, not scheduled
- A client with agreements for several offerings (`ropa-api.md` §9, question 6).
- A `PUT` that swaps a unique value between two nested rows can collide mid-update.
- `mechanism: adequacy` is not checked against the countries that have an adequacy decision.
- Data categories aren't linked to subject categories within an activity.
- Review items have no `openedAt` separate from `createdAt`, so they can't be backdated by the seed.
- Nothing stops two open review items for one finding `key` if the job and the Snapshot open it at the same moment: a `key` column with a partial unique index on open items would (Phase 6 question 1).

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
