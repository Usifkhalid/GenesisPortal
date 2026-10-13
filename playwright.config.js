/**
 * Playwright — the end-to-end smoke tests in tests/e2e. `npm run test:e2e`.
 *
 * Starts its own copy of the portal on a port of its own, with mock sign-in,
 * so it never collides with `npm run dev`. It runs on the test database
 * (mgportal_test, see backend/src/config/test-db.js), created, migrated,
 * emptied and seeded before the server starts; memory when no database is
 * configured.
 *
 * Two projects, the two screens the product is built for: an HQ desktop at
 * 1440 px and a site phone at 360 px. Chromium only.
 */

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);

/** What the test servers run with; see the comments on each value. */
function serverEnv(port, extra = {}) {
  return {
    // The e2e server runs on the test database, never the development one.
    // Both halves of the command read .env themselves and resolve the same
    // test database from it (backend/src/config/env.js), so the one that is
    // emptied and seeded is the one the server then uses.
    USE_TEST_DATABASE: '1',
    PORT: String(port),
    NODE_ENV: 'development',
    AUTH_MODE: 'mock',
    GRAPH_MODE: 'mock',
    LOG_LEVEL: 'warn',
    // Text assets as production serves them, so page-weight.spec.js reports
    // what a phone would download.
    STATIC_PRECOMPRESS: process.env.E2E_PRECOMPRESS ?? 'on',
    // Every test signs in and out from one address; the real cap would trip.
    AUTH_RATE_LIMIT_MAX: '10000',
    RATE_LIMIT_MAX: '100000',
    ...extra,
  };
}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  // Every worker drives the one server and the one SQL Server on this machine.
  // At Playwright's default (half the cores, six here) the database is squeezed
  // for memory and disk and answers take seconds, so tests fail at random; three
  // keeps it responsive. Measured in session 16 (docs/DECISIONS.md D94).
  workers: Number(process.env.E2E_WORKERS ?? 3),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  // Twice the default for a test as well: the long flows (a ticket raised,
  // worked and reopened) take 20 s alone and more beside the other specs.
  timeout: 60_000,
  // Twice the default: a wait on the server is a wait on a shared database.
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    timezoneId: 'Africa/Cairo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone-360',
      use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],

  webServer: {
    command: 'node backend/scripts/prepare-test-db.js --seed && node backend/src/server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: serverEnv(PORT),
  },
});
