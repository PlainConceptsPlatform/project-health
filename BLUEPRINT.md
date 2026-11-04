# BLUEPRINT

You are an AI agent asked to adopt Project Health for a repository. Read this file to the end
before you write anything, then follow the path the person chose.

> The person only has to say: *"Read `BLUEPRINT.md` in PlainConceptsPlatform/Project-Health and
> adopt it for this repository."*

## 1. Pick a path, and say which one out loud

Three paths. They are not a menu of effort levels, they are three different jobs.

| Path | For | You produce |
|---|---|---|
| **A. Copy it** | A GitHub repository that deploys, and wants DORA, the engineering scorecard, agent usage and the roadmap | A fork that collects and publishes the full dashboard |
| **B. Engineering only** | A repository on another host (Azure DevOps, GitLab, Jenkins), or one with no deployments, or a team that only wants the engineering gates | The six facets plus a small engineering dashboard |
| **C. Inspiration only** | A team that wants the standard as a model, and will build its own | A written decision, and its own implementation |

Ask the person which one, if they did not say. Never choose for them, and never quietly do A
because it is the one this repository already contains. Path B exists because A does not fit
every repository.

## 2. What you are looking at

Two layers. Confusing them is the mistake this file exists to prevent.

### 2.1 The dashboard, which is this repository

| Folder | What it is |
|---|---|
| `collector/` | TypeScript. Reads the GitHub API, writes one JSON file per project per month in `data/` |
| `web/` | Next.js static export. Reads `data/` at build time and renders it. No API, no database, no service |
| `schema/` | The JSON Schema for `projects.json` and the engineering excellence facets |
| `config/` | `dora.json` (bands and profiles) and `scorecard.json` (practices, detection patterns, project types, alerts) |
| `data/` | The collected history. Permanent, because GitHub expires artifacts after about 90 days |

The dashboard is host-agnostic in what it renders and GitHub-specific in how it collects. That
is exactly the split path B depends on.

### 2.2 The producers, two of them, and only one is yours to vendor

| Layer | Where it lives | How you get it |
|---|---|---|
| The CI that runs the gates: build, tests with coverage floors, per-PR mutation, Semgrep | `@plainconceptsplatform/workflows`, template `loops/templates/ci/app-ci-dotnet-next.yml`, installed as `.github/workflows/app-ci.yml` | **Install and update it with the package.** Never copy it by hand |
| The six facets: `coverage`, `complexity`, `mutation`, `security`, `sbom`, `hygiene` | Atlas: `scripts/engineering-excellence.mjs`, `scripts/lib/`, `scripts/engineering-excellence.schema.json`, and the decision record `docs/decisions/2026-10-11-engineering-excellence-facets.md` | **Vendor it**, with a header pointing back |

Foundations `ai/ENGINEERING.md` is the standard both answer to. It names Atlas as the reference
implementation of the facets, and the scorecard in this repository is that standard rendered.

Read the boundary once, because it is easy to get wrong in both directions:

- The package's `app-ci.yml` does **not** contain the facets. It runs the gates and stops there.
- The facets do **not** replace the gates. They record what the gates saw, pass or fail, and are
  uploaded even when a gate fails. Facets never gate anything.

### 2.3 The warning about `--force`

In almost every project with facets today, the facet jobs were added to the package-managed
`app-ci.yml`. That works until someone runs `workflows update --force`, which restores the
template and takes the facet jobs with it.

There are two correct answers, and you must pick one before you add a job:

1. **Take the file over.** Remove the `Managed by @plainconceptsplatform/workflows` header. The
   package then treats it as consumer-owned and leaves it alone (`cli/src/catalog-installation.ts`,
   the ownership-header rule). Say so in the pull request, because a taken-over CI stops receiving
   package updates.
2. **Do not edit it.** Put the facet jobs in a separate workflow file that reads the reports the
   package's CI uploaded as artifacts. This is the option to prefer for a new adoption.

Do not add jobs to a managed file and say nothing. That is the state that produced six copies of
the producer with four different contents.

## 3. The contract, the only thing that must match exactly

One artifact per facet, named `engineering-excellence-<facet>`, holding a single `<facet>.json`.
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

The canonical copy is `schema/engineering-excellence-facets.schema.json` in this repository.
Producers vendor it and validate against it before uploading. Rates and scores are fractions from
0 to 1. A breaking change bumps `schemaVersion`, and the collector ignores a version it does not
know rather than misreading it.

The rules for the producing repository:

