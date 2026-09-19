# RoPA Data Model (v0.3, for review)

> Entities, relationships and rules for the RoPA service's Postgres store. It builds on `ropa-design.md` (strawman) and is checked against `ropa-story.md` (Hireloop). It replaces §6 of the strawman, and it is the input for the API shapes.

## 1. Design decisions this model assumes

These settle strawman decisions 1–5, based on what the story showed. **Confirmed 2026-09-19.**

| # | Decision | Answer | Story evidence |
|---|---|---|---|
| 1 | Role modeling | One `processing_activity` table with a `role` field; required fields vary by role (§5) | Ch2, Ch3 |
| 2 | Processor granularity | Processor activities belong to an **offering**. Clients are covered through their **agreement** for that offering. Optional modules use **opt-ins**, and exceptions use **exclusions** | Ch3, Ch4 |
| 3 | Party model | One `party` table (`self` / `client` / `vendor` / `other`) plus a role-bearing `engagement` link from activity to party | Ch2 (Ledgerpay as recipient), Ch4 |
| 4 | Ownership | RoPA owns parties, agreements, activities and review items. The Monitor owns vendor-list snapshots and outbound client notices. The Snapshot owns systems (RoPA keeps a reference) | Ch5, Ch6 |
| 5 | Versioning | Yes: an append-only `revision` table holding a full snapshot of each aggregate (§6) | Ch8 |

**What RoPA deliberately does not store:** data about individual people. It records *categories* of people and data, not records of them. The only personal data it holds is business contacts (owners, DPO, vendor contacts). Following Render's HIPAA guidance, table and column names never contain personal data either.

## 2. Entity overview

```mermaid
erDiagram
    OFFERING ||--o{ PROCESSING_ACTIVITY : "groups (processor role)"
    PROCESSING_ACTIVITY ||--o{ ENGAGEMENT : "involves"
    PARTY ||--o{ ENGAGEMENT : "engaged as"
    ENGAGEMENT ||--o{ TRANSFER : "transfers via"
    ENGAGEMENT ||--o{ ENGAGEMENT_EXCLUSION : "not used for"
    PROCESSING_ACTIVITY ||--o{ RETENTION_RULE : "retains per"
    PROCESSING_ACTIVITY ||--o{ ACTIVITY_OPT_IN : "enabled by"
    AGREEMENT_TERMS ||--o{ AGREEMENT : "governs"
    PARTY ||--o{ AGREEMENT : "signs"
    OFFERING ||--o{ AGREEMENT : "client enrolled in"
    PROCESSING_ACTIVITY }o--o{ SUBJECT_CATEGORY : "concerns"
    PROCESSING_ACTIVITY }o--o{ DATA_CATEGORY : "processes"
    ENGAGEMENT }o--o{ DATA_CATEGORY : "shares"
    PROCESSING_ACTIVITY }o--o{ SYSTEM : "runs on"
    PROCESSING_ACTIVITY }o--o{ SECURITY_MEASURE : "protected by"
    SYSTEM }o--|| PARTY : "hosted by"
    REVIEW_ITEM }o--|| PROCESSING_ACTIVITY : "flags (or party / system)"
```

Groups:
- **Record core:** `processing_activity`, `engagement`, `transfer`, `retention_rule`
- **Who:** `party`, `agreement_terms`, `agreement`, `offering`
- **Client scoping:** `activity_opt_in`, `engagement_exclusion`
- **Where:** `system`
- **Shared vocabulary:** `subject_category`, `data_category`, `security_measure`
- **Workflow and history:** `review_item`, `revision`

## 3. Entities

**Conventions**
- Every table has `id uuid` (primary key) and `created_at timestamptz`. Tables whose rows can be edited also have `updated_at timestamptz`. These columns aren't repeated below.
- One row per column. **Required** means `NOT NULL` (and non-empty for arrays):
  - **yes / no**: always or never required;
  - **by role**: depends on the activity's role, see §5;
  - **if …**: required under the stated condition.
