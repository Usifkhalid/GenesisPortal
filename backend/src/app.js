/**
 * app.js — builds the Express application. No listening happens here, so tests
 * can drive the app with supertest without binding a port.
 *
 * Shape: request ID and log line, security headers, compression, rate limits,
 * API routes under /api, then the static frontend, then the 404 and error
 * handlers. The frontend is plain files with no build step, so this server is
 * the only thing that has to run.
 */

import compression from 'compression';
import express from 'express';
import helmet from 'helmet';

import { FRONTEND_DIR, isProduction } from './config/env.js';
import { apiNotFound, errorHandler, pageNotFound } from './middleware/errors.js';
import { apiLimiter, authLimiter } from './middleware/rate-limit.js';
import { requestLog } from './middleware/request-log.js';

/**
 * @param {object} [options]
 * @param {{ windowMs?: number, limit?: number }} [options.rateLimit]  /api cap, for tests
 * @param {{ windowMs?: number, limit?: number }} [options.authRateLimit]  /api/auth cap, for tests
 * @param {(app: import('express').Express) => void} [options.routes]  extra routes, for tests
 */
export function createApp(options = {}) {
  const app = express();

  // Behind Azure App Service's proxy: needed for correct protocol detection on
  // Secure cookies and for rate limiting by real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // First, so that every later failure has an ID and a log line.
  app.use(requestLog);

  app.use(
    helmet({
      // The frontend sets a handful of custom properties through style
      // attributes, which helmet's default style-src already permits; scripts
      // are all external modules, so script-src stays 'self' with no inline
      // allowance.
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          scriptSrc: ["'self'"],
          // Nothing is loaded from outside: helmet's default allowance of any
          // https: origin for stylesheets is dropped.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      // Set only over HTTPS in production; a dev value would pin localhost.
      strictTransportSecurity: isProduction,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Site staff are on weak mobile connections: text assets and JSON go out
  // compressed. Fonts and images are already compressed and are skipped by
  // the library's content-type filter.
  app.use(compression());

  app.use('/api', apiLimiter(options.rateLimit));
  app.use('/api/auth', authLimiter(options.authRateLimit));

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Module routers mount here as they are built:
  //   app.use('/api/announcements', announcementRoutes);
  options.routes?.(app);

  app.use(apiNotFound);

  app.use(
    express.static(FRONTEND_DIR, {
      extensions: ['html'],
      // Fingerprinted asset names do not exist yet, so assets are revalidated
      // rather than held; site staff on weak connections still get 304s.
      maxAge: isProduction ? '1h' : 0,
    })
  );

  app.use(pageNotFound);
  app.use(errorHandler);

  return app;
}
