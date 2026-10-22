/**
 * request-log.js — gives every request an ID and one log line.
 *
 * The ID is generated here, returned as X-Request-Id and repeated in error
 * bodies, so a user reporting a failure can quote something that finds the
 * log line. An inbound X-Request-Id is not trusted: it would let a caller
 * write arbitrary text into the logs.
 */

import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';

import { logger } from '../lib/logger.js';

export const requestLog = pinoHttp({
  logger,
  genReqId(req, res) {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    // Static assets and the health probe would drown everything else at info.
    return req.originalUrl?.startsWith('/api/') && req.originalUrl !== '/api/health'
      ? 'info'
      : 'debug';
  },
  customProps(req) {
    return req.user ? { userId: req.user.id, companyId: req.user.companyId } : {};
  },
  serializers: {
    // Path only: query strings can carry search terms and names.
    req: (req) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
