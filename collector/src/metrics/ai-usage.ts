import type { ScorecardConfig } from '../config.ts'
import { type AiUsage, type MetricBlock, ok, skip } from '../types.ts'

/** The fields of a /commits list entry this needs. author is the linked GitHub account, if any. */
export interface CommitLike {
  sha: string
  parents?: { sha: string }[]
  commit: { message: string }
  author?: { login: string; type?: string } | null
}

/** Name for a bot that automates with an AI model none of the configured assistants match. */
export const OTHER_AGENT = 'Other agent'

const trailers = (message: string): string[] =>
  [...message.matchAll(/^co-authored-by:\s*(.+)$/gim)].map((m) => m[1]?.trim() ?? '')

const isBot = (author: CommitLike['author']) =>
  Boolean(author && (author.type === 'Bot' || author.login.endsWith('[bot]')))

/**
 * The assistant a commit credits, or null for a commit with no AI signal.
 *
 * Two signals count: a Co-authored-by trailer naming an assistant, which is how coding assistants
 * sign the commits they help write, and a commit authored by a bot account, which is how hosted
 * agents push. Dependency bots and the Actions bot are bots but not AI, so they are excluded.
 */
export function aiAssistant(commit: CommitLike, config: ScorecardConfig['aiUsage']): string | null {
  const match = (text: string) =>
    config.assistants.find((a) => new RegExp(a.pattern, 'i').test(text))?.name ?? null

  for (const trailer of trailers(commit.commit.message)) {
    const assistant = match(trailer)
    if (assistant) return assistant
  }

  const author = commit.author
  if (author && isBot(author)) {
    const login = author.login.toLowerCase()
    if (config.excludedBots.some((bot) => login.startsWith(bot.toLowerCase()))) return null
    return match(login) ?? OTHER_AGENT
  }
  return null
}

/** Buckets are upper bounds: below the first is level 1, at or above the last is level 5. */
export function aiUsageLevel(share: number, buckets: number[]): number {
  const index = buckets.findIndex((bound) => share < bound)
  return index < 0 ? buckets.length + 1 : index + 1
}

/**
 * The share of the month's default branch commits that are AI-assisted. Merge commits are left
 * out, because they repeat commits already counted and carry no authorship of their own.
 */
export function summarizeAiUsage(
  commits: CommitLike[],
  config: ScorecardConfig['aiUsage'],
): MetricBlock<AiUsage> {
  const counted = commits.filter((c) => (c.parents?.length ?? 1) <= 1)
  if (counted.length === 0) {
    return skip('No commits reached the default branch in this period, so AI usage is not rated.')
  }

  const byAssistant: Record<string, number> = {}
  let aiCommits = 0
  for (const commit of counted) {
    const assistant = aiAssistant(commit, config)
    if (!assistant) continue
    aiCommits += 1
    byAssistant[assistant] = (byAssistant[assistant] ?? 0) + 1
  }

  const share = aiCommits / counted.length
  return ok({
    level: aiUsageLevel(share, config.buckets),
    share: Math.round(share * 1000) / 1000,
    aiCommits,
    totalCommits: counted.length,
    byAssistant,
  })
}
