# The six facets

One artifact per facet, named `engineering-excellence-<facet>`, holding a single `<facet>.json`.

| Facet | Carries | Fed by | Cadence |
| --- | --- | --- | --- |
| `coverage` | Line and branch rate per scope and module, against each scope's floor | Merged Cobertura XML; `coverage-final.json` for a JS suite | Every push to the default branch |
| `complexity` | CC percentiles, counts above CC 10 and CRAP 30, the worst methods, and optionally the repository's `gate` | The same coverage reports plus lint output; a committed baseline for the gate | Every push |
| `mutation` | Covered-code and full mutation score per scope and module | Stryker's `mutation-report.json` per scope | Weekly |
| `security` | Vulnerabilities, misconfigurations and secrets by severity, Semgrep counts, and the result of each blocking scanner job | `trivy.json`, `semgrep.json`, and the job outcomes | Every push |
| `sbom` | Component count by ecosystem, licence mix, components with no licence | A CycloneDX BOM | Every push |
| `hygiene` | Duplication per scope and module, the worst files, swallowed exceptions justified and not, dead-code warnings, comment density, optionally the duplication `gate` and `commentSlop` | `jscpd-report.json`, `semgrep.json`, and a committed baseline | Every push |

## Envelope

```json
{
  "schemaVersion": 1,
  "facet": "coverage",
  "repo": "owner/name",
  "ref": "refs/heads/main",
  "commitSha": "<sha>",
  "runId": 123,
  "runAttempt": 1,
  "generatedAt": "2026-10-11T23:03:56.547Z",
  "data": {}
}
```

The canonical schema is `schema/engineering-excellence-facets.schema.json` in Project Health. Vendors
a copy and validate before upload. `data` is defined per facet in that file.

Not every practice has a facet. DAST, performance and the restore drill are read from their own
workflows, so publishing six facets is not the same as passing the standard.

## Rules

- **Default branch only.** A pull-request run measures code that may never merge.
- **Upload on failure too.** A drop is the sample most worth keeping; a facet that only exists when
  the build is green hides exactly the week somebody needs.
- **Any workflow may upload.** Artifacts are found by name and branch, not by workflow, because CI on
  the default branch often runs as a reusable workflow inside a deployment pipeline.
- **Produce only what you have.** A missing facet is an honest absence with a reason, not a failure.
- **Rates and scores are fractions from 0 to 1**, never percentages.
- **`repo` and `ref` must match the repository.** A consumer that does not match them ignores the
  file rather than showing someone else's number.
- **Bumping `schemaVersion` breaks consumers silently**, because an unknown version is ignored by
  design. Bump it when the shape breaks, and land the consumer change first.

The `security` facet's `jobs` are, by contract, the results of the **blocking** scanner jobs. A
scanner the facet reports counts as blocking however its workflow line is written, which is why
facets beat reading YAML for a tool wrapped in a shell script.
