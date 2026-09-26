# Task Plan: RoPA Build Step 2 — Activities

## Goal
Make the record a record. Step 1 built everything an activity needs; this step
builds the activity itself — the discriminated union on `role`, the rules that
make an entry valid, the lifecycle that puts it live — and the two views that
turn the stored record into something a person reads.

Build step 2 from `docs/ropa/ropa-api.md` §8. **Enough for story chapters 2–4.**

## Current Phase
Phase 5

## Definition of done for step 2
- A controller activity and a processor activity can be created, edited,
  activated and retired through the API, with codes allocated and revisions
  written as in step 1.
- Role rules are enforced: what is required, forbidden and allowed differs by
  role, drafts may be incomplete, and `active` records may not.
- Nested rows keep their identity across a `PUT`: sent with an `id` updates,
  without one inserts, left out deletes.
- `GET /subprocessors` answers for an offering and for a client, and the two
  differ for Aurelia exactly as Chapter 4 says they should.
- `GET /report` answers in JSON and Markdown, the Markdown carrying stable
  anchors built from codes.
- `npm run db:seed` replays the Hireloop story, backdated, so the record has a
  history rather than a single moment.

## Scope note
`asOf`, `/changes` and the outbox **dispatcher** stay in step 4, so the views
here read current state only. The rows the dispatcher will deliver are already
being written. `/parties/{ref}/impact`, `/data-map`, `/coverage` and review
items are step 3; CSV and the engagement sub-resource are step 5.

## Phases

### Phase 1: The activity shape
Reference: `ropa-data-model.md` §3.1–§3.4, §5; `ropa-packages.md` §4.1, §4.3
- [x] `ActivityInput` / `Activity` in `@rulemark/ropa-schemas`: a `z.discriminatedUnion` on `role` (Q1, resolved), with `.meta({ discriminator: { propertyName: 'role' } })` so OpenAPI carries it
- [x] A field-level `forbidden(message)` helper: a refinement on the field itself with `params.code = 'forbidden_for_role'`, documented as `{ "not": {} }`. Never a member-level `superRefine`, which is skipped while any structural error remains
- [x] Required-by-role fields stay optional in the schema (drafts may be incomplete) and are checked by `canActivate`
- [x] Allowed engagement roles as a per-member enum (`processor | recipient` / `subprocessor`), reporting `role_not_allowed`; engagement `clientScope` on the processor member only
- [x] Nested shapes: engagement, transfer, retention rule, and both client scopes
- [x] The pure rule helpers (§4.3): `validateActivityShape`, `canActivate`, `describeRoleRules`
- [x] `joint_controller` as a third member that always fails with `not_yet_supported` at `/role` (DM §10, Q5)
- [x] Refinements that compare fields on one record (scope `mode` ↔ `clientCoverage`) go last, on the processor member; derive `pick`/`omit`/`partial` from the unrefined members, because Zod 4 throws on refined ones
- [x] `fieldErrorsFromZod` reports `issue.params.code` when present, so custom codes reach the caller instead of `custom`
- **Done when:** a processor activity with `purposes` and an invalid `name` fails the shape check with both errors in one response, `/purposes` carrying `forbidden_for_role`
- **Status:** complete

### Phase 2: The activity tables
Reference: `ropa-database.md` §4.4, §4.6
- [x] `processing_activity` with the role-dependent checks, including the three guarded by `status = 'active'`
- [x] `engagement`, `transfer`, `retention_rule`, `activity_client_scope`, `engagement_client_scope`
- [x] The four link tables, with the indexes the views will need
- [x] Attach `forbid_immutable_change` to `code` and `role` — the function has been waiting since step 1
- [x] Migration reviewed against §4.4, and a test per named constraint
- [x] `retention_period` check tested with the same accepted and rejected values as `IsoDuration` in `primitives.test.ts`, so the two stay identical
- **Done when:** Postgres refuses a processor activity with `purposes`, and refuses to change a saved `role`
- **Status:** complete

### Phase 3: Saving an aggregate with children
Reference: `ropa-database.md` §6.1 step 3; `ropa-api.md` §1.4
- [x] The children diff: rows with an `id` update, without one insert, left out delete
- [x] Link tables replaced wholesale
- [x] The snapshot covers the whole aggregate, children included, with its own schema
- [x] Cross-entity rules inside the save transaction (DM §5): engagement data categories ⊆ the activity's, scope clients hold an active agreement, `supersedes` points at a retired activity
- **Done when:** a `PUT` that drops one engagement and edits another leaves exactly the right rows, and the revision's snapshot shows it
- **Status:** complete

### Phase 4: Activity endpoints and lifecycle
Reference: `ropa-api.md` §2, §3.1, §3.4, §1.5
- [x] CRUD, with codes allocated per role prefix inside the transaction
- [x] `POST /activities/{ref}/activate` and `/retire`, both requiring `If-Match` and `activity:approve`
- [x] Role rules run on activate and on every save of an `active` activity; drafts may be incomplete
- [x] Filters: `role`, `status`, `offering`, `party`, `system`, `dataCategory`, `special=true`, plus `subjectCategory` and `country` from API §2
- **Done when:** an editor can draft an incomplete activity, cannot activate it, and an approver activating a stale version gets 412
- **Status:** complete

