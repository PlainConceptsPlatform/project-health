import { defineConfig } from 'vitest/config'

// tsconfig.json keeps JSX for Next.js to compile ("preserve"), which Vitest cannot run, so tests
// that render a component compile it with the automatic React runtime instead.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
})
