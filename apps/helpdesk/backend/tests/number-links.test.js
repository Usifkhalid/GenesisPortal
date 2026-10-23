/**
 * Links by ticket number (D146): the portal's old ticket links and emails name
 * a ticket by number or id, and the helpdesk opens either. GET
 * /api/tickets/by-number/:number turns a number into the id, for the people
 * who may see that ticket and nobody else.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createApp } from '../src/app.js';
import { createTicketWorld } from '@mg/shared/server/testing/ticket-world.js';
import { TICKET_NUMBER } from '@mg/shared/server/modules/tickets/rules.js';

const world = (options) => createTicketWorld(createApp, options);

describe('GET /api/tickets/by-number/:number', () => {
  test('gives the id to its requester and to the IT team, in any letter case', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);
    assert.match(ticket.number, TICKET_NUMBER);

    for (const who of [w.gen, w.agent, w.lead]) {
      const res = await who.get(`/api/tickets/by-number/${ticket.number}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { id: ticket.id, number: ticket.number });
    }
    const lower = await w.gen.get(`/api/tickets/by-number/${ticket.number.toLowerCase()}`);
    assert.equal(lower.body.id, ticket.id);
  });

  test('is not found for anyone else, and for a number that does not exist', async () => {
    const w = await world();
    const ticket = await w.raise(w.gen);

    assert.equal((await w.msr.get(`/api/tickets/by-number/${ticket.number}`)).status, 404);
    assert.equal((await w.gen2.get(`/api/tickets/by-number/${ticket.number}`)).status, 404);
    assert.equal((await w.gen.get('/api/tickets/by-number/IT-2026-99999')).status, 404);
  });

  test('refuses what is not a ticket number', async () => {
    const w = await world();
    for (const bad of ['42', 'IT-2026-42', 'IT-26-00042', 'IT-2026-00042-1']) {
      assert.equal((await w.gen.get(`/api/tickets/by-number/${bad}`)).status, 400, bad);
    }
  });
});
