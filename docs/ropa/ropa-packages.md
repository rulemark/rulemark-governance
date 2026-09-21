# RoPA Packages & Monorepo (v0.4)

> How the RoPA service, its shared schemas and its API client are organised so a future frontend can reuse the same types, validation and calls. Builds on `ropa-api.md` (**API §n**) and `ropa-database.md` (**DB §n**). Stack: Node.js + TypeScript, Zod 4, npm workspaces.

## 1. Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | Repository layout | **Monorepo** with npm workspaces |
| 2 | Registry and scope | **Public npm** under **`@rulemark`** (the GitHub organisation name): `@rulemark/ropa-schemas`, `@rulemark/ropa-client`. Packages carry a "demo project" note |
| 3 | When to publish | **Not yet.** Packages are built from day one and consumed as workspace dependencies. Publishing is a later step (§6.4) |
| 4 | Response validation in the client | **On by default**, with an opt-out |
| 5 | Changelogs | Hand-written until the first publish; add Changesets when publishing starts (§6.4) |
| 6 | OpenAPI document | Shipped **inside the client package**, not as a separate package (§5.4) |
| 8 | Browser → API path | The browser calls **the frontend's own origin**; Next.js proxies to the API over Render's private network (§8.1). No CORS. The API is also **public** for Swagger UI, the client package and other consumers |
| 7 | Frontend location | **In this monorepo**, as `apps/ropa-web`. Its framework is still undecided (e.g. Next.js with SSR). It deploys as its own Render service (§8). The packages work in both a browser and Node, so SSR is already covered (§9) |

**Why the name carries the service.** The scope is per-organisation, not per-project, and this is the first of several governance services. `@rulemark/ropa-*` leaves room for `@rulemark/monitor-*` and the rest without renaming anything.

## 2. Layout

```
service-ropa/                     # repository root, npm workspaces
├── package.json                  # workspaces: ["apps/*", "packages/*"], shared scripts
├── tsconfig.base.json            # strict base config, extended by every workspace
├── render.yaml                   # Blueprint: one Render service per app (§8)
├── design/                       # these documents
├── packages/
│   ├── ropa-schemas/             # @rulemark/ropa-schemas — wire schemas, types, enums, rule helpers
│   └── ropa-client/              # @rulemark/ropa-client — typed API client + openapi.json
└── apps/
    ├── ropa-api/                 # the service: Express, Drizzle, domain, migrations, seeds (DB §11)
    └── ropa-web/                 # the frontend (framework TBD); consumes both packages
```

**Dependency direction.** Both apps depend on the packages; the packages depend on nothing in the repository; **`apps/ropa-web` never imports `apps/ropa-api`**. Everything the frontend needs from the service arrives through `@rulemark/ropa-client` and `@rulemark/ropa-schemas`, which is the same path an outside consumer would take. If that rule ever feels restrictive, the missing piece belongs in a package.

`apps/ropa-api` keeps the structure from DB §11; `src/api/schemas/` moves out into `packages/ropa-schemas`.

**What lives in the repository root:** the workspace definition, the shared TypeScript base config, lint and formatting configuration, the CI workflow, and `render.yaml`. Each app owns its own build, start and test scripts.

## 3. The boundary

The rule that makes publishing safe: **only wire shapes are shared.**

| Shared (`packages/*`) | Private (`apps/ropa-api`) |
|---|---|
| Zod schemas for requests, responses and views | Drizzle schema, SQL, migrations |
| Inferred TypeScript types | Domain aggregates, repositories, snapshot formats and upgraders |
| Enum value lists (DB §1) | Role rules that need other tables or the current database state |
| Pure rule helpers (§4.3) | Outbox dispatcher, view SQL, seeds |
| The generated `openapi.json` | Configuration and secrets |

A frontend must never be able to import a table definition. Anything that needs a database connection or knows how rows are stored stays in `apps/ropa-api`.

## 4. `@rulemark/ropa-schemas`

### 4.1 Contents

