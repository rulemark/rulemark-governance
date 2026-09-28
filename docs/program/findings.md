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
- **The component package (open question 1, 2026-09-27).** `@rulemark/ui`
  in `packages/ui`, **source-only**: it exports its TypeScript sources and
  the app compiles them through Next's `transpilePackages`, as the repo's
  other packages serve sources through a `development` condition. No build
  step, and an edit to a component shows in the app at once; built output
  can come if the toolkit is ever used outside this repo. **Base UI** as the
  primitives: shadcn's current default (`base-nova`), actively developed, and
  supported by every style (Radix has more third-party examples; React Aria,
  a first-class base since July 2026, the strongest accessibility behaviour).
  **Nova** style: compact without being cramped, for an app of lists and
  forms. **Neutral** base colour (fixed once initialised) with **dark mode
  from the start**, via next-themes as shadcn recommends, because retrofitting
  it once screens exist is the expensive way. **Lucide** icons, the default.
  Rejected: a built package (a build and watch step for no consumer outside
  the repo), light only.
- **The shadcn CLI is ahead of its documentation page** (checked
  2026-09-27). `components.json`'s page lists only the `new-york` style and no
  choice of primitives, but `shadcn init` (4.21) takes `--base base|radix|aria`
  and presets named for base and style (`base-nova`, the default). The styles
  are Vega (classic), Nova, Maia, Lyra and Mira. Trust `--help` and the
  changelog over the reference page.
- **Where data is fetched (open question 2, 2026-09-27).** TanStack Query's
  documented App Router pattern: a page's Server Component prefetches its
  queries on the server, straight to `ropa-api` over the private network with
  the token, dehydrates them into a `HydrationBoundary`, and its client
  components `useQuery` the same keys, refetching through `/api/ropa` in the
  browser. Writes are `useMutation` through the proxy, then invalidate. The
  first paint has data and no loading flash; one query-key scheme serves both
  sides; and the public subprocessor page (step 5) is server-rendered for
  free. The cost, two fetch paths, is the one `ropa-packages.md` §8.1 already
  planned for (two client instances). Rejected: client-only (a loading state
  on every screen, and the public page to revisit), and Server Components with
  Server Actions (TanStack Query reduced to a side tool, the proxy barely
  used).
- **The API client (open question 3, 2026-09-27).** `@rulemark/ropa-client`
  is built now, as `ropa-packages.md` §5 designs it, but only its core and the
  calls the first page needs: an injectable base URL, `fetch` and token
  provider, so the server's instance (internal host, token) and the browser's
  (`/api/ropa`, no token) are the same code; responses parsed with the shared
  schemas; `problem+json` as the typed errors of §5.3; the `ETag` surfaced as
  `version` and `If-Match` required on writes. Each later screen adds the calls
  it uses, so the package is shaped by its first consumer as §5 intended.
  §5.1's `actor` option is out of date (the actor is the token's subject) and
  goes. Rejected: `fetch` helpers in the app (likely rewritten as the client
  anyway), and a client generated from `openapi.json` (types from the OpenAPI
  document rather than the Zod schemas: no runtime validation, typed problems
  or compile-time `If-Match`).
