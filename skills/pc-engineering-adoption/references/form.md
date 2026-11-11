# The form

The skill opens with this form, whatever the person typed to load it. "Install it", "hazlo", "just
do it" and a three-paragraph brief all start here. The form is how two people with two different
models in two different repositories end up with the same result.

## Rules

- **Every question is asked, and every question is mandatory.** None is skipped because you think
  you know the answer: show what you detected as the recommended option and let the person confirm
  it. An answer the person already gave in their first message is pre-selected as the
  recommendation, and still asked.
- **"You decide" is an answer, not a skip.** Take the recommendation, say which one in one line, and
  mark it `(decided by the agent)` in the record.
- **One question per call** of the host's question tool (`AskUserQuestion` in Claude Code, `question`
  elsewhere). Put the progress in the header: `1/7 CI`, `2/7 Web`… so the person knows how far
  they are.
- **Ask in the language the person writes in.** The option labels below are a template; translate
  them.
- **Recommendation first**, labelled `(Recommended)`, with the reason in its description.
- **At most four options.** The tool adds "Other"; do not write one.
- **Several valid answers means `multiSelect: true`.** If the tool has no multi-select, print a
  numbered list and ask for the numbers ("1, 3, 4"), never for a paragraph.
- **Every option says what it costs or needs** in one line.
- **Look before you ask.** Before Q1, read the remote, the CI files, the stack, the test commands and
  the reports the build already writes. Use what you found to pick the recommendations and to fill
  the Q7 confirmation.
- **Write the answers down as you go**, in `project-health/ADOPTION.md` (template in
  [`adoption-record.md`](adoption-record.md)). A session that dies at question 5 resumes at question
  5, not at question 1.

Questions with a condition (Q3 only when Q2 is yes) are skipped only by that condition, and the
record says why.

## Q1. CI platform (single select) — header `1/7 CI`

"Which platform holds this repository and runs its CI?"

| Option | Description |
| --- | --- |
| GitHub | Project Health already collects GitHub repositories. Use the official repository; this skill only puts the facets in your CI |
| Azure DevOps | No Project Health collector for this host: this skill builds the pipelines, the data folder and the web for you |
| GitLab | Same as Azure DevOps |
| Other (tool) | Jenkins, Bitbucket, TeamCity… The same plan with that host's syntax |

Pre-select what the remote shows (`dev.azure.com` / `visualstudio.com` → Azure DevOps).

**If GitHub**: say it plainly, in the person's language:

> On GitHub you do not need a custom dashboard: the official Project Health
> (<https://github.com/PlainConceptsPlatform/project-health>, public) collects delivery, agents and
> engineering facets from the GitHub API and publishes the site. Either your repository is added to
> an existing instance (whoever runs it uses that repository's `pc-add-project` skill), or you create
> your own instance from that repository as a template. What this skill still does is put the
> engineering facets in your CI so that instance has something to read.

Then ask **Q1b** (single select): "Put the engineering facets in this repository's CI so Project
Health reads them (Recommended)" / "No, only point me to Project Health". On the second answer, stop
here: there is nothing to build. On the first, skip Q2, Q3 and Q4 (the instance decides web,
publishing and cadence) and continue at Q5.

## Q2. Web (single select) — header `2/7 Web`

"Do you want a web page to see the data?"

| Option | Description |
| --- | --- |
| Yes (Recommended) | Project Health's own web, built from the JSON this repository stores. You will see it in a browser before any pipeline exists |
| No | The facets and the month files stay in the repository; the gates do the work |

## Q3. Where the web lives (single select, only when Q2 is yes) — header `3/7 Publish`

"Only on your machine, or published somewhere? Where it lives decides the deployment pipeline."

Offer what fits the host, recommendation first:

| Host | Options |
| --- | --- |
| Azure DevOps | Local only (Recommended for the first release) · Azure Static Web Apps · Another static host (Azure Storage, IIS, nginx) |
| GitLab | Local only (Recommended for the first release) · GitLab Pages · Another static host |
| Other | Local only (Recommended for the first release) · A static host they name |

Local only means: a command that runs the web against the stored JSON, and the skill runs it for
them in this session. It is not "no web".

For a published site, ask in a follow-up for what the deployment needs (the Static Web App's name and
whether a deployment token already exists as a secret variable, the Pages project, the server path)
and say that delivery metrics, if they ever arrive, name real people, so the site should be private.

Then **Q3b. Look** (single select): Project Health's palette (Recommended) · A brand (URL, logo, hex
values) · Inspired by a site they name · Colours by hand. See [`dashboard-ux.md`](dashboard-ux.md).
For a brand or a site, ask for the input in a follow-up and show back what you extracted (primary,
background, text, one accent, typeface) before you apply it.

## Q4. Collection cadence (single select) — header `4/7 Cadence`

"How often should the data be collected into the JSON files?"

| Option | Description |
| --- | --- |
| Daily, at night (Recommended) | A scheduled pipeline takes the latest default-branch run of the day and commits the month file. One commit a day at most |
| On every push to the default branch | One sample per commit, the most detail. One data commit per merge |
| Weekly | The cheapest. Enough for a monthly review, too coarse to see which merge moved a number |

Mutation runs weekly whatever is chosen here, because it is slow; say so in the question text.

## Q5. Pillars (multi select) — header `5/7 Pillars`

"Engineering is always included. Which other pillars do you want?"

Engineering (gates, the facets, the scorecard) is mandatory and is not an option: say so in the
question text. Offer the other pillars with what they need on this host:

| Option | On GitHub | On any other host |
| --- | --- | --- |
| DORA (deployments, lead time, rework) | Collected by Project Health from deployments and releases | No collector yet. Recorded as pending; the web shows it as not available with the reason |
| Agentic (agent cost in tokens and time) | Collected from the agent workflow runs | Same as DORA |
| Roadmap (issues and pull requests in flight) | Collected from issues and pull requests | Same as DORA |
| CI usage (minutes and cost) | Collected from Actions | Same as DORA |

A pillar chosen on a host with no collector is not dropped and not faked: it goes to the record's
**Pending** section, and the month file carries it as `{ "available": false, "reason": "..." }`,
which `facet-store` already writes. Building that collector is a separate piece of work; say so.

## Q6. Engineering scope (single select) — header `6/7 Eng`

"For engineering, everything the standard proposes, or a custom selection?"

| Option | Description |
| --- | --- |
| Everything the standard proposes (Recommended) | Every facet this repository can produce today, the PR gates and the scorecard (pending off GitHub). What it cannot produce is listed with the report it is missing |
| Custom | You pick the modules in the next two questions |

On **Custom**, ask both, each `multiSelect: true`, offering only what the repository can produce (and
saying in the question text which ones you left out and why):

**Q6a. Code quality**: Coverage (Cobertura XML or `coverage-final.json`) · Complexity (coverage
reports plus lint output) · Mutation (Stryker `mutation-report.json`, weekly) · Hygiene
(`jscpd-report.json`, `semgrep.json`).

**Q6b. Security and process**: Security (`trivy.json`, `semgrep.json`, scanner job outcomes) · SBOM (a
CycloneDX BOM) · PR gates (the repository's CI, not a facet) · Scorecard (not a facet: collected by
Project Health on GitHub; on any other host it reads "not collected on this host" and is recorded as
pending, see [`data-and-web.md`](data-and-web.md)).

Gates and scorecard are not facets: say so in their descriptions, so nobody reads "all the facets"
as "the standard passed".

## Q7. Project context — header `7/7 Context`

Read first, then ask. Print what you detected and ask these, one per call:

1. **Detected facts** (single select): "I found: stack, test commands, default branch, the reports the
   build writes, the CI file. Is that right?" Options: Correct (Recommended) · Something is wrong (the
   person corrects it in a follow-up).
2. **Build agents** (Azure DevOps and GitLab only, single select): Microsoft-hosted / shared runners
   (Recommended when the repository already uses them) · A self-hosted pool or runner tag (name it in
   a follow-up). Self-hosted pools are often short of workers; a pipeline that queues for an hour is a
   pipeline nobody trusts, so ask instead of copying `ubuntu-latest`.
3. **Where the JSON lives** (single select): A `project-health/` folder in this repository, on the
   default branch (Recommended) · A dedicated branch `project-health-data` (when the default branch
   has policies that block a pipeline push) · A separate repository. Say what each needs: the first
   two need the pipeline identity to push (Contribute, and "Bypass policies when pushing" for the
   first when the branch is protected).
4. **Anything else** (single select): Nothing else (Recommended) · Yes, there is more (free text in a
   follow-up: monorepo layout, a second default branch, compliance rules, who will open the site).

## Q8. Confirm (single select) — header `Plan`

Print the plan as a short table: host, web and where, look, cadence, pillars (collected / pending),
engineering modules (installed / not producible and why), agents, data location, and the files you
will add. Options: Go ahead (Recommended) · Change something. Touch nothing before the yes.
