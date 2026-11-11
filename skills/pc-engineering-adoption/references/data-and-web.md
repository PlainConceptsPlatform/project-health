# The data folder and the web, on any host

Project Health's web does not care where the JSON came from. On GitHub its collector writes the month
files; anywhere else `facet-store` does, from the facets the CI produced. This file is the recipe for
the second case. It was run end to end against a fixture before it was written; follow it literally.

## 1. Pin Project Health

Use the public repository <https://github.com/PlainConceptsPlatform/project-health>, at a commit, never
at a branch: the web and `facet-store` change, and the pipelines must build what the person saw.

```bash
git ls-remote https://github.com/PlainConceptsPlatform/project-health HEAD   # the sha to pin
git init <scratch>/project-health && cd <scratch>/project-health
git fetch --depth 1 https://github.com/PlainConceptsPlatform/project-health <sha>
git checkout FETCH_HEAD
corepack enable && pnpm install --frozen-lockfile                             # Node 22 or later
```

`<scratch>` is a folder outside the adopting repository. Write the sha in `ADOPTION.md`; every
pipeline below uses the same one.

## 2. The folder in the adopting repository

```
project-health/
  ADOPTION.md       the record (adoption-record.md)
  projects.json     one entry, this repository
  config/           copied from the pinned clone's config/ (dora.json, scorecard.json)
  data/             written by facet-store, committed
```

`projects.json`, with the identity chosen once and used everywhere (the producer's `repo`, here and in
the pipelines):

```json
{
  "organization": "contoso",
  "projects": [
    {
      "id": "checkout",
      "name": "Checkout",
      "repo": "contoso/checkout",
      "enabled": true,
      "status": "production",
      "environments": { "production": null, "staging": null },
      "productionRefPattern": "^main$",
      "agents": { "enabled": false, "workflow": null },
      "engineeringExcellence": { "enabled": true, "branch": "main" }
    }
  ]
}
```

- `organization` must not be `your-org`; that value means "the untouched example".
- `id` is lowercase with dashes: it is the folder under `data/` and the URL of the page.
- `environments.production: null` says there is no deployment data to read, so the DORA blocks read
  "not available" with a reason instead of zero.
- `branch` is the default branch from Q7.

Every Project Health command below reads the folder through two variables, and both point at the
same place, the folder that **contains** `data/`. Set them once per shell or pipeline step:

```bash
export PROJECT_HEALTH_CONFIG_DIR=<repo>/project-health   # absolute
export PROJECT_HEALTH_DATA_DIR=<repo>/project-health     # the same folder
```

Validate the list with the checker from the pinned clone:

```bash
cd <scratch>/project-health && pnpm verify:config
# <repo>/project-health/projects.json: 1 project(s), no problems
```

## 3. Write the month files

From the pinned clone, with an **absolute** path to the facet:

```bash
pnpm facet-store add --project checkout --facet coverage --file <repo>/ee/coverage/coverage.json
# checkout 2026-10 coverage: 1 sample(s), newest 2026-10-11T23:03:56.547Z, created the month
```

Expect `project-health/data/<id>/<yyyy-mm>.json` and `project-health/data/index.json`. Open the month
file and check the numbers are the ones the tool printed, that `source` is `"facets"`, and that
`delivery`, `agents` and `contributors` carry `available: false` with a reason.

A rejection names the reason: usually `repo` does not match `projects.json` (the producer ran without
the variables in [`producers.md`](producers.md)) or `ref` is not the configured branch.

## 4. See it locally

```bash
pnpm web:dev      # http://localhost:3000, same two variables
```

Open it in a browser (the agent's own browser tool when it has one), go to the project page, and run
the checklist in [`dashboard-ux.md`](dashboard-ux.md). Show the person.

Leave the person a one-command way back. Add to the repository's README, or a script next to the
folder, the clone-at-sha, the two variables and the `web:dev` line, so seeing the data tomorrow does
not need an agent.

## 5. Build the static site

```bash
pnpm web:build    # export in web/out/, same two variables
```

`NEXT_PUBLIC_BASE_PATH=/some/path` when the host serves it under a subpath (GitLab Pages project
sites, a folder on a server); empty at a domain root (Azure Static Web Apps). A build with no data is
valid and shows empty states, which is a useful wiring check before the first collection.

## What the web shows from facets alone

The project page opens on the Engineering tab. **Engineering excellence** renders from the facets:
headline numbers, the per-module table, security, SBOM and hygiene for each facet stored, and trend
charts once there are two samples. The header reads "Engineering metrics from each repository's CI"
and the footer says the numbers come from the facets the CI publishes.

Everything a GitHub collector produces (the engineering scorecard, comments and tests, Actions usage,
delivery, agentic, roadmap) reads "Not available: not collected on this host". Say this at the step 5
checkpoint, before the person finds it, and record those as pending in `ADOPTION.md`.

This needs a Project Health commit from 2026-11 or later; an older pin shows GitHub wording and
promises those blocks "after the next collection". Pin the current `HEAD`.
