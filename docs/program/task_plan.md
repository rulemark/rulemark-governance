# Task Plan: Interface Step 1 — The Workspace Skeleton

## Goal
Stand up the frontend and its component toolkit inside the existing
workspace: `apps/ropa-web` (Next.js) and a component library of its own,
`packages/ui` (shadcn/ui), wired to the RoPA API through the proxy the design
already calls for (`ropa-packages.md` §8.1), with tests and CI from the first
commit. No product screens yet beyond one page that proves the path from the
browser to the record works; what the interface shows comes in the steps
after this one.

The first step of the interface, the roadmap's next priority
(`docs/program/roadmap.md`, "Next: the interface, and what clients see").

## Current Phase
Phase 5 (deploy and docs), not started. Phase 4 (tests and CI) is complete, committed and not pushed; Phases 1 to 3 before it too

## The stack (decided by the user, 2026-09-27)
| Concern | Choice |
|---|---|
| Framework | **Next.js** (App Router), **TypeScript** |
| Server state | **TanStack Query** |
| Styling | **Tailwind CSS** (v4) |
| Components | **shadcn/ui**, in a package of its own (`packages/ui`), so the toolkit grows as the user's own |
| Unit and component tests | **Vitest** |
| End-to-end tests | **Playwright** |

Current versions (checked 2026-09-27): Next.js 16.3, React 19.3, TanStack
Query 5.104, Tailwind 4.3, shadcn CLI 4.21, Playwright 1.63, Vitest 5 (the
repo's). TypeScript stays at the repo's 5.9 (see findings).

## Where this step sits (proposed interface build order, to confirm)
1. **The workspace skeleton** (this step): the app, the component package,
   the proxy, one page, tests and CI.
2. **Access:** sign-in through **Stytch** (the user has a workspace), real
   user login with JWTs, and with it how the browser's requests reach the
   API: the step 1 rewrite passing the user's token through for the API to
   verify, or a Route Handler or Next's `proxy.ts` attaching a token the
   server holds. Users, roles and permissions kept in the database rather
   than the `PRINCIPALS` environment variable (the data model's F5), and
   reads that are no longer public by default (story III.1, II.1, II.3).
3. **The record, read:** activities, parties, agreements, review items, and
   the views (report, subprocessors, impact, data map, coverage).
4. **The record, written:** forms on the shared schemas (`canActivate` and
   the rest), `If-Match` and conflicts, the review-item inbox.
5. **What clients see:** the public subprocessor page and the exports
   reviewers accept (III.2, III.5), then per-client access (III.18).
6. **Notices and responses**, once the model has them (III.10–III.17).

Separately, on the API: linking engagements to systems (story II.20), which
the user wants soon.

## Definition of done for step 1
- `npm run dev` starts the API and the web app together; the web app's home
  page lists P1–P3 from the local, seeded API, fetched through
  `/api/ropa/*`, with no CORS and no token in the browser.
- `packages/ui` is a shadcn-initialised package with the Tailwind v4 theme,
  imported by the app as `@rulemark/ui`; `npx shadcn add <component>` run
  from the app puts base components in the package.
- `npm run check` type-checks, lints, formats and runs every Vitest suite,
  the new ones included; Playwright runs a smoke test against the app and a
  seeded API, locally and in CI.
- The docs describe it: `workspace-skeleton.md`, `ropa-packages.md` §8, the
  README's getting-started.
- Deployed as `ropa-web` on Render and verified: the live home page lists P1–P3 read through the proxy over the private network (open question 6).

## Phases

### Phase 1: The component package
- [x] `packages/ui` (`@rulemark/ui`): Tailwind v4, `shadcn init`, its own
      `components.json`, `src/styles/globals.css` with the theme, `lib/utils`
      (`cn`), a first component (`button`). The files are shadcn's own
      (`init --monorepo --base base --preset nova`, generated in a scratch
      directory and ported); the button is added with `shadcn add` from the
      package
- [x] Wired into the workspace's TypeScript (in the build graph, declarations
      only), ESLint (`react-hooks` for `.tsx`) and Prettier config
- [x] Vitest in browser mode for components (Chromium, Playwright provider), per open question 5:
      eight button tests, including the theme's colour in light and dark, each
      checked by breaking the code; CI installs Chromium
- **Status:** complete

### Phase 1b: The Rulemark theme
The user's brand files, added after Phase 1 in `packages/ui/ux/`: the logo and
wordmark SVGs and `rulemark-colors.css` (color tokens v1: `--rm-*` primitives
and semantic tokens, light and dark, `data-theme` with an OS fallback, and
Tailwind utilities). They're to be the global theme, in place of shadcn's
neutral.
- [x] Settle open questions 7–9
- [x] `globals.css` reconciled with `rulemark-colors.css` (now
      `src/styles/`): shadcn's names bridged onto `--rm-*`, `field` for the
      field background, shadcn's `.dark` gone; the button restyled to the
      spec's states; `Lockup`, `Wordmark` and `Icon` components; the SVGs in
      `src/brand/`, exported as `@rulemark/ui/brand/*`; `ux/` removed
- [x] Tests: the theme chosen four ways (default, OS dark, `data-theme` both
      ways), the bridge and utilities in both themes, the base styles, the
      button's states, the logos against their files; 133 in the package,
      each part checked by breaking it (thirteen breaks)
- [x] `rulemark-foundations.css` (foundations v1, added by the user: Geist,
      the type scale, spacing and layout tokens, named radii, base styles)
      imported after the colours; the scaffold's self-referencing
      `--font-sans` removed from `globals.css`; open questions 10–12
- [x] shadcn's radius steps at the spec's values; the button at the spec's
      control sizes, label text and control radius; `cn` configured with the
      foundations' names (`@rulemark/ui/lib/utils`), and a lint rule sending
      `shadcn add`'s `from 'cn'` there
- [x] Tests: the font stacks, every type step, the base styles, the layout
      tokens, the radii, `cn` against every name in the file, the button's
      sizes; 233 in the package; ten more breaks, each failing its tests
- **Status:** complete

### Phase 2: The app
- [x] `apps/ropa-web` on Next.js 16, App Router, its own `components.json`
      pointing at `@rulemark/ui` with the same style, icon library and base
      colour; Tailwind reading the package's `globals.css`. `shadcn add`,
      run from the app, puts the component in `packages/ui` (tried with
      `badge`, then removed)
- [x] Geist through the `geist` package and `next/font` (`GeistSans.variable`
      and `GeistMono.variable` on `<html>`, open question 12), not the
      scaffold's `next/font/google` with `variable: '--font-sans'`
- [x] next-themes with `attribute="data-theme"` (open question 7); the
      favicon from `@rulemark/ui/brand/rulemark-icon.svg` (a copy, tested
      against it); the lockup in the layout shell, with a theme toggle
- [x] TanStack Query provider (a client per request on the server, one in
      the browser), a layout shell, `GET /healthz`
- [x] The environment validated at startup with Zod, failing fast, as the
      other apps do (`ROPA_API_URL`, a URL or `host:port`; the root `.env` in
      development); checked on a real `next start`, which exits 1 naming it
- [x] Wired in: Next's lint rules, `next typegen` before the type-check,
      root helper scripts on `tsc --build` (not a Next build each),
      telemetry off; 25 tests (Node and Chromium), each checked by breaking
      the code (ten breaks)
- **Status:** complete

### Phase 3: The proxy and the first page
- [x] `/api/ropa/v1/*` reaching ropa-api: **a Next rewrite**, not a Route
      Handler (the user's choice, after one was built and tested), since
      step 1 has no credentials to attach; `ETag`, 304s and problems pass
      through untouched; anonymous writes get the API's own 401 problem;
      only `/v1`. The rewrite is compiled into the build, so `next build`
      (and `next typegen`) need `ROPA_API_URL`; CI sets it. Whether step 2
      keeps a rewrite depends on its sign-in design
- [x] `@rulemark/ropa-client`'s core (open question 3): an injectable base
      URL, `fetch` and token provider; responses parsed with the shared
      schemas; `problem+json` as typed errors (`ropa-packages.md` §5.3); the
      activity list call; cancellation. Tested on its own, against a stub
      server (20 tests). **`ETag` as `version` and `If-Match` required on
      writes wait for the first call that needs them** (a single read, a
      write), in step 3 or 4, under open question 3's rule that each screen
      adds its calls
- [x] Two instances in the app: the server's (internal host; no token until
      step 2) and the browser's (`/api/ropa`, no token); the page's query keys
      and query functions shared by the server prefetch and the client (open
      question 2); retries only in the browser, only for what might pass
- [x] The home page lists the activities (C1–C4 and P1–P3), with loading,
      empty and error states; the table from `shadcn add table`, restyled to
      the foundations (and `scope="col"` on headers)
- [x] Found running it: conditional requests through the Route Handler
      (fetch's `Cache-Control: no-cache`; moot with the rewrite), server
      retries holding the page back, `next build` needing the packages'
      `dist/`, and `next dev` failing on the packages' `.js` imports: the
      packages now import with `.ts` and TypeScript rewrites them
      (`rewriteRelativeImportExtensions`, the user's choice); with the API
      down, the list says so in plain words, not Next's "Internal Server
      Error"
- **Status:** complete

### Phase 4: Tests and CI
- [x] Vitest in both workspaces, in `npm run check` (done in Phases 1 and 2)
- [x] Playwright: one smoke file, six tests (the home page lists the story's
      seven activities, P1–P3 among them; they're in the HTML before any
      script; the browser reads through the rewrite; a write is refused with
      the API's 401 and changes nothing; only `/v1` is reachable; `/healthz`)
      against the built API with the story replayed; locally through
      `webServer` on its own database (`ropa_e2e`, created if missing) and
      ports (3310, 3311, never reused), in CI as a job of its own with the
      Postgres service container, Chromium only, the report kept on failure.
      Three breaks, each caught
- [x] Root scripts: `dev` runs both apps (`concurrently`); `test:e2e`
- **Status:** complete

### Phase 5: Deploy and docs
- [ ] `ropa-web` in `render.yaml`: a web service (about $7 a month, accepted),
      its own build filter, `ROPA_API_URL` from `ropa-api`'s `hostport`;
      `packages/ui/**` added to the API's `ignoredPaths` (its filter watches
      `packages/**`, so a component change would rebuild the API);
      pushed code-first **once the user gives the go-ahead**, verified by
      behaviour (the live page lists P1–P3). Its build command is
      `npm ci --include=dev && npm run build -w apps/ropa-web` (which compiles
      the RoPA packages first), its start `npm run start -w apps/ropa-web`,
      its health check `/healthz`
- [ ] `workspace-skeleton.md`, `ropa-packages.md` §8, the README
- **Status:** pending

## Open questions
1. ~~**The component package.**~~ **Resolved (2026-09-27):** `@rulemark/ui`, source-only (Next's `transpilePackages`); Base UI primitives; the Nova style; the neutral base colour, with dark mode from the start (next-themes); Lucide icons. See `findings.md`. Was: Its name (`@rulemark/ui`, where shadcn's docs
   use `@workspace/ui`), and whether it stays source-only, consumed through
   Next's `transpilePackages` like the repo's `development` condition, or is
   built. Plus the shadcn choices both `components.json` files must share:
   style, base colour, icon library, and dark mode from the start or not.
   *Phase 1.*
2. ~~**Where data is fetched.**~~ **Resolved (2026-09-27):** server prefetch and hydration: Server Components prefetch a page's queries straight from the API over the private network, dehydrate them into a `HydrationBoundary`, and client components `useQuery` the same keys through `/api/ropa`; writes are `useMutation` through the proxy, then invalidate. See `findings.md`. Was: Everything through TanStack Query in client
   components via the proxy; or Server Components reading the API directly on
   the server and prefetching into TanStack Query (hydration) so the first
   paint has data, with client components owning interaction and writes. It
   sets the pattern every later screen follows. *Phase 3.*
3. ~~**`@rulemark/ropa-client`.**~~ **Resolved (2026-09-27):** build it now, its core and only the calls the first page uses; each later screen adds its own. §5.1 loses the `actor` option. See `findings.md`. Was: Designed (`ropa-packages.md` §5) and empty
   until its first consumer: this app. Build the client now, shaped by the
   first page (typed errors, `If-Match`, schema validation, two instances for
   browser and server); or let the app call `fetch` with the shared schemas
   and grow the client once screens show what it needs. §5.1's `actor` option
   is out of date either way: the actor comes from the token. *Phase 3.*
4. ~~**Auth in the skeleton.**~~ **Resolved (2026-09-27):** anonymous reads through the proxy and the server prefetch; writes refused with a problem naming step 2. Step 2 brings sign-in through **Stytch**, with users, roles and permissions in the database instead of `PRINCIPALS`. See `findings.md`. Was: Access is step 2's whole subject, but the proxy
   exists now. Proxy anonymous reads only, and refuse writes, until step 2;
   or give the skeleton a development sign-in (mint a token server-side from
   `TOKEN_MINT_SECRET` for a chosen principal) so writes can be tried early.
   *Phase 3.*
5. ~~**Testing layout.**~~ **Resolved (2026-09-27):** Vitest's browser mode (Chromium, Playwright as provider) for components in `packages/ui` and the app's client components, Node for the client package and pure logic; one Playwright smoke test (P1–P3 through the proxy, a write refused) against a seeded API, locally through Playwright's `webServer` and in CI with the Postgres service container. See `findings.md`. Was: Component tests in Vitest with jsdom or happy-dom, or
   Vitest's browser mode (real browser, Playwright as its provider); what
   Playwright tests end to end in this step, and how CI provides it a seeded
   API. *Phases 1 and 4.*
6. ~~**Deploy in this step?**~~ **Resolved (2026-09-27):** yes: `ropa-web` joins the Blueprint as a web service (about $7 a month, accepted), deployed and verified in Phase 5. See `findings.md`. Was: A `ropa-web` web service on Render proves the
   proxy over the private network early, and costs about $7 a month (a
   starter instance). Or stay local until step 2, when there's sign-in and
   something worth showing. *Phase 5.*

7. ~~**Dark mode's switch.**~~ **Resolved (2026-09-27):** the Rulemark file's: `data-theme` on `<html>`, the OS's `prefers-color-scheme` when it's unset; next-themes with `attribute="data-theme"`; shadcn's `.dark` block and variant go. Tests cover the attribute both ways and the OS fallback. See `findings.md`. Was: shadcn keys dark on a `.dark` class (next-themes
   `attribute="class"`, open question 1); `rulemark-colors.css` on
   `data-theme` on `<html>`, falling back to the OS's `prefers-color-scheme`
   when unset. *Phase 1b.*
8. ~~**One vocabulary or two.**~~ **Resolved (2026-09-27):** shadcn's names kept and defined from `--rm-*` (a bridge), Rulemark's names for app code; on the clashes shadcn's meaning keeps the name: `input` is the field border (`--rm-input-border`), Rulemark's field background is renamed `field`, and `secondary` is a soft fill (`--rm-neutral-subtle`). Components are restyled where the Rulemark spec says what shadcn can't: the button's variants take Rulemark's states. See `findings.md`. Was: **One vocabulary or two.** shadcn's components use its names (`muted`,
   `accent`, `destructive`, `popover`, `input`...); the Rulemark file has its
   own (`surface`, `fg-muted`, `danger`, `success`...). Five names collide:
   `primary`, `secondary`, `border`, `ring`, and `input`, which means the field
   border in shadcn and the field background in Rulemark. Bridge shadcn's
   names onto `--rm-*`, and/or restyle components to Rulemark's states
   (`primary-hover`, `secondary-border`, `ghost-hover`). *Phase 1b.*
9. ~~**Where the files live.**~~ **Resolved (2026-09-27):** the colour file moves to `src/styles/rulemark-colors.css`, edited for question 8 with a header naming the changes from v1 (the `--rm-*` values untouched), imported by `globals.css`; the logos become components in the package (`Lockup`, `Wordmark`, `Icon`), inline SVG in the brand's exact colours, switched by the `dark` variant, with an accessible name; the SVG files stay available for what a component can't reach (the favicon, exports, email). See `findings.md`. Was: **Where the files live.** `ux/rulemark-colors.css` imported as is, or its
   tokens moved into `src/styles/`; how the app gets the SVGs. *Phase 1b.*

10. ~~**Radius.**~~ **Resolved (2026-09-27):** shadcn's steps set to the spec's values (`sm` 4px, `md` 6px, `lg` 8px, `xl` 12px, `2xl` 16px), so generated buttons, inputs and cards are on spec untouched; restyled components use the named radii (`rounded-control`, `rounded-popover`, `rounded-card`, `rounded-dialog`...). See `findings.md`. Was: shadcn's scale comes from `--radius` (0.625rem: `lg` 10px, `xl` 14px),
   used as `rounded-lg` 44 times (controls, popovers), `rounded-md` 29 (menu
   items), `rounded-xl` 9 (cards, dialogs); the spec names 8px controls, 10px
   popovers, 12px cards, 16px dialogs. *Phase 1b.*
11. ~~**Control sizes.**~~ **Resolved (2026-09-27):** the spec's: the button's default is `h-control px-control-x text-label` (36px), `sm` `h-control-sm text-label-sm` (32px), `lg` `h-control-lg` (44px), icon buttons `size-control-sm`/`size-control`/`size-control-lg`; `xs` stays 24px with `text-label-sm`, below the spec; inputs and selects follow when added. See `findings.md`. Was: **Control sizes.** Nova's button is 32px by default (28 small, 24 extra
    small, 36 large) and its inputs 32px; the spec's controls are 36px (32
    small, 44 large) with 14px side padding, and label text. Restyle to the
    spec, or keep Nova's compact sizes. *Phase 1b.*
