# @rulemark/ropa-web

The RoPA interface: a Next.js app (App Router) built on `@rulemark/ui`. The
browser calls only this app's origin; the app reaches `ropa-api` over Render's
private network (`docs/ropa/ropa-packages.md` §8.1). The proxy and the first
page that reads the record arrive in interface step 1, Phase 3.

```sh
npm run dev -w apps/ropa-web     # http://localhost:3001 (the API is on 3000)
npm run test -w apps/ropa-web    # Node tests, and components in Chromium
npm run build -w apps/ropa-web && npm run start -w apps/ropa-web
```

- **Configuration:** `ROPA_API_URL`, a URL or `host:port`, read from the
  repository-root `.env` in development. Without it, the server stops at
  startup with the variable to fix (`src/instrumentation.ts`).
- **Health:** `GET /healthz`, as the API's.
- **Components:** run `npx shadcn@latest add <component>` from this directory;
  base components land in `packages/ui`. Then `npm run format`, point the
  new file's `cn` import at `@rulemark/ui/lib/utils` (lint says where), check
  `globals.css`, and restyle to the Rulemark spec where it says more.
- **Theme:** next-themes writes `data-theme` on `<html>`; Geist and Geist Mono
  load through the `geist` package and `next/font`.