### Phase 5: `GET /subprocessors`
Reference: `ropa-api.md` §5.2; `ropa-data-model.md` §3.8, §7
- [ ] Covered clients and effective engagements, as DM §3.8 defines them
- [ ] Scoped by `offering` — the standard terms, ignoring per-client exceptions
- [ ] Scoped by `client` — that client's actual engagements
- **Done when:** for the same offering, Aurelia's list differs from Northwind's in exactly the way Chapter 4 describes
- **Status:** pending

### Phase 6: `GET /report`
Reference: `ropa-api.md` §5.1
- [ ] JSON: organisation, controller activities, processor activities
- [ ] `view`, `offering` and `client` parameters, `offering` and `client` mutually exclusive
- [ ] Markdown, `Content-Type: text/markdown`, with anchors built from codes so a link survives a rename
- [ ] The closing subprocessor list, identical to `GET /subprocessors`
- **Done when:** the Markdown for the `ats` offering reads as an Art. 30 record, and `…#p3` still resolves after P3 is renamed
- **Status:** pending

### Phase 7: The Hireloop seed
Reference: `ropa-database.md` §9; `ropa-story.md`
- [ ] `npm run db:seed`, written through the domain layer so codes, revisions and validation behave as in real use
- [ ] Replays February to September 2026 in story order, backdating `valid_from` — the `SaveContext.validFrom` that step 1 built and tested
- [ ] Idempotent by slug and code; `--reset` truncates first
- **Done when:** the seed produces C1–C4 and P1–P3 with the engagements, transfers and client scopes the story describes
- **Status:** pending

### Phase 8: Deploy and verify
- [ ] The views answer on the deployed service
- [ ] The Markdown report is worth reading
- [ ] README: the tour extended to the record itself

## Carried over from step 1
- [ ] Restrict external database access on `ropa-db`
- [ ] Confirm a docs-only commit deploys nothing, and an `apps/ropa-api/**` commit does
- [ ] Narrow `demo:data`'s configuration: it validates the whole config, so it
      demands a `DATABASE_URL` and `JWT_SECRET` it never uses
- [ ] `demo:data` gains the activities once they exist

## Open questions
1. ~~Zod discriminated unions and the Input/Output split: `z.discriminatedUnion` on `role`, or one object with a `superRefine` that branches?~~ **Resolved 2026-09-26: a discriminated union**, with forbidden fields checked on the field itself. It gives `oneOf` *and* the better field errors; see findings.md. *Phase 1.*
2. Markdown generation: hand-rolled template strings, or a builder? It has to be diffable and stable, because it feeds the architecture document. *Phase 6.*
3. ~~The children diff is the first place two writers can conflict *within* one aggregate. `If-Match` covers the root; is that enough?~~ **Resolved 2026-09-26: yes.** Every save locks the root row with its version check before touching a nested row, and nothing writes a nested row any other way, so a second writer on the same version always gets 412, even when editing a different engagement. Tested. *Phase 3.*
4. Do the views read through the domain layer over aggregates, or as SQL? DB §6.3 says the former, so `asOf` can reuse them in step 4 — confirm that holds once the queries are real. *Phase 5.*
5. Test isolation for the dispatcher, still open from step 1: it manages its own transactions, so transaction-per-test will not do. *Step 4.*

## Decisions carried forward
| Decision | Where it came from |
|---|---|
| Test-driven throughout; tests are written before the code they cover | Step 1, and it paid for itself repeatedly |
| Packages stay source-only, with a `development` export condition | Step 1 findings; a bundler waits for the first publish |
| Snapshot schemas are written by hand and never generated from the tables | They are a record of what the shape *was*; `schemaVersion` exists for that |
| Database tests run against `<database>_test`, beside the development one | Globally unique constraints make a shared database untenable |
| Vitest runs test files one at a time, and each file starts one HTTP server | Step 1 findings; both were real sources of flakiness |
| The dashboard is not where infrastructure changes are made | Both Render resources are Blueprint-managed; `render.yaml` is the source of truth |
| The activity is a Zod discriminated union on `role`; forbidden-by-role is a field-level check | Step 2, open question 1; tested against Zod 4.6.5 |
| A bare "role" means the GDPR sense; permission bundles are `PrincipalRole` | Step 2, before Phase 1 (`9406ac5`) |
| The root's `If-Match` guards the whole activity; nested rows are written only by the aggregate save | Step 2, open question 3 |
| "Active agreement" is judged as of the save's effective date (`validFrom`), not today | Step 2, Phase 3; lets the seed replay the story |
| Lifecycle actions check `If-Match` before judging content, so a stale approver hears 412, not 422 | Step 2, Phase 4 (API §1.8) |
| `joint_controller` is refused as a validation problem whose field error has code `not_yet_supported`, not as its own problem type | Step 2, Phase 4 |

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
| | | |
