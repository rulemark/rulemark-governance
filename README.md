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
   - [`/v1/activities/P1/engagements`](https://ropa-api.onrender.com/v1/activities/P1/engagements)
     — the same engagements on their own, each readable by its id, under P1's
     own `ETag`: they are part of the activity, not a record of their own
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
     findings carried to a person, until resolved or dismissed. Nobody opened
     RI-1 by hand: a Render cron job runs coverage nightly and opens an item for
     each finding no person has yet, as `svc:schedule`. It opens and never
     decides: a second run opens nothing, a dismissal stands, and closing an
     item is left to whoever fixed the finding

5. **Ask what the record said then.** The regulator's questions (Ch8), answered
   from the history every save has kept since the first deploy:

   - [`/v1/report?view=all&asOf=2026-03-01`](https://ropa-api.onrender.com/v1/report?view=all&asOf=2026-03-01)
     — the record as it stood on 1 March: C1–C4 and P1, no P3, no Scribe AI,
     and Aurelia not yet a client. Names are the ones the record used that day.
     [Without `asOf`](https://ropa-api.onrender.com/v1/report?view=all), P3 is
     there
   - [The same record as CSV](https://ropa-api.onrender.com/v1/report?view=all&asOf=2026-03-01&format=csv)
     — for whoever answers the regulator in a spreadsheet: one row per activity
     and engagement, downloaded as `ropa-all-2026-03-01.csv`, with the date and
     the organisation on every row as well, so both survive a rename. A cell that would start a
     formula in Excel is neutralised
   - [`/v1/subprocessors?client=aurelia&asOf=2026-05-01`](https://ropa-api.onrender.com/v1/subprocessors?client=aurelia&asOf=2026-05-01)
     — Aurelia's list on 1 May: Render and Mailcrest in Ireland. Compare
     [today's](https://ropa-api.onrender.com/v1/subprocessors?client=aurelia),
     where Mailcrest reaches India through Helpdesk Partners
   - [`/v1/changes?from=2026-03-01`](https://ropa-api.onrender.com/v1/changes?from=2026-03-01)
     — what changed since March, with who and why: Aurelia signing, P2, P3 on
     14 April, the July edits after Mailcrest's change, and review items as they
     are opened and closed

   Every change is also pushed as an event, in order, to the services that act
   on it: the audit log (a private service, reachable only inside Render) gets
   each one, and the Monitor will get `subprocessors.changed` when a client's
   list moves.

6. **Try to write something.** `POST /v1/parties` without a token answers `401`
   — not `403`, because we do not know who you are. Authorization runs before
   validation, so you cannot learn whether your body was well-formed either.

7. **Get a token.** `POST /v1/tokens` with a known subject and the mint secret,
   then **Authorize**. `GET /v1/me` now lists the permissions your roles add up
   to. A viewer attempting a write gets `403` naming the exact permission it
   needed.

8. **Create a party**, leaving out `slug` — it is derived from the name. Then
   read `/v1/parties/{slug}/revisions`: the change is recorded against the
   subject in your token, not against anything the request could assert. Send
   `X-Actor` and watch it be ignored.

9. **Edit it.** A `PUT` without `If-Match` answers `428`; with a stale version,
   `412`. The `ETag` on every response is the version to send back.

10. **Draft and approve an activity.** An editor can save an incomplete draft,
   but cannot activate it: `POST /v1/activities/{ref}/activate` needs the
   `activity:approve` permission, and `If-Match` naming the version the approver
   reviewed. Activating a draft that is missing what its role requires answers
   `422`, naming each missing field. An approver holding an older version gets
   `412`.

11. **Change one vendor.** Mailcrest's onward transfer to India (Ch6) can be
    recorded on its engagement alone:
    `PUT /v1/activities/P1/engagements/{id}` with the engagement and
    `If-Match` naming P1's version. It is still one activity: one revision, the
    same rules, and `subprocessors.changed` for every list it moves, exactly as
    sending the whole activity would. Errors point into the engagement you
    sent (`/transfers/0/mechanism`); naming a client as the vendor answers
    `422 wrong_party_kind`. `POST` adds one, `DELETE` removes one, with an
    optional `changeNote` in its body.

12. **Carry a finding to a person.** The nightly job did this for the region
    violation (RI-1); by hand it is `POST /v1/review-items` with the finding's
    `targetType`, `target` and `type` as the `reason`, and its `key` in
    `details`. `?key=` with a finding's key finds the items already carrying
    it, and [`?source=schedule`](https://ropa-api.onrender.com/v1/review-items?source=schedule)
    what the job opened. An item gets an `RI-n` code and records who opened it
    from your token. An editor closes it with
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
| [docs/program/roadmap.md](docs/program/roadmap.md)                       | What exists, what comes next, and known gaps         |
| [docs/program/workspace-skeleton.md](docs/program/workspace-skeleton.md) | Repository layout and tooling                        |

## Deployment

The stack is described by [`render.yaml`](render.yaml): one web service, one
Postgres 18 instance, a private service, `audit-log`, that receives the
service's events, and a nightly cron job, `coverage-job`, that opens review
items for new coverage findings, all in a project and environment. Secrets are generated by
Render and never exist in this repository; the database URL and the receiver's
private address are injected rather than copied.

Deploys run only after CI passes, then build → migrate → start, with the
migration on its own instance so a failure fails the deploy and the previous
version keeps serving. Traffic moves only once the new instance answers
`/healthz`.

A build filter keeps documentation changes from deploying, and Render applies
it to the **newest commit of a push** only. A push that ends with a docs-only
commit therefore deploys nothing, even if earlier commits in it change the app,
and the skip leaves no trace in the service's Events. Push code commits on their
own, then documentation separately.

A Blueprint sync that creates a service runs its steps in order, so a variable
pointing at a new service (`EVENT_DESTINATION_AUDIT_LOG`) only arrives once
that service exists; until then its events wait in the outbox. If a sync sits
on "Create private service" for long, a **Manual Sync** from the Blueprint's
page completes it.

The cron job calls the API as `svc:schedule`, which has to be in `ropa-api`'s
`PRINCIPALS` (set in the dashboard, like every subject):
`{"sub":"svc:schedule","name":"Coverage job","roles":["service:schedule"]}`.
Until it is, each run fails and says so. **Trigger run** in the job's dashboard
page runs it without waiting for 02:00 UTC.

To load the story into a fresh database, run the seed from the service's
**Shell** in the Render dashboard, so the connection string never leaves Render:

```bash
ALLOW_SEED_RESET=true node apps/ropa-api/dist/demo/replay.js --reset
```

## Layout

```
apps/ropa-api      the RoPA service (Express, Drizzle, Postgres)
apps/ropa-web      the frontend (framework TBD)
apps/audit-log     a stand-in for the audit log: receives RoPA's events
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

### Events

Every change writes an event to the outbox, and the service delivers them to
each configured consumer (`docs/ropa/ropa-api.md` §6). To watch them arrive
locally, start the receiver and point the service at it:

```bash
npm run build && npm start -w apps/audit-log     # listens on :4000
EVENT_DESTINATION_AUDIT_LOG=localhost:4000 npm run dev
```

Anything written before is delivered first, in order. Leave the variable unset
and events simply wait.

### The coverage job

The nightly job opens a review item for each coverage finding that no person
has yet (`docs/ropa/ropa-api.md` §5.5). With the service running, run it once:

```bash
npm run build && npm run job:coverage -w apps/ropa-api
```

A second run opens nothing. It uses `svc:schedule` from `.env`'s `PRINCIPALS`,
and `ROPA_API_URL` if set, else the local service on `PORT`.

> Demo project. All data is synthetic; no real personal data is used.
