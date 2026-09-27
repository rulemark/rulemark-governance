# Architecture Snapshot: Design (v0.1, in progress)

The Snapshot inventories the Render resources in a workspace and publishes an
always-current architecture document. With RoPA, it makes the program's goal:
a **data-aware architecture document**, where the diagram shows what runs
where and each part carries its legal context (`ropa-design.md` §1). The
pitch and scope are in `docs/program/architecture-snapshot-exec-summary.md`;
this document records the design as it is settled, one question at a time.

## 1. Decisions

| # | Decision | Why | Settled |
|---|---|---|---|
| 1 | **Real infrastructure, with stand-ins.** The Snapshot captures the real workspace. The real resources play Hireloop's systems in RoPA through `system.render_resource_id` (`ropa-api` as `hireloop-api`, `ropa-db` as `hireloop-db`, …); story systems with no real resource show as not deployed | The seed tells the Hireloop story and the demo stays story-centred, while the document shows true types, regions, visibility and drift | 2026-09-27 |
| 2 | **Self-hosted, single-tenant.** Shipped in the suite's Blueprint; the collector runs in the customer's own workspace, with their key | The Render API's only credential is a personal key with every permission across every workspace; it should never leave the customer's account (`docs/program/roadmap.md`, Distribution) | 2026-09-27 |
| 3 | **Its own app, sharing the database.** `apps/snapshot`: a cron job that captures, and a web service for the document and its API. Its tables live in their own Postgres schema (`snapshot`) on the existing `ropa-db` instance. It talks to RoPA only over HTTP, as `service:snapshot`, like the coverage job | "The Snapshot owns systems, RoPA keeps a reference" (DM §1) stays true in the code; no second paid database per install; one Blueprint still ships the suite. The schema boundary is a convention, not a wall: neither app reads the other's tables | 2026-09-27 |
| 4 | **Sources: the Render API, the Blueprint API, and `render.yaml`.** The API for what exists and how it is configured; the Blueprint API for which resources each Blueprint manages (any other resource was created by hand); each Blueprint's `render.yaml` for the edges (`fromService`, `fromDatabase`) and for declared-versus-live drift. Environment variable values are never requested | The API describes every resource but records no relationships: a reference is only an environment variable's value (§3). `render.yaml` is the one place the wiring is declared without secrets | 2026-09-27 |
| 5 | **Scope: workspaces, and an optional read-only Git token.** A setting lists the workspaces to document (default: the one Rulemark runs in); every Blueprint in them counts, Rulemark's own and the customer's apps'. A Blueprint's `render.yaml` is fetched from its repo when the repo is public or an optional read-only Git token can read it (e.g. a GitHub fine-grained token with contents read access to the repos holding Blueprints); otherwise the document says "relationships unknown" for that Blueprint rather than showing none. **Rulemark Governance documents itself**: it holds the customer's record of processing, staff and DPO names included, so it is one of their systems | The Render API gives a Blueprint's repo, branch and path, not its contents. Inventory, visibility and made-by-hand drift need only the Render key, so the Git token buys the arrows and declared drift, nothing else, and stays narrow | 2026-09-27 |
| 6 | **Secrets: an endpoint allowlist, and no values ever.** One small Render client can call only an explicit list of read endpoints: services, Postgres, Key Value, disks, projects, environments and Blueprints. It never calls the environment variable, environment group detail, secret file, connection info or query endpoints, and a test fails if any other path is requested. Environment variable names come only from `render.yaml`, so a hand-made service's variables are not listed, and the document says so | "Names, never values" can't rest on discarding what the API returns: the key reads every secret, and query text can hold personal data (§3). A process that never asks can't leak, log or store what it never had | 2026-09-27 |
| 7 | **The Snapshot creates systems; people link them.** A resource no RoPA system points at becomes a new system, created by the Snapshot (`system:write`): its kind, region, `render_resource_id`, hosting party Render, and a name and slug from the resource. For linked systems it keeps kind and region in sync; names stay as people wrote them. It never links by guessing: a stand-in link (`render_resource_id` on `hireloop-api`) is set by a person, and for the demo by a seed step from a small mapping. A new system no activity uses is coverage's `unmapped_system`, and so a review item: Chapter 5's `cv-parser` path. A system whose resource is gone is shown as not deployed, never deleted | Puts "the Snapshot owns systems, RoPA keeps a reference" (DM §1) to work without letting a machine decide what a resource means legally. A guessed link would attach the wrong activities, and so the wrong legal context, to a system | 2026-09-27 |
| 8 | **Published as a web page, Markdown and an API**, by the Snapshot's web service: an HTML page with the Mermaid diagram (trust boundaries as groups; each system annotated with its RoPA activities, linking to the report's `#p3` anchors), a service catalog, drift and change history; the same document as Markdown, like the report's `format=markdown`, for wikis and audits; and the JSON API the exec summary lists. The data context is read from RoPA's API when the page is rendered | The page is the demo's most visible artifact and a reviewer's way in; Markdown travels into audits and wikis; the API lets other tools query the inventory. Reading RoPA live means the legal context is never older than the record | 2026-09-27 |
| 9 | **Read with a token by default; anonymous reading is the demo's opt-in.** The Snapshot accepts RoPA's own tokens (the JWT secret passed by the Blueprint) and a new `view:architecture` permission, which viewers get. Anonymous reading is off by default and a setting turns it on, as the public demo does | The document maps an install's attack surface: public URLs, what is private, IP allow lists. RoPA's reads are public by default; this one must not be, or every self-hosted install publishes its infrastructure map unless someone thinks to lock it down | 2026-09-27 |
| 10 | **History stored on change; changes and drift announced as events.** Every capture is recorded, but its content is stored only when it differs from the last (by hash), and kept indefinitely. Each new snapshot is diffed against the previous one: resources added or removed, configuration changed (plan, region, instances, visibility, IP allow list), edges changed. Drift is a resource no Blueprint manages, or a live value that differs from its `render.yaml`. Changes and drift go to the audit log as events, through the same outbox pattern and envelope RoPA uses (`ropa-api.md` §6) | An inventory with timestamps and a change history is the audit evidence the exec summary promises, and drift reaching the audit trail is its governance signal. Storing only changes keeps a nightly capture from growing the table by a copy a night | 2026-09-27 |
| 11 | **The coverage job stays the only opener of review items.** The Snapshot opens none itself: it creates systems (decision 7) and captures shortly before the coverage job (for example 01:30 UTC, the job at 02:00), so a new resource becomes a system, an `unmapped_system` finding and a review item the same night. Drift stays in the Snapshot's document and events | One opener means the duplicate-key race on the roadmap can't happen. Drift is an infrastructure signal, not a question about the record, so it doesn't widen RoPA's review vocabulary. **This supersedes** the RoPA documents' expectation that the Snapshot opens `unmapped_system` items with `source: snapshot` (`ropa-api.md` §5.5 and §8, DM §3.11); the `snapshot` source stays available | 2026-09-27 |

