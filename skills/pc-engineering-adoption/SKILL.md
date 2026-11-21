---
name: pc-engineering-adoption
description: Adopt the Platform engineering standard in a repository, with the JSON data and, if wanted, the Project Health web to see it, on GitHub, Azure DevOps, GitLab or another host. Always starts with a mandatory step-by-step form (CI platform, web, where to publish it, cadence, pillars, engineering scope, project context) and then builds the pipelines, the data folder and the web one checked step at a time. Use when a team wants the engineering gates, coverage, mutation, complexity, security, SBOM or hygiene facets, the engineering scorecard, a dashboard of them, or says anything about adopting the standard or Project Health in their repository.
license: MIT
---

# Engineering adoption

The deliverable is the standard running in the repository: gates that fail a pull request, facets
the CI publishes from the default branch, month files of JSON in a folder, and, when the person wants
it, Project Health's web reading that folder, seen in a browser before the skill ends.

This skill is **guided**. It does not decide the shape from the first sentence the person typed. It
runs a form, writes the answers down, and then walks a fixed list of steps, telling the person which
step it is on and showing the evidence of each one. Different models in different repositories have
to end in the same place; the form and the step list are how.

## Before anything: is this an internal repository?

Run `git remote get-url origin`, silently. The repository is **internal** only when the remote is on
`github.com` under the `PlainConceptsPlatform` owner. Anything else (another owner, another host, no
remote) is **external**.

For an external repository, the internal template machinery does not exist: do not read, propose or
mention Copier, `.copier-answers.yml`, `.platform/manifest`, the family template or its repository,
and do not offer the Platform standard as an option beyond what is public. Never name a private
repository to an external user, even to say it is unavailable. Project Health itself and
`agentic-workflows` are public and may be named.

If `project-health/ADOPTION.md` exists, read it: this is a resumed adoption. Say which step it
stopped at and continue from there, asking only the questions it has no answer for.

## Step 1. The form (mandatory, always)

Whatever the person said when loading the skill, start the form. Do not change, add or propose
anything before it is complete and confirmed. Follow [`references/form.md`](references/form.md)
exactly: one question per call, progress in the header, recommendation first, in the person's
language, every question answered.

1. **CI platform**: GitHub, Azure DevOps, GitLab, another. On GitHub, point to the official
   Project Health repository and only wire the facets.
2. **Web**: yes or no.
3. **Where the web lives**: local only, or a named host for the deployment pipeline. Then its look.
4. **Cadence**: daily at night, every push, weekly.
5. **Pillars**: engineering is mandatory; DORA, agentic, roadmap, CI usage on top.
6. **Engineering scope**: everything the standard proposes, or a custom selection of modules.
7. **Project context**: confirm what you detected, build agents, where the JSON lives, anything else.
8. **Confirm** the plan.

Write each answer into `project-health/ADOPTION.md` as it arrives, using
[`references/adoption-record.md`](references/adoption-record.md). That file is created at the first
answer; it is the only thing the skill writes before the plan is confirmed.

**Done when** every question has an answer (an explicit one or "you decide" with the recommendation
recorded), and the person said go ahead to the printed plan.

## How the build runs

After the form, work through steps 2 to 9 in order. For each one:

- **Announce it** in one line before you start: "Step 4 of 9: data folder and first month file".
- **Do it**, then **show the evidence**: the command and its output, the file path, the run link, the
  screenshot. Tick it in `ADOPTION.md` with that evidence.
- **Never skip a step silently.** A step that does not apply (no web, so no step 8) is ticked as
  "not needed" with the answer that made it so. A step that cannot be done stops the build: say
  what is missing and ask, instead of moving on.
- **Never drop the web because the host is not GitHub.** That is the failure this skill was rewritten
  for. The web reads JSON files; any host can produce them (step 4).

Pause for the person only at the checkpoints marked **Checkpoint**. Everything else proceeds.

## Route

| Q1 answer | Steps |
| --- | --- |
| GitHub, facets only | 2, 3, 6 (GitHub wiring), 9. Then hand off: the official Project Health instance collects the rest. Name it and the `pc-add-project` skill in that repository |
| GitHub, nothing to build | None. Point to <https://github.com/PlainConceptsPlatform/project-health> and stop |
| Azure DevOps, GitLab, other | All of 2 to 9 |

What each Q3 answer builds is in [`references/publishing.md`](references/publishing.md).

Before step 2, read [`references/producers.md`](references/producers.md). Two different things
produce engineering signals, from two different places, and mixing them is a failure this skill
exists to prevent.

## Step 2. Vendor the producer

The producer reads report files the build already writes (Cobertura XML, `coverage-final.json`,
`eslint.json`, `jscpd-report.json`, `semgrep.json`, `trivy.json`, a CycloneDX BOM). It never calls a
host API, so the same script works everywhere; only the wiring differs.

Vendoring rule, in this order:

1. Internal repositories only: if it is a Copier consumer (`.copier-answers.yml` exists), the
   producer belongs to a platform-owned path in `.platform/manifest` and arrives with `copier
   update`. Do not copy it into the tree by hand.
