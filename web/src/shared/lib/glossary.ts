/**
 * Plain language explanations for the numbers on this site.
 *
 * Written for somebody who has never heard of DORA. Each entry says what the number counts, and
 * where it is useful, what to be careful about. Kept in one file so the wording stays consistent
 * between the overview and the detail pages.
 */
export const GLOSSARY = {
  deployFrequency:
    'How often finished work reaches production. Counted as distinct commits released, not as deployment records, because some repositories create several records for one release. For the current month the rate is over days elapsed so far, not the whole month.',

  leadTime:
    'How long a change waits between being written and running in production. The p50 is the middle of the range: half of changes were faster than this, half slower. Shorter usually means smaller, safer batches.',

  leadTimeIssue:
    'How long from opening an issue to that work reaching the staging environment. It starts earlier and ends earlier than production lead time, so it always looks shorter. It describes your internal flow rather than delivery speed.',

  reworkRate:
    'The share of releases that shipped a fix rather than planned work. Which label counts is configurable; a broad label such as bug includes routine backlog fixes, so read it as "releases carrying a bug fix" rather than "emergencies".',

  medianGap:
    'The typical time between one release and the next. A small gap with a large total means the releases arrive in bursts rather than steadily.',

  deployRecords:
    'How many raw deployment records GitHub holds for this period. When it is higher than the release count, one release produced several records and they were deduplicated by commit.',

  agentRuns:
    'How many times an AI agent ran on this repository, split by the kind of work it was asked to do.',

  agentTokens:
    'Tokens the agents consumed, input plus output. This is the unit of cost here; no currency conversion is applied because rates change and differ per account. A run only reports tokens if it reached the model and uploaded its record, so the total can be a floor.',

  agentTime:
    'Wall clock time inside the step that runs the agent. It is longer than the time spent waiting on the model, because it also covers tool calls, file edits and git work.',

  measured:
    'How many runs actually reported token usage. When this is below the run count, the token totals are a lower bound rather than a complete figure.',

  teamProfile:
    'The 2025 DORA report groups teams into seven profiles rather than ranking them. A profile is built from three things: throughput, stability, and how the team is doing. GitHub can measure the first two, so more than one profile usually remains possible.',

  throughput:
    'How much finished work reaches production and how quickly, combining release frequency with lead time. The lower of the two decides the band.',

  stability:
    'How often releases go wrong. It stays unknown unless a label marks releases that were genuine reactions to a production problem, because a broad bug label would make a well maintained project look unstable.',

  wellbeing:
    'How the team itself is doing: burnout, friction, satisfaction. It is measured by asking people, so it cannot be derived from a repository and always reads unknown here.',

  percentiles:
    'p50 is the middle value, p75 and p90 are the slower tail. The tail usually matters more than the middle, because that is where the frustrating cases live.',
} as const

export type GlossaryKey = keyof typeof GLOSSARY
