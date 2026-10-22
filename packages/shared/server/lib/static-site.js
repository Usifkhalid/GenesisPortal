/**
 * static-site.js — an app's static files: its own folder first, then the
 * shared one (packages/shared/web: the design system, the components and the
 * pages both apps use). A file is looked up in that order, so the browser sees
 * one tree, /assets/css/tokens.css whichever folder holds it, and the pages'
 * relative imports work unchanged. Text files are served precompressed when
 * STATIC_PRECOMPRESS is on (lib/precompressed-static.js).
 */

import express from 'express';

import { precompressedStatic } from './precompressed-static.js';

/**
 * @param {import('express').Express} app
 * @param {object} options
 * @param {string[]} options.frontendDirs  first match wins
 * @param {{ staticPrecompress: boolean }} options.config
 * @param {boolean} options.isProduction
 * @param {boolean} options.isTest
 */
export function serveFrontend(app, { frontendDirs, config, isProduction, isTest }) {
  if (config.staticPrecompress) {
    const folders = frontendDirs.map((dir) =>
      precompressedStatic(dir, {
        cacheControl: isProduction ? 'public, max-age=3600' : 'public, max-age=0',
        skip: ['/sw.js'],
      })
    );
    for (const precompressed of folders) app.use(precompressed);
    // In the background, one folder after the other: the first phone should
    // not pay for the best setting, nor wait behind two compressions at once.
    if (!isTest) {
      setImmediate(async () => {
        for (const precompressed of folders) await precompressed.warm().catch(() => {});
      });
    }
  }

  for (const dir of frontendDirs) {
    app.use(
      express.static(dir, {
        extensions: ['html'],
        // Fingerprinted asset names do not exist yet, so assets are revalidated
        // rather than held; site staff on weak connections still get 304s.
        maxAge: isProduction ? '1h' : 0,
      })
    );
  }
}
