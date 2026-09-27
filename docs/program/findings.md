# Findings & Decisions — Build Step 5

> Step 4's findings are archived in `plan-archive/5/findings.md`, step 3's in
> `plan-archive/4/findings.md`, step 2's in `plan-archive/3/findings.md`, step
> 1's in `plan-archive/2/findings.md`. They record what the tools and the
> platform actually did, and several conclusions are load-bearing.

## Reference documents
- `docs/ropa/ropa-api.md`: the engagement sub-resource §3.5, saving and concurrency §1.4 and §1.8, the report and its formats §5.1, the build order and every later-step decision §8
- `docs/ropa/ropa-data-model.md`: engagements §3.2, transfers §3.3, client scoping §3.8, identifiers §3.0
- `docs/ropa/ropa-database.md`: the save §6.1, `asOf` reads §6.3
- `docs/ropa/ropa-story.md`: Chapter 6 (Mailcrest's onward transfer) is the sub-resource's acceptance scenario; Chapters 4 and 8 for the report

## What steps 1–4 left ready
- **Engagements keep their `id` across a `PUT`** (`domain/activity/children.ts`): a row sent with its id is updated, one without is inserted, one left out is deleted, and an id from another activity is refused (`unknown_row`).
- **`inputFromSnapshot`** (`domain/activity/input.ts`) turns a stored activity into the `PUT` body that saves it unchanged. The seed's story edits already use it; the sub-resource is a read, a change to `engagements`, and the same save.
- **The save does the rest:** the version check under `If-Match`, the whole activity validated (role rules when `active`), a revision, `record.changed`, and `subprocessors.changed` through `afterRevision` (step 4) when a list changes.
- **One report builder** feeds JSON and Markdown (`api/views/report.ts`, `markdown.ts`), through a `RecordReader`, so `asOf` and the scopes already work for a third format. `format=csv` answers `422 not_yet_supported` in `api/routes/views.ts`.

## Carried-forward cautions
- Render judges a push by its **newest commit**: a push ending in a docs commit deploys nothing, silently. Push up to the last code commit first (`git push origin <sha>:main`), then the rest.
- **A Blueprint sync that creates a service runs its steps in order and can stall**; a Manual Sync completed one. `fromService` values resolve at sync time. Step 5 adds no Render resource, so this shouldn't arise.
- **Verify from here with `gh` and `/healthz`** (uptime resets on a new version); logs, env vars and the database are the user's, the database only from `ropa-api`'s Shell.
- A supertest request is thenable: a helper that builds one stays synchronous, or awaiting it sends it bare.
- Seed tests and the seeded acceptance tests reset the test database before and after, because the story brings a `self` party.
- Prettier reformats after writing, so an exact-text edit can miss; match on current text.
- Postgres reports the alphabetically first failing CHECK; fixtures must pass every other check to reach the one under test.
- A new export in `@rulemark/ropa-schemas` needs `npm run build -w packages/ropa-schemas` before the app type-checks without the `development` condition.
- A test written after the code passes on the first run by construction: break the code on purpose before trusting it.

## Build findings
<!-- Add as we go: surprises, library behaviour, decisions with rationale -->
- **The CSV's shape (open question 1, 2026-09-27).** One file, one table: a
  row per activity × engagement, the activity's columns repeated on each of
  its engagements, an activity with none on one row of its own. An
  `activityRole` column, and the union of both roles' columns, each role
  leaving the other's empty. Lists in one cell, joined with `; `; a transfer
  as `IN: SCCs via Helpdesk Partners Pvt Ltd`. **`asOf` and `generatedAt` on
  every row**, and the scope and date in the filename: the export most likely
  to be handed over as evidence keeps the date it describes after a rename.
  The closing subprocessor list is left out (derivable from the rows;
  `/subprocessors` serves it). Rejected: provenance in the filename and
  headers only (lost on a rename), and one role per file (the regulator's
  whole record as of a date would be two downloads, and `view=all` would
  behave differently in one format).

- **The CSV in a spreadsheet (open question 2, 2026-09-27).** Formula cells
  are neutralised as OWASP recommends: a cell starting with `=`, `+`, `-`,
  `@`, a tab or a carriage return gets a leading `'`. Most of the record is
  written by Hireloop's staff, but the Monitor exists to bring in vendors'
  own text, so the export built to be opened in Excel is where CSV injection
  would land. The file starts with a UTF-8 byte-order mark, so Excel reads
  "Zürich" and "Tomás" correctly. Otherwise RFC 4180: a header row, commas,
  quoting when a field holds a comma, quote or line break, quotes doubled,
  CRLF. The cost, a visible `'` outside a spreadsheet and a BOM for programs
  to strip, falls on readers who have the JSON. Rejected: leaving cells as
  they are, and writing no BOM.
- **Who may write engagements (open question 3, 2026-09-27).**
  `record:write`, as for any change to an activity; no service role gains it.
  Chapter 6 says so already: the Monitor detects and opens review items,
  and "Priya records the onward transfer". Every change to a live activity
  keeps a person behind it, which matters most here, since its changes send
  Art. 28 notices (`subprocessors.changed`). §3.5's motivation (the Monitor
  and the Snapshot) is rewritten: the sub-resource is for anyone changing
  one vendor; a service's write would be its own decision, as Phase 6 kept
  `review:resolve` from the cron job. Rejected: an `engagement:write` for
  the Monitor (a vendor's announcement would change the record and send
  notices with nobody deciding; in Ch6 the right answer was to push back),
  and proposals a person approves (a new workflow doing review items' job).
- **The engagement write conventions (open question 4, 2026-09-27).**
  - **`POST` needs `If-Match`** (the activity's version), like every other
    change to an existing record (§1.8). Nothing could be overwritten
    without it, since the save reads under a lock, but a caller acting on a
    stale view (adding Mailcrest again) would never be told.
  - **A `DELETE` takes an optional JSON body, `{ "changeNote": … }`**: one
    convention for every write (§1.6), where the record's own `DELETE` needs
    none because it removes drafts only. Removing a vendor from a live
    activity sends Art. 28 notices, and is what a note is for. Rejected:
    `?changeNote=` (permanent history written into URLs and access logs).
  - **Writes answer with the engagement:** `POST` `201` with `Location`,
    `PUT` `200`, `DELETE` `204`, each with the activity's new version as
    `ETag`. Rejected: the whole activity (an odd answer from a sub-resource,
    and `GET /activities/{ref}` gives it).
- **What else joins step 5 (open question 5, 2026-09-27).** The
  party-kind check, in Phase 3: an engagement's party must be a `vendor` or
  `other`, a scope's client a `client`, as structural validation in the
  activity save, so the whole-activity `PUT`, `POST /activities` and the
  sub-resource all get it (`422` naming the field). The sub-resource is a new,
  easier way to write exactly these rows, and engaging a client or `self`
  would put them on every other client's subprocessor list and send notices.
  The seeded story must pass it first. `@rulemark/ropa-client` stays empty
  until its first consumer (the frontend or the Monitor) can shape it; both
  HTTP callers so far used `fetch`. The other known gaps stay unscheduled.

## Issues encountered
| Issue | Resolution |
|---|---|
| | |
