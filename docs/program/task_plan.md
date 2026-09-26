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
Phase 1 (not started)

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
CSV and the engagement sub-resource are step 5. The views here read current
state only, as `/subprocessors` and `/report` do. See `ropa-api.md` §8,
"Decided during build step 2", which is where the later steps' decisions live.

## Phases

### Phase 1: Review items
Reference: DM §3.11, DB §4.5, API §2 (workflow), §1.8, §1.9
- [ ] `ReviewItemInput` / `ReviewItem` in `@rulemark/ropa-schemas`, with `targetType` + `target` over the three foreign keys
- [ ] The `review_item` table, `review_item_one_target` and `review_item_resolution`, the open-by-due index and one per target, and `forbid_immutable_change` on `code`
- [ ] `RI-n` codes from the existing counter, inside the creating transaction
- [ ] `GET/POST /review-items`, `GET /review-items/{ref}`, filters `status`, `source`, `reason`, `target`, `dueBefore`
- [ ] `POST /review-items/{ref}/resolve` and `/dismiss` with a required `resolutionNote`, guarded by `… WHERE status = 'open'` (`409` otherwise)
- [ ] Permissions `review:read`, `review:create`, `review:resolve`, as the permission map already declares
- **Done when:** the Monitor's token can open the Ch6 item and read it, cannot resolve it, and a second resolve answers `409`
- **Status:** pending

### Phase 2: `GET /parties/{ref}/impact`
Reference: API §5.3; DM §3.8, §7
- [ ] One entry per engagement, with the activity's role, the engagement's role, subject and data categories, special flag and countries
- [ ] For processor activities: the clients for whom the engagement is effective (the step 2 scoping functions), grouped by agreement terms, with `requiresApproval`, `noticeConflict` against the vendor's inbound terms, and `allowedRegions`
- [ ] `expandClients=true`; small groups (≤ 10) list their clients by default; `summary`
- [ ] The vendor's own inbound terms (`vendorTerms`)
- **Done when:** Mailcrest's impact on the seeded record matches the §5.3 example in substance
- **Status:** pending

### Phase 3: `GET /data-map`
Reference: API §5.4; DM §7
- [ ] `subjectCategory` required; `client` optional, scoping processor activities to that client's effective engagements
- [ ] Per activity: `role`, `action` (`act` for controller, `forward` for processor), systems, vendors with their data categories, retention (controller only)
- **Done when:** Lena's request (candidates, Northwind) and Kees's (employees) answer as Chapter 7 tells them
- **Status:** pending

### Phase 4: `GET /coverage`
Reference: API §5.5; DM §5, §7
- [ ] `unmapped_system`: a Render system no active activity uses; an activity without a Render system is **not** a finding (C1)
- [ ] `transfer_missing`: a processing country outside the EEA with no matching transfer
- [ ] `external_saas_mismatch`, both directions
- [ ] `region_violation`: an engagement effective for a client whose terms have `allowedRegions`, processing or transferring outside them, onward transfers included
- [ ] `review_overdue`
- [ ] `{ generatedAt, findings: [{ type, severity, target, details }] }`
- **Done when:** the seeded record yields Aurelia's region violation and no false findings, and a test per finding type proves each fires and each legitimate case does not
- **Status:** pending

### Phase 5: Deploy and verify
- [ ] Push code commits on their own, docs separately (the build filter judges a push by its newest commit)
- [ ] The three views and review items answer on the live, seeded service
- [ ] README tour: the Monitor's, the DSAR tracker's and the Snapshot's questions

## Open questions
1. **Review items and the audit log.** DM §4: review items are "not versioned; changes go to the audit log". There are no revisions for them (`revision.entity_type` has no `review_item`). What should they write instead: a `record.changed` event with `entityType: review_item`, or an event type of their own? `event_outbox.revision_id` is already nullable. *Phase 1.*
2. **The EEA as data.** `allowedRegions: ["EEA"]` and `transfer_missing` both need the EEA's member countries (EU 27 plus Iceland, Liechtenstein and Norway). Where should the list live? The package seems natural, beside `RegionCode`, which already accepts `EEA`. And should an adequacy country (e.g. the UK) count as "no transfer needed"? *Phase 4.*
3. **Coverage severity.** §5.5 names `severity` but not its values. A proposal: `high` for `region_violation`, `medium` for `transfer_missing` and `unmapped_system`, `low` for the rest. *Phase 4.*
4. **Who turns findings into review items?** §5.5: "a scheduled job (a natural fit for a Render cron job) or the Snapshot". A cron job is another Render feature worth showing, but it is also a new resource in `render.yaml`. In this step, or with the Snapshot later? *Phase 4/5.*
5. **A vendor with several inbound agreements.** `vendorTerms` is singular in §5.3. The seeded record has one per vendor. Which one wins if there were two, and is that another "not supported yet"? *Phase 2.*
6. **Data map vendors.** §5.4 lists vendors with their data categories, and DM §7 says "data categories ∩". Is that intersection the engagement's categories with the activity's, which the save rules already guarantee, or with something tied to the subject category? *Phase 3.*

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

## Known gaps, not scheduled
- A client with agreements for several offerings (`ropa-api.md` §9, question 6).
- Engagement parties are not checked to be `vendor`/`other`, nor scope clients `client` (DM notes, not §5 rules).
- A `PUT` that swaps a unique value between two nested rows can collide mid-update.

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
| | | |