- **Auth in the skeleton (open question 4, 2026-09-27).** Reads go through
  the proxy and the server prefetch without a token, and the proxy answers
  any write with a problem saying sign-in arrives in step 2. It proves the
  proxy passes `If-Match`, `ETag` and problems through, not token attachment,
  and leaves step 2 nothing to undo. Rejected: a server-held service token (a
  principal step 2 would replace) and a development sign-in (it could steer
  step 2's design, and must never reach production).
- **Step 2's direction (the user, 2026-09-27): Stytch.** The user has a
  Stytch workspace and wants sign-in through it, with users, roles and
  permissions supported properly, in the database, instead of principals in
  an environment variable (the data model's F5). Today's permission map
  (`apps/ropa-api/src/auth/permissions.ts`) and the API's own JWTs are what
  it replaces or builds on: a question for step 2's plan.
- **Testing layout (open question 5, 2026-09-27).** Components in
  `packages/ui` and the app's client components are tested in **Vitest's
  browser mode**, in a real Chromium with Playwright as the provider: Base UI
  leans on focus, keyboard, pointer events and portals, which jsdom only
  imitates. The client package and pure logic run in Node like the rest of
  the repo. Playwright's browsers are needed for end-to-end tests anyway, so
  CI gains no new dependency. **One Playwright smoke test** in this step: the
  home page lists P1–P3 read through the proxy, and a write is refused,
  against the real API with the story replayed, started by Playwright's
  `webServer` locally and by a CI job with the Postgres service container
  (migrate, seed, start both, Chromium only). Async Server Components can't
  be rendered by a component test, so pages are covered end to end. Rejected:
  jsdom (passes where a browser fails), and a stubbed API for end-to-end tests
  (can't catch the web app and the real API disagreeing).
- **Deploy in step 1 (open question 6, 2026-09-27).** `ropa-web` joins the
  Blueprint as a web service in this step, about $7 a month, accepted. The
  skeleton proves what only Render can while the app is tiny: a Next.js build
  inside the npm workspace (`transpilePackages`, the shared packages), the
  proxy reaching `ropa-api` over the private network by `hostport`, and
  whether a 512 MB instance builds and runs it. The live page shows only what
  the API already shows publicly. Rejected: staying local until step 2, when
  those surprises would come with a bigger app. Pushed only on the user's
  go-ahead.

- **Phase 1: presets are styles, not base-and-style (2026-09-27).** The
  earlier note that `shadcn init` takes a preset named `base-nova` is wrong:
  4.21 answers `Invalid preset: base-nova. Available presets: nova, vega,
  maia, lyra, mira, luma, sera, rhea`. The base is its own flag: `--base base
  --preset nova`. `components.json` still records the pair as `"style":
  "base-nova"`, which is what the app's file must match.
- **Phase 1: shadcn's scaffold, ported rather than run in place.** `shadcn
  init --monorepo` makes a whole pnpm and Turborepo project, and `init` in a
  bare package has no framework to detect. So the scaffold was generated in a
  scratch directory and its package files ported: `components.json` (aliases
  renamed to `@rulemark/ui`), `globals.css` unchanged, `postcss.config.mjs`,
  and the same `exports` map (`./globals.css`, `./postcss.config`, `./lib/*`,
  `./components/*`, `./hooks/*`). `shadcn add button`, run from the package,
  then produced a file identical to the scaffold's: the CLI finds where files
  go through the `@rulemark/ui/*` path in the package's `tsconfig.json`.
  Differences from the scaffold: React as a peer dependency, not pinned; no
  `zod` or `next-themes` in the package (the app brings next-themes in Phase
  2); the repo's own TypeScript, ESLint and Prettier configs, not shadcn's
  config packages.
- **Phase 1: `cn` is a package now.** shadcn's `lib/utils` re-exports `cn`
  from the `cn` package (shadcn's own, 0.4, "a drop-in replacement for clsx +
  tailwind-merge"), and generated components import it from `cn` directly,
  not from `lib/utils`. Kept as generated.
- **Phase 1: the theme `@source`s every app.** `globals.css` has `@source
  "../../../apps/**/*.{ts,tsx}"`, so Tailwind also scans `ropa-api` and
  `audit-log`: wasted work and possibly stray classes, but harmless. It and
  the scaffold's `components/**` line (a directory we don't have) are kept as
  generated until Phase 2 shows what the app needs.
- **Phase 1: Vite's optimiser splits React when a dependency turns up
  mid-run.** Every test failed with `Cannot read properties of null
  (reading 'useRef')`, one copy of React on disk. The cache had been built
  before the button (and its Base UI import) existed; the new import made
  Vite re-optimise and reload the test mid-run. It'll happen again locally
  whenever a new component imports a Base UI entry the cache hasn't seen (CI
  starts cold and scans first). Fixed with `optimizeDeps.include`: React, the
  renderer, and `@base-ui/react/**` (a glob Vite accepts: about a hundred
  entries, a cold run still about a second). Verified by the same
  reproduction.
- **Phase 1: Base UI's button is `type="button"`.** A test renders one inside
  a form and clicks it: the form doesn't submit. Swapping in a plain
  `<button>` fails that test, so a future `button.tsx` regenerated without
  Base UI is caught.
- **Phase 1: the theme is tested by computed colour.** Tailwind's Vite plugin
  compiles `globals.css` in the test setup, and the button's background is
  compared with a probe painted `var(--primary)`, in light and under `.dark`.
  Removing the `.dark` block or `bg-primary` fails it.
- **Phase 1: the build graph checks the package's types.** `tsc --build`
  can't reference a project that emits nothing, so `packages/ui` joins the
  root references with `emitDeclarationOnly` into an ignored `dist/`; its
  exports still point at sources. Tests type-check through
  `tsconfig.test.json`, as elsewhere. The generated button passes the repo's
  strict settings (`exactOptionalPropertyTypes` included) unchanged.
- **Phase 1: lint.** `eslint-plugin-react` supports ESLint only up to 9.7, and
  the repo is on 10; `eslint-plugin-react-hooks` 7 supports 10, and its
  recommended flat config now applies to `**/*.tsx` (checked with a
  conditional hook). `eslint-config-next` in Phase 2 may bring its own.
- **Phase 1: shadcn writes its own style.** Generated files use double quotes
  and no semicolons, and fail `format:check`: run `npm run format` after
  every `shadcn add`.
- **Phase 1: CI needs Chromium.** `npm run test` now runs the component tests
  in a browser, so CI installs it (`npx playwright install --with-deps
  chromium`) right after `npm ci`. Phase 4's Playwright job uses the same.
- **Phase 1: the API's build filter watches `packages/**`.** A component
  change would rebuild `ropa-api` on Render. `packages/ui/**` goes in its
  `ignoredPaths` with the rest of the Blueprint work in Phase 5.

- **Dark mode's switch (open question 7, 2026-09-27).** The Rulemark file's
  mechanism, not shadcn's: `data-theme="light"` or `"dark"` on `<html>`, and
  with neither, the OS's `prefers-color-scheme` through a media query, with a
  `dark:` variant that follows the same rules. It renders the right theme
  before any script runs and doesn't depend on next-themes, which supports it
  as is: `attribute="data-theme"` writes the resolved theme (`light` or
  `dark`) there, so a manual toggle still wins. shadcn's `.dark` block and
  `@custom-variant dark (&:is(.dark *))` go, and `shadcn/tailwind.css` follows
  along, since it writes its dark styles through `@variant dark`. The tests
  cover both attribute values and the OS fallback (emulated through the
  Playwright provider). Rejected: rewriting the Rulemark file to a `.dark`
  class (light until a script runs, and the OS fallback lost).

- **Colour names (open question 8, 2026-09-27).** Across all 61 base-nova
  components, the colours used are shadcn's names: `destructive` 101 times,
  `muted` and `muted-foreground` 131, `foreground` 61, `ring` 53, `input` 51,
  `primary` 38, `accent` 49, `border` 25, `popover` 37, `background` 19, the
  `sidebar-*` family, and `secondary` and `card` a handful; no `chart-*` in a
  component. So shadcn's names stay, as a bridge onto the Rulemark tokens:
  `background` = canvas, `card` = surface, `popover` = surface-raised,
  `muted` = surface-hover with `muted-foreground` = fg-muted, `accent` =
  surface-hover, `destructive` = danger, `sidebar-*` = the `nav-*` tokens;
  `primary`, `border` and `ring` mean the same in both. Two names clash in
  meaning. `input` is a field's border (`border-input`, 14 times) and a dark
  tint behind it (`bg-input/30`) in shadcn, a field's background in Rulemark:
  shadcn keeps it (= `--rm-input-border`) and Rulemark's background becomes
  `field`. `secondary` is a borderless soft fill in shadcn, and a near-white
  meant to go with `secondary-border` in Rulemark: shadcn keeps it (=
  `--rm-neutral-subtle`), and Rulemark's secondary button is the button's
  `outline` variant. The Rulemark file sets states shadcn can't reach by
  mapping names: shadcn's button hovers by fading (`hover:bg-primary/80`),
  which lightens the green where Rulemark's `primary-hover` darkens it. So the
  button's variants are restyled to Rulemark's states, tested in both themes,
  and each later `shadcn add` gets a look for the same. `chart-*` has no
  Rulemark counterpart yet: shadcn's greys stay until charts arrive.
  Rejected: shadcn's names only, with no restyling (the button's hover
  against the spec), and Rulemark's names only, with a rewrite after every
  `shadcn add` (each shadcn update fighting the rewrite, and a missed name
  silently uncoloured).

