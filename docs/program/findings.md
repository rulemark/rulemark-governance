# Findings & Decisions — Build Step 2

> Step 1's findings are archived in `plan-archive/2/findings.md`. That file is
> worth re-reading before starting: it records what the tools and the platform
> actually did, and several of its conclusions are now load-bearing.

## Reference documents
- `docs/ropa/ropa-api.md` — API contract (activities §3, views §5, build order §8)
- `docs/ropa/ropa-data-model.md` — entities, aggregates, **role rules §5**, client scoping §3.8
- `docs/ropa/ropa-database.md` — the activity aggregate §4.4, the save algorithm §6.1, seeds §9
- `docs/ropa/ropa-story.md` — Hireloop; the seed replays it and the acceptance scenarios come from it
- `render.yaml` — the deployed stack, and the source of truth for it

## What step 1 left ready
- **`SaveContext.validFrom`** exists and is tested. The seed's backdating needs no new mechanism.
- **`code_counter`** is seeded with `C`, `P`, `J` and `RI`; `allocateCode` is tested and rolls back with its transaction.
- **`forbid_immutable_change`** is created but attached to nothing. It was written generically for `processing_activity.code`, `.role` and `review_item.code`; attaching it is one `CREATE TRIGGER` each.
- **`event_outbox`** rows are written on every save. The dispatcher that delivers them is step 4.
- **The resource router** builds seven routes from one definition, and the OpenAPI document is generated from the same definitions — so a new resource is documented by existing.
- **`arrayInList`** was removed in step 1 as unused; the activity's enum arrays (`lawful_bases`, `special_conditions`) are what it was written for.

## Carried-forward cautions
- `drizzle-kit` and Vitest read workspace packages through their **built** output unless the `development` condition applies. `db:generate` builds first for this reason; a constant that fails to resolve produces valid, meaningless SQL.
- Prettier reformats source after it is written, so an exact-text edit that worked once may not match afterwards. Edit by line range or regex when a file has been through the formatter.
- A blanket rename across the documents can corrupt prose that *quotes* the old name. It happened once, in a sentence describing stale paths.
- Database assertions are scoped to the record under test. Anything that commits makes unscoped queries unreliable.
- Nothing in a test disables a constraint or a trigger.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->
- **A bare "role" means the GDPR sense.** Permission roles were renamed to
  `PRINCIPAL_ROLES` / `PrincipalRole` / `PRINCIPAL_ROLE_PERMISSIONS` before
  Phase 1, so `role` on activities and engagements (Hireloop's or a vendor's
  role in the processing, Art. 4(7)–(8)) never shares a name with
  authorization. TypeScript names only: the JWT `roles` claim, the response
  fields and the OpenAPI document are unchanged, and no table was involved.
- **The activity is a discriminated union, and forbidden fields are checked
  on the field (open question 1).** Tested against Zod 4.6.5 with a processor
  that sends `purposes`:

  | Approach | Result | OpenAPI |
  |---|---|---|
  | Union of plain objects | **Passes**: `purposes` is silently stripped | `oneOf` |
  | Union of `.strict()` objects | One `unrecognized_keys` issue at path `""`, not `/purposes` | `oneOf` |
  | One object + `superRefine` | Error at `/purposes`, but **only once every structural error is fixed** | one flat object |
  | Union + field-level `forbidden()` | Error at `/purposes` with our code, **alongside** structural errors | `oneOf`, field `{ "not": {} }` |

  The deciding behaviour: Zod skips an object's refinements while that
  object has any issue, so a `superRefine` rule costs a form a second round
  trip. A refinement on the field itself runs regardless of its siblings.
  Also learned:
  - An object member's `superRefine` does not see keys it doesn't declare,
    because refinements run on the stripped output.
  - `z.undefined()` cannot be represented in JSON Schema, and
    `toJSONSchema` throws on it.
  - Refined objects work as union members.
  - `.meta({ discriminator })` passes through to the output.
  - `.pick`, `.omit` and `.partial` throw on refined objects; `.extend` does
    not.
  - An unknown or missing `role` yields `invalid_union` at `/role`, "Invalid
    discriminator value". The path is right; the wording is Zod's.
- **How Phase 1 built it.**
  - `forbiddenField()` is `z.unknown().refine(() => false).pipe(z.undefined())
    .optional()`, so a processor's `purposes` is typed `undefined`. The pipe
    makes an input schema throw if rendered with `io: 'output'`. The OpenAPI
    document renders inputs as `input` only, and a test holds that.
  - `z.custom()` could carry the error code but cannot be written as JSON
    Schema at all, so it was not used.
  - Engagement roles parse against every known role first, then narrow with
    `.pipe(z.enum(allowed))`. So `processor` on a processor activity gets
    `role_not_allowed`, and `owner` gets Zod's `invalid_value`.
  - `joint_controller` is a union member whose `role` always fails. Because
    the member has no other fields, code that reads `ActivityInput` must
    narrow on `role` first. That is intended.
  - Forbidden means absent: an empty list or `null` is still refused.
  - `fieldErrorsFromZod` moved into `@rulemark/ropa-schemas/errors`, so
    `validateActivityShape` in a form and the server report identical errors.
    It reads `params.code`, so older refinements still report `custom`.
  - `describeRoleRules` is the DM §5 table as data. The schemas take their
    forbidden messages from it, and `canActivate` takes its required fields.
    Tests check every field of both roles against the schema.
