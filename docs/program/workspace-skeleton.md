# Workspace Skeleton (v1.0, implemented)

> The repository layout, root configuration and tooling for the monorepo, and the plan for moving git to the new root. Builds on `ropa-packages.md` (**PKG §n**) and `ropa-database.md` (**DB §n**). This document is program-level: once the move is done it lives at `docs/program/workspace-skeleton.md`.

## 1. Repository scope

**Decided (2026-09-19): one repository for the whole governance program**, named `rulemark-governance`.

| Why | Detail |
|---|---|
| One Blueprint | `render.yaml` is per repository. One repo means one Blueprint that stands up every service on one private network, which is the architecture the program is meant to show |
| Preview environments | A pull request spins up the **whole stack**, not one service |
| The Snapshot service inventories this Blueprint | The demo documents its own architecture |
| Cross-service contracts can't drift | The Monitor and DSAR tracker consume `@rulemark/ropa-client` as a workspace dependency |
| One set of conventions | Tooling, CI, lint and TypeScript configuration written once |

Cost: a larger repository, and every service rebuilds unless build filters are set. PKG §8.2 already sets them.

**If you'd rather keep RoPA alone:** the tree below still applies, minus the sibling apps; drop `docs/program/` and rename the repository to `ropa`. The trade is that each later service needs its own Blueprint, and cross-service packages have to be published before they can be shared.

## 2. Target tree

```
rulemark-governance/                  # repository root (today: Personal/Recipes/render)
├── package.json                      # npm workspaces, shared scripts
├── package-lock.json
├── tsconfig.base.json
├── eslint.config.js                  # flat config, one for the repo
├── .prettierrc
├── .editorconfig
├── .nvmrc                            # Node 24 (LTS)
├── .gitignore
├── .env.example
├── render.yaml                       # Blueprint: every service
├── README.md                         # what this is, how to run it, the demo tour
├── .github/workflows/ci.yml
├── docs/
│   ├── program/                      # service-ideas.md, architecture-snapshot-exec-summary.md,
│   │                                 # workspace-skeleton.md, planning files
│   └── ropa/                         # ropa-story, ropa-design, ropa-data-model,
│                                     # ropa-api, ropa-database, ropa-packages
├── packages/
│   ├── ropa-schemas/                 # @rulemark/ropa-schemas
│   └── ropa-client/                  # @rulemark/ropa-client
└── apps/
    ├── ropa-api/                     # the service (DB §11 layout lives here)
    └── ropa-web/                     # the frontend (framework TBD)
        # later: monitor-api, dsar-api, snapshot-api, audit-api, redactor
```

**Naming:** workspaces are flat and prefixed by service (`ropa-api`, `monitor-api`), so npm's `apps/*` and `packages/*` globs stay simple. Directory names match package names minus the scope: `packages/ropa-schemas` is `@rulemark/ropa-schemas`.

## 3. Root configuration

### 3.1 `package.json`

```jsonc
{
  "name": "rulemark-governance",
  "private": true,                       // never published; the packages are
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "build":      "npm run build --workspaces --if-present",
    "typecheck":  "tsc --build",
    "lint":       "eslint .",
    "format":     "prettier --write .",
    "test":       "npm run test --workspaces --if-present",
    "dev":        "npm run dev -w apps/ropa-api",
    "db:migrate": "npm run db:migrate -w apps/ropa-api",
    "db:seed":    "npm run db:seed -w apps/ropa-api",
    "openapi:write": "npm run openapi:write -w apps/ropa-api",
    "check":      "npm run typecheck && npm run lint && npm run test"
  }
}
```

Each workspace owns its own `build`, `dev` and `test`. The root only delegates, so adding a service means adding a directory.

### 3.2 `tsconfig.base.json`