- **Brand files (open question 9, 2026-09-27).** The colour file lives once,
  in `src/styles/`, as it builds: v1 with the three `@theme` edits of
  question 8 (`input` → `field`, and `input` and `secondary` left to the
  bridge), listed in its header, so a v2 merges as a diff of values. Rejected:
  `ux/` untouched with overrides in `globals.css` (two definitions, the later
  silently winning, and comments that no longer describe the build). The
  seven SVGs are four shapes in brand colours: on light, text `#101112` and
  the mark `green-700`; on dark, text white and the mark `green-400`; plus the
  icon tile, a padded `-on-green` and an all-white wordmark. As components,
  they switch with the theme's own `dark` variant, so a logo is right on first
  paint in every theme, OS fallback included, with no script. Rejected:
  images picked by the app (JavaScript that tracks the theme, or the wrong
  logo until it runs). The base layers of both files combine: Rulemark's
  canvas, selection and focus outline, and shadcn's default border colour;
  components' own focus rings override the outline where they have one.

- **Phase 1b: the bridge is one `:root` block.** shadcn's variables are
  defined once, as `var(--rm-*)`: every Rulemark token switches on `:root`
  (the media query and `[data-theme]` both), so the bridge follows without a
  dark block of its own. Components read seven of them directly (`--primary`,
  `--foreground`, `--secondary`, `--muted`, `--radius`, `--sidebar-border`,
  `--sidebar-accent`), which is why the raw variables stay rather than only
  the utilities.
