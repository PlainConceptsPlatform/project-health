// Lighthouse CI budgets for the built dashboard (.github/workflows/ci.yml, job "Lighthouse budgets").
//
// Runs against the static export in web/out, served by lhci's own local server, so the numbers
// measure the pages `next build` produces from the demo data in data/, not GitHub Pages or the
// network. Three pages cover every layout: the overview, a project and a project month. Three runs
// per page; each category is judged on the median run, which keeps the performance score from
// flaking on a noisy runner.
//
// Budgets sit just under the baseline measured on the GitHub-hosted runner and only ratchet up.
// Never lower one to go green: fix the page.
const PAGES = [
  '/index.html',
  '/projects/checkout/index.html',
  '/projects/checkout/2026-08/index.html',
]

const median = (minScore) => ['error', { minScore, aggregationMethod: 'median-run' }]

module.exports = {
  ci: {
    collect: {
      staticDistDir: './web/out',
      url: PAGES.map((p) => `http://localhost${p}`),
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        // Measured baseline (2026-11-17, the first CI run of the pull request that added this
        // gate): the lowest page median was 0.89 for performance (the project page; the overview
        // scores 0.98), 0.96 for accessibility and best practices, 1.0 for SEO. Performance keeps
        // four points of headroom for runner noise; the rest keep one.
        'categories:performance': median(0.85),
        'categories:accessibility': median(0.95),
        'categories:best-practices': median(0.95),
        'categories:seo': median(0.95),
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: '.lighthouseci/reports',
    },
  },
}