2. Otherwise vendor `scripts/engineering-excellence.mjs`, `scripts/lib/`, the schema copy and the
   gates it needs from the public repository `PlainConceptsPlatform/agentic-workflows`, folder
   `loops/templates/quality-gates/scripts/` (shallow clone into a scratch folder outside this
   repository, `gh api`, or the `@plainconceptsplatform/workflows` npm package). Keep a header
   pointing back to that source and record the commit in `ADOPTION.md`. Never rewrite the producer
   from the fixtures or from memory: a lookalike is the drift this step exists to prevent.

**Done when** the files are in the tree with their header and the commit is in the record.

## Step 3. First facet, locally

Run the build's own test command so the reports exist, then the producer, for each module the form
selected, with the flags and the five `GITHUB_*` variables in
[`references/producers.md`](references/producers.md) ("Running the producer outside GitHub
Actions"). `GITHUB_REPOSITORY` is the `owner/name` that step 4 puts in `projects.json`; without it the
facet names no repository and is rejected later. Facet shapes: [`references/facet-shapes.md`](references/facet-shapes.md).

If a selected module has no input in the repository, do not invent one: mark it "not producible" in
the record with the report it lacks, and tell the person.

**Done when** each producible facet exists as `<facet>.json` and validates against the vendored
facet schema, and its numbers match what the tool itself printed.

## Step 4. Data folder and first month file

Follow [`references/data-and-web.md`](references/data-and-web.md): a `project-health/` folder with
`projects.json` (one entry), `config/` and `data/`, and Project Health cloned at a pinned commit
outside the repository to run `facet-store` and the web.

**Done when** `facet-store add` wrote `project-health/data/<id>/<yyyy-mm>.json` and `data/index.json`
for every facet from step 3, and the project list validated with the Project Health checker.

## Step 5. The web, locally (when Q2 is yes)

Same reference. Run the web against the folder, open it in a browser, and look at it at desktop and
phone width in both themes. Apply the look from Q3b as tokens only, following
[`references/dashboard-ux.md`](references/dashboard-ux.md), and run its checklist. Filters, sort,
the open tab and section, and the folded panels are all query parameters (the Project Health README
lists them under "Search, filters and links" and "A project's Engineering tab"): open one copied
link in a fresh window to check the view comes back.

**Checkpoint**: show the person the page (a screenshot, or the URL with the command to open it
themselves) and the pillars that read "not available" and why. Continue when they have seen it.

**Done when** the overview and the project page render with the step 4 numbers, the checklist in
`dashboard-ux.md` passes, and the person has seen it.

## Step 6. CI publishes the facets

- **GitHub**: the family template already runs the gates. Facets go in a separate workflow file that
  reads the reports its CI uploaded, or in `app-ci.yml` after taking ownership of that file. See
  `references/producers.md` for what taking ownership costs.
- **Azure DevOps**: [`references/azure-pipelines.md`](references/azure-pipelines.md), section "CI".
- **GitLab**: [`references/gitlab-ci.md`](references/gitlab-ci.md), section "CI".
- **Other**: the same three rules in that host's syntax: default branch only, upload on failure too,
  one `<facet>.json` per artifact.

Use the build agents from Q7. **Done when** one default-branch run published the facets and a
pull-request run published none.

## Step 7. Collection pipeline (not on GitHub)

The pipeline that turns the facets into month files at the Q4 cadence: take the latest default-branch
run's facets (failed runs included), run `facet-store add` for each, and commit `project-health/data/`
to where Q7 said the JSON lives, without triggering CI again. Same references, section "Collection".

**Checkpoint** before the first run: tell the person the permission the pipeline identity needs to
push, and confirm they granted it.

**Done when** one scheduled or triggered run committed a month file that has the new sample.

## Step 8. Deployment pipeline (when Q3 is a host)

Build the web from the pinned Project Health commit against the committed folder and deploy the
static export to the Q3 host. Same references, section "Deploy". Local only: tick it as not needed
and leave the one command that runs the web in `ADOPTION.md` and in the repository's README.

**Done when** the deployed URL shows the same page the person saw in step 5, with the step 7 data.

## Step 9. Verify against real runs

- Upload happens on the default branch and on a failed gate, never only on success. A drop is the
  sample most worth keeping.
- Every facet names this repository in `repo` and this branch in `ref`; a mismatch is ignored by the
  consumer and must be ignored, not papered over.
- The gates fail a pull request that breaks them, and the facets still upload. Facets never gate.
- `schemaVersion` is the one the consumer knows. An unknown version is ignored by design.
- One deliberate failure is recorded: break a gate on a branch, merge or run it on the default
  branch's pipeline as the host allows, and confirm the web shows the drop, not a zero.
- Every module and every pillar from the form is accounted for in `ADOPTION.md`: installed with
  evidence, not producible with the reason, or pending with the reason.

**Done when** every line is checked against a real run, not against the pipeline file.

## The closing report

End with a table in the person's language: each step, its state and its evidence; each module;
each pending pillar and what building it would take; the command to see the web locally; and the URL
if it was deployed. That table is also the last update of `ADOPTION.md`.

## What "done" does not mean

A green pipeline is not adoption. Every facet degrades to an absent block with a reason when its
input is missing, so a run that published nothing can still be green. Adoption is the run that
produced a number somebody checked against the tool that measured it, on a page they opened.