- **Phase 1b: the button, restyled.** Default, outline, ghost, destructive
  and link take the spec's states; outline is Rulemark's secondary button,
  its background read as `bg-(--rm-secondary)` since `secondary` is shadcn's;
  destructive is danger-subtle at rest and solid danger on hover (the spec's
  danger, danger-fg and danger-hover, the way GitHub's danger button
  behaves); disabled is `disabled`/`disabled-fg`, not `opacity-50`; focus is
  the base layer's Rulemark outline (2px, ring colour, offset 2) instead of
  shadcn's ring, so a button focuses like a link. shadcn's `secondary`
  variant (a soft fill the spec has no button for) is unchanged.
- **Phase 1b: `transition-all` animates the focus outline.** A focused
  button's outline read 3px at half colour straight after Tab: the width and
  colour transition in from the browser's defaults. Tests of any
  transitioned style poll (`expect.poll`).
- **Phase 1b: a hover outlives its test.** The pointer stays where a test
  left it, over whatever the next test renders in the same place. A second
  custom command parks it in the page's far corner after every test
  (`unhover` just hovers the middle of `<body>`).
- **Phase 1b: an undefined custom property compares equal.** `var(--x)` with
  `--x` undefined inherits the parent's colour, so two misspelled tokens
  would pass a comparison. The test helper throws on an undefined property.
- **Phase 1b: the logos are generated from the files and tested against
  them.** A script copied each file's shapes into `logo.tsx`, after checking
  that each light and on-dark pair shares its geometry; the tests parse the
  SVG files (`?raw`) and compare the view box, every shape's geometry, and
  the fill the browser paints, under each of the four ways a theme is
  chosen. A new file from the brand fails them until the component follows.
  The letters' ink, `#101112`, has no Rulemark token (the nearest,
  `neutral-975`, is `#10100C`), so it's written as an arbitrary value.
- **Phase 1b: watch `shadcn add` for CSS.** Some components (the sidebar,
  charts) write CSS variables into `globals.css` when added, and would put
  shadcn's oklch values, and perhaps a `.dark` block, back. Check the diff of
  `globals.css` after every `shadcn add`, as well as the component.
