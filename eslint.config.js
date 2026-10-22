/**
 * ESLint flat config.
 *
 * Two environments in one repository: each app's backend/ and
 * packages/shared/server are Node; each app's frontend/ and
 * packages/shared/web are the browser. Neither has a build step, so both are
 * plain ES modules and the only difference is which globals exist.
 *
 * Formatting is Prettier's job; eslint-config-prettier switches off the rules
 * that would disagree with it.
 */

import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      '**/generated/**',
      '**/coverage/**',
      '.impeccable/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  js.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    files: ['apps/*/backend/**/*.js', 'packages/shared/server/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/*/frontend/**/*.js', 'packages/shared/web/**/*.js'],
    languageOptions: { globals: globals.browser },
  },

  {
    // Playwright: Node, with callbacks that run inside the page.
    files: [
      'apps/*/tests/e2e/**/*.js',
      'apps/*/playwright.config.js',
      'packages/shared/e2e/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  prettier,
];
