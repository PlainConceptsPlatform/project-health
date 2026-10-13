import { describe, expect, it } from 'vitest'
import type { Deployment, DeploymentStatus } from './github.ts'
import {
  type EnvironmentSource,
  collectEnvironment,
  resourceGroupFromEnvFile,
  tierOf,
} from './metrics/environment.ts'

const UNTIL = new Date('2026-10-31T23:59:59Z')

let nextId = 1
const deployment = (environment: string, created = '2026-10-01T10:00:00Z'): Deployment => ({
  id: nextId++,
  sha: 'abc',
  ref: 'main',
  task: 'deploy',
  environment,
  created_at: created,
})

function source(
  deployments: Deployment[],
  opts: {
    states?: Record<number, DeploymentStatus[]>
    envFiles?: Record<string, string>
    envVars?: Record<string, Record<string, string>>
    repoVars?: Record<string, string>
  } = {},
): EnvironmentSource {
  return {
    deployments: async () => deployments,
    statuses: async (id) =>
      opts.states?.[id] ?? [{ state: 'success', created_at: '2026-10-01T10:05:00Z' }],
    envFile: async (env) => opts.envFiles?.[env] ?? null,
    environmentVariable: async (env, name) => opts.envVars?.[env]?.[name] ?? null,
    repoVariable: async (name) => opts.repoVars?.[name] ?? null,
  }
}

describe('tierOf', () => {
  it('reads PRO and PRE from whole tokens of a resource group or environment name', () => {
    expect(tierOf('numa-pro-rg-01')).toBe('PRO')
    expect(tierOf('Atlas-pre-rg01')).toBe('PRE')
    expect(tierOf('sd-worx-pro-rg-01')).toBe('PRO')
    expect(tierOf('production')).toBe('PRO')
    expect(tierOf('staging')).toBe('PRE')
    expect(tierOf('compass-rg-01')).toBeNull()
    expect(tierOf('github-pages')).toBeNull()
    // "prometheus" contains "pro" but is not the token pro.
    expect(tierOf('prometheus-rg')).toBeNull()
    expect(tierOf(null)).toBeNull()
  })
})

describe('resourceGroupFromEnvFile', () => {
  it('takes the first resource group key and ignores comments and quotes', () => {
    expect(
      resourceGroupFromEnvFile('# PRE\nLOCATION=westeurope\nAZURE_RG="numa-pre-rg-01" # rg\n'),
    ).toBe('numa-pre-rg-01')
    expect(resourceGroupFromEnvFile('export AZURE_RESOURCE_GROUP=pliny-pre-rg-01')).toBe(
      'pliny-pre-rg-01',
    )
    expect(resourceGroupFromEnvFile('APP_NAME=x\n')).toBeNull()
  })
})

describe('collectEnvironment', () => {
  it('is PRO when any reached environment sits in a PRO resource group', async () => {
    const block = await collectEnvironment(
      source([deployment('pro'), deployment('pre')], {
        envFiles: { pre: 'AZURE_RG=numa-pre-rg-01', pro: 'AZURE_RG=numa-pro-rg-01' },
      }),
      UNTIL,
    )
    expect(block).toMatchObject({
      available: true,
      data: {
        final: 'PRO',
        environments: [
          { name: 'pre', resourceGroup: 'numa-pre-rg-01', tier: 'PRE', source: 'resource-group' },
          { name: 'pro', resourceGroup: 'numa-pro-rg-01', tier: 'PRO', source: 'resource-group' },
        ],
      },
    })
  })

  it('stays PRE when the PRO environment never deployed successfully', async () => {
    const pro = deployment('pro')
    const block = await collectEnvironment(
      source([pro, deployment('pre')], {
        states: { [pro.id]: [{ state: 'failure', created_at: '2026-10-01T10:05:00Z' }] },
        envFiles: { pre: 'AZURE_RG=compass-pre-rg-01', pro: 'AZURE_RG=compass-pro-rg-01' },
      }),
      UNTIL,
    )
    expect(block.available && block.data.final).toBe('PRE')
    expect(block.available && block.data.environments.map((e) => e.name)).toEqual(['pre'])
  })

  it('lets the resource group decide over the environment name, then falls back to the name', async () => {
    const block = await collectEnvironment(
      source([deployment('production'), deployment('github-pages')], {
        repoVars: { AZURE_RESOURCE_GROUP: 'sd-worx-pre-rg-01' },
      }),
      UNTIL,
    )
    // The repo variable applies to both environments, so both read PRE from the RG.
    expect(block.available && block.data.final).toBe('PRE')

    const named = await collectEnvironment(source([deployment('production')]), UNTIL)
    expect(named).toMatchObject({
      available: true,
      data: { final: 'PRO', environments: [{ resourceGroup: null, source: 'environment-name' }] },
    })
  })

  it('reads an infrastructure environment from its application environment file', async () => {
    const block = await collectEnvironment(
      source([deployment('pro-infra')], { envFiles: { pro: 'AZURE_RG=atlas-pro-rg-01' } }),
      UNTIL,
    )
    expect(block.available && block.data.environments[0]).toMatchObject({
      resourceGroup: 'atlas-pro-rg-01',
      source: 'resource-group',
    })
  })

  it('prefers an environment variable over the repository variable', async () => {
    const block = await collectEnvironment(
      source([deployment('pro')], {
        envVars: { pro: { AZURE_RG: 'janus-pro-rg-01' } },
        repoVars: { AZURE_RG: 'janus-pre-rg-01' },
      }),
      UNTIL,
    )
    expect(block.available && block.data.environments[0]?.resourceGroup).toBe('janus-pro-rg-01')
  })

  it('ignores deployments after the period, so a backfilled month shows where it stood then', async () => {
    const block = await collectEnvironment(
      source([deployment('pro', '2026-11-03T09:00:00Z'), deployment('pre')], {
        envFiles: { pro: 'AZURE_RG=atlas-pro-rg-01', pre: 'AZURE_RG=Atlas-pre-rg01' },
      }),
      UNTIL,
    )
    expect(block.available && block.data.final).toBe('PRE')
  })

  it('is unavailable with no successful deployment, and says why', async () => {
    expect(await collectEnvironment(source([]), UNTIL)).toEqual({
      available: false,
      reason: 'No deployments recorded.',
    })
    const failed = deployment('pre')
    expect(
      await collectEnvironment(
        source([failed], {
          states: { [failed.id]: [{ state: 'error', created_at: '2026-10-01T10:05:00Z' }] },
        }),
        UNTIL,
      ),
    ).toEqual({ available: false, reason: 'No environment has a successful deployment.' })
  })
})
