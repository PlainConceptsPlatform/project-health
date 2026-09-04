import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { repoRoot } from './config.ts'
import { exportToOtlp } from './otel.ts'
import type { MonthlyReport } from './types.ts'

const received: unknown[] = []
const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c as Buffer))
  req.on('end', () => {
    try {
      received.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    } catch {
      received.push({ url: req.url, body: '<unparseable>' })
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
})

await new Promise<void>((r) => server.listen(4318, r))
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

const reports: MonthlyReport[] = []
for (const p of ['numa', 'atlas', 'signal']) {
  for (const m of ['2026-07', '2026-08']) {
    try {
      reports.push(JSON.parse(readFileSync(join(repoRoot, 'data', p, `${m}.json`), 'utf8')))
    } catch {}
  }
}
console.log(`feeding ${reports.length} reports`)
await exportToOtlp(reports)
await new Promise((r) => setTimeout(r, 800))
server.close()

for (const entry of received as { url: string; body: any }[]) {
  console.log(`POST ${entry.url}`)
  const rm = entry.body?.resourceMetrics?.[0]
  console.log('  resource:', JSON.stringify(rm?.resource?.attributes))
  for (const sm of rm?.scopeMetrics ?? []) {
    for (const metric of sm.metrics ?? []) {
      const pts = metric.gauge?.dataPoints ?? []
      console.log(`  ${metric.name} [${metric.unit}] points=${pts.length}`)
      if (pts[0]) {
        const attrs = Object.fromEntries(
          (pts[0].attributes ?? []).map((a: any) => [
            a.key,
            a.value?.stringValue ?? a.value?.intValue ?? a.value?.doubleValue,
          ]),
        )
        console.log(
          `    sample value=${pts[0].asDouble ?? pts[0].asInt} attrs=${JSON.stringify(attrs)}`,
        )
      }
    }
  }
}
if (received.length === 0) console.log('NOTHING RECEIVED')
