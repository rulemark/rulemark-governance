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

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