- `FK → table` is a foreign key to that table's `id`.
- Link tables (pure many-to-many) are named `a_b`, have two required FK columns and use both as a composite primary key.

### 3.0 Identifiers

Each record can have up to three identifiers, each with a different job:

| Identifier | Example | Used by | Shown to people? | Can it change? | Tables |
|---|---|---|---|---|---|
| `id` | `3f9c…` (UUID) | Databases, foreign keys, other services | Never | Never | All |
| `code` | `P3`, `RI-42` | People: diagram labels, cross-references, report headings, DPA annexes, DPIA packs | Yes, **next to** the name ("P3 · CV parsing") | **Never**, and never reused | `processing_activity`, `review_item` |
| `slug` | `mailcrest`, `health` | People and machines: URLs, seed files, config | Rarely as a label | Rarely; avoid after publishing | `party`, `agreement_terms`, `offering`, `system`, taxonomies |
| `name` | "CV parsing" | People: the main label | Yes | Freely (e.g. the C1 rename kept `C1`) | `processing_activity` and every table with a `slug` |

Rows that only exist inside another record (`engagement`, `transfer`, `retention_rule`, `agreement`, opt-ins, exclusions, revisions) have only an `id`. They're identified by the record they belong to.

**Code rules**
- **Assigned by the system, never typed by hand.** Activities get a sequence per role prefix: `C1…Cn` for controller, `P1…Pn` for processor, `J1…Jn` for joint controller (deferred). Review items get `RI-1…RI-n`.
- **Never changed or reused.** Once `P3` has appeared in a report or a contract annex, it must mean the same thing forever. A retired activity keeps its code, and the code is never assigned again.
- **A role change means a new activity.** The prefix encodes the role, and moving an entry from controller to processor changes which Art. 30 record it belongs to. So Priya retires C4 and creates P4 with `supersedes_id → C4`. The trail stays visible, and old documents that mention C4 still resolve.

**Slug rules**
- Lowercase, hyphenated, unique **within its table** (no type prefix: `health`, not `dc-health`).
- Derived from the name at creation. Changing one after it has been shared breaks URLs and seeds, so avoid it.
- The story's prefixed identifiers (`act-c2`, `off-ats`, `sc-candidates`, `dc-identity`) are illustrative. In this model they are code `C2`, slug `ats`, slug `candidates` and slug `identity`.

### 3.1 `processing_activity`: the heart of the record

| Column | Type | Required | Notes |
|---|---|---|---|
| code | text, unique, immutable | yes | `C1`, `P3`. Assigned by the system from the role prefix (§3.0) |
| name | text | yes | Main label |
| description | text | no | Free-text explanation |
| supersedes_id | FK → processing_activity | no | Set when this activity replaces a retired one (e.g. after a role change) |
| role | enum `controller` \| `processor` \| `joint_controller` | yes | Immutable once saved. Drives validation (§5). `joint_controller` is modeled but deferred (Art. 26) |
| role_rationale | text | no | Why this role. Strongly recommended for grey zones (C4) |
| status | enum `draft` \| `active` \| `retired` | yes | Default `draft`. Only `active` appears in reports |
| owner | text | yes | Business contact accountable for the activity |
| offering_id | FK → offering | by role | Processor only |
| client_coverage | enum `all_enrolled` \| `opt_in` | by role | Processor only. P1 = `all_enrolled`, P2 = `opt_in` |
| purposes | text[] | by role | Controller only (Art. 30(1)(b)) |
| lawful_bases | enum[] `6(1)(a)`…`6(1)(f)` | by role | Controller only |
| special_conditions | enum[] `9(2)(a)`…`9(2)(j)`, `art10` | if controller and any data category is special | Controller only |
| processing_categories | text[] | by role | Processor only (Art. 30(2)(b)): hosting, storage, notifications… |
| dpia_required | boolean | by role | Controller only. Default `false` |
| dpia_ref | text | no | Controller only: Hireloop's own DPIA |
| dpia_support_ref | text | no | Processor only: support pack for clients (Art. 28(3)(f)) |
| review_due_at | date | no | Next periodic review |
| started_at | date | no | When the processing began. Enables "since 2026-04-14" |
| ended_at | date | no | When the processing stopped (usually set on retirement) |

