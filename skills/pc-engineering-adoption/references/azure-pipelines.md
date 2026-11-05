# Azure Pipelines

A starting point, not a drop-in: the flags depend on the stack and on the producer version you
vendored. Read the usage block at the top of `scripts/engineering-excellence.mjs` before you copy
anything, because the copies in the estate have drifted.

Each facet gets its own output directory, so the artifact holds exactly one `<facet>.json`. A facet
artifact with two files in it is read as neither.

```yaml
trigger:
  branches:
    include: [main]
pr:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - checkout: self
    fetchDepth: 0

  - task: UseNode@1
    inputs:
      version: '22'

  - script: npm ci
    displayName: Install

  - script: npm test -- --coverage
    displayName: Tests with coverage

  # Upload even when the tests failed: a drop is the sample worth keeping.
  - script: |
      node scripts/engineering-excellence.mjs coverage \
        --out ee/coverage/coverage.json \
        --web coverage/coverage-final.json
    displayName: Build the coverage facet
    condition: and(succeededOrFailed(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))

  - task: PublishPipelineArtifact@1
    displayName: Publish the coverage facet
    condition: and(succeededOrFailed(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    inputs:
      targetPath: ee/coverage
      artifact: engineering-excellence-coverage
```

## What differs from GitHub

- **Branch policy is the gate.** The equivalent of a required status check is a Build Validation
  policy on the default branch, plus required checks on the branch. A pipeline nobody must pass only
  reports.
- **Artifacts have no expiry by default.** Set retention on the pipeline definition; a facet is a
  snapshot, and the consumer keeps the history.
- **There is no consumer on this host.** Project Health reads GitHub Actions artifacts, so a facet
  published here is the repository's own record unless something reads it. Say that to the person
  instead of implying a dashboard.

## Verify before you call it done

1. A pull-request run publishes no facet.
2. A default-branch run publishes exactly one file per artifact, named `<facet>.json`.
3. Breaking a gate still produces the facet, with the failing numbers in it.
4. The JSON validates against the vendored facet schema, and its `repo` and `ref` name this
   repository and this branch.
