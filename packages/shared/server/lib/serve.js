/**
 * serve.js — starting and stopping an app's process: the port opens once the
 * database has answered, the app's timed jobs start, and SIGTERM/SIGINT stop
 * it gracefully. Each app's backend/src/server.js calls serve().
 *
 * Migrations are never run from here: they are a separate deploy step with
 * its own database login (docs/DEPLOY.md), and the app's login cannot change
 * the schema.
 */

import { createJobLease, noLease } from './job-lease.js';
import { logger } from './logger.js';
import { disconnectPrisma, warmPrisma } from './prisma.js';

/**
 * @param {object} options
 * @param {import('express').Express} options.app  from the app's createApp()
 * @param {object} options.env  the app's environment
 * @param {object} options.telemetry  lib/telemetry.js
 * @param {string} options.title  for the "listening" line
 * @param {Record<string, unknown>} options.facts  logged with it (modes, data)
 * @param {(jobOptions: { lease: object, telemetry: object }) => { stop: () => void }[]} options.jobs
 */
export async function serve({ app, env, telemetry, title, facts, jobs: startJobs }) {
  // The port opens only once the database has answered, so "listening" (and the
  // health check that deploys and the e2e runner wait on) means ready to serve.
  if (!app.locals.inMemory) await warmPrisma(logger);

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, ...facts, telemetry: telemetry.enabled },
      `${title} listening on http://localhost:${env.PORT}`
    );
    if (app.locals.inMemory) {
      logger.warn(
        'DATABASE_URL is missing or still a placeholder: users come from seed-data.js and sessions are held in memory. Both are lost on restart.'
      );
    }
  });

  // With two app instances every job still has its timer on both, and a row
  // per job in JobLease decides which one works each round (lib/job-lease.js).
  const jobs = startJobs({
    lease: app.locals.inMemory ? noLease : createJobLease(),
    telemetry,
  });

  /**
   * Graceful shutdown. App Service sends SIGTERM before it stops or swaps an
   * instance: say "not ready" so no new traffic is routed here, stop the
   * timers, let requests in flight finish, then close the pool and leave. If
   * they have not finished within SHUTDOWN_GRACE_MS the process leaves anyway.
   */
  let stopping = false;
  async function shutdown(signal, code = 0) {
    if (stopping) return;
    stopping = true;
    app.locals.stopping = true;
    logger.info({ signal }, 'shutting down');

    const forced = setTimeout(() => {
      logger.warn('shutdown grace period over: closing open connections');
      server.closeAllConnections();
    }, env.SHUTDOWN_GRACE_MS);
    forced.unref();

    for (const job of jobs) job.stop();
    await new Promise((resolve) => {
      server.close(resolve);
      // Keep-alive connections with no request in flight would hold close() open.
      server.closeIdleConnections();
    });
    clearTimeout(forced);

    await telemetry.flush();
    await disconnectPrisma().catch((err) =>
      logger.warn({ err }, 'database pool did not close')
    );
    process.exit(code);
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => shutdown(signal));
  }

  // Log and exit: after an unknown failure the process state cannot be trusted,
  // and App Service restarts it.
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    process.on(event, (err) => {
      logger.fatal({ err }, event);
      telemetry.error(err, { event });
      telemetry.flush().finally(() => process.exit(1));
    });
  }

  return server;
}