**Link tables**

| Table | Left column | Right column |
|---|---|---|
| `activity_subject_category` | activity_id → processing_activity | subject_category_id → subject_category |
| `activity_data_category` | activity_id → processing_activity | data_category_id → data_category |
| `activity_system` | activity_id → processing_activity | system_id → system |
| `activity_security_measure` | activity_id → processing_activity | security_measure_id → security_measure |

### 3.2 `engagement`: an activity involves a party in a given role

| Column | Type | Required | Notes |
|---|---|---|---|
| activity_id | FK → processing_activity | yes | |
| party_id | FK → party | yes | A party of kind `vendor` or `other` |
| role | enum `processor` \| `subprocessor` \| `recipient` \| `joint_controller` | yes | Allowed values depend on the activity role (§5) |
| service_description | text | yes | "Transactional email", "Error tracking" |
| processing_countries | text[] (ISO 3166) | yes (≥ 1) | **Where the data is processed or accessed**, which is not the vendor's HQ. Render = `DE`; Glitchlog = `US` |
| started_at | date | no | When the vendor started receiving data for this activity |
| ended_at | date | no | When it stopped |

**Link table:** `engagement_data_category` (engagement_id → engagement, data_category_id → data_category). The categories must be a **subset** of the activity's data categories.

### 3.3 `transfer`: third-country transfer safeguards (Art. 44–49)

| Column | Type | Required | Notes |
|---|---|---|---|
| engagement_id | FK → engagement | yes | |
| destination_country | text (ISO 3166) | yes | |
| mechanism | enum `adequacy` \| `dpf` \| `sccs` \| `bcr` \| `derogation_49` | yes | |
| onward_via | text | no | Onward transfer through the vendor's own subprocessor ("Helpdesk Partners Pvt Ltd", Ch6) |
| document_ref | text | no | SCCs / DPA reference |

One engagement can have several transfers: Mailcrest → US directly, and → IN onward after Chapter 6.

### 3.4 `retention_rule` (controller only)

| Column | Type | Required | Notes |
|---|---|---|---|
| activity_id | FK → processing_activity | yes | |
| data_category_id | FK → data_category | no | Empty = the default rule for the activity |
| period | text (ISO 8601 duration) | yes | `P90D`, `P7Y` |
| trigger | text | yes | "after contract end" |
| legal_ref | text | no | "Dutch tax law". Justifies keeping data despite an erasure request (Art. 17(3)(b), Ch7) |

At most one rule per (activity, data category), and at most one default rule per activity.

### 3.5 `party`

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `hireloop`, `mailcrest`, `aurelia` |
| kind | enum `self` \| `client` \| `vendor` \| `other` | yes | Exactly one `self` (the record owner) |
| legal_name | text | yes | Doubles as the party's `name` |
| country | text (ISO 3166) | yes | Where the legal entity is established |
| contact_name | text | no | Business contact |
| contact_email | text | no | Business contact |
| dpo_name | text | if `kind = self` | Art. 30(1)(a) |
| dpo_email | text | if `kind = self` | Art. 30(1)(a) |
| trust_url | text | no | Vendors: trust/security page |
| dpa_url | text | no | Vendors: published DPA |
| subprocessor_list_url | text | no | Vendors: what the Monitor watches |

A party can be both a client and a vendor in real life. With a single `kind`, you'd record the second relationship as a separate agreement. See open question Q4.

### 3.6 `agreement_terms` and `agreement`

Split into two tables, because 400 clients sign **one** standard DPA while Aurelia signs its own.

