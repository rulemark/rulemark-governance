# Plan archive 2 — build step 1 (2026-09-19 to 2026-09-21)

Planning files from the first build step: the foundation of the RoPA service, from
an empty monorepo to a documented, authenticated API deployed on Render from a
Blueprint, with the foundation records working end to end.

Nine phases: app foundations, the shared schemas package, the database, persistence
machinery, authentication, the record endpoints, OpenAPI and Swagger UI, CI
hardening, and the deployment.

`findings.md` is the part worth re-reading. It records what the tools and the
platform actually did rather than what the design assumed — including the four
defects that only appeared once the thing was deployed, and the reasoning behind
decisions that are now load-bearing: export conditions, snapshot schemas written
by hand, the 401/403 split, one test database beside the development one, and how
many proxies to trust.

The decisions themselves live in `docs/ropa/*`, `render.yaml` and the code; these
files record how they were reached, and what had to be corrected on the way.
