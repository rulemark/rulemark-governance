# Plan archive 4 — build step 3 (2026-09-26)

Planning files from the third build step: the governance views. The record
existed after step 2; this step made it answer the questions it exists for, as
the services around it would ask them, and deployed the answers.

Five phases: review items (with their own `review_item.changed` event), the
impact view (the Monitor's question, Ch6), the data map (the DSAR tracker's,
Ch7), coverage (the Snapshot's, Ch5), and the deploy. All six open questions
were settled before any code was written; each is recorded, with its reasoning,
in `findings.md`.

`findings.md` is the part worth re-reading. It records:

- **Why review items have events and no revisions**, and why the event carries
  the whole item: with no revision behind it, the event is the history.
- **Why adequacy is a transfer mechanism, not an exemption**, so the code needs
  the EEA's members and no list of adequacy decisions.
- **Why a coverage finding needs a `key`**: `(reason, target)` is not an
  identity, because one activity can hold several findings of a type.
- **Why `vendorTerms` is a list** and `noticeConflict` can be `null`.
- **Why the data map's vendor categories are an upper bound**, told through
  Lena's request in Chapter 7.
- **Where the tests nearly lied**: a seeded record too small to reach the
  large-group rule, grouping by party hiding per-engagement scoping, and a
  fixture missing a transfer the seed has.

The decisions themselves live in `docs/ropa/*` (see `ropa-api.md` §8,
"Decided during build step 3"), the code and the migrations; these files record
how they were reached, and what had to be corrected on the way.