**`agreement_terms`**: the terms document, either a reusable template or a bespoke contract.

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `standard-dpa-v3`, `aurelia-dpa`, `mailcrest-dpa-2025` |
| name | text | yes | "Standard DPA v3" |
| direction | enum `outbound` \| `inbound` | yes | Outbound: we are the processor for a client. Inbound: a vendor processes for us |
| authorization_type | enum `general` \| `specific` | yes | Art. 28(2) |
| notice_days | int | yes | 30 / 60 |
| allowed_regions | text[] | no | e.g. `['EEA']` for Aurelia. Empty = no restriction |
| document_url | text | no | |

**`agreement`**: a signed agreement with one party.

| Column | Type | Required | Notes |
|---|---|---|---|
| party_id | FK → party | yes | Northwind, Aurelia, Mailcrest… |
| terms_id | FK → agreement_terms | yes | |
| offering_id | FK → offering | if the terms are `outbound` | Which offering the client is enrolled in |
| signed_at | date | yes | Aurelia: 2026-03-16. Prospects have no row |
| ended_at | date | no | When the agreement ended |

The set of clients covered by an offering = active outbound agreements for that offering.

### 3.7 `offering`

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `ats` |
| name | text | yes | "Hireloop ATS" |
| default_terms_id | FK → agreement_terms | yes | Must be `outbound`. `ats` → `standard-dpa-v3` |

### 3.8 Client scoping

**`activity_opt_in`**: a client enabled an `opt_in` activity (Aurelia → P2).

| Column | Type | Required | Notes |
|---|---|---|---|
| activity_id | FK → processing_activity | yes | Must have `client_coverage = opt_in` |
| client_party_id | FK → party | yes | A party of kind `client` |
| started_at | date | yes | When the client enabled it |
| ended_at | date | no | When the client disabled it |

**`engagement_exclusion`**: this vendor is **not** used for this client's data (Glitchlog and Scribe for Aurelia).

| Column | Type | Required | Notes |
|---|---|---|---|
| engagement_id | FK → engagement | yes | |
| client_party_id | FK → party | yes | A party of kind `client` |
| reason | text | yes | "EU-only processing (Aurelia DPA §7)", "Client objected" |
| agreement_id | FK → agreement | no | The agreement that requires the exclusion, if any |

### 3.9 `system`

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `hireloop-db` |
| name | text | yes | "Primary database" |
| kind | enum `render_web_service` \| `render_private_service` \| `render_worker` \| `render_cron` \| `render_static_site` \| `render_postgres` \| `render_key_value` \| `external_saas` | yes | `external_saas` covers tools like Peoplehub HR |
| render_resource_id | text, unique | no | Join key to Architecture Snapshot (`srv-…`, `dpg-…`) |
| region | text | if `kind` is a `render_*` kind | `frankfurt` |
| hosting_party_id | FK → party | yes | Render, Peoplehub |

For now, systems are entered or seeded by hand. Once the Snapshot exists, it keeps them in sync through `render_resource_id`.

### 3.10 Taxonomies

Shared vocabularies. DSAR and Monitor reference them by `slug`.

**`subject_category`**: seed: candidates, client-users, employees, leads.

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `candidates` |
| name | text | yes | "Candidates" |
| description | text | no | |

**`data_category`**: seed: identity, cv, assessment, diversity⚠, health⚠, account, billing, telemetry, payroll, marketing.

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `health` |
| name | text | yes | "Health data" |
| description | text | no | |
| special | enum `none` \| `art9` \| `art10` | yes | Default `none`. `art9` = special category; `art10` = criminal convictions |

**`security_measure`**: seed: encryption-at-rest, tenant-isolation, rbac, sso-for-staff, audit-logging.

| Column | Type | Required | Notes |
|---|---|---|---|
| slug | text, unique | yes | `encryption-at-rest` |
| name | text | yes | "Encryption at rest" |
| description | text | no | |

### 3.11 `review_item`

