# AGENTS.md

The operating guide for an AI agent working in this repository. The README explains what the
dashboard measures; this file explains how to change it without producing a number that is wrong.

## What this repository is

Project Health reads the GitHub API, stores one JSON file per project per month in `data/`, and
publishes a static site from `web/`. `projects.json` is the allowlist: nothing is measured unless it
is listed there.

Two rules matter more than anything below.

- **Collection is GitHub-specific; rendering is not.** `collector/` speaks the GitHub API. `web/` and
  `data/` are host-agnostic, which is what makes an engineering-only adoption possible elsewhere.
  Check `collector/src/github.ts` before assuming a metric is portable.
- **Green is not measured.** Every metric degrades to `{ "available": false, "reason": "..." }` when
  it fails, so a collection run that wrote nothing still exits 0. A green run is evidence that the
  code did not throw, never that a number is right. Verify the stored JSON, not the exit code.

## Skills

Skills live in `.agents/skills/` and are called with the `skill` tool, one per name.

- `@pc-add-project`: add a repository to `projects.json`, or bootstrap a fresh copy of the template.
  Load it before editing `projects.json`.

`skills/` at the root holds the skills other repositories install, so they are not loaded here:

- `pc-engineering-adoption`: the standard in a repository, with or without this dashboard. Install
  elsewhere with `npx skills add PlainConceptsPlatform/project-health`.

## Commands

```bash
pnpm install
pnpm verify:config                                  # validate projects.json against the schema
pnpm test:config                                    # test the validator itself
pnpm collect                                        # GITHUB_TOKEN required
pnpm web:dev
pnpm --filter @project-health/collector run test
pnpm --filter @project-health/web run test
```

`--discover <owner/repo>` reads a repository and prints the entry it should have. It writes nothing.

## Where the standard lives

The engineering standard is not defined here. [Foundations](https://github.com/PlainConceptsPlatform/Foundations)
`ai/ENGINEERING.md` owns the practices, the levels and the checklist; this repository renders it as
the scorecard and consumes the facets its CI publishes. When the two disagree about a practice, read
Foundations. When they disagree about a facet's shape, read `schema/`.

The reference implementation of the facet producer is Atlas (`scripts/engineering-excellence.mjs`),
which each repository vendors with a header pointing back. The CI that runs the gates is not part of
that code: it is the family template, installed and updated by `@plainconceptsplatform/workflows`.

## Tests

A change to a metric needs a test that names the mistake it prevents, not one that raises a coverage
number. Both collection workflows run typecheck and tests before writing anything, because the
failure mode here is a successful run that produced nothing useful.
