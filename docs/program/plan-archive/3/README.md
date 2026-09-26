# Plan archive 3 — build step 2 (2026-09-21 to 2026-09-26)

Planning files from the second build step: the activity itself. It went from the
activity's shape to a deployed service whose record replays the Hireloop story,
Chapters 2 to 6, with its history dated as the story tells it.

Eight phases: the activity shape (a Zod discriminated union on `role`), the
activity tables, saving an aggregate with children, the endpoints and lifecycle,
`GET /subprocessors`, `GET /report` in JSON and Markdown, the Hireloop seed, and
the deployment. The three items carried over from step 1 were closed at the end.

`findings.md` is the part worth re-reading. It records:
- **Why the forbidden-by-role checks are field-level.** Zod skips an object's
  refinements while any of its fields is invalid.
- **That Postgres runs CHECK constraints in alphabetical order**, and reports
  the first one that fails.
- **How the save's `afterWrite` hook works**, and why the root's `If-Match`
  guards the whole aggregate.
- **Why the views are pure functions over aggregates**, and how one scoping
  function serves both the subprocessor list and the report.
- **How the seed stays idempotent step by step.**
- **That Render judges a push by its newest commit.** That is why code and
  documentation are pushed separately.

The decisions themselves live in `docs/ropa/*` (see `ropa-api.md` §8, "Decided
during build step 2"), `render.yaml` and the code; these files record how they
were reached, and what had to be corrected on the way.
