import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  type IMetricReader,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import type { MonthlyReport } from './types.ts'

/**
 * Optional OTLP export.
 *
 * The JSON under data/ stays the source of truth for the site, because the site is a static export
 * with no backend. This adds a second path so the same numbers can reach an observability backend,
 * which is the only way to keep agent history past the roughly 90 days that GitHub keeps artifacts.
 *
 * Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set, using the standard environment variables so it
 * points at Azure Monitor, a collector, or anything else that speaks OTLP without a code change.
 *
 * Naming note: OpenTelemetry has CI/CD and VCS semantic conventions, but they are still
 * experimental and none of them define a DORA metric. Delivery metrics are therefore emitted under
 * a clearly separate dora.* namespace rather than pretending to match a convention that does not
 * exist yet. Attributes do use the real conventions where they fit.
 */

// The CI/CD and VCS conventions are still incubating, so their constants are not exported from the
// stable entry point. The attribute keys themselves are stated here rather than imported from a
// subpath that can move between releases.
const ATTR_CICD_PIPELINE_NAME = 'cicd.pipeline.name'
const ATTR_VCS_REPOSITORY_NAME = 'vcs.repository.name'

const SERVICE_NAME = 'project-health'
const SERVICE_VERSION = '1.0.0'

export function otlpConfigured(): boolean {
  return Boolean(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  )
}

interface Sample {
  value: number
  attributes: Record<string, string | number>
}

/** Flattens one monthly report into the metric series it can support. Missing metrics emit nothing. */
function samplesFor(report: MonthlyReport): Record<string, Sample[]> {
  const base = {
    'project.id': report.project,
    [ATTR_VCS_REPOSITORY_NAME]: report.repo,
    'dora.period': `${report.period.year}-${String(report.period.month).padStart(2, '0')}`,
  }

  const series: Record<string, Sample[]> = {
    'dora.deployment.count': [],
    'dora.deployment.frequency': [],
    'dora.change_lead_time': [],
    'dora.deployment.rework_rate': [],
    'agent.token.usage': [],
    'agent.run.count': [],
    'cicd.pipeline.run.duration': [],
  }

  const frequency = report.delivery.deploymentFrequency
  if (frequency.available) {
    series['dora.deployment.count']?.push({ value: frequency.data.count, attributes: base })
    series['dora.deployment.frequency']?.push({ value: frequency.data.perWeek, attributes: base })
  }

  const leadTime = report.delivery.leadTime
  if (leadTime.available && leadTime.data.commitToProduction.available) {
    const d = leadTime.data.commitToProduction.data
    series['dora.change_lead_time']?.push({
      value: d.p50Hours * 3600,
      attributes: { ...base, quantile: 'p50' },
    })
    series['dora.change_lead_time']?.push({
      value: d.p90Hours * 3600,
      attributes: { ...base, quantile: 'p90' },
    })
  }

  const rework = report.delivery.reworkRate
  if (rework.available && rework.data.confidence !== 'none') {
    series['dora.deployment.rework_rate']?.push({ value: rework.data.rate, attributes: base })
  }

  if (report.agents.available) {
    for (const [kind, summary] of Object.entries(report.agents.data.byKind)) {
      const agentBase = { ...base, [ATTR_CICD_PIPELINE_NAME]: kind }

      series['agent.run.count']?.push({ value: summary.runs, attributes: agentBase })

      const tokenTypes: [string, number][] = [
        ['input', summary.tokens.inputTokens],
        ['output', summary.tokens.outputTokens],
        ['cache_read', summary.tokens.cacheReadTokens],
        ['cache_write', summary.tokens.cacheWriteTokens],
      ]
      for (const [type, value] of tokenTypes) {
        series['agent.token.usage']?.push({
          value,
          attributes: {
            ...agentBase,
            'token.type': type,
            'gen_ai.request.model': summary.tokens.primaryModel ?? 'unknown',
          },
        })
      }

      if (summary.executionSeconds.available) {
        series['cicd.pipeline.run.duration']?.push({
          value: summary.executionSeconds.data.p50,
          attributes: { ...agentBase, quantile: 'p50' },
        })
      }
    }
  }

  return series
}

const DESCRIPTIONS: Record<string, { unit: string; description: string }> = {
  'dora.deployment.count': {
    unit: '{deployment}',
    description: 'Production releases in the period',
  },
  'dora.deployment.frequency': {
    unit: '{deployment}/wk',
    description: 'Production releases per week',
  },
  'dora.change_lead_time': { unit: 's', description: 'Time from commit to production' },
  'dora.deployment.rework_rate': {
    unit: '1',
    description: 'Share of releases that were unplanned',
  },
  'agent.token.usage': { unit: '{token}', description: 'Tokens consumed by agent runs' },
  'agent.run.count': { unit: '{run}', description: 'Agent workflow runs in the period' },
  'cicd.pipeline.run.duration': { unit: 's', description: 'Duration of the agent execution step' },
}

export async function exportToOtlp(reports: MonthlyReport[]): Promise<void> {
  if (!otlpConfigured()) return

  const reader: IMetricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    // Nothing is collected on a timer. The run flushes once and shuts down.
    exportIntervalMillis: 2_147_483_647,
  })

  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
    }),
    readers: [reader],
  })

  const meter = provider.getMeter(SERVICE_NAME, SERVICE_VERSION)
  const collected = reports.map(samplesFor)

  for (const [name, meta] of Object.entries(DESCRIPTIONS)) {
    const gauge = meter.createObservableGauge(name, meta)
    gauge.addCallback((result) => {
      for (const series of collected) {
        for (const sample of series[name] ?? []) {
          result.observe(sample.value, sample.attributes)
        }
      }
    })
  }

  try {
    // shutdown() performs one final collection and export. Calling forceFlush() first would send
    // the same points twice and double every series in the backend.
    await provider.shutdown()
    console.log(
      `Exported ${reports.length} report(s) to ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT}`,
    )
  } catch (error) {
    // Telemetry export must never fail the collection that produced the data.
    const message = error instanceof Error ? error.message : String(error)
    console.error(`OTLP export failed, the JSON under data/ is unaffected: ${message}`)
  }
}
