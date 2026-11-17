import { defineConfig } from 'vitest/config'

// Coverage floors for the CI gate (`vitest run --coverage` in .github/workflows/ci.yml). They sit
// just under what the suite measured when the gate was added (lines 71.4%, statements 70.7%,
// branches 66.4%, functions 70.5%) and only ever move up: raise them when coverage rises, never
// lower one to go green.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/fixtures/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 69, statements: 68, branches: 64, functions: 68 },
    },
  },
})
