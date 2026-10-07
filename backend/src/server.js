/**
 * server.js — the process entry point. `npm run dev` runs this under
 * node --watch.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './lib/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(
    `MG Holding Portal listening on http://localhost:${env.PORT}  ` +
      `(${env.NODE_ENV}, auth=${env.AUTH_MODE}, graph=${env.GRAPH_MODE})`
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
  });
}