- **Phase 1b: API tests can reach another process.** Fifteen test files in
  `ropa-api` start the app with `.listen(0)`, on `::`, and supertest connects
  to `127.0.0.1`. When the OS hands out a port another process holds on
  `127.0.0.1` alone (on this machine a VS Code helper at 52173, which answers
  `{"type":"error","error":{"type":"authentication_error",...}}`), macOS
  routes the request there and the file fails with a 401 the API never
  sends. The shared harnesses already bind `127.0.0.1`; binding these fifteen
  the same way would close it. Offered to the user as its own change.

- **Radius (open question 10, 2026-09-27).** Across the 61 base-nova
  components: `rounded-lg` 44 times (buttons, inputs, selects, popovers,
  menus), `rounded-md` 29 (menu items), `rounded-xl` 9 (cards, dialogs),
  `rounded-4xl` for pill badges. From `--radius: 0.625rem` those are 10, 8
  and 14px; the foundations name 8px controls, 10px popovers, 12px cards,
  16px dialogs, 6px badges and 4px for the smallest things. shadcn's steps
  now carry the spec's values (`sm` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16px),
  so a generated control or card is on spec untouched; popovers (8px, spec
  10) and dialogs (12px, spec 16) stay near it until restyled with
  `rounded-popover` and `rounded-dialog`. Restyled components use the names.
  Rejected: shadcn's scale left as is (most components 2px off until each is
  restyled).

