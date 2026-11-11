import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDataDir } from './paths'

/**
 * The collector writes `$PROJECT_HEALTH_DATA_DIR/data/`. If the web read the variable differently, a
 * pipeline that sets it once for both would store months the site never shows.
 */
describe('resolveDataDir', () => {
  const config = join('/repo', 'project-health')
  const files =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path)

  it('reads data/ under the config folder when the variable is unset', () => {
    expect(resolveDataDir({}, config, files())).toBe(join(config, 'data'))
  })

  it('reads data/ under the variable, as the collector writes it', () => {
    const root = join('/store')
    const exists = files(join(root, 'data', 'index.json'))
    expect(resolveDataDir({ PROJECT_HEALTH_DATA_DIR: root }, config, exists)).toBe(
      join(root, 'data'),
    )
  })

  it('still accepts a variable that points at the data folder itself', () => {
    const legacy = join('/store', 'data')
    const exists = files(join(legacy, 'index.json'))
    expect(resolveDataDir({ PROJECT_HEALTH_DATA_DIR: legacy }, config, exists)).toBe(legacy)
  })

  it('prefers the collector layout before anything has been collected', () => {
    const root = join('/store')
    expect(resolveDataDir({ PROJECT_HEALTH_DATA_DIR: root }, config, files())).toBe(
      join(root, 'data'),
    )
  })
})