- **Upload from the default branch only.** A pull request run measures code that may never merge.
- **Upload even when a gate fails.** A drop is the sample most worth keeping.
- **Any workflow may upload.** Artifacts are found by name and branch, not by workflow, because CI
  on main often runs as a reusable workflow inside a deployment workflow.
- **Produce only the facets you have.** A missing facet renders as not available, with a reason.
  That is a correct outcome, not a failure.

What the collector does with them: it lists artifacts by name, keeps those that have not expired,
came from the configured branch of the repository itself, and were created inside the month being
collected, then downloads the newest one per commit. It validates each file against the schema, and
a file whose `repo` or `ref` does not match is ignored and noted as
`engineering excellence schema mismatch`. The month file keeps one sample per commit, oldest first,
deduplicated to the latest run attempt, with only scope totals on the older samples and the full
detail on the newest.

## 4. Path A — copy it

1. Copy the repository. Keep `collector/`, `web/`, `schema/`, `config/` and the workflows.
2. Do not hand-write the project entry. Ask the repository what its configuration should be:

   ```bash
   GITHUB_TOKEN=$(gh auth token) pnpm --filter @project-health/collector run start \
     --discover your-org/some-repo
   ```

   It writes nothing, and it prints an entry ready to paste. Repositories disagree about which
   environment is production, whether releases are tags or branches, and which label means rework,
   and a wrong guess produces a metric that is quietly meaningless.
3. Paste the entry into `projects.json`. Change `organization` away from `your-org` at the same
   time: while it says `your-org`, collection treats the configuration as the untouched example and
   deliberately does nothing.
4. Delete `data/checkout`, `data/billing` and `data/mobile` when the example numbers are no longer
   wanted.
5. Collect, then build:

   ```bash
   GITHUB_TOKEN=$(gh auth token) pnpm install && pnpm collect
   pnpm web:dev
   ```

6. Opt in the facets with one line, if the repository publishes them:

   ```json
   "engineeringExcellence": { "enabled": true }
   ```

   `branch` (default `main`) and `artifactPrefix` (default `engineering-excellence-`) are optional.

Done means section 9.

## 5. Path B — engineering only

The goal is the engineering scorecard and the six facets, with nothing that assumes GitHub
deployments, agents or a roadmap.

### 5.1 If the repository is on GitHub

This works today, by configuration only:

1. `projects.json`: `"engineeringExcellence": { "enabled": true }`, `"agents": { "enabled": false }`,
   and no `roadmap` block.