- **For Phase 2.**
  - **Resolved:** `IsoDuration` now accepts exactly what the
    `retention_period` check allows: whole years, months, weeks and days, in
    that order, with no time part (`PT12H` is refused). `P0D` and weeks mixed
    with other components (`P1Y2W`) are allowed on both sides. The Zod regex
    uses the database's own spelling, and a lookahead stands in for its
    `<> 'P'`.
  - `dpiaRequired` defaults to `false` in the controller input, which
    satisfies `processing_activity_active_controller`.
- **How Phase 2 built it.**
  - Migration `0003_activity_aggregate` is generated and matches DB §4.4
    check for check. The deliberate differences: every check is named
    `<table>_<meaning>` instead of being inline, every table has the §3
    timestamps (link tables carry `created_at` only, because they are
    replaced wholesale and never updated), and the link tables' primary keys
    are named `<table>_pkey`.
  - Migration `0004_activity_triggers` is hand-written. It attaches
    `forbid_immutable_change('code', 'role')` as `BEFORE UPDATE OF code,
    role`, and `set_updated_at` to the six editable tables.
  - **Postgres runs CHECK constraints in alphabetical order by name**, and
    reports the first that fails. `processing_activity_code_prefix` reads the
    role (`ELSE 'J'`), so an unknown role with a `C` code fails there before
    `_role`. `_active_started` treats any status but `draft` as live, so an
    unknown status without a start date fails there before `_status`. Three
    fixtures had to be fixed for this. Phase 4 maps constraint names to API
    errors, so it should expect the first failing name, not the most
    specific one; Zod reports these first anyway.
  - The `retention_rule_period` test runs every value against both Postgres
    and `IsoDuration`, so the two cannot drift apart silently.
  - The local development database has not been migrated. The test database
    has (`global-setup.ts`). Run `npm run db:migrate` before using the dev
    server against activities.
- **How Phase 3 built it.**
  - The generic save gained two things and changed no behaviour: `toSnapshot`
    may read through the transaction, and create/update take an `afterWrite`
    hook. The hook runs after the root row is written and locked, and before
    the revision is taken. The activity writes its nested rows there, so the
    snapshot sees them.
  - `src/domain/activity/`: `resolve.ts` (every reference, one batch query
    per record type, every unknown one reported at its path), `rules.ts` (the
    cross-entity rules), `children.ts` (nested-id checks and the diff),
    `load.ts` (the canonical aggregate, which is also the snapshot) and
    `save.ts`.
  - **Order of checks:** references and cross-entity rules run before the
    version check, because the root's values need resolved ids. A request
    that is both stale and invalid therefore gets 422, not 412. Nothing is
    written either way.
  - **Nested ids are checked against the aggregate.** An id must name a row
    this activity holds, under the same parent, once (`unknown_row`,
    `duplicate_row`). Otherwise quoting an id could adopt another activity's
    engagement or move a transfer between engagements.
  - **"Active outbound agreement"** means signed on or before the save's
    effective date and not ended by it, with outbound terms for the
    activity's offering (`clientsWithActiveAgreement`, for Phase 5 to reuse).
    The effective date is `validFrom`, so the backdated seed is judged by the
    agreements in force at the time. A scope entry that cites an agreement
    must cite that client's own.
  - The tests were checked by breaking the diff (no deletes): the three
    diff tests failed as they should.
- **Left for later, deliberately.**
  - **Phase 4, delete:** `deleteAggregate` takes its snapshot after the
    `DELETE`. For an activity, the cascade has already removed the children
    by then, so the "deleted" revision would show none. Load the snapshot
    before deleting.
  - **Phase 4, active saves:** a `PUT` of an active activity must pass the
    role rules, and must keep `startedAt`. The input may leave it out, and
    `processing_activity_active_started` would then refuse the row.
  - **Phase 4, swaps:** deletes run before updates, but two rows swapping a
    unique value in one `PUT` (two retention rules exchanging data
    categories) would still collide mid-update. It is rare; if it matters,
    defer the constraint or update in two passes.
  - **Phase 5:** `subprocessors.changed` events (DB §6.1 step 5) need the
    subprocessor list, which Phase 5 builds.
  - **Not checked:** an engagement's party being a `vendor` or `other`
    (DM §3.2), and a scope client being of kind `client`. They are notes in
    the data model, not DM §5 rules. A scope client must hold an outbound
    agreement, which in practice makes it a client.
- **For Phase 4.** `joint_controller` surfaces as a field error with code
  `not_yet_supported` inside a validation problem. The app also has a
  `notYetSupported()` problem type (`problems.ts`). Decide whether the route
  maps one onto the other.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
