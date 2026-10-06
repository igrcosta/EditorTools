import { defineConfig } from 'vitest/config';

// Unit tests are for pure logic only (limits, signatures, state machines, event queue): money and
// security rules. No UI tests, no browser.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'supabase/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