12. ~~**Loading Geist.**~~ **Resolved (2026-09-27):** the `geist` package through `next/font` in the app (Phase 2), setting `--font-geist-sans` and `--font-geist-mono` on `<html>`, as the stack expects; the package only drops the scaffold's self-referencing `--font-sans` and tests the stack. See `findings.md`. Was: **Loading Geist.** The spec's stack looks for `--font-geist-sans` (the
    `geist` package through `next/font`); the scaffold's `next/font/google`
    with `variable: '--font-sans'` would overwrite the stack; Fontsource or a
    Google Fonts link are the other routes. *Phase 1b, built in Phase 2.*

## Decisions carried forward
| Decision | Where it came from |
|---|---|
| Rulemark Governance isn't for sale; features are judged by their value to the people using it | Roadmap, 2026-09-27 |
| Self-hosted and single-tenant: one deployment per organisation | Roadmap, Distribution |
| The browser calls only the web app's origin; a Next Route Handler proxies to the API over the private network and holds the token; no CORS | `ropa-packages.md` §8.1 |
| Test-driven throughout; tests are written before the code they cover, and checked by breaking the code on purpose | RoPA steps 1–5 |
| Packages stay source-only, with a `development` export condition; rebuild before `tsc` reads them without it | RoPA step 1 |
| npm workspaces, one ESLint flat config and one Prettier config at the root; no task runner until CI gets slow | `workspace-skeleton.md` §3.3 |
| Code is pushed separately from docs, code first; **nothing is pushed without the user's go-ahead** | RoPA steps; 2026-09-27 |
| **The component package (open question 1):** `packages/ui` is `@rulemark/ui`, source-only, compiled by the app through `transpilePackages`; shadcn on **Base UI**, style **Nova**, base colour **neutral**, **Lucide** icons, CSS variables; dark mode from the start with next-themes (system default; its `attribute` is now `data-theme`, open question 7). Both `components.json` files share style, icon library and base colour | Interface step 1 |
| **Where data is fetched (open question 2):** Server Components prefetch on the server (to `ropa-api` directly, with the token) and hydrate TanStack Query; client components read the same query keys, refetching through `/api/ropa`; writes are mutations through the proxy that invalidate. One set of query keys and query functions for both sides | Interface step 1 |
| **The API client (open question 3):** `@rulemark/ropa-client` is built now, its core plus the calls the first page uses, and grows with each screen; `ropa-packages.md` §5.1's `actor` option goes (the token decides) | Interface step 1 |
| **Auth in the skeleton (open question 4):** reads go through anonymously, writes are refused until step 2. **Step 2: Stytch** for sign-in, and users, roles and permissions in the database, replacing `PRINCIPALS` | Interface step 1 |
| **Testing layout (open question 5):** Vitest browser mode (Chromium) for components, Node for the client and logic; Playwright smoke-tests the real web app against the real API with the story replayed, locally and in CI; later steps add their own journeys | Interface step 1 |
| **Dark mode's switch (open question 7):** `data-theme` on `<html>` (`light` or `dark`), falling back to the OS's preference when unset, as `rulemark-colors.css` defines it; next-themes writes the attribute (`attribute="data-theme"`, system default); no `.dark` class | Interface step 1, Phase 1b |
| **Colour names (open question 8):** two vocabularies, one palette. shadcn's names (`background`, `muted`, `accent`, `destructive`, `popover`, `input`, `sidebar-*`...) are defined from `--rm-*`, so generated components take the Rulemark colours unchanged; app code uses Rulemark's names (`surface`, `fg-muted`, `danger`, `success`...). Clashes go to shadcn's meaning: `input` = the field border, Rulemark's field background = **`field`**, `secondary` = a soft fill. Components are restyled to Rulemark's spec where it says more (the button's hover, active, border and danger states); each `shadcn add` gets a look for that | Interface step 1, Phase 1b |
| **Brand files (open question 9):** one colour file, `packages/ui/src/styles/rulemark-colors.css`, the user's v1 with question 8's edits named in its header; logo components (`Lockup`, `Wordmark`, `Icon`) drawn inline and switched by the `dark` variant, right on first paint; the SVG files kept for the favicon, exports and email | Interface step 1, Phase 1b |
| **Radius (open question 10):** shadcn's radius steps carry the foundations' values (`sm` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16px) instead of multiples of `--radius`; components restyled to the spec use the named radii | Interface step 1, Phase 1b |
| **Control sizes (open question 11):** controls take the foundations' heights (36px default, 32 small, 44 large) and label text, not Nova's (32, 28, 36); the button now, inputs and selects as they're added; the button's `xs` (24px) stays as a size below the spec | Interface step 1, Phase 1b |
| **Loading Geist (open question 12):** the app loads Geist and Geist Mono with the `geist` package through `next/font`, which self-hosts, preloads and size-matches the fallback, and sets the `--font-geist-*` variables the foundations' stacks read; no Google Fonts request from the browser | Interface step 1, Phase 1b (built in Phase 2) |
| **How the browser reaches the API (step 1):** a Next rewrite, `/api/ropa/v1/:path*` → `ROPA_API_URL/v1/:path*`, compiled into the build; not a Route Handler, since there are no credentials yet. Anonymous writes get the API's 401. Revisited with step 2's sign-in | Interface step 1, Phase 3 (the user, 2026-09-27) |
| **Package imports:** `ropa-schemas` and `ropa-client` import each other's files with `.ts`, rewritten to `.js` on emit (`rewriteRelativeImportExtensions`), so Turbopack compiles them from source in development | Interface step 1, Phase 3 (the user, 2026-09-27) |
| **Deploy in step 1 (open question 6):** `ropa-web` joins the Blueprint as a web service; about $7 a month, accepted 2026-09-27 | Interface step 1 |

## Errors encountered
| Error | Attempt | Resolution |
|---|---|---|
