/**
 * audit.js — the only writer of AuditLog. Every admin action calls writeAudit
 * (CLAUDE.md rule 7). The table is append-only: there is no update or delete
 * here, and lib/prisma.js refuses both on the model.
 *
 *   const before = await tx.company.findUnique({ where: { id } });
 *   const after = await tx.company.update({ where: { id }, data });
 *   await writeAudit(req, 'company.update', 'Company', before, after, { tx });
 *
 * Pass `tx` so the change and its audit row commit or roll back together.
 */

import { getPrisma } from './prisma.js';

// Never worth keeping in a snapshot, whatever table it came from.
const REDACTED_KEYS = /secret|password|token/i;

/** JSON for a before/after snapshot, or null. BigInt and Date are made safe. */
export function snapshot(value) {
  if (value == null) return null;
  return JSON.stringify(value, (key, v) => {
    if (REDACTED_KEYS.test(key)) return '[redacted]';
    return typeof v === 'bigint' ? v.toString() : v;
  });
}

/**
 * @param {import('express').Request} req  supplies the actor and the IP
 * @param {string} action  dotted verb, e.g. 'company.update'
 * @param {string} entity  model name, e.g. 'Company'
 * @param {object | null} before  the row before the change; null on create
 * @param {object | null} after  the row after the change; null on delete
 * @param {object} [options]
 * @param {string} [options.entityId]  defaults to the row's id
 * @param {string | null} [options.companyId]  defaults to the row's companyId
 *   (or its id, for a Company); null marks a holding-wide change
 * @param {object} [options.tx]  a Prisma transaction client
 */
export async function writeAudit(req, action, entity, before, after, options = {}) {
  const row = after ?? before ?? {};
  const db = options.tx ?? (await getPrisma());

  const companyId =
    options.companyId !== undefined
      ? options.companyId
      : (row.companyId ?? (entity === 'Company' ? row.id : null) ?? null);

  return db.auditLog.create({
    data: {
      actorId: req?.user?.id ?? null,
      companyId,
      action,
      entity,
      entityId: options.entityId ?? (row.id != null ? String(row.id) : null),
      before: snapshot(before),
      after: snapshot(after),
      ip: req?.ip ?? null,
    },
  });
}
