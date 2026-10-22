/**
 * client-ip.js — the address a request really came from, as a rate-limit key.
 *
 * Behind Azure App Service the socket belongs to Azure's front end, and the
 * client is the last entry Azure appended to X-Forwarded-For. Express reads it
 * as `req.ip` once `trust proxy` counts that one hop (TRUST_PROXY_HOPS, set in
 * app.js); entries further left were sent by the client and are never used.
 *
 * Two things still stand between `req.ip` and a usable key:
 *   - App Service writes IPv4 clients as "203.0.113.7:51234". The port changes
 *     with every connection, so a key that kept it would never count twice.
 *   - one IPv6 customer holds a whole /64 and can rotate through it at will,
 *     so IPv6 addresses are counted by their /56 (express-rate-limit's helper).
 */

import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

/** "1.2.3.4:5678" → "1.2.3.4"; "[::1]:5678" → "::1"; anything else unchanged. */
export function stripPort(address) {
  const value = String(address ?? '').trim();
  if (isIP(value)) return value;

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed && isIP(bracketed[1])) return bracketed[1];

  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (v4 && isIP(v4[1])) return v4[1];

  return value;
}

/** The client's address without a port, or '' when there is none worth trusting. */
export function clientAddress(req) {
  const address = stripPort(req.ip ?? req.socket?.remoteAddress);
  return isIP(address) ? address : '';
}

/**
 * The key requests are counted under. Everyone whose address cannot be read
 * shares one bucket: an unreadable address must not be a way around the cap.
 */
export function clientKey(req) {
  const address = clientAddress(req);
  return address ? ipKeyGenerator(address) : 'unknown';
}
