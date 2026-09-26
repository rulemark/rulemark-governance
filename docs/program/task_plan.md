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
Phase 1 (not started)

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
  delivered event is never sent again.
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
- [ ] Load every aggregate's latest revision at or before T (`revision_as_of`), dropping `deleted` ones
- [ ] Snapshots upgraded on read if an old `schemaVersion` ever exists (none yet: prove the path is there, don't build upgraders)
- [ ] One "record as of T" the views read, with the same shape the live loaders give them: activities, agreements and terms, parties, systems, taxonomies
- [ ] Names in Refs resolved from each record's own revision at T (DB §6.2), so a renamed party reads under its old name
- **Done when:** loading as of 2026-03-01 on the seeded record gives C1–C4 and P1 in their March state, and Aurelia is not a client
- **Status:** pending

### Phase 2: `asOf` in the views
Reference: API §5, §5.1, §5.2, §5.3, §5.4
- [ ] `/report` (JSON and Markdown), `/subprocessors`, `/parties/{ref}/impact` and `/data-map` take `asOf`; `422 not_yet_supported` goes away
- [ ] The response's `asOf` says what was asked for; `generatedAt` stays now
- [ ] "Active" and "in force" judged on the `asOf` day, not today (the pure functions already take `day`)
- [ ] `/coverage` keeps refusing `asOf` (`not_supported`)
- **Done when:** Ch8's two reports and §5.2's `asOf` example answer as the documents say
- **Status:** pending

### Phase 3: `GET /changes`
Reference: API §2 (history), §6 (reconciliation); step 3 open question 1
- [ ] `from`, `to`, `entityType`; every revision in the range across the record, with `actor`, `changeNote`, `changeType`, `version`, `validFrom`
- [ ] Review-item events from the outbox, ordered by `occurredAt` (they have no revision)
- [ ] Paged like every list (§1.3)
- **Done when:** "what changed since March" (Ch8) lists the story's changes in order, review items included
- **Status:** pending

### Phase 4: `subprocessors.changed`
Reference: API §6; DB §6.1 step 5; step 2's decision in API §8
- [ ] The save computes the offering's and each affected client's list before and after, with the functions `GET /subprocessors` uses, and writes `added[]`/`removed[]` when they differ
- [ ] In the same transaction as the save; destination `monitor`
- **Done when:** saving P3 writes Scribe AI added; excluding Aurelia from P3 writes it removed for her alone
- **Status:** pending

### Phase 5: The dispatcher
Reference: DB §7; API §6 (delivery guarantees)
- [ ] Pending events sent by `POST` to each destination's URL; `delivered_at` on a `2xx`
- [ ] Failures retried at 1 min, 5 min, 30 min, then hourly; each attempt's error kept
- [ ] One record's events in version order; rows with no `revision_id` (review items) ordered by `occurredAt`
- [ ] `FOR UPDATE SKIP LOCKED`, so two dispatchers never send one event at once
- [ ] Cleanup of delivered rows, once open question 3 is settled
- **Done when:** events reach a destination, a failing one is retried on schedule, and none is delivered twice
- **Status:** pending

### Phase 6: The coverage cron job
Reference: API §8 ("Decided during build step 3"), §5.5
- [ ] A principal and role for it: `view:coverage`, `review:read`, `review:create`
- [ ] Calls `GET /coverage`, opens a review item with `source: schedule` for each finding whose `key` has no open item; the key goes in `details`
- [ ] Reaches the API over Render's private network
- [ ] A `cron` resource in `render.yaml`
- [ ] `service:snapshot` gains `review:read`, so the Snapshot can dedupe the same way
- **Done when:** on Render, the job opens Aurelia's region violation once, and a second run opens nothing
- **Status:** pending

### Phase 7: Deploy and verify
- [ ] Push code commits on their own, docs separately
- [ ] Ch8 answered on the live, seeded service; the cron job's run visible in Render
- [ ] README tour: the regulator's question, `/changes`, and the cron job

## Open questions
1. **Where do events go?** No consumer exists yet: the audit log (#1) and the Monitor (#5) are future services. Configure destinations as name → URL (an environment variable), and leave events for an unconfigured destination pending? Build a minimal receiver so delivery can be seen end to end? *Phase 5.*
2. **Where does the dispatcher run?** A loop inside the web service (free, and `SKIP LOCKED` makes several instances safe), a Render background worker (API §6's "production shape", a paid instance), or a cron job every minute? *Phase 5.*
3. **Outbox cleanup against review-item history.** DB §7 deletes delivered rows after 30 days, but the outbox is the only store of review-item history, which `/changes` replays. Keep `review_item.changed` rows, give review-item events a table of their own, or accept a month? *Phases 3 and 5.*
4. **What `asOf=2026-03-01` means.** The start of the day or its end, and in which time zone? "The record as it stood on 1 March" suggests the end of the day. A timestamp would be taken as given. *Phase 1.*
5. **Which saves emit `subprocessors.changed`.** Activity saves change lists; so does an agreement being signed or ending (a client's list goes from nothing to something), and a scope row reaching its dates. Which count as a change the Monitor must hear about? *Phase 4.*
6. **The cron job's identity and schedule.** A new principal role (`service:schedule`), minting its own token with the mint secret, and the private-network address of the API. Nightly? And when a finding disappears, should the job resolve the item it opened, or leave that to a person? *Phase 6.*
7. **Testing the dispatcher**, which manages its own transactions rather than one per test (carried from step 2). *Phase 5.*

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
| The seeded-story acceptance tests share one replay per file (`governance-views.test.ts`); pure-view tests share `test/fixtures/story-snapshots.ts` | Step 3 |

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
| | | |