Strict, modern, extended by every workspace: `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, `target: "es2023"`, plus project references so `apps/ropa-api` type-checks against package **sources** during development and against built types in CI.

### 3.3 Tooling choices

| Concern | Choice | Why |
|---|---|---|
| Package manager | **npm workspaces** | Built in, no extra tooling, and what Render's default build command expects |
| Node | **24 LTS**, pinned in `.nvmrc`, `engines` and the Blueprint's `NODE_VERSION` | One version everywhere, including Render |
| TypeScript | **5.x** (pinned) | TypeScript 7 is released, but `typescript-eslint` still requires `<6.1`. Revisit once it supports 7 |
| Build (packages) | **`tsc`** | ESM + type declarations into `dist/`, with a `development` export condition serving sources to `tsx` and Vitest. A bundler waits for the first publish (PKG §7) |
| Dev runner (API) | **tsx** watch | No build step while developing (added with the API) |
| Tests | **Vitest** | Same runner everywhere; works with TypeScript and ESM without ceremony |
| Lint / format | **ESLint flat config + Prettier** | One config at the root |
| Commits | **Conventional Commits** (`feat:`, `fix:`, `chore:`) | Already the style in the existing history, and it feeds changelogs when we publish (PKG §6.4) |
| Task orchestration | None for now | Four workspaces don't need Turborepo. Worth revisiting if CI gets slow |

### 3.4 Environment and secrets

- `.env.example` at the root lists every variable with a safe placeholder: `DATABASE_URL`, `JWT_SECRET`, `TOKEN_MINT_SECRET`, `PRINCIPALS`, `REQUIRE_AUTH_FOR_READS`, `AUTH_DISABLED`, `ROPA_API_URL`.
- Apps load `.env` only in development; on Render everything comes from the service's environment.
- Each app validates its environment at startup with a Zod schema and **fails fast** with a clear message. A missing `JWT_SECRET` should stop the process, not surface later as a 500.
- Shared values (like the database URL) go in a Render **environment group**; generated secrets use `generateValue: true` (PKG §8.2).
- `.env` is git-ignored. Only `.env.example` is committed.

### 3.5 CI (`.github/workflows/ci.yml`)

One workflow on push and pull request:
1. Checkout, set up Node 24, `npm ci`.
2. `npm run typecheck`, `npm run lint`.
3. `npm run test` with a **Postgres 18 service container** (DB §10).
4. `npm run build`.
5. **Drift checks:** `drizzle-kit generate` must produce no new file (DB §8.1), and `openapi:write` must leave `packages/ropa-client/openapi.json` unchanged (PKG §7).

## 4. Moving git to the new root

Today `.git` sits in `service-ropa/`. The repository root needs to become the parent, and history should survive the move.

**Plan (to run when you're ready, in this order):**

1. **Check the working tree is clean** in `service-ropa` (`git status`), so the move starts from a known state.
2. **Move the git directory up one level:** `mv service-ropa/.git .git`, run from the parent. Every tracked file now looks deleted, and the same files appear under `service-ropa/`.
3. **Stage everything:** `git add -A`. Git detects the renames, and `git log --follow` still walks through them. Commit as `chore: move repository root to monorepo root`.
4. **Reorganise into the target tree** with `git mv`, in one commit: design documents to `docs/ropa/`, program documents to `docs/program/`, and `service-ropa/` disappears.
5. **Add the root files** from §3 (package.json, tsconfig.base.json, lint, `.nvmrc`, `.gitignore`, `.env.example`, CI). Commit.
6. **Create the empty workspaces** (`packages/ropa-schemas`, `packages/ropa-client`, `apps/ropa-api`) with their `package.json` and `tsconfig.json`, so `npm install` links them. Commit.
7. **Optionally rename the local folder** from `render` to `rulemark-governance`, then create the GitHub repository under the `rulemark` organisation and push.

**Points worth deciding before step 4** are in §6.

## 5. First-run experience

The README should get a new machine running in three commands, and CI runs the same ones:

```bash
npm ci
docker compose up -d db      # Postgres 18 locally
npm run db:migrate && npm run db:seed
npm run dev                  # API on :3000, docs at /api-docs
```

`docker-compose.yml` at the root holds only Postgres. Everything else runs on the host.

## 6. Decisions (2026-09-19)

| Question | Decision |
|---|---|
| Repository scope | The whole governance program |
| Repository name | `rulemark-governance` |
| Planning files | Committed under `docs/program/` |
| Research documents | Moved to `docs/program/` unchanged; they predate several decisions (notably on cost, now that the workspace is on Pro) |
| `apps/ropa-web` | Created empty now |

## 7. What exists now

Steps §4.1–§4.6 are done, in four commits: the skeleton document, the root move, the documentation reorganisation, and the scaffold. Verified locally: `npm ci`, `npm run typecheck`, `npm run lint` and `npx prettier --check .` all pass.

Deliberately **not** done yet:
- **`render.yaml`.** The Blueprint sketch in PKG §8.2 refers to build and start scripts that don't exist yet. It lands with the API in build step 1.
- **Drift checks in CI.** The two steps are in `ci.yml`, commented out until there are migrations and an OpenAPI document to compare.
- **`tsup`, `tsx`, framework dependencies.** They arrive with the code that needs them.
- **The local folder rename** (`render` → `rulemark-governance`) and creating the GitHub repository.

**Markdown is excluded from Prettier** (`.prettierignore`). Its table padding turned the design documents into an 1,800-line whitespace diff and would reflow a whole table on every edit.
