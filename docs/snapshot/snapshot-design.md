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
- **Relationships are not first-class.** A `fromService` or `fromDatabase`
  reference is only visible in `render.yaml`; to the API it is an
  environment variable's value.
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

1. **Sources.** Which of the Render API, the Blueprint API, `render.yaml`
   and webhooks the capture reads, and where relationships come from.
2. **Secrets.** How "names, never values" is enforced: the endpoint
   allowlist, and whether values are ever read, even in memory.
3. **Linking to RoPA systems.** Who sets `render_resource_id` for the
   stand-ins, and what happens to a resource nothing maps to.
4. **The document.** What it contains (diagram, catalog, trust boundaries,
   each system's data context from RoPA) and where it is published.
5. **History and drift.** Snapshots, diffs, and drift events to the audit
   log.
6. **Review items.** Whether the Snapshot opens `unmapped_system` items, and
   how it shares keys with the cron job.