- **Control sizes (open question 11, 2026-09-27).** Nova's button is 24,
  28, 32 and 36px (`xs`, `sm`, default, `lg`), its inputs 32px; the
  foundations make controls 36px by default, 32 small and 44 large, with 14px
  side padding, `text-label` (14/20, 500, which is Nova's `text-sm
  font-medium` under the spec's name) and `text-label-sm` for small buttons.
  The spec's sizes win, so a button beside a field, or beside anything the
  app builds with `h-control`, lines up; the cost is 4px of Nova's density,
  and the 14px body text and 44px rows keep the interface dense. `xs` (24px)
  stays for tight spots, a size the spec doesn't name. Rejected: Nova's sizes
  with the tokens for app layouts only (a 36px field beside a 32px button),
  and changing the spec to 32px (the user's call; 36 stands).

- **Loading Geist (open question 12, 2026-09-27).** The foundations' stacks
  begin `var(--font-geist-sans, "Geist")` and `var(--font-geist-mono, ...)`:
  the variables the `geist` package (1.7.2, peer `next >= 13.2`) sets through
  `next/font`, which serves the files from the app's own origin, preloads
  them, and size-matches the fallback so text doesn't shift. The app does
  that in Phase 2. The scaffold's `next/font/google` with `variable:
  '--font-sans'` would have replaced the whole stack with one family, and
  `globals.css`'s `--font-sans: var(--font-sans)` (defined as itself, and
  later than the foundations) would have voided it: both go. Rejected:
  Fontsource in the package (Geist in the component tests too, but no
  preload or fallback sizing) and a Google Fonts link (every browser calling
  Google, from a self-hosted tool about data protection).

- **API tests: `listen(0, host)` isn't listening on the next line.** With a
  host, Node looks it up and binds asynchronously, so `address()` is null
  until `listening`; two files read the port at once and failed, and
  supertest, finding no address, calls `listen(0)` itself, on every
  interface. `listenOnLoopback()` (`apps/ropa-api/test/listen.ts`) binds
  127.0.0.1 and awaits `listening`; a lint rule flags `listen(0)` and
  `listen(0, host)` without a callback in tests.
- **Phase 1b: `cn` has to know the theme.** tailwind-merge's rules, which
  `cn` follows, recognise Tailwind's own scale names only: `text-label`
  passes for a text colour, so `cn('text-label', 'text-primary-fg')` drops the
  size, and `h-control` doesn't conflict with `h-12`, so a caller's override
  depends on CSS order. `lib/utils.ts` now exports
  `createCn({ extend: { theme: { text, spacing, radius, container } } })`
  (from `cn/config`) with the foundations' names, and a test reads every
  name from `rulemark-foundations.css` and checks `cn` resolves it, so a v2
  with a new token fails until the list follows. `cn build` (its Vite and
  Next plugins) can read `@theme` from the CSS, but generates a tables file
  the code must import: no simpler.
- **Phase 1b: `shadcn add` imports `cn` from the package.** Even with a
  configured `lib/utils.ts`, the CLI writes `import { cn } from "cn"`. A lint
  rule (`no-restricted-imports`, `packages/ui/src` and `apps/ropa-web`)
  points it to `@rulemark/ui/lib/utils`; it caught the logos at once. The
  package imports itself by that name, which Vite and TypeScript resolve.
  After `shadcn add`: `npm run format`, fix the `cn` import, check
  `globals.css`, and restyle to the spec where it says more.
- **Phase 1b: the foundations, built.** Imported after the colours; `@theme
  static`, so every token is a CSS variable even when unused, which the
  tests' probes rely on. The type-scale probe throws on an undefined token,
  like the colour helper. The button is `text-label` (the size, line height
  and weight in one; `font-medium` goes), `rounded-control`, and
  `h-control*` with `px-control-x` for `sm`, default and `lg`; `xs` keeps its
  24px, 8px padding and smaller radius, in `text-label-sm`.

- **Phase 2: `eslint-config-next` needs `eslint-plugin-react`**, which
  supports ESLint only to 9.7. `@next/eslint-plugin-next` alone has no such
  dependency, and its `core-web-vitals` config is flat: it applies to
  `apps/ropa-web` (checked with a plain `<a>` to `/`).
- **Phase 2: `next typegen` before `tsc`.** Next generates `next-env.d.ts`
  and route types during a build; `next typegen` (Next 15.5+) writes them
  without one, so the type-check runs in CI before any build.
  `next-env.d.ts` is gitignored, as `create-next-app` does.
- **Phase 2: the startup check.** `instrumentation.ts`'s `register()` runs
  once as `next start` or `next dev` begins, not during `next build` (which
  succeeds without `ROPA_API_URL`, so CI needs none). Next compiles the file
  for the Edge runtime too, so its Node-only half (`process.exit`,
  `process.stderr`) lives in `lib/startup.ts`, imported under
  `process.env.NEXT_RUNTIME === 'nodejs'`, which Next replaces at compile
  time (dot access, not brackets). On `next start` the server prints "Ready"
  first, then the problem, and exits 1: it never serves a request, and a
  Render deploy never passes its health check.
- **Phase 2: one `.env`.** The API reads the repository-root `.env` in
  development; Next reads only its own directory's. `@next/env`'s
  `loadEnvConfig(root)` from `next.config.ts` looks right and does nothing:
  Next has already loaded the app directory's files by then, and the
  function returns its cached first result unless forced (and forcing
  resets `process.env` first). `loadRootEnvFile()` reads the root `.env`
  itself (`util.parseEnv`, Node 21.7+), fills in only what isn't set, and
  reads nothing in production. Found only by running `next dev` without the
  variable exported: every earlier check had passed it explicitly. The web app runs on 3001 in development,
  the API on 3000 (`next dev --port 3001`, since the root `.env` sets `PORT`
  for the API).
- **Phase 2: the scaffold's `@source` never reached the apps.** From
  `packages/ui/src/styles/`, `../../../apps/**` is `packages/apps`. It didn't
  show because Tailwind also detects sources from the working directory, as
  the app's builds and tests run. Now `../../../../apps/ropa-web/src/**`,
  which leaves out the API, `audit-log` and `.next`.
- **Phase 2: `next/link` in component tests.** It reads `process.env`,
  which Next defines in its bundles; the browser test project defines it as
  `{}`. Link renders a plain anchor without Next's router, enough for a
  component test; navigation is Playwright's (Phase 4).
- **Phase 2: the title template skips its own segment.** A layout's
  `title.template` applies to pages below it, so the home page, beside it,
  sets its full title (`absolute`).
- **Phase 2: the theme toggle and hydration.** The server can't know a
  stored theme, so the toggle renders "system" until the client takes over
  (`useSyncExternalStore` with a server snapshot of `false`; an effect
  setting state would trip `react-hooks`' newer rules), then shows the
  stored choice: the server's HTML and the first client render agree.
- **Phase 2: telemetry off.** `next build`, `dev` and `start` report
  anonymous usage to Vercel by default; the app's scripts set
  `NEXT_TELEMETRY_DISABLED=1`, on Render and in CI too.
- **Phase 2: one Next build per `npm run build`.** The root `build` runs
  every workspace's, now including `next build`; the helper scripts that
  only need compiled TypeScript (`db:*`, `openapi:write`, `test:dist`,
  `demo:data`) run `tsc --build` instead, which builds exactly what they did.

- **Phase 2: Next writes agent rules.** Next 16.3's `next dev` writes a
  managed block of instructions for coding agents into `AGENTS.md` and a
  `CLAUDE.md` that imports it, and re-adds it if removed
  (`next/dist/server/lib/generate-agent-files.js`; `agentRules: false` in
  `next.config.ts` turns it off). The user chose `CLAUDE.md` only: with the
  block in `CLAUDE.md` and no `AGENTS.md`, Next updates `CLAUDE.md` alone.

- **Phase 3: the list contract.** `GET /v1/activities` returns
  `{ data: Activity[], nextCursor }` (`listResponse(Activity)` in
  `ropa-schemas`; there's no summary type, items are whole activities), 50 a
  page by default, ordered by creation; filters `role`, `status`,
  `offering`, `subjectCategory`, `dataCategory`, `party`, `system`,
  `country`, `special=true`, with a 422 for an unknown reference. Problems
  are `application/problem+json` with `type` under
  `https://ropa.example/problems/`. Reads are public unless
  `REQUIRE_AUTH_FOR_READS`. The seed has seven activities: C1–C4 (Hireloop
  as controller) and P1–P3 (as processor); the page lists all seven.
- **Phase 3: the client's scope.** Its core (base URL, injectable `fetch`,
  token or provider, validation, typed errors, cancellation) and
  `activities.list`. `ETag` as `version` and `If-Match` required at compile
  time come with the first single read or write (step 3 or 4); the body
  already carries `version`. Retries are the app's (TanStack Query's), not
  the client's, for now. The global `fetch` is looked up per call, so a test
  or runtime can replace it. `dist/` runs in plain Node.
- **Phase 3: fetch and conditional requests.** Per the fetch spec, a request
  with `If-None-Match` (or another conditional header) and no
  `Cache-Control` of its own is sent with `Cache-Control: no-cache` and
  `Pragma: no-cache`; Express's `fresh` then never answers 304. The proxy
  forwards the browser's `Cache-Control` and otherwise sends `max-age=0`.
  The unit test's stub now decides like Express, which is what caught it.
- **Phase 3: no retries on the server.** A prefetch that retries holds the
  whole page back (3 s with the API down). The server's client doesn't
  retry; the page renders its loading state, and the browser retries twice
  through the proxy (network errors, 429, 5xx only) before the error.
- **Phase 3: how Next resolves the workspace packages.** `next dev`
  (Turbopack) applies the `development` condition, so it compiles
  `ropa-schemas` and `ropa-client` from source (`transpilePackages` not
  needed); `next build` doesn't, and uses `dist/`. So the app's `build`
  compiles the packages first, which Render's build command gets for free.
  Turbopack has no `extensionAlias` (it's webpack-only, under
  `experimental`), so the packages' NodeNext-style `./x.js` imports failed in
  development. They're now `./x.ts`, with `rewriteRelativeImportExtensions`
  in the base config: emitted JavaScript imports `./x.js` (the API runs
  `dist/` in plain Node, and `test:dist` passes), declarations keep `./x.ts`
  (which both bundler and NodeNext consumers resolve to the `.d.ts`). Only
  the two packages changed; the apps keep `.js` imports.
- **Phase 3: Next's route announcer is `role="alert"`.** An end-to-end test
  looking for an alert must filter by its text.
- **Phase 3: Vitest 5 matchers.** `toHaveTextContent` now matches the whole
  text exactly; partial and regex checks are `toMatchTextContent`.
- **Phase 3: `<th>` needs a scope.** Chromium exposed shadcn's headers as
  cells (no `scope`, and the Vitest locator follows the accessibility
  tree), so a screen reader may not announce them with their column. The
  restyled `TableHead` defaults to `scope="col"`.
- **Phase 3: running it locally without touching the user's data.** The
  user's API (3000) and database were left alone: a second API on 3100
  against `ropa_test`, seeded with `db:seed -- --reset`. The API's tests
  empty `ropa_test` when they finish, so reseed after `npm run check`.

- **Phase 3: a rewrite, not a Route Handler (the user, 2026-09-27).** The
  Route Handler was built and tested first (reads through, writes refused
  with a 403, credentials held back, `/v1` only, 502/504 problems). The user
  asked why not Next's `rewrites`; the case for the handler rested on
  credentials, and step 1 has none. So `/api/ropa/v1/:path*` is a rewrite
  to `ROPA_API_URL/v1/:path*` (`src/lib/rewrites.ts`). What changed: an
  anonymous write reaches the API and gets its 401 problem; an API that's
  down gives Next's plain 500 (the list says it isn't answering, in plain
  words); the browser's cookies and headers pass through; conditional
  requests work as they are (Next's proxy isn't `fetch`). **The destination
  is compiled into the build**: tested by building against one stub API and
  starting against another, and the build's won. So `next build` and `next
  typegen` (which evaluates rewrites too) need `ROPA_API_URL`: CI sets it for
  the job, locally the root `.env` gives it (now read whenever it exists,
  production mode included, since it's never deployed), and on Render it's
  there at build time; changing it means a rebuild, which a Render deploy
  is. Step 2 decides, with its sign-in, whether the browser's token passes
  through the rewrite for the API to verify, or a Route Handler or Next's
  `proxy.ts` (Next 16's name for middleware) attaches one the server holds.
  The Route Handler was never committed; this entry and the Phase 3 notes
  above describe what it did, if step 2 wants one.

- **Phase 4: the smoke test's own database.** Not the user's `ropa`, and
  not `ropa_test`, which the API's tests empty on their own schedule:
  `ropa_e2e`, beside it, created with `pg` from the `postgres` database if
  missing (the web app can't borrow the API's harness: it never imports the
  API). In CI it's the fresh service's own database (`E2E_DATABASE_URL`).
  Each run migrates, resets and seeds it, and builds the web app afresh,
  since the rewrite compiles in the API's address.
- **Phase 4: never reuse a server.** `reuseExistingServer` would reuse
  anything answering on the port, and on macOS something bound to
  127.0.0.1 alone takes the requests even after our server binds every
  interface. Two leftover proxies from another session held 3200 and 3201;
  the test now uses 3310 and 3311 and never reuses, so a taken port stops
  the run with Playwright's own message. The leftovers were left for the
  user.
- **Phase 4: server output.** The webServers' stdout is ignored (the seed
  prints 71 lines) and stderr shown, so a failing start still explains
  itself.
- **Phase 4: `npm run dev`.** `concurrently --kill-others`: the API (3000)
  and the web app (3001) together, one Ctrl-C for both, and either failing
  stops the other. A process runner, not the task runner the skeleton
  decided against (`workspace-skeleton.md` §3.3). A developer whose own API
  already holds 3000 sets `PORT` (and `ROPA_API_URL`) for the run.

- **Render builds per workspace.** Every service's `buildCommand` builds
  its own workspace (`npm run build -w apps/<service>`): the root build runs
  every workspace's, and since interface step 1 that includes the web app's
  `next build`, which needs `ROPA_API_URL`. `ropa-api` was the one service
  still on the root build; its deploy of `a9a0200` failed (the previous
  version kept serving, as Render does). Anything that changes the root
  build must be checked against `render.yaml` as well as CI.

- **Phase 5: Render gives `fromService` values to the build.** The rewrite
  needs `ROPA_API_URL` during `next build`, and the live `/api/ropa/v1/*`
  answering proves Render provided it there, not only at runtime. The two
  paths read it at different times: the server's prefetch at runtime, the
  browser's rewrite at build time (checked by building against one address
  and starting against another). Render's **Save and deploy** reuses the
  last build, so a changed address would reach the prefetch and not the
  browser; it needs **Save, rebuild, and deploy**. Noted on the variable in
  `render.yaml`, in the README and in `ropa-packages.md` §8.2.
- **Phase 5: `ropa-web` is public.** Its page shows what `ropa-api`'s
  anonymous reads already show on the public internet, so it exposes nothing
  new. Step 2 makes reads authenticated (story III.1), for both.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