| Column | Type | Required | Notes |
|---|---|---|---|
| code | text, unique, immutable | yes | `RI-42`. Assigned by the system (§3.0) |
| target_type | enum `activity` \| `party` \| `system` | yes | What kind of record needs attention |
| target_id | uuid | yes | Which record (polymorphic, so checked in the application rather than by an FK) |
| source | enum `monitor` \| `snapshot` \| `manual` \| `schedule` | yes | Who opened it |
| reason | enum `vendor_subprocessor_added` \| `vendor_subprocessor_removed` \| `unmapped_system` \| `transfer_missing` \| `review_overdue` | yes | |
| details | jsonb | no | e.g. the diff from the Monitor |
| deadlines | jsonb | no | e.g. `{vendorEffective: 2026-07-03, clientNotice: [{client: aurelia, type: specific, due: …}]}` for the Ch6 collision |
| due_at | date | no | Earliest deadline |
| status | enum `open` \| `resolved` \| `dismissed` | yes | Default `open` |
| resolution_note | text | if `status` is `resolved` or `dismissed` | What was decided |

### 3.12 `revision`: history for `asOf` reports

Append-only: rows are never updated, so there is no `updated_at`.

| Column | Type | Required | Notes |
|---|---|---|---|
| entity_type | enum `activity` \| `party` \| `agreement` \| `agreement_terms` \| `offering` \| `system` \| `subject_category` \| `data_category` \| `security_measure` | yes | Which aggregate type (§4) |
| entity_id | uuid | yes | The aggregate root's `id` |
| version | int | yes | Increments per entity. Unique with (entity_type, entity_id) |
| valid_from | timestamptz | yes | When this version took effect |
| snapshot | jsonb | yes | Full aggregate as saved (§6) |
| actor | text | yes | Who made the change |
| change_note | text | no | Why. Also emitted to the audit-log service |

## 4. Aggregates (what gets saved, and versioned, together)

| Aggregate | Root | Includes | API implication |
|---|---|---|---|
| **Activity** | processing_activity | category/system/measure links, retention rules, opt-ins, engagements (+ data categories, transfers, exclusions) | One document per activity. `PUT /activities/{id}` replaces the whole thing; sub-resources are optional convenience |
| Party | party | — | `/parties` |
| Agreement terms | agreement_terms | — | `/agreement-terms` |
| Agreement | agreement | — | `/agreements` |
| Offering | offering | — | `/offerings` |
| System | system | — | `/systems` |
| Taxonomy entry | each taxonomy row | — | `/taxonomy/*` |
| Review item | review_item | — | Workflow entity, not versioned; changes go to the audit log |

## 5. Rules by role

**Activity fields**

| Field | controller | processor |
|---|---|---|
| purposes, lawful_bases | required | forbidden |
| special_conditions | required if any data category is special | forbidden (the client establishes them) |
| retention_rules | ≥ 1 required | forbidden |
| offering_id, client_coverage | forbidden | required |
| processing_categories | forbidden | required |
| dpia_required / dpia_ref | allowed | forbidden |
| dpia_support_ref | forbidden | allowed |
| opt-ins | forbidden | only if `client_coverage = opt_in` |

**Engagement roles allowed**

| Activity role | Allowed engagement roles |
|---|---|
| controller | `processor`, `recipient`, `joint_controller` |
| processor | `subprocessor` |

**Cross-entity rules**
- Engagement data categories ⊆ activity data categories.
- An exclusion's client must hold an active outbound agreement for the activity's offering.
- Any `processing_countries` entry outside the EEA needs a matching `transfer` row. Missing ones are reported by `/coverage` (as `transfer_missing`) rather than blocked, so drafts can be saved.
- Exactly one party of kind `self`.
- `role` cannot be changed on a saved activity. Changing role = retire the activity and create a new one with `supersedes_id` (§3.0).
- `supersedes_id` must point to a `retired` activity.
- In Zod these become a discriminated union on `role`, which becomes `oneOf` in OpenAPI.

## 6. Versioning approach

