# GitLab CI

The same three jobs as Azure Pipelines, in one `.gitlab-ci.yml`: **CI** produces the facets,
**Collection** turns them into month files, **Deploy** publishes the web. Starting points, not
drop-ins: the producer flags depend on the stack (see [`producers.md`](producers.md)) and the runner
tags come from Q7. Placeholders are the ones in [`azure-pipelines.md`](azure-pipelines.md).

GitLab's artifact download API only returns artifacts of successful jobs, which would throw away the
failed runs this standard wants to keep. So collection runs **in the same pipeline** as the facets,
after them, instead of fetching them later.

## CI

```yaml
stages: [test, collect, deploy]

default:
  image: node:22
  tags: [<runner tag>]        # from Q7; remove for shared runners

variables:
  # The producer fills the envelope from GitHub's variable names, whatever the host.
  GITHUB_REPOSITORY: <repo-id>
  GITHUB_REF: refs/heads/$CI_COMMIT_BRANCH
  GITHUB_SHA: $CI_COMMIT_SHA
  GITHUB_RUN_ID: $CI_PIPELINE_ID
  GITHUB_RUN_ATTEMPT: '1'

ee-coverage:
  stage: test
  script:
    - npm ci
    # ... the repository's own tests, writing the reports the producer reads ...
    - mkdir -p ee/coverage
    - node scripts/engineering-excellence.mjs coverage
        --out ee/coverage/coverage.json
        --api <api cobertura.xml>
        --web <web cobertura.xml>
  artifacts:
    paths: [ee/coverage/coverage.json]
    when: always              # a failing job still publishes the facet
    expire_in: 90 days
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

One job per facet. Mutation gets `rules: - if: $CI_PIPELINE_SOURCE == "schedule"` on a weekly
schedule. **Protected branches and "pipelines must succeed" are the gate**; a job that is not
required only reports.

## Collection

```yaml
collect:
  stage: collect
  when: always                # run after a failed facet job too
  needs:
    - { job: ee-coverage, artifacts: true, optional: true }
    # one line per facet job
  script:
    - PH=/tmp/project-health
    - git init $PH && cd $PH
    - git fetch --depth 1 https://github.com/PlainConceptsPlatform/project-health <ph-sha>
    - git checkout FETCH_HEAD
    - corepack enable && pnpm install --frozen-lockfile
    - |
      for f in "$CI_PROJECT_DIR"/ee/*/*.json; do
        [ -f "$f" ] || continue
        facet=$(basename "$f" .json)
        PROJECT_HEALTH_CONFIG_DIR="$CI_PROJECT_DIR/project-health" \
        PROJECT_HEALTH_DATA_DIR="$CI_PROJECT_DIR/project-health" \
          pnpm facet-store add --project <project-id> --facet "$facet" --file "$f"
      done
    - cd "$CI_PROJECT_DIR"
    - git config user.name "Project Health" && git config user.email "project-health@pipeline.invalid"
    - git add project-health/data
    - git diff --cached --quiet && exit 0
    - git commit -m "chore(project-health): collect facets [skip ci]"
    - git push "https://project-health:${PROJECT_HEALTH_PUSH_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" HEAD:$CI_DEFAULT_BRANCH
  rules:
    # Q4 daily or weekly: a pipeline schedule on the default branch (Build > Pipeline schedules)
    - if: $CI_PIPELINE_SOURCE == "schedule"
    # Q4 every push: use this rule instead
    # - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

- With a daily or weekly cadence the schedule runs the facet jobs too, so the facet jobs' `rules`
  must also accept `$CI_PIPELINE_SOURCE == "schedule"`.
- **Permission, checkpoint of step 7**: `PROJECT_HEALTH_PUSH_TOKEN` is a project access token with
  `write_repository`, stored as a masked, protected variable. If the default branch does not allow
  that role to push, use the `project-health-data` branch from Q7.
- `[skip ci]` keeps the data commit from starting a pipeline and looping.

## Deploy

GitLab Pages, when Q3 chose it. Project sites live under a subpath, so the base path is set.

```yaml
pages:
  stage: deploy
  script:
    - PH=/tmp/project-health
    - git init $PH && cd $PH
    - git fetch --depth 1 https://github.com/PlainConceptsPlatform/project-health <ph-sha>
    - git checkout FETCH_HEAD
    - corepack enable && pnpm install --frozen-lockfile
    - NEXT_PUBLIC_BASE_PATH="/$CI_PROJECT_NAME" PROJECT_HEALTH_CONFIG_DIR="$CI_PROJECT_DIR/project-health" PROJECT_HEALTH_DATA_DIR="$CI_PROJECT_DIR/project-health" pnpm web:build
    - cp -r web/out "$CI_PROJECT_DIR/public"
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes: [project-health/**/*]
```

Set Pages access control to project members.

## Verify before you tick the steps

1. A merge-request pipeline publishes no facet.
2. A default-branch or scheduled pipeline publishes one artifact per facet, each holding one
   `<facet>.json` whose `repo` and `ref` match `projects.json`.
3. A failing facet job still publishes the facet, and `collect` still runs.
4. `collect` commits a month file with that pipeline's sample, and no pipeline starts because of it.
5. The Pages site shows the same numbers as the local web.
