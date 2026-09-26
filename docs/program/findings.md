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
- **For Phase 4.** `joint_controller` surfaces as a field error with code
  `not_yet_supported` inside a validation problem. The app also has a
  `notYetSupported()` problem type (`problems.ts`). Decide whether the route
  maps one onto the other.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
