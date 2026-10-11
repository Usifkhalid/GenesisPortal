/**
 * server.js — the process entry point. `npm run dev` runs this under
 * node --watch.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startSessionPruning } from './jobs/prune-sessions.js';
import { disconnectPrisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, auth: env.AUTH_MODE, graph: env.GRAPH_MODE },
    `MG Holding Portal listening on http://localhost:${env.PORT}`
  );
  if (app.locals.inMemory) {
    logger.warn(
      'DATABASE_URL is missing or still a placeholder: users come from prisma/seed-data.js and sessions are held in memory. Both are lost on restart.'
    );
  }
});

// Expired sessions: removed now, then hourly (jobs/prune-sessions.js).
const pruning = startSessionPruning(app.locals.sessionStore, logger);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      pruning.stop();
      await disconnectPrisma();
      process.exit(0);
    });
  });
}

// Log and exit: after an unknown failure the process state cannot be trusted,
// and App Service restarts it.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    logger.fatal({ err }, event);
    process.exit(1);
  });
}
