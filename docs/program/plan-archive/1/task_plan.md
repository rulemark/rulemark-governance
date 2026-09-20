	# Task Plan: Governance Demo Suite on Render, starting with RoPA

## Program Goal
Build a set of governance demo services on Render that (a) teach Render's offerings and mechanics, (b) feed an always-current **architecture document** (see `architecture-snapshot-exec-summary.md`), and (c) show a strong understanding of the Governance domain.

Planned services: **RoPA (#4, first)** → Subprocessor monitor (#5) → DSAR tracker (#3) → Architecture Snapshot, plus Audit-log (#1) and Redaction (#2).

## Current Goal
Define the **shape of the RoPA service**: the problems it solves, its users, the controller/processor model, the data model and the API. The design must anticipate the subprocessor monitor (#5) and DSAR (#3), and link to the Architecture Snapshot inventory.

## Current Phase
Build step 1: auth + Drizzle schema + first migration (docs/ropa/ropa-api.md §8)

## Phases

### Phase 1: Problem framing & users
- [x] Read program docs; confirm RoPA is first (user, 2026-09-19)
- [x] Draft problems/users/personas (design/ropa-design.md §2)
- [x] Review with the user; agree on the problems in scope
- **Status:** complete

### Phase 1b: Storytelling scenario
- [x] Draft Hireloop narrative + seed data (design/ropa-story.md)
- [x] Review with the user; fold "what the story revealed" into the data model
- **Status:** complete

### Phase 2: Controller vs Processor model
- [x] Draft options + recommendation (§3)
- [x] Decide role modeling and processor-record granularity (data model decisions 1–2)
- **Status:** complete

### Phase 3: Subprocessor & DSAR integration needs
- [x] Draft what #5 and #3 need from RoPA (§4, §5)
- [x] Decide service boundaries (data model decision 4, §8)
- **Status:** complete

### Phase 4: Data model
- [x] Strawman ER model (§6)
- [x] Story edits finalized (incl. DPIA); user committing to service-ropa
- [x] Data model v0.1: design/ropa-data-model.md (proposes decisions 1–5)
- [x] Review with the user; resolve open questions (§10) → v0.4
- **Status:** complete

### Phase 5: API design
- [x] Strawman API surface (§8)
- [x] API design v0.1: design/ropa-api.md (conventions, endpoint map, activity shapes, views, events, story walkthrough, build order)
- [x] Review with the user; resolve API open questions (§9): all 5 resolved → API v0.4, DM v0.7
- **Status:** complete

### Phase 6: Database design
- [x] Choose DB access layer: Drizzle ORM (user decision 2026-09-19)
- [x] Database doc v0.1: design/ropa-database.md (layers, rule placement, DDL, code allocation, aggregate save, asOf, outbox dispatcher, migrations, seeds, tests)
- [x] Carry physical changes back: DM v0.9 (retention_period/trigger_event, review_item target FKs, revision.change_type), API v0.6
- [x] Review with the user; resolve DB open questions (§12): Q1 pre-deploy (Pro), Q2 deferred as D1, Q3 30-day outbox retention, Q4 active-record checks added
- **Status:** complete

### Phase 7: Packaging & repo layout
- [x] Decisions: monorepo (npm workspaces), public npm later, validate-on by default (user, 2026-09-19)
- [x] design/ropa-packages.md v0.1 (boundary, @ropa/schemas, @ropa/client, versioning, build, Render monorepo setup)
- [x] Resolve open questions: scope `@rulemark` (`@rulemark/ropa-schemas`, `@rulemark/ropa-client`), changelogs by hand for now, OpenAPI inside the client, frontend in the monorepo as `apps/web` (own Render service)
- **Status:** complete

### Phase 8: Auth & topology
- [x] JWT (HS256, 8h, `jose`), principals in `PRINCIPALS` env var, `POST /v1/tokens`, `GET /v1/me`
- [x] Permissions as the unit; roles = bundles (viewer/editor/approver/admin + per-service roles); `activity:approve` split from `record:write` (segregation of duties)
- [x] Reads public by default (anonymous = viewer), writes require a token; `REQUIRE_AUTH_FOR_READS` flag
- [x] Actor comes from the token `sub`; `X-Actor` only when auth is disabled locally
- [x] Browser → Next.js same-origin proxy → API over the private network; no CORS; API also public for docs/clients
- **Status:** complete

### Phase 9: Workspace skeleton & repo move
- [x] design/workspace-skeleton.md v0.1 (scope, tree, root config, tooling, CI, git move plan)
- [x] Decisions: whole-program repo `rulemark-governance`; planning + research docs in `docs/program/`; `apps/ropa-web` created empty
- [x] Git moved to the monorepo root (history preserved via rename detection); docs reorganised into docs/program + docs/ropa
- [x] Root config + 4 workspaces scaffolded; typecheck/lint/format pass
- [ ] Remaining: local folder rename, GitHub repo under `rulemark`, render.yaml (with build step 1)
- **Status:** complete (scaffold)

### Later (deferred by user): region, implementation, deploy
- Cost constraint lifted: Render **Pro** workspace (2026-09-19) → paid instances, pre-deploy command, background workers, cron jobs, paid Postgres (no 30-day expiry), preview environments, Render audit logs all available

## Key Questions (open — see design §9)
1. Role modeling: one activity type with a `role` field, or separate controller/processor resources?
2. Processor-record granularity: per client, or per service offering?
3. Unified `Party` vs separate Vendor/Client entities?
4. Who owns vendor subprocessor lists: RoPA or the monitor?
5. Versioning: revisions in RoPA, or events to the audit-log service?
6. System linkage: FK to Render resource IDs from the snapshot, or standalone Systems?
7. Demo scenario/company for seed data?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| RoPA is the first service | User decision 2026-09-19 |
| Model must anticipate #3 DSAR and #5 Subprocessor monitor | User decision; drives shared IDs for vendors and taxonomies |
| Defer region/auth/cost | User decision; not needed for shaping |
| Express + TS, Zod-first OpenAPI | From service-ideas.md; one source of truth for validation and docs |
| Synthetic data only | No real PII/PHI |
| Data model decisions 1–5 confirmed | ropa-data-model.md §1 (2026-09-19) |
| Identifiers: id / code / slug / name | Codes are stable references for documents; slugs for URLs and seeds (§3.0) |
| API Q1 concurrency: If-Match on PUT/DELETE/activate/retire; review items status-guarded | ropa-api.md §1.8 (2026-09-19) |
| API Q2: X-Actor header until auth; changeNote = permanent optional write-only body field | ropa-api.md §1.6; required notes deferred as DM F4 |
| API Q3 push events via transactional outbox (at-least-once); Q4 engagement sub-resource (designed, built later); Q5 Markdown export in build step 2 | ropa-api.md §6, §3.5, §5.1, §8; DM §3.13 event_outbox |
| Activity-level client scope: `activity_opt_in` → `activity_client_scope` (include = opt-in, exclude = opt-out; mode must match client_coverage). P3 excludes Aurelia at activity level | DM v0.8 §3.8; fixes P3 wrongly covering Aurelia |
| Q1 full JSON snapshots per aggregate; Q2 onward_via text; Q3 external SaaS = system; Q4 single party kind; Q5 joint controller deferred; Q6 accept any identifier, return all | ropa-data-model.md §10; deferred items tracked as F1–F3 in §11 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |
