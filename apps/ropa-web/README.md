# @rulemark/ropa-web

The RoPA interface: a Next.js app (App Router) built on `@rulemark/ui`. The
browser calls only this app's origin; the app reaches `ropa-api` over Render's
private network (`docs/ropa/ropa-packages.md` §8.1): through a Next rewrite
from the browser, and directly from the server, which prefetches each page's
data into TanStack Query. The home page lists the record's activities.

- **The rewrite** (`src/lib/rewrites.ts`): `/api/ropa/v1/*` on this origin is
  served from `ROPA_API_URL/v1/*`, so there's no CORS. Next compiles it into
  the build, so `next build` and `next typegen` need `ROPA_API_URL` (locally
  from the root `.env`). Until sign-in (interface step 2), reads are anonymous
  and the API refuses writes itself.

```sh
npm run dev -w apps/ropa-web     # http://localhost:3001 (the API is on 3000)
npm run test -w apps/ropa-web    # Node tests, and components in Chromium
npm run build -w apps/ropa-web && npm run start -w apps/ropa-web
```

- **Configuration:** `ROPA_API_URL`, a URL or `host:port`, read from the
  repository-root `.env` locally. Without it, the build stops, and so does
  the server at startup, naming the variable (`src/instrumentation.ts`).
- **Health:** `GET /healthz`, as the API's.
- **Components:** run `npx shadcn@latest add <component>` from this directory;
  base components land in `packages/ui`. Then `npm run format`, point the
  new file's `cn` import at `@rulemark/ui/lib/utils` (lint says where), check
  `globals.css`, and restyle to the Rulemark spec where it says more.
- **Theme:** next-themes writes `data-theme` on `<html>`; Geist and Geist Mono
  load through the `geist` package and `next/font`.
