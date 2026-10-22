/**
 * telemetry.js — the Application Insights hook.
 *
 * Off unless APPLICATIONINSIGHTS_CONNECTION_STRING is set: then nothing is
 * imported, collected or sent, and every function here does nothing.
 *
 * When on, three things are reported, and only these (the SDK's automatic
 * collection is not switched on):
 *   requests  method, route pattern, status, duration; never the query
 *             string, a body, a cookie or a header
 *   errors    the exception behind a 5xx answer, with its request id
 *   job runs  one event per background job run: name, outcome, duration
 * A person is identified by their user id only (no name, no address).
 *
 * NOT YET RUN AGAINST AZURE. Covered by tests with a stand-in client.
 */

import { logger } from './logger.js';

const noop = Object.freeze({
  enabled: false,
  request() {},
  error() {},
  jobRun() {},
  middleware: (req, res, next) => next(),
  flush: async () => {},
});

/**
 * @param {{ APPLICATIONINSIGHTS_CONNECTION_STRING?: string }} config
 * @param {object} [client]  a stand-in for the SDK's TelemetryClient, for tests
 */
export async function createTelemetry(config, client) {
  if (!client && !config.APPLICATIONINSIGHTS_CONNECTION_STRING) return noop;

  let sdk = client;
  if (!sdk) {
    try {
      const { default: ai } = await import('applicationinsights');
      sdk = new ai.TelemetryClient(config.APPLICATIONINSIGHTS_CONNECTION_STRING);
    } catch (err) {
      // Telemetry must never be the reason the portal does not start.
      logger.warn({ err }, 'Application Insights could not be started; continuing without it');
      return noop;
    }
  }

  const safely = (work) => {
    try {
      work();
    } catch (err) {
      logger.debug({ err }, 'telemetry call failed');
    }
  };

  const telemetry = {
    enabled: true,

    request({ name, url, duration, status, requestId, userId }) {
      safely(() =>
        sdk.trackRequest({
          name,
          url,
          duration,
          resultCode: String(status),
          success: status < 500,
          properties: { requestId, ...(userId ? { userId } : {}) },
        })
      );
    },

    error(err, properties = {}) {
      safely(() =>
        sdk.trackException({
          exception: err instanceof Error ? err : new Error(String(err)),
          properties,
        })
      );
    },

    jobRun({ name, outcome, durationMs }) {
      safely(() =>
        sdk.trackEvent({ name: 'job.run', properties: { job: name, outcome, durationMs } })
      );
    },

    /** One request record per answered API request. Mounted first. */
    middleware(req, res, next) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        if (!req.originalUrl.startsWith('/api/') && !req.originalUrl.startsWith('/auth/'))
          return;
        // The route pattern ("/api/tickets/:id"), not the address: no ids, no query.
        const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : '(unmatched)';
        telemetry.request({
          name: `${req.method} ${route}`,
          url: route,
          duration: Number((process.hrtime.bigint() - started) / 1_000_000n),
          status: res.statusCode,
          requestId: req.id,
          userId: req.user?.id,
        });
      });
      next();
    },

    async flush() {
      try {
        await sdk.flush?.();
      } catch (err) {
        logger.debug({ err }, 'telemetry flush failed');
      }
    },
  };
  return telemetry;
}

export { noop as noTelemetry };
