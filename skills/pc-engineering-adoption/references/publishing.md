# Publishing

The form decides this (Q1, Q2, Q3); this file says what each answer leads to. A dashboard nobody
opens is a pipeline and a hosting bill, so a local-only web is a good first release, and it is still
a web: the person sees it in step 5.

## On GitHub: the official Project Health

The facets are picked up with no integration code: the collector reads `engineering-excellence-<facet>`
artifacts from the configured branch, and also collects delivery, agents, roadmap, CI usage and the
scorecard from the GitHub API.

- **An existing instance**: one entry in its `projects.json`, added by whoever runs it with that
  repository's `pc-add-project` skill.
- **Your own instance**: create a repository from <https://github.com/PlainConceptsPlatform/project-health>,
  add a token, turn on Pages. Keep it private: delivery metrics name real people.

## Anywhere else: the folder and the pinned web

The web reads `data/index.json` and `data/<id>/<yyyy-mm>.json` at build time and needs nothing else.
`facet-store` writes them from the facets the CI produced. The full recipe is [`data-and-web.md`](data-and-web.md); the pipelines are in
[`azure-pipelines.md`](azure-pipelines.md) and [`gitlab-ci.md`](gitlab-ci.md).

| Q3 answer | What gets built |
| --- | --- |
| Local only | The folder, the collection pipeline, and a one-command `web:dev` written in the README |
| Azure Static Web Apps | The above plus the Deploy pipeline with `AzureStaticWebApp@0` |
| GitLab Pages | The above plus the `pages` job |
| Another static host | The above plus a copy of `web/out/` to that host |

What remains impossible off GitHub today is delivery, agents, pull requests, CI usage and the
scorecard: no collector reads those hosts. They are recorded as pending, and the month file says so
in each block instead of showing a zero.

## No web

The facets and the month files stay in the repository and the gates do the work. Step 5 and step 8
are ticked as not needed, with Q2's answer as the reason.

## The merge rules of `facet-store`

The collector's: one sample per commit, oldest first, deduplicated to the latest run attempt, full
detail on the newest and scope totals on the older ones. The project must already be in
`projects.json`. `--month yyyy-mm` overrides the month taken from `generatedAt`; `--commit <sha>`
sets the commit when the CI checks out a different revision than the one measured. When the month
does not exist it is created with every deployment, agent and pull request block absent and a
reason.
