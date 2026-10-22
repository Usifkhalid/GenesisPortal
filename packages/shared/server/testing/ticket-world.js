/**
 * ticket-world.js — an app with the seeded fake people signed in, a clock the
 * test moves, and short-hands for raising and working tickets. Either app's
 * tests build one: createTicketWorld(createApp).
 *
 * Who is signed in (seed-data.js): a HoldingAdmin, two CompanyAdmins who are
 * not on the IT team, two Genesis users and two Masar users, and the IT
 * team's lead and two agents (all three at the holding).
 */

import assert from 'node:assert/strict';

import { createMemoryStorage } from '../lib/storage.js';
import { createMemoryUserRepo } from '../modules/auth/repo-memory.js';
import { cairo, signIn } from './clients.js';

export const DEV = { NODE_ENV: 'development', AUTH_MODE: 'mock' };

/** Sunday 11 October 2026, 11:00 in Cairo: a working morning. */
export const SUNDAY = '2026-10-11';
export const START = cairo(SUNDAY, '11:00');

/**
 * The app on its own: memory repo and storage, the test's clock.
 * @param {(options: object) => import('express').Express} createApp
 * @param {object} [options]  more createApp options
 */
export function buildApp(createApp, options = {}) {
  const repo = createMemoryUserRepo();
  const storage = createMemoryStorage();
  const clock = { now: START };
  const app = createApp({
    config: DEV,
    userRepo: repo,
    storage,
    now: () => clock.now,
    authRateLimit: { limit: 100_000, accountLimit: 100_000 },
    rateLimit: { limit: 100_000 },
    ...options,
  });
  return { app, repo, storage, clock };
}

/**
 * @param {(options: object) => import('express').Express} createApp
 * @param {object} [options]  more createApp options
 */
export async function createTicketWorld(createApp, options) {
  const w = buildApp(createApp, options);
  const byEmail = (email) => w.repo.users.find((u) => u.email === email);
  const who = async (email) => signIn(w.app, byEmail(email));
  w.ha = await who('nadia.elsayed@mgholding.example');
  w.caGen = await who('hany.soliman@genesismining-eg.com');
  w.caMsr = await who('tarek.elmasry@masar.eg');
  w.gen = await who('salma.ibrahim@genesismining-eg.com');
  w.gen2 = await who('mahmoud.attia@genesismining-eg.com');
  w.msr = await who('yasmine.nabil@masar.eg');
  w.hq = await who('rania.farouk@masar.eg');
  w.lead = await who('omar.fahmy@mgholding.example');
  w.agent = await who('sherif.awad@mgholding.example');
  w.agent2 = await who('tamer.gad@mgholding.example');

  w.company = (code) => w.repo.companies.find((c) => c.code === code);
  w.team = w.repo.helpdesk.team[0];
  w.category = (nameEn) => w.repo.helpdesk.category.find((c) => c.nameEn === nameEn);
  w.location = (nameEn) => w.repo.helpdesk.location.find((l) => l.nameEn === nameEn);
  w.at = (ymd, hhmm) => {
    w.clock.now = cairo(ymd, hhmm);
  };

  /** Raises a ticket; "Laptop / PC" is a P3 category. */
  w.raise = async (as, body = {}) => {
    const res = await as.post('/api/tickets', {
      subject: 'Laptop will not start',
      description: 'It shows the logo and then a black screen.',
      categoryId: w.category('Laptop / PC').id,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.ticket;
  };
  w.ticket = async (as, id) => {
    const res = await as.get(`/api/tickets/${id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };
  w.change = async (as, id, body) => {
    const res = await as.patch(`/api/tickets/${id}`, body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.ticket;
  };
  w.say = async (as, id, body, isInternal = false) => {
    const res = await as.post(`/api/tickets/${id}/comments`, { body, isInternal });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  w.row = (id) => w.repo.helpdesk.ticket.find((t) => t.id === id);
  /** Gives a ticket to an agent without the event and status change an assignment makes. */
  w.give = (id, agent) => {
    w.row(id).assigneeId = agent.user.id;
  };
  return w;
}
