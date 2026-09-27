# Findings & Decisions — Interface Step 1

> The RoPA API's five build steps are archived in `plan-archive/1/` to
> `plan-archive/6/`; their `findings.md` files record what the tools and the
> platform actually did, and several conclusions still hold here.

## Reference documents
- `docs/program/roadmap.md`: the priorities, and every story gap by where it lands
- `docs/ropa/ropa-packages.md`: the client package §5, the deployment topology §8 (the proxy §8.1, the Blueprint sketch for `ropa-web` §8.2)
- `docs/program/workspace-skeleton.md`: the repository's layout and tooling
- `docs/ropa/ropa-story.md`: Parts II and III, which found the gaps the interface is meant to close

## What exists already
- **`apps/ropa-web`** is a placeholder: a `package.json` naming
  `@rulemark/ropa-client` and `@rulemark/ropa-schemas` as dependencies, and a
  README pointing at `ropa-packages.md` §8.1.
- **`@rulemark/ropa-client`** is empty apart from the generated
  `openapi.json`; §5 designs it (namespaces per endpoint, `If-Match` required
  on writes at compile time, typed errors, cursor iteration, validation with
  the shared schemas). Its `actor` option predates auth and is out of date.
- **`@rulemark/ropa-schemas`** exports every input and output schema, and the
  single-record rules (`canActivate` and the rest) a form can run, so a form
  can show the errors the server would return.
- **The ESLint config already ignores `**/.next/**`.**
- **The topology is designed** (`ropa-packages.md` §8.1): the browser calls
  `/api/ropa/*` on the web app's origin; a catch-all Route Handler forwards to
  `ropa-api` over the private network with the token; `If-Match`, `ETag` and
  `Authorization` pass straight through; two client instances, one relative
  for the browser and one with the internal host for the server.

## Versions (npm, 2026-09-27)
| Package | Version | Note |
|---|---|---|
| next | 16.3.6 | peer: React 18.2 or 19; Playwright 1.51+ optional |
| react | 19.3.0 | |
| @tanstack/react-query | 5.104.0 | |
| tailwindcss | 4.3.3 | v4: CSS-first configuration, no `tailwind.config` needed |
| shadcn (CLI) | 4.21.0 | |
| @playwright/test | 1.63.0 | |
| vitest | 5.0.2 | the repo is on 5.0.1 |
| @vitejs/plugin-react | 6.1.1 | for component tests |
| @testing-library/react | 16.3.3 | |
| eslint-config-next | 16.3.6 | |
| typescript | 7.0.2 | **the repo stays on 5.9**: `typescript-eslint` still requires below 6.1 (`workspace-skeleton.md` §3.3) |

## shadcn in a monorepo (ui.shadcn.com/docs/monorepo, 2026-09-27)
- The documented structure is exactly the one wanted: an app, and
  `packages/ui` holding `src/components`, `hooks`, `lib` and
  `styles/globals.css`.
- **Each workspace has its own `components.json`**: the app's aliases point
  at the package (`ui` → `<pkg>/components`, `utils` → `<pkg>/lib/utils`),
  the package's at itself. **Both must share `style`, `iconLibrary` and
  `baseColor`.** With Tailwind v4 the `tailwind.config` entry is left empty,
  and the app's `css` points at the package's `globals.css`.
- **The CLI runs from the app** (`npx shadcn@latest add <component>`): base
  components land in `packages/ui`, blocks in the app, with imports rewritten.
- The docs use pnpm and Turborepo and the scope `@workspace/ui`; nothing in
  them requires either, and npm workspaces work.

## Carried-forward cautions
- **Render judges a push by its newest commit**, and a docs-only commit
  deploys nothing: push code first. **Push nothing without the user's
  go-ahead.**
- **Check push access with git's own SSH command** (the repo's
  `core.sshCommand` key), not a bare `ssh -T`, and retry once before
  suspecting credentials.
- **Confirm a deploy by its behaviour**, not by `/healthz` uptime alone.
- **A test written after the code passes by construction**: break the code on
  purpose. A test that passes before the code exists (a `404` from a missing
  route) must check what it's actually about.
- **A new package export needs a rebuild** before `tsc` reads it without the
  `development` condition.
- **Markdown is excluded from Prettier.**
- **zsh doesn't split unquoted variables into words**, and `$n)` in a pattern
  is read as a subscript: do shell loops in Python, or quote carefully.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
