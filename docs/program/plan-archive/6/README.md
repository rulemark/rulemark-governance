# Plan archive 6 — build step 5 (2026-09-27)

Planning files from the fifth and last step of the RoPA API's build order
(`ropa-api.md` §8): conveniences. Two things the record already supported,
made easy to use: a **CSV export** of the Art. 30 record for whoever answers a
questionnaire or a regulator in a spreadsheet, and an **engagement
sub-resource**, so one vendor on an activity can be read or changed without
sending the whole activity, while it stays one aggregate.

Four phases: the CSV report, reading engagements, writing engagements (with
the party-kind check), and the deploy. Five open questions were settled
before any code was written; Phase 3 raised one more (where a sub-resource
reports its errors), settled before its code. After the deploy, the CSV
gained an `organisation` column. Every decision is recorded, with its
reasoning, in `findings.md`.

`findings.md` is the part worth re-reading. It records:

- **Why the CSV is one table with the date and organisation on every row**:
  the file most likely to be handed over as evidence will be renamed, and
  `view=all` shouldn't behave differently in one format.
- **Why formula cells are neutralised and the file starts with a BOM**: the
  Monitor exists to bring vendors' own text into the record, and the export
  built to be opened in Excel is where CSV injection would land.
- **Why engagement writes need `record:write` and no service gets it**:
  services open review items, people record changes, and these changes send
  Art. 28 notices.
- **Why errors are body-relative, with the rest under `/activity`**, and why
  a stale caller hears `412` before anything about its body.
- **Tests that pass on the first run can't tell right from wrong**: two had
  to be tightened (a viewer, not the monitor, for `403`; stale before
  content), and `404` tests passed on Express's "No route" until they checked
  the problem's detail.
- **What deploying taught**: this repo pushes with its own SSH key, so a bare
  `ssh -T` shows the wrong account; and `/healthz` uptime alone can mislead
  when two deploys are close together.

The decisions themselves live in `docs/ropa/*` (see `ropa-api.md` §3.5, §5.1
and §8, and `ropa-data-model.md` §3.2), the code and the tests; these files
record how they were reached, and what had to be corrected on the way.
