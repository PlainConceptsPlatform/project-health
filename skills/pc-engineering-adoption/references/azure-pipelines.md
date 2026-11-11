# Azure Pipelines

Three pipelines, one per job: **CI** produces the facets, **Collection** turns them into month files,
**Deploy** publishes the web. Starting points, not drop-ins: the producer flags depend on the stack
(see [`producers.md`](producers.md)) and the pool comes from Q7, never from this file. The `script`
steps are bash: on a Windows pool, use the `Bash@3` task (Git Bash) or translate them to `pwsh`.

Values used below, all from `ADOPTION.md`:

| Placeholder | From |
| --- | --- |
| `<pool>` | Q7 build agents: `vmImage: ubuntu-latest`, or `name: <self-hosted pool>` |
| `<repo-id>` | the `repo` of the `projects.json` entry, for example `contoso/checkout` |
| `<project-id>` | the `id` of that entry |
| `<ph-sha>` | the pinned Project Health commit |
| `<ci-pipeline-id>` | the CI pipeline's definition id, from its URL (`definitionId=`) after it is created |

## CI

Facets on the default branch, uploaded even when a gate failed. One output directory per facet, so
each artifact holds exactly one `<facet>.json`.

```yaml
trigger:
  branches:
    include: [main]
pr:
  branches:
    include: [main]

pool:
  <pool>

steps:
  - checkout: self
    fetchDepth: 0

  - task: UseNode@1
    inputs:
      version: '22'

  # ... the repository's own build and tests, writing the reports the producer reads ...

  # The producer fills the envelope from GitHub's variable names, whatever the host.
  - script: |
      mkdir -p ee/coverage
      node scripts/engineering-excellence.mjs coverage \
        --out ee/coverage/coverage.json \
        --api <api cobertura.xml> \
        --web <web cobertura.xml>
    displayName: Build the coverage facet
    condition: and(succeededOrFailed(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    env:
      GITHUB_REPOSITORY: <repo-id>
      GITHUB_REF: $(Build.SourceBranch)
      GITHUB_SHA: $(Build.SourceVersion)
      GITHUB_RUN_ID: $(Build.BuildId)
      GITHUB_RUN_ATTEMPT: $(System.JobAttempt)

  - task: PublishPipelineArtifact@1
    displayName: Publish the coverage facet
    condition: and(succeededOrFailed(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      targetPath: ee/coverage
      artifact: engineering-excellence-coverage
```

Repeat the pair per facet. Mutation is slow: give it its own pipeline with a weekly `schedules`
entry and the same two steps.

**Branch policy is the gate.** A required status check on GitHub is a Build Validation policy on the
default branch here. A pipeline nobody must pass only reports.

## Collection

