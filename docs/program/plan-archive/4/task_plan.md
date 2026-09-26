# Task Plan: RoPA Build Step 3 — Governance views

## Goal
Answer the questions the record exists for. Step 2 made the record; this step
reads it for the people and services who act on it: what depends on a vendor
(the Monitor, Ch6), where a data subject's data lives and whether Hireloop acts
or forwards (the DSAR tracker, Ch7), where the record and the architecture
disagree (the Snapshot, Ch5), and the review items that carry each finding to a
person.

Build step 3 from `docs/ropa/ropa-api.md` §8. **Enough for Ch5–Ch7 and the
Monitor and DSAR integrations.**

## Current Phase
All phases complete: build step 3 is done, pending closing and archiving the plan

## Definition of done for step 3
- Review items can be opened, listed, read, resolved and dismissed through the
  API, with `RI-n` codes, the three-target rule, and a `409` for closing one
  that is not open.
- `GET /parties/mailcrest/impact` on the seeded record answers Chapter 6 as
  §5.3 shows it. Every Mailcrest engagement appears, P1 twice. Clients are
  grouped by terms. Aurelia's group shows `requiresApproval`, a
  `noticeConflict`, and `allowedRegions: ["EEA"]`.
- `GET /data-map?subjectCategory=candidates&client=northwind` answers Lena's
  request (Ch7): P1 and P3 `forward`, C4 `act` with its retention. The same
  for `employees` answers Kees's: C1 `act`, with the 2-year and 7-year rules.
