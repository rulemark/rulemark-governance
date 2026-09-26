# rulemark-governance

Governance demo services running on [Render](https://render.com), built to explore the
platform and to produce an always-current architecture document.

**First service: RoPA** — a Record of Processing Activities API (GDPR Article 30).
More to follow: a subprocessor monitor, a DSAR tracker, and an architecture snapshot.

## Live

**<https://ropa-api.onrender.com>** — the API, its documentation, and the
Hireloop demo record.

### A five-minute tour

1. **Open the docs.** The root redirects to Swagger UI, generated from the same
   Zod schemas the server validates with, so it cannot drift from the API.

2. **Read something.** Reads are public and an anonymous caller is treated as a
   viewer, so these need no token:

   - [`/v1/parties?kind=vendor`](https://ropa-api.onrender.com/v1/parties?kind=vendor)
     — who processes data for us
   - [`/v1/agreements?offering=ats`](https://ropa-api.onrender.com/v1/agreements?offering=ats)
     — which clients are enrolled, and on whose terms. Aurelia signed its own
     DPA restricted to the EEA
   - [`/v1/taxonomy/data-categories`](https://ropa-api.onrender.com/v1/taxonomy/data-categories)
     — `diversity` and `health` are flagged `art9`
   - [`/v1/me`](https://ropa-api.onrender.com/v1/me) — what you are allowed to do

3. **Read the record itself.** The Hireloop story (`docs/ropa/ropa-story.md`) is
   loaded as it happened, February to September 2026:

   - [`/v1/activities`](https://ropa-api.onrender.com/v1/activities) — four
     controller activities (C1–C4) and three processor ones (P1–P3). Filter them:
     [`?party=mailcrest`](https://ropa-api.onrender.com/v1/activities?party=mailcrest),
     [`?special=true`](https://ropa-api.onrender.com/v1/activities?special=true),
     [`?country=US`](https://ropa-api.onrender.com/v1/activities?country=US)
   - [`/v1/activities/P1`](https://ropa-api.onrender.com/v1/activities/P1) —
     Mailcrest appears twice, one region each: the EU region only for Aurelia,
     the US region for everyone else
   - [`/v1/activities/P1/revisions`](https://ropa-api.onrender.com/v1/activities/P1/revisions)
     — its history, dated as the story tells it: created in February, changed
     when Aurelia signed in March, and again when Mailcrest added a
     subcontractor in India in July
   - The subprocessor list, derived from the record rather than kept as a page:
     [by offering](https://ropa-api.onrender.com/v1/subprocessors?offering=ats)
     (the standard terms, and the public page), for
     [Aurelia](https://ropa-api.onrender.com/v1/subprocessors?client=aurelia)
     (Mailcrest in Ireland, no Glitchlog, no AI parsing) and for
     [Northwind](https://ropa-api.onrender.com/v1/subprocessors?client=northwind)
   - [The Art. 30 record for the ATS, as Markdown](https://ropa-api.onrender.com/v1/report?offering=ats&format=markdown)
     — each activity carries an anchor built from its code, so a link to `#p3`
     survives any rename

4. **Ask the questions the record exists for.** Each view answers one of the
   services built around the record:

   - [`/v1/parties/mailcrest/impact`](https://ropa-api.onrender.com/v1/parties/mailcrest/impact)
     — the Monitor's question when Mailcrest adds a subcontractor (Ch6): every
     engagement that depends on Mailcrest, P1 twice, and for each the clients
     it reaches, grouped by the terms they signed. Aurelia needs to approve,
     not just be told, and Mailcrest's 30 days' notice is shorter than the 60
     she is owed (`noticeConflict`)
   - [`/v1/data-map?subjectCategory=candidates&client=northwind`](https://ropa-api.onrender.com/v1/data-map?subjectCategory=candidates&client=northwind)
     — the DSAR tracker's question when Lena, who applied to Northwind, asks to
     be erased (Ch7): Hireloop `forward`s P1 and P3 to Northwind, and `act`s on
     C4, its own error tracking, with its own retention rules
   - [`/v1/data-map?subjectCategory=employees`](https://ropa-api.onrender.com/v1/data-map?subjectCategory=employees)
     — Kees, a former employee: only C1, in Peoplehub, where sick-leave records
     go after two years and payroll stays for seven (Dutch tax law)
   - [`/v1/coverage`](https://ropa-api.onrender.com/v1/coverage) — the
     Snapshot's question: where do the record and the architecture disagree?
     Exactly one finding: Helpdesk Partners in India can reach Mailcrest's EU
     region, which breaks Aurelia's EEA-only clause. C1 has no Render system,
     and that is correctly not a finding
   - [`/v1/review-items`](https://ropa-api.onrender.com/v1/review-items) — the
     findings carried to a person, until resolved or dismissed

5. **Try to write something.** `POST /v1/parties` without a token answers `401`
   — not `403`, because we do not know who you are. Authorization runs before
   validation, so you cannot learn whether your body was well-formed either.

6. **Get a token.** `POST /v1/tokens` with a known subject and the mint secret,
   then **Authorize**. `GET /v1/me` now lists the permissions your roles add up
   to. A viewer attempting a write gets `403` naming the exact permission it
   needed.

7. **Create a party**, leaving out `slug` — it is derived from the name. Then
   read `/v1/parties/{slug}/revisions`: the change is recorded against the
   subject in your token, not against anything the request could assert. Send
   `X-Actor` and watch it be ignored.

8. **Edit it.** A `PUT` without `If-Match` answers `428`; with a stale version,
   `412`. The `ETag` on every response is the version to send back.

9. **Draft and approve an activity.** An editor can save an incomplete draft,
   but cannot activate it: `POST /v1/activities/{ref}/activate` needs the
   `activity:approve` permission, and `If-Match` naming the version the approver
   reviewed. Activating a draft that is missing what its role requires answers
   `422`, naming each missing field. An approver holding an older version gets
   `412`.

10. **Carry a finding to a person.** Open a review item from the coverage
    finding: `POST /v1/review-items` with its `targetType`, `target` and
    `type` as the `reason`, and its `key` in `details`. It gets an `RI-n` code
    and records who opened it from your token. An editor closes it with
    `POST /v1/review-items/{code}/resolve` and a `resolutionNote`; a second
    close answers `409`, because only an open item can be closed. Review items
    are not versioned, so there is no `If-Match` here.

> Demo project. All data is synthetic; no real personal data is used, and the
> mint secret is not published — the write steps need one.

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

## Deployment

The stack is described by [`render.yaml`](render.yaml): one web service, one
Postgres 18 instance, in a project and environment. Secrets are generated by
Render and never exist in this repository; the database URL is injected rather
than copied.

Deploys run only after CI passes, then build → migrate → start, with the
migration on its own instance so a failure fails the deploy and the previous
version keeps serving. Traffic moves only once the new instance answers
`/healthz`.

A build filter keeps documentation changes from deploying, and Render applies
it to the **newest commit of a push** only. A push that ends with a docs-only
commit therefore deploys nothing, even if earlier commits in it change the app,
and the skip leaves no trace in the service's Events. Push code commits on their
own, then documentation separately.

To load the story into a fresh database, run the seed from the service's
**Shell** in the Render dashboard, so the connection string never leaves Render:

```bash
ALLOW_SEED_RESET=true node apps/ropa-api/dist/demo/replay.js --reset
```

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

Two ways to load the Hireloop story. Both are idempotent: run either twice and
nothing changes.

```bash
npm run db:seed                  # replays the story into the database, backdated
npm run db:seed -- --reset       # empties the record first, so codes start at C1 and P1
npm run demo:data                # loads the story through the API, stamped now
```

**`db:seed`** writes through the domain layer, so every rule, code and revision
behaves as in real use, and it backdates each save to its moment in the story
(February to September 2026). That gives `asOf` and `/changes` a history to
show. It produces C1–C4 and P1–P3 as `docs/ropa/ropa-story.md` tells them.
`--reset` empties everything, history included, so it refuses to run with
`NODE_ENV=production` unless `ALLOW_SEED_RESET=true` is set. It needs only
`DATABASE_URL`.

**`demo:data`** talks HTTP like any other client, so it also works against a
deployed service (`DEMO_API_URL=https://… npm run demo:data`), which is how a
Render preview environment gets filled, and doubles as a smoke test. It creates
and approves the activities, then makes the story's later edits by reading each
activity and sending it back changed. Everything is stamped now, because
backdating is deliberately not exposed over HTTP. It needs only
`TOKEN_MINT_SECRET` and a subject with the admin role (`DEMO_SUBJECT`, default
`svc:seed`).

Then open `http://localhost:3000/api-docs`, mint a token at `POST /v1/tokens`
with the `TOKEN_MINT_SECRET` from your `.env`, press **Authorize**, and explore.

On Render nothing reads `.env`: every variable comes from the service's
environment, and the generated secrets come from the Blueprint. A variable that
is already set always wins over `.env`, so an override in your shell works as
you would expect.

Requires Node 24 (see `.nvmrc`).

> Demo project. All data is synthetic; no real personal data is used.
