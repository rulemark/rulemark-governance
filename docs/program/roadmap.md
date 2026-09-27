# Roadmap

What exists, what comes next, and everything else worth doing, in one place.
Each entry points to where its details live; this file only keeps the list.

## Where things stand (2026-09-27)

The **RoPA API** is built and deployed: all five steps of its build order
(`docs/ropa/ropa-api.md` §8), with the Hireloop story (`ropa-story.md`)
seeded on the live service. On Render, from one Blueprint (`render.yaml`):

- `ropa-api`, a public web service, with Postgres
- `audit-log`, a private service that receives every change as an event
- a cron job that runs the coverage view nightly and opens review items

The step-by-step history is in `docs/program/plan-archive/` (one folder per
step; its `findings.md` files record why things are the way they are).

## Distribution: self-hosted, single-tenant (decided 2026-09-27)

Rulemark Governance ships as a Blueprint each customer deploys into their own
Render workspace; one deployment serves one organisation, as the demo does
today.

- **Why.** The Render API has no OAuth and no scoped keys: its only
  credential is a personal API key that reaches every workspace its user
  belongs to, with every action the user has. A hosted service reading
  customers' Render data would have to hold such keys; self-hosted, the key
  never leaves the customer's account. And the record itself (employees,
  vendors, clients) stays in the customer's database, so Rulemark is not a
  processor of it (Art. 28): the right shape for a GDPR tool.
- **What it asks of us.** A deployable Blueprint: a "Deploy to Render" button
  from a public repository, prompting for secrets (`sync: false`), with
  `autoDeployTrigger: off` for services deployed that way (Render's advice);
  first-run setup that doesn't depend on our dashboard habits (the
  `PRINCIPALS` list, the mint secret, the seed being optional); and upgrades
  customers apply themselves, which migrations run in `preDeployCommand`
  already allow.
- **Rejected for now.** A hosted multi-tenant SaaS: the key problem above,
  Rulemark becoming every customer's processor, and a `tenant_id`, row-level
  security and per-tenant uniqueness through the whole schema. A hybrid
  (hosted app, collector in the customer's workspace pushing metadata out,
  Render webhooks as triggers) stays possible later if the Snapshot's
  collector talks to the rest only through APIs.

## Next: the Architecture Snapshot

Design in progress: `docs/snapshot/snapshot-design.md`. Everything above exists partly to give the Snapshot a
real scenario: public and private services, a database and a cron job it
should find and describe, and a RoPA that tells it what personal data each
part handles. Together they make the program's goal, a **data-aware
architecture document** (`docs/ropa/ropa-design.md` §1). Starting point:
`docs/program/architecture-snapshot-exec-summary.md`.

Its design questions are settled (2026-09-27): eleven decisions in
`docs/snapshot/snapshot-design.md`, among them real infrastructure with
Hireloop's systems played by real resources, an app of its own sharing
`ropa-db`, the Render API and each Blueprint's `render.yaml` as sources, an
endpoint allowlist so it never reads a secret, and the coverage job staying
the only opener of review items. Next: a build plan.

## Services around the record

- **Subprocessor Monitor** (service #5 in `service-ideas.md`). Watches
  vendors' subprocessor lists, opens review items when one changes, and sends
  the Art. 28 notices clients are owed. RoPA already writes
  `subprocessors.changed` for it and answers its question at
  `/parties/{ref}/impact`. Building it adds the per-event `data` schemas the
  event envelope is waiting for (`ropa-api.md` §6, §8).
- **DSAR tracker** (service #3). Finds where a data subject's data lives,
  and who must act, through `/data-map` (Chapter 7 of the story).
- **RoPA frontend** (`apps/ropa-web`, a placeholder) and
  **`@rulemark/ropa-client`** (`ropa-packages.md` §5, empty until its first
  consumer shapes it). The framework is not chosen; the app proxies to
  `ropa-api` over the private network (`ropa-packages.md` §8.1).

## Hardening the RoPA API

Known gaps, none needed by the story so far:

- A client with agreements for several offerings is refused by the per-client
  views (`ropa-api.md` §9, question 6).
- A `PUT` that swaps a unique value between two nested rows can collide
  mid-update.
- `mechanism: adequacy` is not checked against the countries that have an
  adequacy decision.
- Data categories aren't linked to subject categories within an activity.
- Review items have no `openedAt` separate from `createdAt`, so the seed
  can't backdate them.
- Nothing stops two open review items for one finding `key` if the cron job
  and the Snapshot open it at the same moment; a `key` column with a partial
  unique index on open items would. Less pressing now: the Snapshot won't
  open items itself (`snapshot-design.md`, decision 11).

Future improvements to the data model, with their reasoning:
`ropa-data-model.md` §11 (F1 onward transfers as parties, F2 party roles as a
set, F3 joint controllers, F4 required change notes on the live record, F5
principals in the database).

## Ideas not taken up

From `service-ideas.md`, researched but not planned: a PII/PHI redaction
guard in front of the audit log (#2), a 72-hour breach-notification clock
(#6), and a consent and retention-policy service (#7).
