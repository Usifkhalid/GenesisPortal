/**
 * routes.js — the rooms module's HTTP surface. See docs/API.md.
 *
 * For every signed-in person:
 *   GET    /api/rooms?capacity=&equipment=&floor=
 *   GET    /api/rooms/availability?date=&view=day|week&roomId=&capacity=&equipment=&floor=
 *   GET    /api/rooms/find?date=&start=&duration=&people=&equipment=
 *   GET    /api/rooms/:id
 *   GET    /api/rooms/:id/photo
 *
 *   POST   /api/bookings                 book, once or as a series
 *   GET    /api/bookings/mine            my upcoming bookings
 *   GET    /api/bookings/:id
 *   PATCH  /api/bookings/:id             subject or time of one occurrence
 *   POST   /api/bookings/:id/cancel      { scope: one | series }
 *
 * For administrators:
 *   GET    /api/admin/bookings           HoldingAdmin all, CompanyAdmin their companies
 *   GET    /api/admin/rooms              HoldingAdmin from here down
 *   GET    /api/admin/rooms/mailboxes
 *   POST   /api/admin/rooms
 *   PATCH  /api/admin/rooms/:id
 *   PUT    /api/admin/rooms/:id/photo    raw PNG, JPEG or WebP, 2 MB
 *   DELETE /api/admin/rooms/:id/photo
 *
 * An administrator changes or cancels someone's booking through the same
 * /api/bookings routes as its organiser; the service audits it.
 */

import express, { Router } from 'express';

import { ROLES } from '@mg/shared/server/lib/roles.js';
import { requireRole } from '@mg/shared/server/middleware/auth.js';
import { MAX_PHOTO_BYTES } from './rules.js';
import {
  adminBookingQuery,
  availabilityQuery,
  bookingCancelBody,
  bookingCreateBody,
  bookingUpdateBody,
  concurrencyQuery,
  findQuery,
  idParam,
  roomCreateBody,
  roomListQuery,
  roomUpdateBody,
} from './schema.js';

const { HOLDING_ADMIN, COMPANY_ADMIN } = ROLES;

/** @param {ReturnType<import('./service.js').createRoomService>} service */
export function roomRoutes(service) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await service.listRooms(req, roomListQuery.parse(req.query)));
  });

  router.get('/availability', async (req, res) => {
    res.json(await service.availability(req, availabilityQuery.parse(req.query)));
  });

  router.get('/find', async (req, res) => {
    res.json(await service.findFree(req, findQuery.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getRoom(req, id));
  });

  // The address carries a version (?v=), so the browser may keep the bytes.
  router.get('/:id/photo', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const photo = await service.readPhoto(req, id);
    res
      .set('Cache-Control', 'private, max-age=31536000, immutable')
      .set('Content-Security-Policy', "default-src 'none'")
      .type(photo.type)
      .send(photo.buffer);
  });

  return router;
}

/** @param {ReturnType<import('./service.js').createRoomService>} service */
export function bookingRoutes(service) {
  const router = Router();

  router.post('/', async (req, res) => {
    res.status(201).json(await service.book(req, bookingCreateBody.parse(req.body)));
  });

  router.get('/mine', async (req, res) => {
    res.json(await service.myBookings(req));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getBooking(req, id));
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateBooking(req, id, bookingUpdateBody.parse(req.body)));
  });

  router.post('/:id/cancel', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.cancelBooking(req, id, bookingCancelBody.parse(req.body ?? {})));
  });

  return router;
}

/** @param {ReturnType<import('./service.js').createRoomService>} service */
export function adminBookingRoutes(service) {
  const router = Router();
  router.use(requireRole(HOLDING_ADMIN, COMPANY_ADMIN));

  router.get('/', async (req, res) => {
    res.json(await service.listBookingsAdmin(req, adminBookingQuery.parse(req.query)));
  });

  return router;
}

/** @param {ReturnType<import('./service.js').createRoomService>} service */
export function adminRoomRoutes(service) {
  const router = Router();
  router.use(requireRole(HOLDING_ADMIN));

  router.get('/', async (req, res) => {
    res.json(await service.listRoomsAdmin(req));
  });

  router.get('/mailboxes', async (req, res) => {
    res.json(await service.listMailboxes(req));
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.createRoom(req, roomCreateBody.parse(req.body)));
  });

  router.patch('/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateRoom(req, id, roomUpdateBody.parse(req.body)));
  });

  router.put(
    '/:id/photo',
    // Any content type: the file's own signature decides what it is.
    express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }),
    async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { updatedAt } = concurrencyQuery.parse(req.query);
      res.json(await service.setPhoto(req, id, req.body, updatedAt));
    }
  );

  router.delete('/:id/photo', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { updatedAt } = concurrencyQuery.parse(req.query);
    res.json(await service.removePhoto(req, id, updatedAt));
  });

  return router;
}
