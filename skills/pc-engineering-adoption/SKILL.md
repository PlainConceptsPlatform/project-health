---
name: pc-engineering-adoption
description: Adopt the Platform engineering standard in a repository, with or without the Project Health dashboard. Use when a team wants the engineering gates, coverage, mutation, complexity, security, SBOM or hygiene facets, the engineering scorecard, or an engineering-only dashboard, on GitHub, Azure DevOps, GitLab or another host.
license: MIT
---

# Engineering adoption

The deliverable is the standard running in the repository: gates that fail a pull request, and the
six facets the CI publishes from the default branch. A dashboard is optional and comes after.

Read [`references/producers.md`](references/producers.md) before you add anything. Two different
things produce engineering signals, they come from two different places, and mixing them is the
failure this skill exists to prevent.

## 1. Interview

One `question` call, one message, three parts. Each has a recommendation, so the person answers in a
single reply.

1. **Host**: GitHub, Azure DevOps, GitLab, or another. Which system holds the code and runs the CI.
2. **Scope**: everything, or engineering only. Everything means delivery and agent metrics too.
3. **Standard**: the Platform standard (Foundations `ai/ENGINEERING.md`), or a generic quality bar the
   team chooses.

**Done when** all three are answered, or the person said "you decide" and you stated the
recommendation you took.

## 2. Pick the shape

| Host | Scope | What to do |
| --- | --- | --- |
| GitHub | everything | Stop. This is not an adoption: it is one entry in an existing Project Health instance. Follow the add-project skill in that repository, or ask whoever runs it |
| GitHub | engineering only | Continue to step 3 on the family template, then step 6 |
| Any other | either | Continue to step 3 with host wiring, then step 6 only if they want a dashboard |

Anything except the first row means this repository needs its own CI wiring, because no family
template exists for that host.

**Done when** you have named the row and read the reference it points at.

## 3. Put the producer in the repository

The producer reads report files that the build already writes (Cobertura XML, `coverage-final.json`,
`eslint.json`, `jscpd-report.json`, `semgrep.json`, `trivy.json`, a CycloneDX BOM). It never calls a
host API, so the same script works everywhere; only the wiring differs.

Vendoring rule, in this order:

1. If the repository is a Copier consumer (`.copier-answers.yml` exists), the producer belongs to a
   platform-owned path in `.platform/manifest`, and it arrives with `copier update`. Do not copy it
   into the tree by hand.
2. Otherwise vendor `scripts/engineering-excellence.mjs`, `scripts/lib/`, the schema copy and the
   gates it needs, with a header pointing back to the source. Record the commit it came from.

Write down which rule you used, in the pull request or in the repository's decisions folder.

**Done when** the script runs locally against a real report and writes a `<facet>.json` that
validates against the vendored copy of the facet schema.

## 4. Wire the host

- **GitHub**: the family template already runs the gates. Facets go in a separate workflow file that
  reads the reports its CI uploaded, or in `app-ci.yml` after taking ownership of that file. See
  `references/producers.md` for what taking ownership costs.
- **Azure DevOps**: [`references/azure-pipelines.md`](references/azure-pipelines.md).
- **GitLab**: [`references/gitlab-ci.md`](references/gitlab-ci.md).

Only the facets the repository can actually produce. Two or three is a good first release; six is
rare, and a facet invented from a tool that does not run is worse than a missing one.

**Done when** one run on the **default branch** published the chosen facets, and a pull-request run
published none.

## 5. Verify

- Upload happens on the default branch and on a failed gate, never only on success. A drop is the
  sample most worth keeping.
- Every facet names this repository in `repo` and this branch in `ref`; a mismatch is ignored by the
  consumer and must be ignored, not papered over.
- The gates fail a pull request that breaks them, and the facets still upload. Facets never gate;
  the repository's own CI decides what fails.
- `schemaVersion` is the one the consumer knows. An unknown version is ignored by design, so bumping
  it without the consumer is a silent data loss.
- One deliberate failure is recorded: break a gate on a branch, confirm the facet still exists, and
  confirm the dashboard or the reader shows the drop rather than a zero.

**Done when** every line above is checked against a real run, not against the workflow file.

## 6. The dashboard, if they asked for one

Read [`references/publishing.md`](references/publishing.md). It covers the four ways to publish. A
non-GitHub host can now write the month files with `pnpm facet-store add`, so option 3 is a commit
rather than a piece of work; what it cannot do is collect deployments, agents or pull requests.

**Done when** the person knows which publishing path they have, and what remains to build for the
other one.

## What "done" does not mean

A green pipeline is not adoption. Every facet degrades to an absent block with a reason when its
input is missing, so a run that published nothing can still be green. Adoption is the run that
produced a number somebody checked against the tool that measured it.
