import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the web reads `index.json` and the month files from.
 *
 * `PROJECT_HEALTH_DATA_DIR` is the folder that contains `data/`, the same meaning the collector and
 * `facet-store` give it, so one value works for writing and for reading. The web used to read it as
 * the `data/` folder itself, which meant a pipeline that set both to the same folder wrote months the
 * site then could not find. A folder that holds `index.json` directly is still accepted, so a build
 * configured the old way keeps working.
 */
export function resolveDataDir(
  env: Record<string, string | undefined>,
  configRoot: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const root = env.PROJECT_HEALTH_DATA_DIR
  if (!root) return join(configRoot, 'data')
  const nested = join(root, 'data')
  if (!exists(join(nested, 'index.json')) && exists(join(root, 'index.json'))) return root
  return nested
}
