# Findings & Decisions

## Requirements
- (Provisional) RoPA / Data Inventory API, per idea #4 in `service-ideas.md`
- Endpoints: `POST /activities`, `GET /activities`, `GET /activities/{id}`, `PUT /activities/{id}`, `GET /report`, `GET /healthz`
- Render features: Postgres, Blueprint (`render.yaml`), env groups; optional static-site frontend
- OpenAPI docs served via Swagger UI

## Research Findings
- Art. 30(1) controller vs 30(2) processor records: the processor record lists each controller served + categories of processing, transfers, TOMs, but no purposes/legal basis/retention.
- Art. 28(2): processor needs controller authorization for subprocessors; with general authorization it must notify changes and allow objection. This is the legal driver for the subprocessor monitor (#5). Art. 28(4): the initial processor remains liable for subprocessors.
- Art. 30(4): record must be made available to the supervisory authority on request. Art. 30(5): <250-employee exemption rarely applies (not occasional / special categories).
- A B2B SaaS on Render is both a controller (own staff/leads) and a processor (customers' end-user data); Render is its subprocessor. The processor chain is exactly what the monitor tracks.
- DSAR needs shared taxonomy IDs (subject + data categories) to query "where does this person's data live".
- Design strawman: `service-ropa/design/ropa-design.md`
- To verify: URL/format of Render's own published subprocessor list (a real monitor target).
- Art. 30 RoPA contents: processing purposes, categories of data subjects and personal data, recipients/subprocessors, third-country transfers + safeguards (SCCs/adequacy), retention/erasure periods, plus a general description of security measures. It is "the first document supervisory authorities request."
- Suggested pairing: DSAR tracker (#3) reads the RoPA to find which systems/subprocessors hold a subject's data.
- Render regions: Oregon, Ohio, Virginia, Frankfurt, Singapore. A service's region can't be changed after creation.
- Free tier: web services spin down after 15 min; free Postgres expires after 30 days (1 GB, no backups). Starter plan is $7/mo.
- Private networking is a workspace-level trust model, not zero-trust, so add app-layer auth for service-to-service calls.
- Don't put PII/PHI in resource names (services, env var names, table/column names), logs, or IaC.

## Story review notes (applied to ropa-story.md 2026-09-19)
- Ch1: clarify Aurelia is about to sign the subscription contract (MSA/order form) + DPA; questionnaire = pre-contract due diligence (Art. 28(1); DORA for banks).
- Define ATS (Applicant Tracking System) in the Cast section.
- Rename C1 → "Hireloop staff administration", C3 → "Hireloop sales & marketing (prospective customers)"; stress controller = Hireloop's own operations.
- /coverage must not flag activities with no Render system (e.g. C1 in Peoplehub); coverage works both ways.
- Ch3/Ch4 ordering bug: Aurelia is a prospect when answering Q37. Answer with `?offering=off-ats` (standard view, incl. Glitchlog) → Marc objects → bespoke DPA → sign → then record Aurelia client + exclusions; `?client=aurelia` only after signing.
- API: `/report` and `/subprocessors` take `offering=` and `client=`. The offering view = the public subprocessor page other monitors would watch.
- Prospects are not in RoPA (a CRM concern); prospect contacts are leads in C3.

## Story review notes: DPIA (applied 2026-09-19)
- DPIA = Data Protection Impact Assessment (Art. 35); a controller obligation. P3 is a processor activity, so the DPIA belongs to the clients; Hireloop assists (Art. 28(3)(f)) with a DPIA support pack.
  - Model: `dpiaRequired`/`dpiaRef` on controller activities; `dpiaSupportRef` on processor activities.
  - Ch5: reword the P3 flag. Ch8: regulator asks for Hireloop's processor record + DPIA support documentation, not "the DPIA".
  - Spell out DPIA on first use in the story.
  - Optional: mention the EU AI Act (CV screening = high-risk); verify application dates before citing.

## Data model review notes (identifiers applied to ropa-data-model.md v0.2)
- Decisions 1–5 in ropa-data-model.md §1 confirmed by the user (2026-09-19).
- Identifier roles: `id` (UUID, never shown), `key`/code (short stable reference shown next to the name: diagrams, cross-refs, report headings, DPA annexes), `name` (main label, can change; e.g. the C1 rename kept C1).
- Proposed: split `key` into `code` (activities, maybe review items `RI-042`; auto-assigned per role prefix, never changed or reused) and `slug` (parties, taxonomies, etc.; URL/seed-friendly).
- Proposed: a role change = retire the old activity + create a new one with `supersedes_id` (C4 → P4), since the C/P prefix encodes the role.
- Feeds Q6 (which identifiers the API exposes).

## API review notes
- RESOLVED (2026-09-19): Aurelia EU-only vs Mailcrest US. Mailcrest uses its EU data region (IE) for Aurelia.
  - Model: several engagements per party per activity (one per region); `engagement_exclusion` → `engagement_client_scope` (mode include|exclude); "effective engagements for a client" defined once (DM §3.8) and used by all views.
  - New advisory check `region_violation` (agreement `allowed_regions` vs processing countries + transfer destinations).
  - Story Ch6 keeps the conflict: Helpdesk Partners (India) supports all regions, so remote access = transfer even with EU data residency.
  - Updated: ropa-story.md (Cast, Ch4, Ch5, Ch6, Ch9, revealed #2/#12, appendix), ropa-data-model.md v0.5, ropa-api.md (§1.4, §1.5, §3, §4, §5.2–5.5, §7).

## Verified platform facts (2026-09-19)
- Render pre-deploy command: runs after build, before deploy, on a separate instance; failure fails the deploy; recommended for DB migrations; **paid web/private services and workers only** (https://render.com/docs/deploys).
- Render Postgres supports major versions 13–18 (18 is the latest supported; 19 not yet) (https://render.com/docs/postgresql-upgrading).
- PostgreSQL 18 has built-in `uuidv7()` plus `gen_random_uuid()`/`uuidv4()` (https://www.postgresql.org/docs/18/functions-uuid.html).
- Drizzle: `check()`, `unique().on()`, `primaryKey({columns})`, partial indexes via `.where(sql…)`, custom migrations via `drizzle-kit generate --custom --name=…`, runtime `migrate(db)` from `drizzle-orm/node-postgres/migrator`, snake_case casing support (https://orm.drizzle.team/docs/indexes-constraints, /docs/kit-custom-migrations, /docs/migrations, /docs/sql-schema-declaration).
- Not verified: exact Drizzle syntax for `FOR UPDATE SKIP LOCKED` (fallback: `sql` template); `nullsNotDistinct()` support in Drizzle's unique builder (fallback: custom migration).

## Verified platform facts (packaging)
- Render monorepos: `rootDir` (root-relative build/start commands; autodeploy only for changes under it) + `buildFilter.paths`/`ignoredPaths` (always relative to repo root; manual deploys ignore filters) (https://render.com/docs/monorepo-support).
- Zod 4 is the current major (4.6.x as of 2026-09) (https://www.npmjs.com/package/zod, https://zod.dev/v4).

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Zod-first (`zod-to-openapi` / `zod-openapi`) + `swagger-ui-express` | One source of truth for validation and the spec |
| `/healthz` endpoint | Render health check prevents bad deploys from replacing a healthy one |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
|       |            |

## Resources
- `service-ideas.md`: full research on governance demo ideas and Render features
- `architecture-snapshot-exec-summary.md`: related "Architecture Snapshot" proposal (third governance service)
- `service-ropa/`: empty target directory (created 2026-09-19)
- Render example repo: https://github.com/render-examples/patient-api

## Visual/Browser Findings
-