| Module | Exports |
|---|---|
| `enums` | `ACTIVITY_ROLES`, `ENGAGEMENT_ROLES`, `LAWFUL_BASES`, `TRANSFER_MECHANISMS`, `SYSTEM_KINDS`, `REVIEW_REASONS`, … as `as const` arrays (DB §1) |
| `primitives` | `Slug`, `Code`, `CountryCode`, `IsoDuration`, `Ref` (`{id, code?/slug?, name}`), `Cursor`, `AsOf` |
| `resources` | Per record, an **Input** and an **Output** schema: `ActivityInput` / `Activity` (a discriminated union on `role`), `PartyInput` / `Party`, `AgreementTerms`, `Agreement`, `Offering`, `System`, taxonomies, `ReviewItem` |
| `views` | `ReportResponse`, `SubprocessorsResponse`, `ImpactResponse`, `DataMapResponse`, `CoverageResponse`, `ChangesResponse` |
| `errors` | `ProblemDetails` (RFC 9457) with the field-level `errors[]` (API §1.7) |
| `constants` | `API_VERSION = 'v1'` |

Types come from `z.infer`, exported alongside each schema (`export type Activity = z.infer<typeof Activity>`).

### 4.2 Conventions

- **Zod 4** (currently 4.6.x), declared as a **peer dependency** so the app and the frontend share one copy.
- Input and Output are separate schemas, because the API differs on purpose (API §1.2): inputs take identifiers as strings, outputs return `Ref` objects; `changeNote` is input-only; `id`, `code`, `version`, `status` and timestamps are output-only.
- Schemas are annotated for documentation (`.describe()`), so the generated OpenAPI carries the text.
- No side effects, no environment access, no Node-only APIs: the package must work in a browser.

### 4.3 Rule helpers

The parts of DM §5 that need only the record itself are exported as pure functions, so a form can show the same errors the server would return:

```ts
validateActivityShape(input)        // structural + "forbidden by role"  → ProblemDetails["errors"]
canActivate(activity)               // "required by role", the checks that run on activate
describeRoleRules(role)             // field-by-field required/forbidden, for building UI hints
```

