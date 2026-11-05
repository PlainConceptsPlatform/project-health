# GitLab CI

A starting point, not a drop-in: the flags depend on the stack and on the producer version you
vendored. Read the usage block at the top of `scripts/engineering-excellence.mjs` before you copy
anything.

One directory per facet, so the artifact holds exactly one `<facet>.json`.

```yaml
stages:
  - test

engineering-excellence:
  stage: test
  image: node:22
  script:
    - npm ci
    - npm test -- --coverage
    - node scripts/engineering-excellence.mjs coverage
        --out ee/coverage/coverage.json
        --web coverage/coverage-final.json
  artifacts:
    name: engineering-excellence-coverage
    paths:
      - ee/coverage/coverage.json
    # The upload is the point, so it happens on a failing job too.
    when: always
    expire_in: 90 days
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

## What differs from GitHub

- **`when: always` is the equivalent of "upload even when a gate fails".** Without it, the job that
  produces the most interesting sample publishes nothing.
- **`rules` is the default-branch filter.** A merge-request pipeline publishes no facet, which is
  correct: it measures code that may never merge.
- **Protected branches are the gate.** A job that is not required on the protected branch only
  reports.
- **There is no consumer on this host.** Project Health reads GitHub Actions artifacts, so a facet
  published here is the repository's own record unless something reads it.

## Verify before you call it done

1. A merge-request pipeline publishes no facet.
2. A default-branch pipeline publishes one artifact per facet, holding one `<facet>.json`.
3. A failing job still publishes the facet.
4. The JSON validates against the vendored facet schema, and its `repo` and `ref` name this
   repository and this branch.
