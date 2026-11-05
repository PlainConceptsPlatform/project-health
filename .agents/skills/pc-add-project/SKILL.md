---
name: pc-add-project
description: Add a repository to the Project Health dashboard, or bootstrap a fresh copy of the template. Use when adding a project, onboarding a repository to the panel, activating a repository that is measured nowhere, or setting up a new instance after "Use this template".
license: MIT
---

# Add a project

`projects.json` is the allowlist and the configuration at once. Nothing is measured unless it is
listed there, and a wrong field produces a metric that is quietly meaningless rather than an error.
That is why every field is read from the repository instead of guessed.

## 1. Name the mode

Read `projects.json`. It is missing, or its `organization` is still `your-org`, in a fresh copy of
the template: that is **bootstrap**, and `references/bootstrap.md` owns the order of work.

Anything else is **add**, and this file owns it.

**Done when** you can say which mode and why, in one sentence.

## 2. Ask the repository

```bash
pnpm --filter @project-health/collector run start --discover <owner/repo>
```

It writes nothing and prints what it found plus an entry ready to paste. Repositories disagree about
which environment is production, whether releases are tags or branches, and which label means
rework, so this output is the configuration. Do not infer any of it from a name.

**Done when** the output names the production environment, the ref pattern, the work item label, the
rework label and the agents, or says it found none of one.

## 3. Ask the person what the repository cannot answer

One `question` call, one message. Ask only these, because discover already answered the rest:

| Field | Why a person decides it |
| --- | --- |
| `id` | The folder under `data/` and the URL segment, forever. Kebab-case, short, stable across renames |
| `name` | How it reads on the dashboard |
| `type` | Decides which scorecard practices apply |
| `group` | `applications` or `tooling`; decides which table it is ranked in |
| `status` | `production`, `pre-production` or `planned`. Not a guess: it changes which metrics are skipped |

**Done when** every field in the entry is either reported by discover or answered by the person.

## 4. Write the entry

Paste discover's entry into the `projects` array and add the answers from step 3. Keep the array
sorted by `id`. Two optional blocks are worth offering when they fit:

- `"engineeringExcellence": { "enabled": true }` once the repository publishes facets from its
  default branch.
- `"roadmap": { "enabled": true }` only where agents and people hand issues over with labels.

Never add a field the repository does not have, and never set a value discover reported as absent.
`null` is a measurement ("this does not exist"); a plausible default is a lie.

**Done when** the diff touches `projects.json` and nothing else.

## 5. Validate

```bash
pnpm verify:config
```

It checks the file against `schema/projects.schema.json` and then the things a schema cannot: ids
that collide, practice ids in `scorecard.notApplicable` that do not exist, and a
`productionRefPattern` that does not compile.

**Done when** it exits 0. Fix every problem it lists; it reports all of them at once.

## 6. Report

State what will happen on the next collection: which metrics exist, which will read unavailable with
a reason, and what the person still has to create. The repository appears on the site as soon as the
entry exists, before anything is collected, showing empty states rather than nothing.

**Done when** the person knows whether they need a token, a backfill, or nothing at all.

## Bootstrap

If step 1 said bootstrap, follow [`references/bootstrap.md`](references/bootstrap.md) instead of the
steps above, and come back to step 5 when it sends you.
