# The interview

One decision per question, in this order. The person should never have to type an answer that a
button could carry, and never be told "several answers are possible" by a control that accepts one.

## Rules

- **Use the host's question tool** (`AskUserQuestion` in Claude Code, `question` elsewhere), one call
  per decision. Do not bundle decisions into one call: a single-select control cannot hold a
  multi-part answer, which is how a person ends up typing it.
- **A decision with several valid answers is `multiSelect: true`.** Modules are always that. If the
  tool has no multi-select, print a numbered list and ask for the numbers ("1, 3, 4"), never a
  free-form paragraph.
- **At most four options per question.** More than four means split it into two questions by theme,
  as below. "Other" is added by the tool, so do not write one.
- **Recommendation first**, labelled `(Recommended)`, with the reason in its description.
- **Every option says what it costs or needs**, in one line: the tool it requires, or the report it
  reads. An option whose input does not exist in the repository is left out of the list rather than
  offered, and you say once, in the question text, which ones you left out and why.
- **Look before you ask.** Read the repository first (host, CI files, the reports its build already
  writes, and `.copier-answers.yml` only when step 0 says the repository is internal) and phrase each question around what you found.
- **"You decide"** is a valid answer. State the choice you took and why, then continue.

## The questions

### Q1. Host (single select)

GitHub, Azure DevOps, GitLab, Other. Pre-select what the remote and the CI files show.

### Q2. Scope (single select)

Engineering only (recommended when the repository is not already in a Project Health instance), or
everything, which adds delivery and agent metrics. Step 2 of the skill says what each leads to.

### Q3. Standard (single select)

The Platform standard (Foundations `ai/ENGINEERING.md`), or a generic quality bar the team picks.

### Q4. Modules (multi select, split by theme)

Ask both questions, one after the other, each `multiSelect: true`. Offer only what the repository can
produce, and say what each one reads.

**Q4a. Code quality**

| Option | Reads | Cadence |
| --- | --- | --- |
| Coverage | Cobertura XML or `coverage-final.json` | every push |
| Complexity | the coverage reports plus lint output | every push |
| Mutation | Stryker `mutation-report.json` | weekly |
| Hygiene | `jscpd-report.json`, `semgrep.json` | every push |

**Q4b. Security and process**

| Option | Reads | Cadence |
| --- | --- | --- |
| Security | `trivy.json`, `semgrep.json`, scanner job outcomes | every push |
| SBOM | a CycloneDX BOM | every push |
| PR gates | the repository's CI, not a facet | every pull request |
| Scorecard | the facets above, rendered | needs a dashboard |

Gates and scorecard are not facets. Say so in their description, so nobody reads "all six facets" as
"the standard passed".

Recommend two or three to start. Six is rare, and a facet from a tool that does not run is worse than
a missing one.

### Q5. Dashboard (single select)

Ask when the scorecard was chosen or the person mentioned a dashboard. Who opens it? Options: no
dashboard (recommended for a first release), an existing Project Health instance (GitHub only), your
own instance, a static site from committed JSON. Follow [`publishing.md`](publishing.md).

### Q6. Look (single select, only when a site will be built)

See [`dashboard-ux.md`](dashboard-ux.md): the UX is fixed, the identity is theirs.

1. Project Health's neutral palette (Recommended).
2. Follow a brand: a URL, a logo, hex colours or a brand guide the person provides.
3. Take inspiration from a website they name.
4. Pick colours by hand.

For 2 and 3 ask for the input in a follow-up, and say what you will extract from it (primary,
background, text, one accent, the typeface) so they can correct it before you apply it.

### Q7. Confirm (single select)

Print the plan in a few lines: host, scope, standard, modules, dashboard, look, and the files you will
add. Options: Go ahead (Recommended), Change something. Touch nothing before the yes.
