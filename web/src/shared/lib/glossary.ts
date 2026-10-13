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

  percentiles:
    'p50 is the middle value, p75 and p90 are the slower tail. The tail usually matters more than the middle, because that is where the frustrating cases live.',

  coverage:
    'The share of lines that the test suite executes, across every scope the repository measures. It says what ran, not what was checked: a test that asserts nothing still covers the lines it touches.',

  mutationScore:
    'Mutation testing changes the code in small ways and checks that some test fails. The covered score counts only the changes that tests reach, so it measures how well the tests that run actually assert. It is usually collected weekly, because it is slow.',

  crap: 'CRAP combines cyclomatic complexity with coverage: complexity squared times the uncovered share cubed, plus complexity. Above 30 a method is both complicated and poorly tested, which makes it risky to change.',

  vulnerabilities:
    'Known vulnerabilities in dependencies reported by Trivy, counting only critical and high severity. Findings without a fix yet are included, because they still describe exposure.',

  complexityDebt:
    'Methods over the complexity or CRAP limit that the repository has accepted into a baseline rather than fix at once. Its gate blocks any new one, so this count should only fall. New violations and justified exemptions are shown underneath.',

  duplication:
    'The share of source lines that sit inside a copy-pasted block, as found by a clone detector with the minimum size shown. Both copies count. Tests, generated code and migrations are left out. Some duplication is harmless; a rising share usually means helpers were copied rather than reused.',

  swallowedExceptions:
    'Empty catch blocks, which hide a failure instead of handling it. Justified ones carry an inline reason, such as a best-effort cleanup, and are counted separately. "n/a" means the scanner produced no result, not zero.',

  deadCode:
    'Unused private members, locals and parameters. When the repository makes them build errors the count is held at zero by its CI, which is what "gated" means.',

  commentDensity:
    'Comment-only lines per line of code. It is a rough, line-based measure, so it is shown for its trend only: a sudden jump can mean comments that restate the code.',

  commentSlop:
    'Comments that are noise by their shape alone: decorative banners, #region labels, TODOs with no issue, doc comments that only repeat the member name, filler return docs, commented-out code and apologetic notes. Where the repository gates them, a change may not add any beyond its baseline.',

  duplicationDebt:
    'Duplicated lines the repository has accepted into a baseline rather than remove at once. Its gate fails a change that adds a clone or grows a baselined file, so this count should only fall.',

  sbomComponents:
    'Every third party component in the software bill of materials, across all ecosystems. More components mean more surface to keep patched; the licence mix says what obligations ship with them.',

  finalEnvironment:
    'The furthest environment the application has deployed to successfully. Each deployment environment is matched to the Azure resource group it deploys to (infra/<env>.env or the AZURE_RG / AZURE_RESOURCE_GROUP variable), and the group name says PRO or PRE. Without a resource group, the environment name decides. Not deployed means no deployment has ever succeeded.',

  engineeringLevel:
    'A cumulative level where only green gates count. L1: secrets, vulnerability and SAST gates green and tests present. L2: L1 plus tests and coverage, Gherkin specs and the SBOM green. L3: L2 plus mutation, DAST and complexity green where they apply. Anything less is L0.',

  engineeringScore:
    'Green practices plus half the yellow ones, over every practice that applies, from 0 to 100. Not-applicable practices are left out rather than counted against the project.',

  gates:
    'Gates in place, green or yellow, out of the gates that apply to this project, on every build and after deploying to the test environment. A gate that runs report-only still counts as present here; its colour says it is weaker than standard.',

  aiUsage:
    "The share of this month's default branch commits that are AI-assisted: a Co-authored-by trailer naming an assistant, or a commit by an agent bot. Dependency and Actions bots are not counted. Under 10% is 1, under 25% is 2, under 50% is 3, under 75% is 4, anything above is 5.",

  scorecardSource:
    'Facet means the repository published an engineering excellence facet and its verdict decided the colour. Detected means the tool was found in a workflow on the default branch, and the latest run of that workflow decided it.',

  roadmapAgentShare:
    'Of all the time the issues on this page were open, the share an agent was actually working on one. The rest is waiting: for a person, for a merge, or for nobody in particular. Wall clock, so nights and weekends count.',

  roadmapOpenedToMerged:
    'From opening an issue to merging the pull request that closed it, wall clock. The middle value of the issues merged in the period, so one slow issue does not move it much.',

  roadmapStalls:
    'How many times an agent run gave up and handed the issue to a person (the stalled label), plus attempts the workflow reported as ended early and retried.',

  roadmapWaiting:
    'Open issues whose latest state is waiting for a person: a question from the agent, a review, or a stalled run.',
} as const

export type GlossaryKey = keyof typeof GLOSSARY
