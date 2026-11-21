/**
 * Search and filters for the Delivery tab's tables. Both live in the query (?rq=&unplanned=1 for
 * releases, ?runq= for agent runs), so a shared link opens on the same rows.
 */
import { matchesSearch } from './list-filter'
import type { AgentRun, Release } from './types'

export interface ReleaseFilter {
  query: string
  unplannedOnly: boolean
}

const releaseText = (r: Release) =>
  [
    r.ref,
    r.sha,
    r.deployedBy ?? '',
    r.unplanned ? 'unplanned' : '',
    r.outOfProcess ? 'not a tag' : '',
  ].join(' ')

export function filterReleases(releases: Release[], filter: ReleaseFilter): Release[] {
  return releases.filter(
    (r) => (!filter.unplannedOnly || r.unplanned) && matchesSearch(releaseText(r), filter.query),
  )
}

const runText = (r: AgentRun) =>
  [
    String(r.runId),
    r.kind,
    r.workflow,
    r.issueNumber ? `#${r.issueNumber}` : '',
    r.actor ?? '',
  ].join(' ')

export const filterRuns = (runs: AgentRun[], query: string): AgentRun[] =>
  runs.filter((r) => matchesSearch(runText(r), query))

/** Runs shown at first and added by every "Show more". */
export const RUNS_PAGE = 60