## 2. What it documents

The real workspace today (`render.yaml`), all in Frankfurt, in one project
(`rulemark-governance`, environment `Production`):

| Resource | Render type | Visibility | Relationships (from the Blueprint) |
|---|---|---|---|
| `ropa-api` | web service | public | `ropa-db` (`fromDatabase`); `audit-log` (`fromService`, events) |
| `audit-log` | private service | private network only | receives events from `ropa-api` |
| `coverage-job` | cron job, 02:00 UTC | none | `ropa-api` over the private network; its mint secret (`fromService`) |
| `ropa-db` | Postgres 18 | no external connections (`ipAllowList: []`) | used by `ropa-api` |

The Snapshot adds its own cron job and web service to this list, and should
document itself too.

RoPA's side, already built for it: `system` records with a
`render_resource_id` (`srv-…`, `dpg-…`) and a `kind` per Render type (DM
§3.9); the `service:snapshot` role (`record:read`, `system:write`,
`view:coverage`, `review:read`, `review:create`); `/coverage`'s
`unmapped_system` finding and review items with `source: snapshot` sharing a
finding `key` with the cron job's (API §5.5); and the Markdown report's
stable per-activity anchors (`…#p3`) for the document to link to.

## 3. What the Render API offers (checked 2026-09-27)

- **One credential:** a personal API key reaching every workspace its user
  belongs to, with every action the user can take. No OAuth, no scoped or
  read-only keys.
- **Inventory:** services (web, private, worker, cron, static), Postgres and
  Key Value instances, disks, custom domains, projects and environments,
  environment groups; per-service events and deploys.
- **Blueprints:** `Retrieve Blueprint` lists the resources a Blueprint
  manages (id, name, type), with its repo, branch, `render.yaml` path, status
  and last sync. A resource in no Blueprint was created by hand: drift
  without parsing anything.
- **What each resource carries.** A service: type, runtime, region, plan,
  instances and autoscaling, repo, branch, root directory, build filter,
  build, start and pre-deploy commands, health check path, open ports, public
  URL, IP allow list, disk, previews, suspension, and a cron job's schedule
  and last successful run. A Postgres instance: version, plan, region, disk,
  high availability, read replicas, IP allow list. An environment: its
  project, the services and datastores in it, network isolation and IP allow
  list. An environment group: the services linked to it (but retrieving one
  returns its values too).
- **Relationships are not first-class.** No field says which services use a
  database, and a service carries no references. A `fromService` or
  `fromDatabase` reference is only visible in `render.yaml`; to the API it is
  an environment variable's value. Environment-group links are the only
  relationship the API exposes.
- **Only in `render.yaml`:** the edges; the declared configuration, so a
  dashboard change can be told from a sanctioned one (without it, a change is
  still seen by diffing captures); and environment variable names without
  their values, with how each is set (`generateValue`, `sync: false`,
  `fromService`).
- **Secrets come back unasked.** Listing a service's environment variables
  always returns values, with no keys-only option. The same key can also read
  secret files, database connection strings, and live and top queries
  (`pg_stat_activity`, `pg_stat_statements`), whose text can hold personal
  data. "Names, never values" is therefore the collector's to enforce, with an
  allowlist of endpoints, not something the API guarantees.
- **Webhooks** (Pro workspaces and up): about 50 event types (deploys,
  scaling, datastores) pushed to a URL, Standard Webhooks format. They report
  changes, not an inventory, so they can trigger a capture, not replace one.

## 4. Open questions

All six are settled (decisions 4–11). What remains is detail, worked out
when planning the build: the document's sections, the Snapshot's tables and
event types, the endpoint allowlist itself, the demo's stand-in mapping, the
Blueprint's two new resources and their cost, and whether RoPA's delivery code
moves into a package both apps share.
