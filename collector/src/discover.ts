import { type Deployment, get, paginate } from './github.ts'

/**
 * Inspects a repository and prints a projects.json entry for it.
 *
 * Adding a project is otherwise a research task: which environment counts as production, whether
 * releases are tags or branches, which label means "a person must look at this". Those answers
 * differ per repository and getting one wrong produces a metric that is quietly meaningless, for
 * example flagging every release as out of process because the ref pattern assumed tags.
 *
 * This reads the repository and proposes an answer for each. It writes nothing.
 */

interface Repo {
  full_name: string
  visibility: string
}

const SEMVER = /^v?\d+\.\d+\.\d+$/

export async function discover(repo: string): Promise<void> {
  const meta = await get<Repo>(`/repos/${repo}`)
  if (!meta) {
    console.error(`Cannot read ${repo}. Check the name and that the token can see it.`)
    process.exitCode = 1
    return
  }

  const envs =
    (
      await get<{ environments: { name: string }[] }>(`/repos/${repo}/environments?per_page=100`)
    )?.environments?.map((e) => e.name) ?? []

  const labels =
    (await get<{ name: string }[]>(`/repos/${repo}/labels?per_page=100`))?.map((l) => l.name) ?? []

  const workflows =
    (
      await get<{ workflows: { name: string; path: string }[] }>(
        `/repos/${repo}/actions/workflows?per_page=100`,
      )
    )?.workflows ?? []

  // Production is whichever of these the repository actually has. The name is not standardised.
  const production = ['pro', 'production', 'prod'].find((n) => envs.includes(n)) ?? null
  const staging = ['pre', 'staging', 'stage'].find((n) => envs.includes(n)) ?? null

  let refPattern = '^v[0-9]+[.][0-9]+[.][0-9]+$'
  let refNote = 'no production deployments yet, assuming semver tags'
  let productionCount = 0

  if (production) {
    const deployments = await paginate<Deployment>(
      `/repos/${repo}/deployments?environment=${encodeURIComponent(production)}&per_page=100`,
      2,
    )
    productionCount = new Set(deployments.map((d) => d.sha)).size
    const refs = [...new Set(deployments.map((d) => d.ref))]
    const tagged = refs.filter((r) => SEMVER.test(r)).length

    if (refs.length > 0 && tagged === 0) {
      // Some repositories deploy branches and never tag. Assuming tags would flag every release as
      // out of process, so the in-process ref becomes the branch they actually deploy.
      const branch = refs.includes('main') ? 'main' : (refs[0] as string)
      refPattern = `^${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
      refNote = `deploys branches, never tags (saw ${refs.slice(0, 3).join(', ')})`
    } else if (refs.length > 0) {
      refNote = `${tagged} of ${refs.length} distinct refs look like semver tags`
    }
  }

  const status =
    production && productionCount > 0 ? 'production' : staging ? 'pre-production' : 'planned'

  const router = workflows.find((w) => w.path.includes('work-router'))
  // Agents hand issues over with these labels; without them the roadmap has nothing to read.
  const handover = ['bot-working', 'pr-pending'].filter((l) => labels.includes(l))

  const entry = {
    id: repo.split('/')[1]?.toLowerCase(),
    name: repo.split('/')[1],
    repo,
    enabled: true,
    status,
    environments: { production, staging },
    productionRefPattern: refPattern,
    workItemLabel: labels.includes('implement') ? 'implement' : null,
    reworkLabel: labels.includes('hotfix') ? 'hotfix' : labels.includes('bug') ? 'bug' : 'bug',
    reworkLabelPrecision: labels.includes('hotfix') ? 'incident' : 'broad',
    agents: { enabled: Boolean(router), workflow: router ? router.path : null },
    ...(handover.length > 0 ? { roadmap: { enabled: true } } : {}),
    notes: '',
  }

  console.log(`\n${repo} (${meta.visibility})\n`)
  console.log(`  environments      ${envs.length > 0 ? envs.join(', ') : 'none'}`)
  console.log(`  production        ${production ?? 'none found'}  (${productionCount} releases)`)
  console.log(`  staging           ${staging ?? 'none found'}`)
  console.log(`  ref pattern       ${refPattern}`)
  console.log(`                    ${refNote}`)
  console.log(`  work item label   ${entry.workItemLabel ?? 'none, issue to staging not measured'}`)
  console.log(
    `  rework label      ${entry.reworkLabel} (${entry.reworkLabelPrecision})${
      entry.reworkLabelPrecision === 'broad'
        ? ', so it is reported but does not place the project on the stability axis'
        : ''
    }`,
  )
  console.log(`  agents            ${router ? router.path : 'no router workflow found'}`)
  console.log(
    `  roadmap           ${
      handover.length > 0
        ? `labels ${handover.join(', ')} found, issue journeys collected`
        : 'no bot-working or pr-pending label, not collected'
    }`,
  )
  console.log(`  status            ${status}`)
  console.log('\nPaste into projects.json:\n')
  console.log(`${JSON.stringify(entry, null, 2)}\n`)

  if (status === 'planned') {
    console.log('Nothing is measurable yet, so it will be listed but never collected.\n')
  }
}