- `GET /coverage` on the seeded record reports Aurelia's `region_violation`
  (Helpdesk Partners in India on Mailcrest's EU region), and nothing that the
  story says is legitimate. C1 has no Render system, and that is fine.
- Deployed and verified on the live, seeded service, pushed code-first
  (see "Decisions carried forward").

## Scope note
`asOf`, `/changes`, the dispatcher and `subprocessors.changed` events are step 4.
CSV and the engagement sub-resource are step 5. The cron job that opens review
items from coverage findings comes after this step (open question 4). The views here read current
state only, as `/subprocessors` and `/report` do. See `ropa-api.md` §8,
"Decided during build step 2", which is where the later steps' decisions live.

## Phases

### Phase 1: Review items
Reference: DM §3.11, DB §4.5, API §2 (workflow), §1.8, §1.9
- [x] `ReviewItemInput` / `ReviewItem` in `@rulemark/ropa-schemas`, with `targetType` + `target` over the three foreign keys
- [x] The `review_item` table, `review_item_one_target` and `review_item_resolution`, the open-by-due index and one per target, and `forbid_immutable_change` on `code`
- [x] `RI-n` codes from the existing counter, inside the creating transaction
- [x] `GET/POST /review-items`, `GET /review-items/{ref}`, filters `status`, `source`, `reason`, `target`, `dueBefore`
- [x] `POST /review-items/{ref}/resolve` and `/dismiss` with a required `resolutionNote`, guarded by `… WHERE status = 'open'` (`409` otherwise)
- [x] Permissions `review:read`, `review:create`, `review:resolve`, as the permission map already declares
- [x] `review_item.changed` (`opened` | `resolved` | `dismissed`) in `EVENT_TYPES`, a migration widening `event_outbox_event_type`, and a `reviewItemChangedEvent` builder; one outbox row per open/resolve/dismiss, to `audit-log`, in the same transaction, with no `revision_id`
- [x] Document the event: DM §3.13, DB `event_outbox`, API §6's event table and envelope
- [x] `openedBy`, `closedBy`, `closedAt` columns, from the token (decided at the start of Phase 1)
- **Decided at the start of Phase 1 (2026-09-26):** review items get their own router, not a `ResourceDefinition` (no versions, ETags, `PUT`/`DELETE` or revisions); `openedBy`/`closedBy`/`closedAt` from the token, so "who dismissed RI-7" is answerable without the audit log; `source` stays caller-set (`openedBy` records the authenticated principal); `?target=` needs `?targetType=`, like the body. **No `openedAt`:** `createdAt` is when the item was opened; a separate column would only serve backdating seeded items, so seeded items (if any) carry their real insert time
- **Done when:** the Monitor's token can open the Ch6 item and read it, cannot resolve it, and a second resolve answers `409`
- **Status:** complete

### Phase 2: `GET /parties/{ref}/impact`
Reference: API §5.3; DM §3.8, §7
- [x] One entry per engagement, with the activity's role, the engagement's role, subject and data categories, special flag and countries
- [x] For processor activities: the clients for whom the engagement is effective (the step 2 scoping functions), grouped by agreement terms, with `requiresApproval`, `noticeConflict` against the vendor's inbound terms, and `allowedRegions`
- [x] `expandClients=true`; small groups (≤ 10) list their clients by default; `summary`
- [x] The vendor's own inbound terms as a list, `vendorTerms: [...]`: every inbound agreement in force (`inForce` in `domain/agreements.ts` hard-codes `outbound`; take the direction as a parameter)
- [x] `noticeConflict` compares against the **shortest** vendor notice; with no inbound agreement it is `null`, not `false`
- [x] Update API §5.3 (the example's `vendorTerms` becomes a one-element list; the `noticeConflict` bullet) and DM §7's impact row
- **Decided while building (2026-09-26):** only live activities and engagements in force today; every entry names its `engagement`; `summary` counts distinct clients; larger groups first; one agreement per client and offering, the most recently signed; an unknown party is `404`, a party nothing depends on answers empty; transfers are not part of the response (§5.3 doesn't ask for them)
- **Done when:** Mailcrest's impact on the seeded record matches the §5.3 example in substance
- **Status:** complete

### Phase 3: `GET /data-map`
Reference: API §5.4; DM §7
- [x] `subjectCategory` required; `client` optional, scoping processor activities to that client's effective engagements
- [x] Per activity: `role`, `action` (`act` for controller, `forward` for processor), systems, vendors with their data categories, retention (controller only)
- [x] `vendors` lists **every** effective engagement's party, Render included, with the engagement's own data categories, not narrowed by subject category (C4's Glitchlog shows `telemetry, identity` for candidates)
- [x] Correct the API §5.4 example to what the seed produces, with a line that categories are what the vendor receives *for the activity* (DM §7's row is already reworded)
- **Decided while building (2026-09-26):** a party with no agreement gets the controller entries only, not an error (the controller side still answers); vendors are grouped once per party and role, merging categories; recipients are included (Art. 19); code order, live activities and engagements in force only
- **Done when:** Lena's request (candidates, Northwind) and Kees's (employees) answer as Chapter 7 tells them
- **Status:** complete

### Phase 4: `GET /coverage`
Reference: API §5.5; DM §5, §7
- [x] `EEA_COUNTRIES` (EU 27 + IS, LI, NO; Greece is `GR`) and `expandRegions(regions): Set<CountryCode>` in `@rulemark/ropa-schemas`, beside `RegionCode`; a test pins the full list
- [x] `unmapped_system`: a Render system no active activity uses; an activity without a Render system is **not** a finding (C1)
- [x] `transfer_missing`: a processing country outside the EEA with no matching transfer. Adequacy countries (GB, CH) are not exempt: they need a transfer row with `mechanism: adequacy`
- [x] `external_saas_mismatch`, both directions
- [x] `region_violation`: an engagement effective for a client whose terms have `allowedRegions`, processing or transferring outside them, onward transfers included
- [x] `review_overdue`
- [x] `{ generatedAt, findings: [{ type, severity, target, details }] }`
- [x] Each finding carries a stable `key` from its type, target and specific cause (`transfer_missing:<engagementId>:US`, `region_violation:<engagementId>:<clientId>:IN`): the same cause gives the same key on every run, and two causes on one target give two keys. Documented in API §5.5 as what a caller stores in a review item's `details` to dedupe
- [x] `FINDING_SEVERITIES` (`high` | `medium` | `low`) in the package; severity fixed per finding type in the coverage view; a severity column in API §5.5's table
- [x] `external_saas_mismatch` added to `REVIEW_REASONS` (migration `0007`), so every finding type can become a review item
- **Decided while building (2026-09-26):** findings carry `targetType` + `target` as a review item would; `details` typed per finding type, and the schema holds each type to its severity; "engagement without system" means the activity lists **none** of the host's SaaS systems (a literal reading would flag a host with two tools, one used); only live activities and engagements in force; `review_overdue` means before today, not on it; a country is reported once per engagement and client, as processing if it is both; `?asOf=` is refused with `not_supported`
- **Done when:** the seeded record yields Aurelia's region violation and no false findings, and a test per finding type proves each fires and each legitimate case does not
- **Status:** complete

### Phase 5: Deploy and verify
- [x] Push code commits on their own, docs separately (the build filter judges a push by its newest commit)
- [x] The three views and review items answer on the live, seeded service
- [x] README tour: the Monitor's, the DSAR tracker's and the Snapshot's questions
- **Verified live (2026-09-26):** Mailcrest's impact, Lena's and Kees's data maps and coverage (exactly Aurelia's region violation) answered on `ropa-api.onrender.com` as the tests expect; `/review-items` answers, empty; `?asOf=` on coverage is `422`
- **Status:** complete

## Open questions
1. ~~**Review items and the audit log.**~~ **Resolved (2026-09-26):** an event type of their own, `review_item.changed`, not `record.changed` and not revisions. See "Decisions carried forward" and `findings.md`. *Phase 1.*
2. ~~**The EEA as data.**~~ **Resolved (2026-09-26):** a constant in the package, beside `RegionCode`; adequacy countries are third countries whose transfers are recorded with `mechanism: adequacy`, not exempt. See "Decisions carried forward" and `findings.md`. *Phase 4.*
3. ~~**Coverage severity.**~~ **Resolved (2026-09-26):** three levels, fixed per finding type, as proposed. See "Decisions carried forward". *Phase 4.*
4. ~~**Who turns findings into review items?**~~ **Resolved (2026-09-26):** not in this step. Step 3 gives each finding a stable `key` so any caller can dedupe; the cron job comes later (`ropa-api.md` §8, "Decided during build step 3"). See "Decisions carried forward". *Phase 4.*
5. ~~**A vendor with several inbound agreements.**~~ **Resolved (2026-09-26):** `vendorTerms` becomes a list of every active inbound agreement; no `422`. See "Decisions carried forward". *Phase 2.*
6. ~~**Data map vendors.**~~ **Resolved (2026-09-26):** the engagement's categories as recorded, an upper bound. See "Decisions carried forward" and `findings.md`. *Phase 3.*

## Decisions carried forward
| Decision | Where it came from |
|---|---|
| Test-driven throughout; tests are written before the code they cover, and checked by breaking the code on purpose | Steps 1–2 |
| Packages stay source-only, with a `development` export condition; rebuild the package before `tsc` reads it without the condition | Step 1, met again in step 2 |
| Snapshot schemas are written by hand and never generated from the tables | Step 1 |
| Database tests run against `<database>_test`; test files run one at a time; each file starts one HTTP server | Step 1 |
| The dashboard is not where infrastructure changes are made; `render.yaml` is | Step 1 |
| A bare "role" means the GDPR sense; permission bundles are `PrincipalRole` | Step 2 |
| Forbidden-by-role is a field-level check; required-by-role waits for activation | Step 2, open question 1 |
| The root's `If-Match` guards the whole activity; nested rows are written only by the aggregate save | Step 2, open question 3 |
| **Views are pure functions over aggregates**; SQL only chooses what to load, so `asOf` can feed them snapshots later. `scopeProcessorActivities`, `isEffectiveFor`, `coversClient` and `clientsByOffering` are the shared vocabulary for "who is this for" | Step 2, open question 4 and Phase 6 |
| "Active agreement": outbound terms, signed on or before the day, not ended by it; judged as of the save's effective date | Step 2, Phase 3 (DM §3.8) |
| Not-yet-supported parameters answer `422 not_yet_supported` rather than being quietly ignored (`asOf`, `format=csv`, `several_offerings`) | Step 2, Phases 5–6 |
| Postgres runs CHECK constraints alphabetically and reports the first failure; map API errors from whichever name comes first | Step 2, Phase 2 |
| **Deploying:** Render judges a push by its newest commit. Push code commits on their own, docs separately. Production data is loaded from the service's Shell (`ropa-db` takes no external connections) | Step 2, Phase 8 |
| **Review items emit `review_item.changed`**, one type with `changeType: opened \| resolved \| dismissed`, following the `<noun>.changed` pattern. There is no revision, so the event *is* the history: its payload carries the whole item after the change (Ref with `RI-n`, `targetType` + `target`, `source`, `reason`, `dueDate`, `status`, `actor`, `resolutionNote` on close). Destination `audit-log` only | Step 3, open question 1 |
| **The EEA is a constant in the package** (`EEA_COUNTRIES`, `expandRegions`), beside `RegionCode`, which already owns what `'EEA'` means. **Adequacy is a transfer mechanism, not an exemption:** a GB or CH processing country without a transfer row is `transfer_missing`, and outside `allowedRegions: ["EEA"]` it is a `region_violation`, adequacy or not | Step 3, open question 2 |
| **Coverage severity is fixed per finding type:** `high` for `region_violation` (breaks a client contract); `medium` for `transfer_missing` and `unmapped_system`; `low` for `external_saas_mismatch` and `review_overdue`. Nothing is judged per instance. Review items get no severity column | Step 3, open question 3 |
| **Coverage findings carry a stable `key`**; `(reason, target)` is not an identity, because review items target an activity, party or system, and one activity can hold several findings of a type (one per engagement or country). **Opening review items from findings is deferred:** a Render cron job (`source: schedule`) comes after step 3, and the Snapshot (`source: snapshot`) when it exists | Step 3, open question 4 |
| **`vendorTerms` is a list** of every inbound agreement in force (same "active" rule as outbound), because nothing ties an engagement to one agreement: renewal overlaps and per-product DPAs both give several. `noticeConflict` uses the shortest vendor notice (the worst case); with no vendor DPA it is `null`, "can't tell", not `false`. Not a `422`: unlike `several_offerings`, the caller couldn't fix it | Step 3, open question 5 |
| **The data map's vendor categories are an upper bound:** each engagement's categories as recorded, since the model doesn't link data categories to subject categories. For erasure and access requests, too broad costs a wasted search; too narrow breaks the law | Step 3, open question 6 |

## Known gaps, not scheduled
- A client with agreements for several offerings (`ropa-api.md` §9, question 6).
- Engagement parties are not checked to be `vendor`/`other`, nor scope clients `client` (DM notes, not §5 rules).
- A `PUT` that swaps a unique value between two nested rows can collide mid-update.
- `mechanism: adequacy` is not checked against the countries that actually have an adequacy decision. That list changes more often than the EEA; it would be a save rule, and the story doesn't need it.
- Data categories aren't linked to subject categories within an activity, so the data map can't narrow a vendor's categories to one subject group. It would matter for an activity sending a sensitive category on behalf of only one of its groups; the story has none.

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
| | | |
