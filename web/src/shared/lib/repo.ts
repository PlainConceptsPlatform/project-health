/**
 * The repository this site was built from.
 *
 * GitHub Actions sets GITHUB_REPOSITORY on every run, so the public demo links to the template and a
 * private deployment links to itself with nothing to configure. NEXT_PUBLIC_REPO_URL overrides it,
 * and the template is the fallback for a local build where neither is set.
 */
const FALLBACK = 'https://github.com/PlainConceptsPlatform/Project-Health'

export function repoUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_REPO_URL
  if (explicit) return explicit.replace(/\/+$/, '')

  const slug = process.env.GITHUB_REPOSITORY
  return slug ? `https://github.com/${slug}` : FALLBACK
}

/** "owner/name", for a label short enough to sit in a header. */
export function repoSlug(): string {
  return repoUrl().replace('https://github.com/', '')
}