2. Leave `delivery` alone. It will read not available with a reason ("<project> has no production
   environment configured, so deployment frequency is not measured."), which is true and is what the
   site is built to render. Do not invent a zero, and do not mark the project `planned` to silence
   it: that changes the meaning of every delivery figure.
3. Set `scorecard.notApplicable` for practices this repository genuinely does not run. A practice
   that is applicable but unmeasured reads yellow (unknown), and a red one reads as a missing gate.
   Both are honest, but only one of them is about this repository.
4. Make the site engineering-only by removing tabs in `web/src/views/project/index.tsx`. The
   `engineering` tab is always first and already contains the scorecard, excellence, code and
   actions panels; the `delivery`, `agentic` and `roadmap` entries are the ones to drop. The
   portfolio view declares its own tabs in `web/src/views/overview/portfolio.tsx`; drop the ones
   there that this project cannot fill.

### 5.2 If the repository is not on GitHub

The collector will not run. It is a GitHub client: `collector/src/github.ts` is three primitives
(`get`, `paginate`, `getBinary`) and every metric builds its own `/repos/...` path. Do not ask an
agent to "port the collector"; that is how a dashboard ends up green and meaningless.

Two options, in order of preference:

1. **Write the month files from the pipeline.** Publish the facets, and have the pipeline write
   `data/<id>/<yyyy-mm>.json` and `data/index.json`. The web reads those files at build time and
   needs nothing else. This is the smallest possible integration and it survives any host.
2. **Add a source adapter.** Only if the first option is not enough. Adapt the transport, keep every
   metric's meaning, and add a test per adapter that names the mistake it prevents.

The minimum monthly document still has the full shape: `delivery`, `agents`, `contributors`,
`placement` and `warnings` are required keys, but each may be
`{ "available": false, "reason": "..." }`. Put the real content in `engineeringExcellence` and
`scorecard`. The web renders a reason where a number would go, so an honest absence is a supported
state, not a broken page. The type is `EngineeringExcellence` in `web/src/shared/lib/types.ts`, and
`data/billing/2026-08.json` is a collected example to copy rather than invent.

The scorecard in this mode comes from the facets, not from detection. Detection reads
`.github/workflows/*.yml`, which does not exist on another host. A repository that publishes facets
gets a measurement; one that does not gets an inference.

### 5.3 The mini web

Do not build a second dashboard. This one is already per-project, already static, and already
engineering-first. Point it at the project list and the data:

```bash
PROJECT_HEALTH_CONFIG_DIR=<dir with projects.json and config/> \
PROJECT_HEALTH_DATA_DIR=<dir with data/> pnpm web:build
```

The export lands in `web/out/` and can be served by any static host. A build with no collected data
is valid and shows empty states, which is how you check the wiring before the first collection.

## 6. Path C — inspiration only

Take these, and say in writing which ones you took:

- The contract in section 3. Keep the envelope even if your own shape differs, so a later adoption
  is a configuration change rather than a migration.
- The twelve practices, the four colours, the cumulative level and the score formula, as a rubric.
- The honesty rules in section 7.
- Weak versus strong: tests that run without a coverage tool are yellow, never green. When a weak
  and a strong tool are both found, the strong one decides.
- Gates declared by the repository (a baseline, new violations, justified exemptions), not guessed
  by the collector.

Do not copy, because these are one host's implementation and not the model:

- Workflow detection from `.github/workflows/*.yml`.
- The zipball download, the Actions billing report and the run timings.
- DORA from deployments, releases and pull requests.
- The agent and AI-usage axis.

If you copy those, you will spend the effort and inherit the assumptions.

## 7. Rules you never break

Every metric is either present with data or absent with a reason:

```json
{ "available": false, "reason": "Billing has no production environment configured." }
```

- **A missing value never sorts as zero.** Otherwise the projects without data top the fastest
  lead time.
- **Never estimate to fill a gap.** Where GitHub, or the host, cannot answer a question, the site
  says so. Change fail rate and failed deployment recovery time are deliberately not collected,
  because a red pipeline is not a failed deployment.
- **Small samples refuse to be placed.** Below five releases in a period, no profile is assigned.
- **Partial periods divide by elapsed days.** A month in progress is not a month.
- **Unknown schema versions are ignored.** Never read a facet you do not understand.
- **Facets never gate.** The repository's own CI decides what fails.

And the one that matters most here: **a run that writes `unavailable` everywhere still succeeds.**
Metrics degrade by design, so a green collection run is not evidence that anything was measured.
That is why section 9 exists.

## 8. Ask the person before writing code

One message, then build. Ask only what the path needs.

1. **Which path** (A, B or C), if they did not say.
2. **The repository**, and which host it is on if it is not GitHub.
3. **Path A:** the production environment name, whether production refs are tags or branches, the
   work item label and the rework label (run `--discover` first and confirm its answers rather than
   asking blind).
4. **Path B:** which of the six facets this repository can actually produce. Three is a good
   answer; six is rare.
5. **The token**: whether they have a GitHub App or a personal token, and whether they will create
   the permissions in section 10.

## 9. Done means

- Every facet the repository produces renders data on the project page, or the page says why not.
  Open the page. An empty card with a reason is a pass; an empty card with no reason is a bug.
- A facet with a wrong `repo` or `ref` is ignored, and the month file records
  `engineering excellence schema mismatch` rather than showing its numbers.
- Two scorecard practices are checked by hand against the real CI file, and they agree.
- The stored month holds more than the newest sample when more than one commit ran, so the trend
  line has something to draw.
- `pnpm --filter @project-health/collector run test` and
  `pnpm --filter @project-health/web run test` pass, if the code was changed at all.
- Nothing claims a number the host cannot produce. Search the new code for `?? 0` and for defaults
  on metric blocks; those are where an absence turns into a zero.

## 10. What the person must create

Nothing here can be created from the repository.

- **A token that can read the listed repositories**, as `METRICS_TOKEN` or as a GitHub App through
  `BOT_APP_ID` and `BOT_PRIVATE_KEY`. The App needs five repository permissions, all read:
  **Metadata**, **Deployments**, **Contents**, **Issues** and **Actions**. Deployments is the one
  people miss, and it carries deployment frequency, lead time and rework rate. A token missing a
  permission answers 404 rather than 403, so the collector runs a preflight and names what is
  missing instead of writing empty metrics.
- **Pull requests read**, only for the roadmap. **Administration read** on the organisation, only for
  the Actions billing report. Both are optional, and their absence degrades one block rather than
  the run.
- **Pages**, if path A is deployed the way this repository is: Settings → Pages → Source: GitHub
  Actions, and private visibility on GitHub Enterprise Cloud, so repository access is the access
  list.
- **A repository ruleset on the default branch**, so the gates run before a merge and the facets
  describe code that actually shipped.
