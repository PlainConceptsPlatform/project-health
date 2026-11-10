# The two producers

Two different things produce engineering signals, and they are not interchangeable.

| Layer | Source | How a repository gets it |
| --- | --- | --- |
| The CI that runs the gates: build, tests with coverage floors, per-PR mutation, Semgrep | `@plainconceptsplatform/workflows`, template `loops/templates/ci/app-ci-dotnet-next.yml`, installed as `.github/workflows/app-ci.yml` | Install and update it with the package. Do not hand-copy it |
| The six facets: coverage, complexity, mutation, security, SBOM, hygiene | `scripts/engineering-excellence.mjs`, `scripts/lib/` and the schema copy, published in the public `PlainConceptsPlatform/agentic-workflows` repository under `loops/templates/quality-gates/scripts/` | Vendor it, or receive it through a platform-owned path |

The boundary is easy to get wrong in both directions:

- The package's `app-ci.yml` runs the gates and **does not** contain the facets. Its header says
  `Managed by @plainconceptsplatform/workflows` and that a consumer edit may be overwritten.
- The facets **do not** replace the gates. They record what the gates saw, pass or fail, and are
  uploaded even when a gate fails. Facets never gate.

## The `--force` trap

Adding facet jobs to a managed `app-ci.yml` works until somebody runs `workflows update --force`,
which restores the template and takes the jobs with it. This is not hypothetical: the projects that
took that route grew `app-ci.yml` from the template's 351 lines to about 750, and a forced update
reverts all of it.

Two answers, both valid:

1. **Take the file over.** Remove the `Managed by @plainconceptsplatform/workflows` header. The
   package then treats it as consumer-owned and leaves it alone. Say so in the pull request, because
   a taken-over CI stops receiving package updates.
2. **Do not touch it.** Put the facet jobs in a separate workflow that reads the reports the managed
   CI already uploaded as artifacts. Prefer this for a new adoption.

Adding jobs to a managed file and saying nothing is the state that produced six copies of the
producer with four different contents.

## Why one owner matters

The producer was hand-vendored into six projects and the copies diverged within weeks: different
line counts, and different features, so the same consumer read six slightly different definitions of
"hygiene". That is the drift the Copier decision exists to stop.

So:

- If the repository has `.copier-answers.yml`, the producer belongs in `.platform/manifest` and
  arrives with `copier update`. Never edit a manifest path by hand.
- If it does not, vendor it with a header pointing back at the source, and record the commit. The
  header is what makes the next update a diff rather than an archaeology project.

A repository that wants a behaviour the producer does not have should add it upstream, where every
consumer gets it, rather than in its own copy.
