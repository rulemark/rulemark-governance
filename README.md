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
npm run db:migrate && npm run db:seed
npm run dev                      # API on :3000, docs at /api-docs
```

On Render nothing reads `.env`: every variable comes from the service's
environment, and the generated secrets come from the Blueprint. A variable that
is already set always wins over `.env`, so an override in your shell works as
you would expect.

Requires Node 24 (see `.nvmrc`).

> Demo project. All data is synthetic; no real personal data is used.
