import { type Deployment, type DeploymentStatus, get, paginate } from '../github.ts'
import {
  type DeployedEnvironment,
  type EnvironmentTier,
  type FinalEnvironment,
  type MetricBlock,
  ok,
  skip,
} from '../types.ts'

/** Where an environment's tier was read from, strongest first. */
export type TierSource = DeployedEnvironment['source']

const PRO = new Set(['pro', 'prod', 'production', 'prd'])
const PRE = new Set(['pre', 'preprod', 'staging', 'stg', 'stage'])

/**
 * PRO or PRE from a resource group or environment name, by whole token: `numa-pro-rg-01` is PRO,
 * `Atlas-pre-rg01` is PRE, `compass` is neither. Tokens split on anything that is not a letter, so
 * `rg01` never reads as a tier.
 */
export function tierOf(name: string | null | undefined): EnvironmentTier | null {
  if (!name) return null
  const tokens = name.toLowerCase().split(/[^a-z]+/)
  if (tokens.some((t) => PRO.has(t))) return 'PRO'
  if (tokens.some((t) => PRE.has(t))) return 'PRE'
  return null
}

const RG_KEYS = ['AZURE_RG', 'AZURE_RESOURCE_GROUP', 'RESOURCE_GROUP']

/** The resource group a dotenv-style `infra/<env>.env` names, if it names one. */
export function resourceGroupFromEnvFile(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*["']?([^"'#\s]+)/)
    if (m && RG_KEYS.includes(m[1] as string)) return m[2] as string
  }
  return null
}

export interface EnvironmentSource {
  /** Every deployment record, newest first. */
  deployments: () => Promise<Deployment[]>
  statuses: (deploymentId: number) => Promise<DeploymentStatus[]>
  /** `infra/<env>.env` on the default branch, or null when absent. */
  envFile: (environment: string) => Promise<string | null>
  /** A variable's value on the environment, or null when absent or not readable. */
  environmentVariable: (environment: string, name: string) => Promise<string | null>
  repoVariable: (name: string) => Promise<string | null>
}

/** How many of an environment's newest deployments are checked for a success before giving up. */
const STATUS_PROBES = 20

async function lastSuccess(
  source: EnvironmentSource,
  deployments: Deployment[],
  until: Date,
): Promise<string | null> {
  for (const d of deployments.slice(0, STATUS_PROBES)) {
    const statuses = await source.statuses(d.id)
    const success = statuses.find((s) => s.state === 'success' && new Date(s.created_at) <= until)
    if (success) return success.created_at
  }
  return null
}

async function resourceGroup(
  source: EnvironmentSource,
  environment: string,
): Promise<string | null> {
  // An infrastructure environment (`pro-infra`) applies to the application environment's RG.
  const file =
    (await source.envFile(environment)) ??
    (environment.endsWith('-infra') ? await source.envFile(environment.slice(0, -6)) : null)
  const fromFile = file ? resourceGroupFromEnvFile(file) : null
  if (fromFile) return fromFile
  for (const key of RG_KEYS) {
    const value =
      (await source.environmentVariable(environment, key)) ?? (await source.repoVariable(key))
    if (value) return value
  }
  return null
}

/**
 * The furthest environment the application has reached: PRO when any environment with a
 * successful deployment sits in a PRO resource group, otherwise PRE. The resource group is the
 * evidence because environment names vary (production, pro, prd); without one, the name decides.
 */
export async function collectEnvironment(
  source: EnvironmentSource,
  /** End of the reported period: a backfilled month shows where the application stood then. */
  until: Date,
): Promise<MetricBlock<FinalEnvironment>> {
  const all = (await source.deployments()).filter((d) => new Date(d.created_at) <= until)
  const byName = new Map<string, Deployment[]>()
  for (const d of all) byName.set(d.environment, [...(byName.get(d.environment) ?? []), d])
  const environments: DeployedEnvironment[] = []
  for (const [name, list] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    const lastDeployedAt = await lastSuccess(source, list, until)
    if (!lastDeployedAt) continue
    const rg = await resourceGroup(source, name)
    const rgTier = tierOf(rg)
    environments.push({
      name,
      resourceGroup: rg,
      tier: rgTier ?? tierOf(name),
      source: rgTier ? 'resource-group' : 'environment-name',
      lastDeployedAt,
    })
  }
  if (environments.length === 0) {
    return skip(
      all.length === 0 ? 'No deployments recorded.' : 'No environment has a successful deployment.',
    )
  }
  const tiers = environments.map((e) => e.tier)
  const final = tiers.includes('PRO') ? 'PRO' : tiers.includes('PRE') ? 'PRE' : null
  return ok({ final, environments })
}

export const githubEnvironmentSource = (repo: string): EnvironmentSource => ({
  deployments: () => paginate<Deployment>(`/repos/${repo}/deployments?per_page=100`, 5),
  statuses: async (id) =>
    (await get<DeploymentStatus[]>(`/repos/${repo}/deployments/${id}/statuses?per_page=20`)) ?? [],
  envFile: async (environment) => {
    const content = await get<{ content?: string; encoding?: string }>(
      `/repos/${repo}/contents/infra/${encodeURIComponent(environment)}.env`,
    )
    if (!content?.content) return null
    return content.encoding === 'base64'
      ? Buffer.from(content.content, 'base64').toString('utf8')
      : content.content
  },
  // A token without the variables permission gets 403 here; that is "unknown", not a failure.
  environmentVariable: (environment, name) =>
    readVariable(
      `/repos/${repo}/environments/${encodeURIComponent(environment)}/variables/${name}`,
    ),
  repoVariable: (name) => readVariable(`/repos/${repo}/actions/variables/${name}`),
})

async function readVariable(path: string): Promise<string | null> {
  try {
    return (await get<{ value?: string }>(path))?.value ?? null
  } catch {
    return null
  }
}
