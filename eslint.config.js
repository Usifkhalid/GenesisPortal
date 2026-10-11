/**
 * ESLint flat config.
 *
 * Two environments in one repository: backend/ is Node, frontend/ is the
 * browser. Neither has a build step, so both are plain ES modules and the only
 * difference is which globals exist.
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
      'backend/generated/**',
      'coverage/**',
      '.impeccable/**',
      'playwright-report/**',
      'test-results/**',
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
    files: ['backend/**/*.js'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['frontend/**/*.js'],
    languageOptions: { globals: globals.browser },
  },

  {
    // Playwright: Node, with callbacks that run inside the page.
    files: ['tests/e2e/**/*.js', 'playwright.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  prettier,
];
