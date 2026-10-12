# Project Health

DORA and AI agent metrics for a set of GitHub repositories, collected from the GitHub API, stored as
JSON, and published as a private static site.

No database, no monitoring system, no service to run. A scheduled workflow reads the API, commits the
result, and rebuilds a static site. Where GitHub cannot answer a question, the site says so instead of
estimating.

**[Live demo](https://plainconceptsplatform.github.io/Project-Health/)** running on the example data
that ships with this repository.

**Adding a project takes one command and one paste.** Jump to
[Adding a project](#adding-a-project).

## What it measures

Modern DORA defines five metrics across two groups. Three can be derived from GitHub alone. Two
cannot, and this is explicit about that rather than approximating them.

| Metric | Group | Status |
| --- | --- | --- |
| Deployment frequency | Throughput | Collected |
| Change lead time | Throughput | Collected |
| Deployment rework rate | Instability | Collected, once releases carry a marker |
| Change fail rate | Instability | Not collected |
| Failed deployment recovery time | Throughput | Not collected |

The two missing ones both need to know that a release *caused a problem in production*. DORA defines a
failed deployment as one that "requires immediate intervention following a deployment", which is a
fact about the running service, not about the repository. A red pipeline is a different thing and a
misleading substitute: in the estate this was built against, not one production deployment was ever
recorded as failed, so a pipeline based change fail rate would have read zero forever.

Rework rate survives because it is a property of one release in isolation. It asks whether a release
was planned or shipped in reaction to something, which a person can state when they ship it.

It also collects what the DORA report does not: **agent cost in tokens and time**, per kind of work,
and, for repositories that opt in, **engineering excellence facets** their own CI reports: coverage,
mutation score, complexity, scanner findings and the SBOM. See
[Engineering excellence facets](#engineering-excellence-facets).

## Team profiles

The 2025 DORA report replaced Elite/High/Medium/Low with seven team profiles from cluster analysis,
built on three axes: throughput, stability, and team well being.

Well being is measured by asking people, so it cannot come from a repository. This places a project on
two axes and reports the *set* of profiles consistent with that, rather than inventing a single label.
Do not try to infer well being from commit timestamps or weekend activity: it is weak evidence, and
measuring people that way costs more trust than the metric is worth.

The band edges in `config/dora.json` are directional reference lines, not official thresholds. DORA
re-derives its clusters from each year's survey, so there are no fixed cutoffs to copy.

## Adding a project

This is the whole job. Everything else has a sensible default.

### 1. Ask the repository what its configuration should be

Do not hand write the entry. Repositories disagree about which environment is production, whether
releases are tags or branches, and which labels mean what, and a wrong guess produces a metric that is
quietly meaningless. One command reads all of that and tells you:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --filter @project-health/collector run start \
  --discover your-org/some-repo
```

Or from the Actions tab, with no local setup at all:

```bash
gh workflow run discover.yml -f repo=your-org/some-repo
```

It writes nothing. It prints what it found and an entry ready to paste:

```
your-org/some-repo (private)

  environments      pro, pre
  production        pro  (23 releases)
  staging           pre
  ref pattern       ^v[0-9]+[.][0-9]+[.][0-9]+$
                    18 of 23 distinct refs look like semver tags
  work item label   implement
  rework label      hotfix (incident)
  agents            .github/workflows/work-router.yml
  status            production

Paste into projects.json:

{ "id": "some-repo", "name": "some-repo", ... }
```

### 2. Paste it into `projects.json`

```bash
cp projects.example.json projects.json   # first time only
```

Then add the entry to the `projects` array. That is the only file you edit to add a project, and it is
also the whole allowlist: nothing is measured unless it is listed here.

Change `organization` away from `your-org` at the same time. While it says `your-org`, collection
treats the config as the untouched example and deliberately does nothing.

### 3. Collect

```bash
GITHUB_TOKEN=$(gh auth token) pnpm install && pnpm collect
pnpm web:dev
```

Or let the workflows do it: **Backfill metrics** for history, then **Collect metrics** daily from then
on. Both need a token that can read the repositories you listed, as `METRICS_TOKEN` or an org GitHub
App via `BOT_APP_ID` and `BOT_PRIVATE_KEY`.

The App needs five repository permissions, all read: **Metadata**, **Deployments**, **Contents**,
**Issues**, **Actions**. Deployments is the one people miss, and it carries deployment frequency, lead
time and rework rate. A token missing a permission answers 404 rather than 403, so the collector runs a
preflight and names what is missing instead of silently writing empty metrics.

The same five permissions cover engineering excellence facets: they are read from the repository's
artifact list, which is Actions read. Preflight checks that endpoint for every project that opts in.

### That is it

A project appears on the dashboard as soon as it is in `projects.json`, before anything is collected,
showing an empty state rather than nothing. Remove a project by deleting its entry, and delete
`data/<id>/` if you want its history gone too.

A project with `"status": "planned"` is not deployed, so it stays **Planned** in Delivery and its
delivery, agent, contributor and facet blocks read "Planned project: not deployed yet." Once its
repository exists and is readable, its Engineering scorecard and AI usage are collected like any other
project's, and it appears in the scorecard table. Until then it is skipped without failing the run.

## Engineering excellence facets

DORA says how fast and how safely work ships. It says nothing about the code that shipped. That part
can only come from the repository itself, so this is the one place where a repository supplies its
own numbers: its CI uploads small JSON files as workflow artifacts, and the collector finds, checks
and keeps them.

### The convention

One artifact per facet, named `<prefix><facet>` with the default prefix `engineering-excellence-`.
The zip holds a single `<facet>.json`:

| Facet | Artifact | Typical cadence | Carries |
| --- | --- | --- | --- |
| `coverage` | `engineering-excellence-coverage` | every push to main | line and branch rate per scope and module, against each scope's floor |
| `complexity` | `engineering-excellence-complexity` | every push to main | cyclomatic complexity percentiles, CC above 10 and CRAP above 30 counts, the worst CRAP methods, and optionally the repository's complexity `gate` (baselined backlog, new violations, justified exemptions) |
| `mutation` | `engineering-excellence-mutation` | weekly | covered and full mutation score per scope and module, against floors |
| `security` | `engineering-excellence-security` | every push to main | Trivy vulnerabilities, misconfigurations and secrets by severity, Semgrep counts, scanner job results |
| `sbom` | `engineering-excellence-sbom` | every push to main | component count by ecosystem, licence mix, components without a licence |

Every file is an envelope:

```json
{
  "schemaVersion": 1,
  "facet": "coverage",
  "repo": "your-org/some-repo",
  "ref": "refs/heads/main",
  "commitSha": "<sha>",
  "runId": 123,
  "runAttempt": 1,
  "generatedAt": "2026-10-11T23:03:56.547Z",
  "data": {}
}
```

The contract is [`schema/engineering-excellence-facets.schema.json`](schema/engineering-excellence-facets.schema.json),
and this copy is canonical: producers vendor it. Rates and scores are fractions from 0 to 1. A breaking
change bumps `schemaVersion`, and the collector ignores a version it does not know rather than
misreading it.

Rules for the producing repository:

- **Upload only from the main branch.** A pull request run measures code that may never merge.
- **Upload even when a gate fails.** A drop is the sample most worth keeping. Facets never gate
  anything here; the repository's own CI decides what fails.
- **Any workflow can upload.** Artifacts are found by name and branch, not by workflow, because CI on
  main often runs as a reusable workflow inside a deployment workflow.
- **Produce only the facets you have.** A missing facet renders as not available, with a reason.

### How the collector reads them

For each facet it lists the repository's artifacts by name, keeps those that have not expired, came
from the configured branch of the repository itself (not a fork), and were created inside the month
being collected, then downloads the newest one per commit. Each file is validated against the schema,
and its `repo` and `ref` must match the project; one that does not is ignored and noted as
`engineering excellence schema mismatch`.

The month file keeps one sample per commit, oldest first, deduplicated to the latest run attempt, plus
the full detail of the newest sample. Only scope totals are kept on the older samples, because a month
of per-commit samples carrying every module would make each file several megabytes for a trend line
that never reads them. Samples already stored are merged with new ones and never refetched, so, as
with agent usage, the stored JSON is the durable record once artifacts expire after about 90 days.

### Opting in

Add one line to the project's entry in `projects.json`:

```json
"engineeringExcellence": { "enabled": true }
```

`branch` (default `main`) and `artifactPrefix` (default `engineering-excellence-`) are optional. The
project page then shows an Engineering excellence section: headline numbers with the change against
the previous month, coverage and mutation trends per scope against their floors, a per-module table
joining coverage, mutation and complexity, the worst CRAP methods, security counts by severity and
the SBOM's ecosystems and licences. When the complexity facet carries a `gate`, a Complexity debt tile
shows its baselined backlog (lower is better) with a trend line; without one the tile is hidden. With OTLP configured, the month's latest coverage, mutation
score, CRAP count, critical and high vulnerabilities and SBOM size are exported as `engineering.*`
gauges.

## Engineering scorecard

A portfolio view of which engineering practices guard each project, read every collection from the
default branch. The ten practices, their standard mode (Blocking, Threshold or Policy), the tool
patterns that detect them and which project types they apply to live in `config/scorecard.json`.
`config/` is the file a platform mirror overrides, so practices (complexity included) can be
disabled or extended there without touching code.

Each practice is decided by one of two sources, and the page says which:

- **Facet**: when the repository publishes the engineering excellence facets above, their verdicts
  decide coverage, mutation, complexity, the Trivy and Semgrep gates and the SBOM.
- **Detected**: otherwise the collector reads `.github/workflows/*.yml` at the default branch and
  finds the tools in `uses:` and `run:` lines. A step is report-only when it carries
  `continue-on-error: true`, `exit-code: "0"` or `|| true` (Trivy also needs an explicit non-zero
  exit code, because it exits 0 by default). Pass or fail is the conclusion of that job in the
  latest completed run of the workflow, read through the caller when the workflow is reusable.

Workflows are read as they are today, so a backfilled month pairs today's gates with that month's
run results and commits. A result older than 14 days counts as stale.

| Colour | Means |
| --- | --- |
| Green | present in its standard mode and passing, or its threshold met |
| Yellow | present but weaker than standard (report-only), threshold not met, or unknown or stale |
| Red | applicable but absent, or a Blocking gate failing on the default branch |
| Grey | not applicable to this project |

The **level** is cumulative and counts only green gates: N1 needs secrets, vulnerabilities and SAST
green with tests present; N2 adds tests and coverage, spec and SBOM; N3 adds mutation, DAST and
complexity where they apply. The **score** is (green + half of yellow) over applicable, 0 to 100.
**AI usage** (1 to 5) is the share of the month's non-merge default branch commits with an assistant
Co-authored-by trailer or an agent bot author; dependency and Actions bots are excluded.

Two alerts read both axes: *High AI usage, low engineering* (AI 4 or more at N1 or below) and
*Engineering declining* (the score 10 or more points under the best of the two previous months).

A project sets its `type` (`back-front`, `mobile`, `data`, `ml`, `library`, `other`) in
`projects.json`; without one every practice applies. `scorecard.performance: true` opts in to load
testing and `scorecard.notApplicable` drops further practices for that project.

## Setting it up the first time

Use this repository as a template, then:

1. **Settings → Pages → Source: GitHub Actions.** On GitHub Enterprise Cloud also set visibility to
   private, so the dashboard is visible only to people with read access.
2. **Add the token** from step 3 above as a repository or organisation secret.
3. **Add your first project** as above, and delete the `data/checkout`, `data/billing` and
   `data/mobile` folders once you no longer want the example numbers.

Keeping the metrics private while the code stays public is one variable, not a rewrite. See
[Splitting the data out](#splitting-the-data-out).

## Why almost everything is configuration

Repositories in the same organisation disagree with each other, and every assumption baked in as a
constant produced a wrong number at some point during development:

- One project calls its environment `production`, another `pro`. So the name is configuration.
- One deploys **branches** and never tags. Assuming tags flagged every one of its releases as
  bypassing the release process. So the expected ref is a per-project pattern.
- One emits about four deployment records per release. Counting records overstated its frequency
  fourfold. So a release is a distinct commit, not an API object.
- One labels the *issue* that reported a bug; another labels the *pull request* that fixed it. Reading
  only pull requests reported zero rework forever. So both are read.

`--discover` exists because working all of that out by hand for each repository is the actual cost of
adding a project.

## Nothing breaks when a metric is missing

Every metric in the stored JSON is either present with data or absent with a reason:

```json
{ "available": false, "reason": "Billing has no production environment configured." }
```

Each metric runs inside a wrapper that turns a failure into an unavailable block plus a warning, one
project failing never stops the next, and the site renders the reason where the number would go. A
metric added after a file was written also renders an empty state rather than breaking the page.

## Honesty features

These are the parts worth keeping if you fork this.

**Token totals are a floor, and say so.** A run only reports usage if it reached the model and uploaded
its record. The site prints "measured N of M" rather than presenting a partial sum as complete.

**A broad rework label does not drive the stability axis.** A label like `bug` covers planned backlog
fixes, so it answers "what share of releases carried a bug fix", not "unplanned response to an
incident". Set `reworkLabelPrecision` to `incident` only when the marker means the narrow thing.
Otherwise the number is shown, the label that produced it is named, and the axis stays unknown. A
healthy, well ticketed project should not be classified as unstable because it files bugs.

**A missing value never sorts as zero.** Otherwise projects without production data top the "fastest
lead time" ranking.

**Small samples refuse to be placed.** Below five releases in a period, no profile is assigned.

**Partial periods divide by elapsed days.** Dividing a month in progress by its full length understated
frequency by a third.

## Chart colours

Charts use only the first two slots of the chart ramp, because validating the full five-slot ramp
fails: two of the slots separate by 3.5 in OKLab under protanopia, a red against green collision, and
one sits below the chroma floor so it reads grey. Multi series charts also carry a legend and direct
labels, so identity never depends on colour alone.

If you swap in your own palette, validate it rather than eyeballing it.

## Architecture

```
collector/        TypeScript. Reads the API, writes data/
web/              Next.js static export, Tailwind v4, shadcn/ui
schema/           JSON Schema for projects.json and the engineering excellence facets
config/dora.json  band edges and the seven profiles
config/scorecard.json  scorecard practices, detection patterns, project types and alerts
```

Data layout is one folder per project, one file per month. Monthly files are permanent, which matters because GitHub expires workflow artifacts after
about 90 days: agent token usage cannot be recovered after the fact, so the stored JSON becomes the
durable record.

### Splitting the data out

`PROJECT_HEALTH_CONFIG_DIR` and `PROJECT_HEALTH_DATA_DIR` decide where `projects.json`, `config/` and
`data/` are read from and written to. Both default to this repository.

Setting them lets an organisation keep this code public while its project list and collected metrics
live in a private repository. Delivery metrics name real people and describe private projects; the code
does not, and gains nothing from being hidden.

## Publishing

The site is a static export deployed to GitHub Pages. On GitHub Enterprise Cloud, Pages can be
published **privately**, visible only to people with read access to the repository, which makes
repository access the access list.

It is deliberately not fetched live in the browser. Reading private repositories from client
JavaScript would require shipping a token to anyone who opens the page. Instead a scheduled job reads
the API, every stored month is stamped with when it was collected, and the site says so.

## Tests

```bash
pnpm --filter @project-health/collector run test
```

The suite covers the places that were actually wrong during development rather than aiming at a
coverage number, and each test names the mistake it prevents. Both collection workflows run typecheck
plus tests before writing anything, because a green collection run does not mean the numbers are
right: metrics degrade to "unavailable" by design, so a regression can finish successfully having
produced nothing useful. That is exactly how two real bugs survived.

## Licence

MIT. See [LICENSE](LICENSE).
