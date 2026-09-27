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

## Priorities (set 2026-09-27)

Rulemark Governance isn't for sale: what to build next is decided by its
value to the people using it (the DPO, customer success, Hireloop's clients,
auditors), not by a market. Walking the product through the story (Parts II
and III of `docs/ropa/ropa-story.md`) found where that value is, and what's
missing on the way to it:

1. **Next: the interface, and what clients see.** Without an interface nothing
   reaches Priya, and the outputs that leave Hireloop (the subprocessor page,
   questionnaire answers, notices and approvals, a client's own view) are
   where the record pays off.
2. **Soon: the model.** Linking engagements to the systems that send them
   data (story II.20), and making the story and seed agree with themselves.
3. **Later: the Architecture Snapshot.** Its design questions are settled; its
   build waits.

Story references below are part and gap number: **II.20** is Part II's gap
20, in the table at the end of that part.

## Next: the interface, and what clients see

`apps/ropa-web` is a placeholder and `@rulemark/ropa-client` is empty until
its first consumer shapes it (`ropa-packages.md` §5); the framework is not
chosen, and the app proxies to `ropa-api` over the private network
(`ropa-packages.md` §8.1). What the story says it has to meet:

**Access, first.** Every output below depends on who may see what.

- Anonymous reads expose the whole record; only an offering's subprocessor
  list should be public (III.1).
- Signing in is minting a token with a shared secret (II.1); users live in an
  environment variable, so adding one means a redeploy (II.3, F5).
  Direction (2026-09-27): sign-in through **Stytch**, with users, roles and
  permissions in the database, as the interface's step 2.
- Client staff and outside auditors need their own sign-in, and access
  limited to one client's views; roles are global today (III.18, II.19).
- Which fields may leave Hireloop, per output: owners, role rationales
  (III.6).

**The outputs.**

- The subprocessor page, on Hireloop's own domain, dated, with a year of
  changes (III.2).
- Exports in the form reviewers accept: a dated PDF, answers for a bank's
  portal (III.5); a published format for a processor's extract (III.20).
- Supporting documents as files, not references: the DPIA support pack
  (III.19).
- Later: recurring questionnaire questions mapped to the record (III.8).

**Notices and responses** (Art. 28(2)): the largest gap in the model.

- Notices must go out before a change is decided; the record holds only
  decided changes. Proposed changes that notify without taking effect? The
  biggest open question (III.15).
- A notice contact on the agreement (III.10); notices, deadlines, approvals,
  objections and silent acceptance recorded (III.12); a per-client schedule
  from the effective date and each client's notice days (III.16); per-client
  start dates, since engagement scope entries have no dates (III.13).
- What sends them: `subprocessors.changed` is routed to a Monitor that
  doesn't exist, and sending Hireloop's own notices may not be the Monitor's
  job at all (III.11). Sending and following up hundreds at once (III.17);
  proof of delivery (III.14).
- Subscribers to the public page are a different audience from clients
  (III.4), and their emails are personal data needing consent, unsubscribe,
  retention and an activity (III.3).

**Prospects.** A "what if" preview of a prospect's list under proposed terms,
which the record can't show because prospects aren't in it (III.7).

**First run and upgrades** (see Distribution). A guided order for the `self`
party and the `Render` party, the demo seed kept off real installs (II.4);
upgrades for button deploys, and the suite's cost for a small company (II.5).

## Soon: the model

- **Engagements linked to systems** (II.20): which systems send data to each
  engagement, so the vendor arrows of Chapter 9's diagram have something to
  come from. The model links activities to systems and to engagements, never
  an engagement to a system.
- **The story and seed agree with themselves**: the seed starts Scribe AI on
  14 April, before its notice period ends (III.9); Part I never dates
  `cv-parser`'s deploy (II.13); Rulemark's own processing needs an activity,
  C5, that neither the story's appendix nor the seed has (II.10).
- **Coverage**: check where Hireloop's own systems run against clients'
  allowed regions, not just engagements (II.15); a review item whose finding
  has gone could say so, rather than waiting to be closed by hand (II.9).

## Later: the Architecture Snapshot

Design settled: `docs/snapshot/snapshot-design.md`, eleven decisions, among
them real infrastructure with Hireloop's systems played by real resources, an
app of its own sharing `ropa-db`, the Render API and each Blueprint's
`render.yaml` as sources, an endpoint allowlist so it never reads a secret,
and the coverage job staying the only opener of review items. Together with
RoPA it makes the program's goal, a **data-aware architecture document**
(`docs/ropa/ropa-design.md` §1). Starting point:
`docs/program/architecture-snapshot-exec-summary.md`.

What the story added, to settle when it's built:

- **Revisit before building:** stand-ins collide with "documents itself",
  since one real resource can't play `hireloop-api` and be Rulemark's own
  (II.11); drift reaches the audit log but no person, which may overturn
  decision 11 (II.14).
- **The key and its sources:** a personal Render key, and whether a read-only
  member role exists (II.2); a source that stops working (an expired Git
  token, a departed key owner) thins the document silently (II.8).
- **Timing:** a new service is found after it deploys; a pull-request check
  could find it before (II.12); a nightly capture leaves a day's gap, which
  webhooks could close (II.16).
- **Onboarding:** a review item per system on day one, before the record
  exists (II.6).
- **The document:** vendor arrows must come from RoPA (II.7, and II.20
  above); it should say what a capture can't know (II.17); the architecture
  as of a date (II.18); drift linked to the review that followed it (II.21);
  sharing with outsiders (II.19, under Access above).

## Services around the record

- **Subprocessor Monitor** (service #5 in `service-ideas.md`). Watches
  vendors' subprocessor lists and opens review items when one changes; RoPA
  answers its question at `/parties/{ref}/impact`. Whether it also sends
  Hireloop's own notices is open (III.11, above). Building it adds the
  per-event `data` schemas the event envelope is waiting for (`ropa-api.md`
  §6, §8).
- **DSAR tracker** (service #3). Finds where a data subject's data lives,
  and who must act, through `/data-map` (Chapter 7 of the story); and a
  channel for requests between controller and processor, such as forwarded
  erasure requests (III.21).

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