- Normal tables always hold **current state**. Every save of an aggregate also appends a `revision` row with its **full JSON snapshot**, in the same transaction.
- `GET /report?asOf=T` rebuilds the record from the latest revision ≤ T for each aggregate. Snapshots store IDs, so party names are resolved from party revisions at T too. The report shows what the record said then.
- Why not temporal tables or event sourcing: both are heavier to build and query. Snapshots are simple, match "the record as it stood", and can be diffed for Ch8.
- Each revision is also sent to the audit-log service (#1), which records who changed what.

## 7. Derived views (the read models the API exposes)

| View | Derivation | Story |
|---|---|---|
| **Subprocessors (offering)** | Active processor activities in the offering with `all_enrolled` coverage → `subprocessor` engagements → party, service, countries, mechanism. Opt-in modules listed separately | Ch4 (pre-contract) |
| **Subprocessors (client)** | As above for the client's offering, plus opt-in activities the client enabled, minus exclusions for the client | Ch4 (post-contract) |
| **Report** | Controller view: `self` party + controller activities with all Art. 30(1) fields. Processor view: offering/client scoping + Art. 30(2) fields. `asOf` via revisions | Ch4, Ch8 |
| **Impact (party)** | The party's engagements → activities (role, data categories, special flag, countries). For processor activities: affected clients = enrolled clients − exclusions (+ opt-ins), each with its terms (authorization type, notice days). Plus the vendor's inbound terms. Flags **notice conflict** when vendor notice < client notice | Ch6 |
| **Data map** | Subject category (+ optional client) → activities → systems + engagements (data categories ∩), retention rules, and `action: act \| forward` from the activity role | Ch7 |
| **Coverage** | Render systems with no activity; non-EEA countries with no transfer; review dates passed. Activities with no Render system are **not** flagged | Ch5 |

## 8. Cross-service references

| Service | Holds | References into RoPA |
|---|---|---|
| Subprocessor monitor | vendor-list snapshots, diffs, fetch schedule, outbound client notices and responses | `party.slug` (watches `subprocessor_list_url`); reads `/parties/{id}/impact`, `/subprocessors`; writes `review_item` |
| DSAR tracker | requests, timelines | `subject_category.slug`, `party.slug` (client); reads `/data-map` |
| Architecture Snapshot | Render resources, snapshots | `system.render_resource_id`; writes `review_item` (unmapped system) |
| Audit log | events | receives revision events |

## 9. Story check

| Chapter | Tables exercised |
|---|---|
| Ch2 controller records | processing_activity (controller), engagement (processor, recipient), retention_rule, data_category.special |
| Ch3 processor records | offering, agreement_terms (standard), agreement ×N, processing_activity (processor) |
| Ch4 signing Aurelia | agreement_terms (bespoke) + agreement, engagement_exclusion, activity_opt_in (P2) |
| Ch5 AI parsing | system (cv-parser) → review_item (snapshot), new activity + engagement + transfer, dpia_support_ref, engagement_exclusion (Scribe) |
| Ch6 vendor change | review_item (monitor) with deadlines, transfer with `onward_via` |
| Ch7 DSARs | data map over taxonomies, retention_rule.legal_ref |
| Ch8 regulator | revision (`asOf`), started_at |
| Ch9 architecture doc | system.render_resource_id + activity_system |

## 10. Open questions

1. **Revisions:** full JSON snapshots per aggregate (proposed), or something finer-grained?
2. **Onward transfers:** keep sub-subprocessors (Helpdesk Partners) as `transfer.onward_via` text (proposed), or make them parties? The Monitor has the full vendor lists either way.
3. **External SaaS as systems:** should Peoplehub HR be a `system` (kind `external_saas`) as well as a vendor engagement? It makes the data map uniform, but it duplicates the vendor.
4. **Party with multiple roles:** single `kind` (proposed for the demo), or a set of roles?
5. **Joint controllers:** keep in the enum but leave out of the story and validation for now?
6. **IDs in the API:** which identifiers (§3.0) appear in URLs and response bodies: `id` only, `code`/`slug` only, or both (e.g. accept either in URLs, always return all)?
