/**
 * The open-source project page of each tool the scorecard names, keyed by the name a practice
 * lists it under (the `name` of a tool in config/scorecard.json). One map, so a renamed or added
 * tool is one line. Only open-source projects with a stable canonical page are listed; any other
 * name, such as a flag like `--coverage` or a mirror's own tool, is shown as plain text.
 */
export const TOOL_LINKS: Record<string, string> = {
  // Spec
  Cucumber: 'https://github.com/cucumber',
  Gherkin: 'https://github.com/cucumber/gherkin',
  '.feature files': 'https://github.com/cucumber/gherkin',
  'Gherkin (.feature files)': 'https://github.com/cucumber/gherkin',
  Reqnroll: 'https://github.com/reqnroll/Reqnroll',
  // SpecFlow is left out: it reached end of life and its repository is gone.
  'playwright-bdd': 'https://github.com/vitalets/playwright-bdd',
  // Tests and coverage
  coverlet: 'https://github.com/coverlet-coverage/coverlet',
  ReportGenerator: 'https://github.com/danielpalme/ReportGenerator',
  'coverage-v8': 'https://github.com/vitest-dev/vitest/tree/main/packages/coverage-v8',
  Istanbul: 'https://github.com/istanbuljs/istanbuljs',
  JaCoCo: 'https://github.com/jacoco/jacoco',
  'pytest-cov': 'https://github.com/pytest-dev/pytest-cov',
  Vitest: 'https://github.com/vitest-dev/vitest',
  Jest: 'https://github.com/jestjs/jest',
  pytest: 'https://github.com/pytest-dev/pytest',
  Gradle: 'https://github.com/gradle/gradle',
  Maven: 'https://github.com/apache/maven',
  'dotnet test': 'https://github.com/dotnet/sdk',
  'go test': 'https://github.com/golang/go',
  'cargo test': 'https://github.com/rust-lang/cargo',
  'npm test': 'https://github.com/npm/cli',
  'pnpm test': 'https://github.com/pnpm/pnpm',
  'yarn test': 'https://github.com/yarnpkg/berry',
  // Mutation
  Stryker: 'https://github.com/stryker-mutator',
  // Security
  TruffleHog: 'https://github.com/trufflesecurity/trufflehog',
  Trivy: 'https://github.com/aquasecurity/trivy',
  Semgrep: 'https://github.com/semgrep/semgrep',
  // SBOM
  CycloneDX: 'https://github.com/CycloneDX',
  Syft: 'https://github.com/anchore/syft',
  'anchore/sbom-action': 'https://github.com/anchore/sbom-action',
  // Complexity and hygiene
  lizard: 'https://github.com/terryyin/lizard',
  ESLint: 'https://github.com/eslint/eslint',
  jscpd: 'https://github.com/kucherenko/jscpd',
  Knip: 'https://github.com/webpro-nl/knip',
  // Bundle size
  'size-limit': 'https://github.com/ai/size-limit',
  // Architecture
  Steiger: 'https://github.com/feature-sliced/steiger',
  ArchUnitNET: 'https://github.com/TNG/ArchUnitNET',
  NetArchTest: 'https://github.com/BenMorris/NetArchTest',
  // Code patterns
  'Meziantou.Analyzer': 'https://github.com/meziantou/Meziantou.Analyzer',
  Roslynator: 'https://github.com/dotnet/roslynator',
  'Roslyn analyzers': 'https://github.com/dotnet/roslyn-analyzers',
  // Test environment
  'OWASP ZAP': 'https://github.com/zaproxy/zaproxy',
  JMeter: 'https://github.com/apache/jmeter',
  'Lighthouse CI': 'https://github.com/GoogleChrome/lighthouse-ci',
  k6: 'https://github.com/grafana/k6',
}

/**
 * .NET: coverlet per project, merged into one Cobertura file by ReportGenerator, which also carries
 * each method's cyclomatic complexity. Web: Vitest with Istanbul coverage, and ESLint's complexity rule.
 */
const COMPLEXITY = ['coverlet', 'ReportGenerator', 'Vitest', 'Istanbul', 'ESLint']

/**
 * The platform's own gates are not tools: the scripts in PlainConceptsPlatform/agentic-workflows
 * loops/templates/quality-gates/scripts, and the facets they write, each stand for the open-source
 * tools whose output they read, by their key in TOOL_LINKS.
 */
export const PLATFORM_GATES: Record<string, string[]> = {
  // check-complexity.mjs: CC and CRAP from the merged Cobertura, Vitest's Istanbul
  // coverage-final.json and ESLint's complexity rule.
  'check-complexity': COMPLEXITY,
  'complexity gate': COMPLEXITY,
  'complexity facet': COMPLEXITY,
  // check-coverage.mjs: coverlet's Cobertura merged by ReportGenerator for the API, Vitest's v8
  // report for the web.
  'coverage facet': ['coverlet', 'ReportGenerator', 'Vitest', 'coverage-v8'],
  // check-mutation.mjs: Stryker's report.
  'mutation facet': ['Stryker'],
  // check-duplication.mjs reads jscpd; swallowed exceptions are Semgrep findings. Knip's web dead
  // code (check-dead-code.mjs) is named by the practice itself, and only once its gate is a ratchet.
  'hygiene facet': ['jscpd', 'Semgrep'],
  // check-bundle-size.mjs: size-limit with @size-limit/file over the static export's chunks.
  'bundle facet': ['size-limit'],
  // check-architecture.mjs reads Steiger's JSON; the .NET part reads the architecture tests' TRX,
  // whose library the facet names on its own.
  'architecture facet': ['Steiger'],
  // check-patterns.mjs reads the .NET build's SARIF error logs (the analyzers each repository
  // references); the facet also records the repository's own Semgrep rules.
  'patterns facet': ['Roslyn analyzers', 'Semgrep'],
  // engineering-excellence.mjs: the Trivy and Semgrep reports, and a CycloneDX SBOM.
  'security facet': ['Trivy', 'Semgrep'],
  'SBOM facet': ['CycloneDX'],
}

/** The project page of a tool, or null when it is not a known open-source project. */
export const toolLink = (name: string): string | null =>
  Object.hasOwn(TOOL_LINKS, name) ? (TOOL_LINKS[name] ?? null) : null

/**
 * The tools to show for a practice: a platform gate is replaced by the open-source tools it reads,
 * and each tool appears once, in the order first named.
 */
export const externalTools = (tools: string[]): string[] => [
  ...new Set(
    tools.flatMap((tool) =>
      Object.hasOwn(PLATFORM_GATES, tool) ? (PLATFORM_GATES[tool] ?? []) : [tool],
    ),
  ),
]