Scheduled at the Q4 cadence (or `trigger: none` plus a pipeline-completion trigger on CI for "every
push"). It takes the latest default-branch CI run **including failed ones**, writes the months and
commits them without starting CI again.

```yaml
trigger: none
pr: none

schedules:
  - cron: '0 3 * * *'          # daily at 03:00 UTC; '0 3 * * 1' for weekly
    displayName: Collect Project Health data
    branches:
      include: [main]
    always: true               # run even when nothing was pushed: the CI run may be newer

pool:
  <pool>

steps:
  - checkout: self
    persistCredentials: true   # lets the last step push

  - task: UseNode@1
    inputs:
      version: '22'

  - task: DownloadPipelineArtifact@2
    displayName: Download the latest facets from main
    inputs:
      buildType: specific
      project: $(System.TeamProjectId)
      definition: <ci-pipeline-id>
      buildVersionToDownload: latestFromBranch
      branchName: refs/heads/main
      allowFailedBuilds: true                 # a drop is the sample most worth keeping
      allowPartiallySucceededBuilds: true
      itemPattern: 'engineering-excellence-*/**'
      targetPath: $(Pipeline.Workspace)/facets

  - script: |
      set -euo pipefail
      PH="$(Agent.TempDirectory)/project-health"
      git init "$PH" && cd "$PH"
      git fetch --depth 1 https://github.com/PlainConceptsPlatform/project-health <ph-sha>
      git checkout FETCH_HEAD
      corepack enable
      pnpm install --frozen-lockfile
      for dir in "$(Pipeline.Workspace)"/facets/engineering-excellence-*; do
        [ -d "$dir" ] || continue
        facet="${dir##*/engineering-excellence-}"
        PROJECT_HEALTH_CONFIG_DIR="$(Build.SourcesDirectory)/project-health" \
        PROJECT_HEALTH_DATA_DIR="$(Build.SourcesDirectory)/project-health" \
          pnpm facet-store add --project <project-id> --facet "$facet" --file "$dir/$facet.json"
      done
    displayName: Write the month files

  - script: |
      set -euo pipefail
      git config user.name "Project Health"
      git config user.email "project-health@pipeline.invalid"
      git add project-health/data
      if git diff --cached --quiet; then echo "No new sample"; exit 0; fi
      git commit -m "chore(project-health): collect facets ***NO_CI***"
      git push origin HEAD:refs/heads/main
    displayName: Commit the month files
```

- `***NO_CI***` in the message keeps the push from starting CI, and so from looping.
- **Permission, checkpoint of step 7**: the identity `<Project> Build Service (<organization>)` needs
  **Contribute** on the repository, and **Bypass policies when pushing** when `main` has branch
  policies. If the person cannot grant the second one, push to the `project-health-data` branch from
  Q7 instead and point the deploy pipeline at it.
- `facet-store` keeps one sample per commit, so running it twice on the same CI run changes nothing.
  Daily collection keeps the last run of each day.
- A facet the CI did not produce is simply absent from the download; the month keeps it as not
  available. A `facet-store` rejection fails this step on purpose: read its reason.

## Deploy

Only when Q3 named a host. Builds the web from the same pinned commit against the committed folder.
Trigger it on changes to `project-health/` so every collection commit redeploys.

```yaml
trigger:
  branches:
    include: [main]
  paths:
    include: [project-health]
pr: none

pool:
  <pool>

steps:
  - checkout: self

  - task: UseNode@1
    inputs:
      version: '22'

  - script: |
      set -euo pipefail
      PH="$(Agent.TempDirectory)/project-health"
      git init "$PH" && cd "$PH"
      git fetch --depth 1 https://github.com/PlainConceptsPlatform/project-health <ph-sha>
      git checkout FETCH_HEAD
      corepack enable
      pnpm install --frozen-lockfile
      PROJECT_HEALTH_CONFIG_DIR="$(Build.SourcesDirectory)/project-health" \
      PROJECT_HEALTH_DATA_DIR="$(Build.SourcesDirectory)/project-health" \
        pnpm web:build
      cp -r web/out "$(Build.ArtifactStagingDirectory)/site"
    displayName: Build the web

  # Azure Static Web Apps. The token is a secret pipeline variable, never in the YAML.
  - task: AzureStaticWebApp@0
    inputs:
      app_location: $(Build.ArtifactStagingDirectory)/site
      skip_app_build: true
      azure_static_web_apps_api_token: $(SWA_DEPLOYMENT_TOKEN)
```

For another static host, replace the last task with the copy that host needs (an Azure Storage
`$web` upload, an IIS or nginx folder). Under a subpath, set `NEXT_PUBLIC_BASE_PATH` on the build.

Keep the site private (Static Web Apps with Entra ID authentication on a Standard plan, or an
internal host). Engineering numbers are not sensitive; delivery numbers, if they ever arrive, name
people.

## Verify before you tick the steps

1. A pull-request CI run publishes no facet.
2. A default-branch CI run publishes one artifact per facet, each holding one `<facet>.json` whose
   `repo` is `<repo-id>` and `ref` is `refs/heads/main`.
3. Breaking a gate still produces the facet, with the failing numbers in it.
4. A collection run commits a month file with that run's sample, and CI did not start because of it.
5. The deployed page shows the same numbers as the local one.
