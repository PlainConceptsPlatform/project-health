# Bootstrap a fresh instance

The order matters: a token before a collection, a collection before a backfill, and the example data
gone before anyone reads a number that is not theirs.

## 1. Take the template's configuration

```bash
cp projects.example.json projects.json
```

Change `organization` away from `your-org` in the same edit. While it says `your-org`, collection
treats the file as the untouched example and deliberately does nothing, which is correct for the
public template and wrong for an instance.

**Done when** `organization` names the real organisation.

## 2. Give the workflows a token

The App is the default: set the repository or organisation secrets `BOT_APP_ID` and
`BOT_PRIVATE_KEY`. The workflows pass them to the collector as `GITHUB_APP_ID` and
`GITHUB_APP_PRIVATE_KEY`, and mint a fresh installation token before it expires.

The App needs five repository permissions, all read: **Metadata**, **Deployments**, **Contents**,
**Issues**, **Actions**. Add **Pull requests** only for the roadmap, and the organisation permission
**Administration** only for the Actions billing report. A missing permission answers 404 rather than
403, so the collector runs a preflight and names it.

A personal token works for a first look: `GITHUB_TOKEN` or `METRICS_TOKEN` in the environment.

**Done when** the preflight in step 6 names no missing permission.

## 3. Turn on Pages

Settings → Pages → Source: **GitHub Actions**. On GitHub Enterprise Cloud, set the site to private,
so repository access is the access list.

**Done when** the `deploy-web` workflow has somewhere to publish.

## 4. Delete the example numbers

```bash
rm -rf data/checkout data/billing data/mobile
```

They are synthetic, and the site says so, but a real dashboard should not open on somebody else's
data.

**Done when** `data/` holds only `index.json` and the projects that were actually collected.

## 5. Add the first project

Return to [`../SKILL.md`](../SKILL.md) step 2. Add the first repository before the first collection,
so the run has something to measure.

## 6. Backfill, then collect

Run **Backfill metrics** for history, then **Collect metrics** daily from then on. Backfilling after
a daily collection is fine; collecting before a backfill just leaves the trend short.

**Done when** `data/<id>/<yyyy-mm>.json` exists for the months asked for, and the month file holds
more than one facet sample when more than one commit ran.

## If this instance mirrors the template

An instance that copies the code from `PlainConceptsPlatform/Project-Health` with `sync-upstream.yml`
receives only the paths that workflow lists. It copies `collector web schema package.json
pnpm-workspace.yaml pnpm-lock.yaml biome.json .nvmrc` and the four workflows, so this skill and
`AGENTS.md` do not arrive on their own. Add `AGENTS.md` and `.agents` to that list, or the skill will
exist in the template and nowhere it is used.
