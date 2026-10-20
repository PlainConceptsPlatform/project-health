// Copies the evidence screenshots the collector stored beside each project's data into public/,
// so the static export serves them from the dashboard's own origin. Resolves the data folder the
// way src/shared/lib/data.ts does, so a build against private data finds its screenshots too.
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const configRoot = process.env.PROJECT_HEALTH_CONFIG_DIR ?? join(process.cwd(), '..')
const dataDir = process.env.PROJECT_HEALTH_DATA_DIR ?? join(configRoot, 'data')
const target = join(process.cwd(), 'public', 'evidence')

rmSync(target, { recursive: true, force: true })
let projects = 0
for (const project of existsSync(dataDir) ? readdirSync(dataDir) : []) {
  const source = join(dataDir, project, 'evidence')
  if (!existsSync(source)) continue
  cpSync(source, join(target, project), { recursive: true })
  projects += 1
}
console.log(`Copied evidence screenshots for ${projects} project(s).`)
