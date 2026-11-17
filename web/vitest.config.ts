import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// tsconfig.json keeps JSX for Next.js to compile ("preserve"), which Vitest cannot run, so tests
// that render a component compile it with the automatic React runtime instead. `@/` is the
// tsconfig path alias the views import through.
//
// Coverage floors for the CI gate (`vitest run --coverage` in .github/workflows/ci.yml). Most of the
// views are rendered only by the static export, so the floors are low: they sit just under what the
// suite measured when the gate was added (lines 15.9%, statements 14.9%, branches 11.2%, functions
// 11.3%) and only ever move up. Raise them with every tested view, never lower one to go green.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 15, statements: 14, branches: 10, functions: 10 },
    },
  },
})
