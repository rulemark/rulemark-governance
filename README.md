# rulemark-governance

Governance demo services running on [Render](https://render.com), built to explore the
platform and to produce an always-current architecture document.

**First service: RoPA** — a Record of Processing Activities API (GDPR Article 30).
More to follow: a subprocessor monitor, a DSAR tracker, and an architecture snapshot.

## Documentation

| Document                                                                 | What it covers                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| [docs/ropa/ropa-story.md](docs/ropa/ropa-story.md)                       | The Hireloop narrative the design is checked against |
| [docs/ropa/ropa-design.md](docs/ropa/ropa-design.md)                     | First design strawman (partly superseded)            |
| [docs/ropa/ropa-data-model.md](docs/ropa/ropa-data-model.md)             | Entities, relationships, rules, versioning           |
| [docs/ropa/ropa-api.md](docs/ropa/ropa-api.md)                           | HTTP API: conventions, endpoints, views, auth        |
| [docs/ropa/ropa-database.md](docs/ropa/ropa-database.md)                 | Postgres schema, migrations, seeds                   |
| [docs/ropa/ropa-packages.md](docs/ropa/ropa-packages.md)                 | Shared packages and deployment topology              |
| [docs/program/workspace-skeleton.md](docs/program/workspace-skeleton.md) | Repository layout and tooling                        |

## Layout

```
apps/ropa-api      the RoPA service (Express, Drizzle, Postgres)
apps/ropa-web      the frontend (framework TBD)
packages/ropa-schemas   @rulemark/ropa-schemas — Zod schemas, types, enums
packages/ropa-client    @rulemark/ropa-client  — typed API client
docs/              design and program documents
```

## Contributing to this repo

Commits are signed and authored as `matt@rulemark.io`. After cloning, enable the
guard hook, which refuses a push with the wrong GitHub identity or remote:

```bash
git config core.hooksPath .githooks
```

## Getting started

```bash
npm ci
cp .env.example .env             # local settings; git-ignored, never deployed
docker compose up -d db          # Postgres 18
npm run db:migrate               # creates the schema
npm run dev                      # API on :3000, docs at /api-docs
```

### Demo data

```bash
npm run demo:data                # loads the Hireloop cast through the API
```

This talks HTTP like any other client, so it also works against a deployed
service (`DEMO_API_URL=https://… npm run demo:data`), which is how a Render
preview environment gets filled. It is idempotent: run it twice and nothing
changes.

It is **not** the seed described in `docs/ropa/ropa-database.md` §9. That one
writes through the domain layer so it can backdate `valid_from` and replay the
story's timeline for `asOf` and `/changes`; backdating is deliberately not
exposed over HTTP, so everything loaded here is stamped now. The real
`npm run db:seed` arrives with build step 2, along with activities.

Then open `http://localhost:3000/api-docs`, mint a token at `POST /v1/tokens`
with the `TOKEN_MINT_SECRET` from your `.env`, press **Authorize**, and explore.

On Render nothing reads `.env`: every variable comes from the service's
environment, and the generated secrets come from the Blueprint. A variable that
is already set always wins over `.env`, so an override in your shell works as
you would expect.

Requires Node 24 (see `.nvmrc`).

> Demo project. All data is synthetic; no real personal data is used.