The **server stays authoritative**. Rules that need other records (a client's agreement, data-category subsets, `supersedes` pointing at a retired activity) run in the domain layer inside the save transaction (DB §2), not here.

## 5. `@rulemark/ropa-client`

### 5.1 Shape

```ts
const ropa = createRopaClient({
  baseUrl: 'https://ropa.example.com',
  actor: 'priya.raman',      // X-Actor until auth exists (API §1.6)
  validate: true,            // default: parse responses with the shared schemas
  fetch,                     // injectable, for tests and SSR
});

const activity = await ropa.activities.get('P3');            // → Activity, including `version`
await ropa.activities.update('P3', next, {
  ifMatch: activity.version,                                  // API §1.8
  changeNote: 'Added the DPIA support pack reference',
});

for await (const a of ropa.activities.iterate({ role: 'processor' })) { … }   // cursor paging

const list = await ropa.subprocessors.forClient('aurelia', { asOf: '2026-05-01' });
const impact = await ropa.parties.impact('mailcrest');
const report = await ropa.report.markdown({ view: 'processor', client: 'aurelia' });
```

Namespaces mirror the endpoint map (API §2): `activities`, `parties`, `agreementTerms`, `agreements`, `offerings`, `systems`, `taxonomy`, `reviewItems`, `report`, `subprocessors`, `dataMap`, `coverage`, `changes`, `health`.

### 5.2 What it handles for the caller

| Concern | Behaviour |
|---|---|
| Identifiers | Any identifier works in path parameters, exactly as the API allows (API §1.2) |
| Concurrency | `ifMatch` is sent as `If-Match`; the response `ETag` is surfaced as `version`. Omitting it on a write is a **compile-time** error, so nobody forgets it |
| Change notes | `changeNote` is an option on writes, placed into the body |
| Paging | `list()` returns one page (`data` + `nextCursor`); `iterate()` is an async iterator that follows the cursor |
| Errors | `problem+json` becomes a typed error (§5.3) |
| Validation | Responses are parsed with the shared schemas by default; `validate: false` skips it |
| Retries | Only for `GET` on network errors, `429` and `5xx`, with backoff. **Never** for writes, which are not idempotent |
| Cancellation | Every call takes an `AbortSignal` and an optional timeout |
| Auth | `token` (a string or an async provider) becomes `Authorization: Bearer` (API §1.9). `ropa.tokens.mint()` and `ropa.me()` are typed like any other call |

### 5.3 Errors

```ts
RopaError                      // base: status, problem details, raw response
├── RopaValidationError        // 422 — .errors[] is field-level, ready to attach to form inputs
├── RopaConflictError          // 409 — slug taken, still referenced, invalid state transition
├── RopaPreconditionError      // 412 / 428 — stale or missing version (API §1.8)
├── RopaNotFoundError          // 404
└── RopaResponseError          // the body did not match the schema (only when validate: true)
```

`RopaResponseError` is the early-warning system: it fires the moment the deployed service stops matching the package the caller has.

### 5.4 The OpenAPI document

The client package also ships the generated `openapi.json`, so consumers in other languages can generate their own client. It's produced by `apps/ropa-api` from the shared schemas and copied in at build time (§7).

## 6. Versioning and release

### 6.1 Two different versions

| | What it means | Changes when |
|---|---|---|
| **API version** (`/v1`) | The HTTP contract | Only for a breaking change to the contract; a `/v2` would run alongside `/v1` |
| **Package version** (semver) | The published artifacts | Every release |

A compatibility table in each package README says which package versions speak which API version.

### 6.2 What counts as breaking (packages)

| Change | Bump |
|---|---|
| Remove or rename a field, tighten validation, remove an enum value, change a function signature | **major** |
| Add an optional field, add an enum value, add an endpoint or helper | **minor** |
| Documentation, internal refactors, fixes that don't change shapes | **patch** |

Note that **adding an enum value is minor for the server but can break a consumer** that exhaustively switches on it. It gets called out in the changelog.

### 6.3 Keeping the two packages in step

`@rulemark/ropa-client` depends on an exact `@rulemark/ropa-schemas` version and they're released together. Simplest rule: one version number for both.

### 6.4 Release process (when we start publishing)

1. Changesets record intent in the PR.
2. CI builds, type-checks, tests, then verifies the committed `openapi.json` is current.
3. A release PR bumps versions and changelogs; merging it publishes both packages with provenance.
4. Until then, `apps/ropa-api` depends on `"@rulemark/ropa-schemas": "*"` and npm workspaces resolves it locally. Nothing about the code changes when publishing starts.

## 7. Build and tooling

- **Build (packages):** plain `tsc`, emitting ESM and type declarations into `dist/`, with an `exports` map. Subpath exports (`@rulemark/ropa-schemas/enums`) keep imports small. Each entry carries a **`development` condition** pointing at the TypeScript source, so `tsx` and Vitest need no build step, while everything else — the built service included — loads `dist/`. Node refuses to strip types inside `node_modules`, so a package whose entry point is TypeScript cannot be loaded by `node dist/index.js`; the condition is what makes source-only development and a working production build coexist.
- **A bundler is deferred to the first publish** (§6.4), which is when CJS output and a single-file build start to matter. Nothing consumes CJS today: both apps are ESM. The export map does not change when a bundler arrives, so this is a one-line swap in a build script, not a redo. **Pick the tool then rather than now:** this document originally named `tsup`, whose last release was November 2025; the activity has since moved to `tsdown`, from the Rolldown team. Neither is deprecated, and the choice should be made against whatever is current at the time.
- **TypeScript:** one `tsconfig.base.json`, strict, with project references so `apps/ropa-api` type-checks against the packages' sources during development.
- **Root scripts:** `build`, `typecheck`, `lint`, `test`, `db:migrate`, `db:seed`, `openapi:write`, each delegating to workspaces.
- **OpenAPI generation:** `apps/ropa-api` builds the document from the shared schemas (it owns the routes) and `openapi:write` writes it to `packages/ropa-client/openapi.json`. CI fails if that file is stale, which is the same trick as the Drizzle migration check (DB §8.1).
- **Contract tests:** the API integration tests call the service **through `@rulemark/ropa-client`**. The client gets exercised on every run, and any drift between schemas, routes and client shows up as a test failure.

## 8. Deployment topology

### 8.1 How the browser reaches the API

```mermaid
flowchart LR
    B(["Browser"]) -->|"same origin: /api/ropa/*"| W["ropa-web (Next.js)<br/>proxy + SSR"]
    W -->|"private network + Bearer token"| A["ropa-api (Express)"]
    Ext(["Swagger UI · @rulemark/ropa-client · other consumers"]) -->|"public URL + Bearer token"| A
    A --> DB[("Render Postgres")]
```

The API service is public **and** reachable on Render's internal hostname, so both paths work at once.

- **No CORS.** Browser requests go to the frontend's own origin and are proxied, so no cross-origin request is ever made. The API sets no CORS headers.
- **The token stays server-side.** The browser never holds an API token. The Next server attaches it (API §1.9), which is the standard backend-for-frontend split.
- **The actor can't be forged.** Because the proxy adds the token, the subject written into every revision comes from the server, not from something the browser can set.
- **From rewrites to a route handler.** A `next.config` rewrite is a static pass-through, which is fine before auth. To attach a per-user token it becomes a catch-all Route Handler at the same path (`/api/ropa/[...path]`). Both must pass `If-Match`, `ETag` and `Authorization` straight through.
- **Two client instances in `apps/ropa-web`:** one for the browser with a relative base URL (`/api/ropa`) and one for server-side rendering with the internal hostname. `fetch` accepts a relative URL in the browser but not in Node, so the base URL can't be shared. The token option differs too: server-side instances carry one, browser instances don't.

### 8.2 Services on Render

Render supports monorepos through a **root directory** and **build filters**. Root-relative settings (build command, start command) run relative to the root directory, while build filter paths are always relative to the repository root.

**Recommended setup:** leave the service's root directory at the repository root, because npm workspaces need a root-level install, and use **build filters** so unrelated changes don't trigger deploys.

**This is now real: see [`render.yaml`](../../render.yaml) at the repository
root**, which describes the deployed stack and is the source of truth for it.
What follows is the reasoning; the file is the specification.

The Blueprint declares a **project** and its **environments**, and the resources
nest inside an environment rather than sitting at the top level:

```yaml
projects:
  - name: rulemark-governance
    environments:
      - name: Production
        databases: [ropa-db]
        services: [ropa-api]
```

Three things learned by deploying, which this sketch originally got wrong:

- **Private networking is scoped to an environment** (`networking.isolation` is
  an environment-level key). The services of the suite must share one to reach
  each other, and a `staging` environment is a complete second copy, its own
  database included.
- **Render matches resources by name when a Blueprint is first synced**, so a
  stack built by hand can be adopted rather than recreated — but the names must
  match exactly, capitalisation included.
- **The build must install devDependencies explicitly.** `NODE_ENV=production`
  makes npm omit them, and the build runs `tsc`, which is one.

The frontend is a second service in the same Blueprint, with its own filter:

```yaml
  - type: web
    name: ropa-web
    runtime: node
    plan: starter
    buildCommand: npm ci && npm run build -w apps/ropa-web
    startCommand: npm start -w apps/ropa-web
    envVars:
      - key: ROPA_API_URL
        fromService: { type: web, name: ropa-api, property: hostport }   # private network
      - key: ROPA_SERVICE_TOKEN_SECRET # the proxy mints tokens for the signed-in user
        fromService: { type: web, name: ropa-api, envVarKey: TOKEN_MINT_SECRET }
    buildFilter:
      paths:
        - apps/ropa-web/**
        - packages/**
        - package.json
        - package-lock.json
      ignoredPaths:
        - docs/**
```

Notes:
- A change under `packages/**` rebuilds **both** services, since both depend on them. That's correct: a schema change affects both sides of the contract.
- A change under `apps/ropa-api/**` alone doesn't rebuild the frontend, and vice versa.
- Documentation-only commits redeploy nothing.
- Manual deploys always run, whatever the filters say.
- Whether the frontend calls the API over Render's **private network** (server-side rendering) or from the browser (which needs a public URL and CORS) is a decision for when we pick the framework. The Blueprint sketch above assumes server-side calls.

## 9. How a frontend uses this

```tsx
import { ActivityInput, validateActivityShape, type Activity } from '@rulemark/ropa-schemas';
import { createRopaClient, RopaValidationError } from '@rulemark/ropa-client';

const ropa = createRopaClient({ baseUrl: import.meta.env.VITE_ROPA_URL, actor: currentUser.id });

// Same rules as the server, before anything is sent
const errors = validateActivityShape(form);

try {
  await ropa.activities.update(code, form, { ifMatch: loaded.version, changeNote });
} catch (e) {
  if (e instanceof RopaValidationError) showFieldErrors(e.errors);   // paths line up with form fields
}
```

The frontend gets types, validation, and calls from one place, and a stale deployment shows up as a `RopaResponseError` rather than as a silent mismatch.

## 10. Questions

**Resolved (2026-09-19):** scope `@rulemark` (§1); changelogs hand-written for now (§1); OpenAPI stays in the client (§5.4); the frontend lives in this monorepo as `apps/ropa-web` (§1, §2, §8).

**Still open**
1. **npm scope availability.** `@rulemark` has to be registered on npm as an organisation or user scope; it may already be taken by someone else. To check when we get to publishing. Fallback: unscoped `rulemark-ropa-schemas` / `rulemark-ropa-client`.
2. **Frontend framework details.** The call path is settled (§8.1: same-origin proxy, no CORS, public API for other consumers). What remains is the framework version and whether any page calls the API directly during server-side rendering rather than through the proxy.
