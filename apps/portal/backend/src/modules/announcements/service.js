/**
 * service.js — the announcements module's rules, apart from HTTP and storage.
 *
 * Readers see published, unexpired posts for their own company and holding-wide
 * posts; nothing else, whatever the client asks for. Admins write: a
 * CompanyAdmin for the companies they administer, a HoldingAdmin for any
 * company or holding-wide. Every write is one transaction holding the change
 * and its audit row (lib/audit.js).
 *
 * Errors a form can act on carry a stable code (docs/API.md):
 *   stale_record, title_required, language_incomplete, cover_alt_required,
 *   expiry_before_publish, expiry_in_past, not_a_draft, unsupported_image,
 *   cover_too_large, empty_upload, unknown_company.
 */

import { randomUUID } from 'node:crypto';

import {
  plainText,
  renderMarkdown,
  sanitizeMarkdown,
} from '@mg/shared/web/assets/js/markdown.js';
import { writeAudit } from '@mg/shared/server/lib/audit.js';
import { detectImage } from '@mg/shared/server/lib/image-type.js';
import { logger } from '@mg/shared/server/lib/logger.js';
import { silentNotify } from '@mg/shared/server/lib/notify.js';
import {
  adminCompanyIdsFor,
  assertCompanyAdmin,
  assertHoldingAdmin,
  requireUser,
} from '@mg/shared/server/lib/scope.js';
import { HttpError } from '@mg/shared/server/middleware/errors.js';
import { MAX_COVER_BYTES, completeLanguages, isLive, statusOf } from './rules.js';

/** A pinned post is announced only while it is this new. */
const PINNED_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

const notFound = () => new HttpError(404, 'not_found');
const stale = () =>
  new HttpError(
    409,
    'stale_record',
    'This announcement was changed by someone else. Reload it.'
  );

const SUMMARY_FALLBACK_CHARS = 160;
const LANGS = ['En', 'Ar'];

const clean = (value) => sanitizeMarkdown(value);

/** The summary an author wrote, or the start of the body when there is none. */
function effectiveSummary(row, L) {
  const written = row[`summary${L}`];
  if (written) return written;
  const text = plainText(row[`body${L}`]);
  return text.length > SUMMARY_FALLBACK_CHARS
    ? `${text.slice(0, SUMMARY_FALLBACK_CHARS - 1).trimEnd()}…`
    : text;
}

const authorView = (a) =>
  a ? { id: a.id, displayNameEn: a.displayNameEn, displayNameAr: a.displayNameAr } : null;

/** What a reader's card needs. The storage key never leaves the server. */
function readerItem(row, isRead) {
  const languages = completeLanguages(row);
  return {
    id: row.id,
    companyId: row.companyId,
    company: row.company,
    category: row.category,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    summaryEn: effectiveSummary(row, 'En'),
    summaryAr: effectiveSummary(row, 'Ar'),
    coverUrl: row.coverUrl,
    coverAltEn: row.coverAltEn,
    coverAltAr: row.coverAltAr,
    isPinned: row.isPinned,
    publishAt: row.publishAt,
    expiresAt: row.expiresAt,
    author: authorView(row.author),
    languages,
    isRead,
  };
}

function readerDetail(row, isRead) {
  return {
    ...readerItem(row, isRead),
    bodyHtmlEn: renderMarkdown(row.bodyEn),
    bodyHtmlAr: renderMarkdown(row.bodyAr),
  };
}

function adminItem(row, now, stats) {
  const languages = completeLanguages(row);
  return {
    id: row.id,
    companyId: row.companyId,
    company: row.company,
    category: row.category,
    status: statusOf(row, now),
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    summaryEn: row.summaryEn,
    summaryAr: row.summaryAr,
    coverUrl: row.coverUrl,
    coverAltEn: row.coverAltEn,
    coverAltAr: row.coverAltAr,
    isPinned: row.isPinned,
    publishAt: row.publishAt,
    expiresAt: row.expiresAt,
    author: authorView(row.author),
    languages,
    translationMissing: { en: !languages.en, ar: !languages.ar },
    readStats: stats ?? { read: 0, audience: 0 },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const adminDetail = (row, now, stats) => ({
  ...adminItem(row, now, stats),
  bodyEn: row.bodyEn,
  bodyAr: row.bodyAr,
});

/** The fields of a row worth keeping in an audit snapshot. */
const snapshot = (row, now) => ({
  companyId: row.companyId,
  status: statusOf(row, now),
  category: row.category,
  titleEn: row.titleEn,
  titleAr: row.titleAr,
  summaryEn: row.summaryEn,
  summaryAr: row.summaryAr,
  bodyEn: row.bodyEn,
  bodyAr: row.bodyAr,
  coverUrl: row.coverUrl,
  coverAltEn: row.coverAltEn,
  coverAltAr: row.coverAltAr,
  isPinned: row.isPinned,
  publishAt: row.publishAt,
  expiresAt: row.expiresAt,
});

const toDate = (value) => (value == null ? null : new Date(value));

/**
 * Throws a 400 a form can act on when the row, as it would be saved, breaks a
 * rule. `checkExpiry`: the dates are being set now (not merely carried along
 * by an edit of an already expired post).
 */
function validate(row, now, { checkExpiry }) {
  const hasTitle = { En: Boolean(row.titleEn), Ar: Boolean(row.titleAr) };
  if (!hasTitle.En && !hasTitle.Ar) {
    throw new HttpError(400, 'title_required', 'Give the announcement a title.');
  }

  const languages = completeLanguages(row);
  if (row.publishAt && !languages.en && !languages.ar) {
    throw new HttpError(
      400,
      'language_incomplete',
      'At least one language needs a title and a body before this can go out.'
    );
  }

  if (row.coverKey) {
    const missing = LANGS.filter((L) => hasTitle[L] && !row[`coverAlt${L}`]).map((L) =>
      L.toLowerCase()
    );
    if (missing.length > 0) {
      throw new HttpError(
        400,
        'cover_alt_required',
        'Describe the cover image in each language that has a title.',
        { languages: missing }
      );
    }
  }

  if (row.expiresAt && row.publishAt && row.expiresAt <= row.publishAt) {
    throw new HttpError(400, 'expiry_before_publish', 'It must expire after it is published.');
  }
  if (checkExpiry && row.publishAt && row.expiresAt && row.expiresAt <= now) {
    throw new HttpError(400, 'expiry_in_past', 'The expiry time has already passed.');
  }
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store-prisma.js').createPrismaAnnouncementStore>} deps.store
 * @param {ReturnType<import('@mg/shared/server/lib/storage.js').createLocalStorage>} deps.storage
 * @param {() => Date} [deps.now]
 * @param {(userIds: string[], key: string, data?: object) => Promise<object>} [deps.notify]
 *   see lib/notify.js
 * @param {{ warn: Function }} [deps.log]
 */
export function createAnnouncementService({
  store,
  storage,
  now = () => new Date(),
  notify = silentNotify,
  log = logger,
}) {
  /* ---------------------------------------------------------- pinned alert */

  /**
   * A pinned announcement that has gone live tells everyone it reaches, once
   * (the key is per announcement, so a later edit or a second sweep tells
   * nobody twice). Only recent posts are announced: a pin on something that
   * has been up for days is not news. The author is not told about their own.
   */
  async function tellPinned(row, at) {
    if (!row?.isPinned || !row.publishAt || row.publishAt > at) return 0;
    if (at.getTime() - row.publishAt.getTime() > PINNED_WINDOW_MS) return 0;
    if (row.expiresAt && row.expiresAt <= at) return 0;
    try {
      const ids = (await store.audienceUserIds(row.companyId)).filter(
        (id) => id !== row.authorId
      );
      const sent = await notify(ids, 'announcement.pinned', {
        link: `#announcements/${row.id}`,
        dedupeKey: `announcement:${row.id}`,
        title: { en: row.titleEn || row.titleAr, ar: row.titleAr || row.titleEn },
        summary: {
          en: row.summaryEn || row.summaryAr || '',
          ar: row.summaryAr || row.summaryEn || '',
        },
      });
      return sent.inApp + sent.email;
    } catch (err) {
      log.warn({ err, announcementId: row.id }, 'pinned announcement notification failed');
      return 0;
    }
  }

  /**
   * The job: pinned posts that went live on a schedule are announced when
   * their time comes. Returns how many people were told.
   */
  async function notifyPinned() {
    const at = now();
    const rows = await store.listPinnedLiveSince({
      since: new Date(at.getTime() - PINNED_WINDOW_MS),
      now: at,
    });
    let told = 0;
    for (const row of rows) told += await tellPinned(row, at);
    return told;
  }

  /* --------------------------------------------------------------- readers */

  const visibleToReader = (row, user, at) =>
    row && isLive(row, at) && (row.companyId === null || row.companyId === user.companyId);

  async function listForReader(req, { category, unread, page, pageSize }) {
    const user = requireUser(req);
    const at = now();
    const base = { companyId: user.companyId, userId: user.id, now: at };
    const [list, unreadCount] = await Promise.all([
      store.listVisible({
        ...base,
        category,
        unread,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      store.countUnread(base),
    ]);
    return {
      items: list.items.map((row) => readerItem(row, row.isRead)),
      total: list.total,
      page,
      pageSize,
      unreadCount,
    };
  }

  async function unreadCount(req) {
    const user = requireUser(req);
    return {
      count: await store.countUnread({
        companyId: user.companyId,
        userId: user.id,
        now: now(),
      }),
    };
  }

  /** Opening a post marks it read for this person, once. */
  async function getForReader(req, id) {
    const user = requireUser(req);
    const row = await store.getRow(id);
    if (!visibleToReader(row, user, now())) throw notFound();

    await store.markRead({ userId: user.id, companyId: user.companyId, announcementId: id });
    return readerDetail(row, true);
  }

  /* ---------------------------------------------------------------- scope */

  /**
   * The row, once the person may manage it. A post of a company they cannot
   * reach is a 404; one they can read but not run (holding-wide, for a
   * company admin) is a 403.
   */
  async function managedRow(req, id) {
    const row = await store.getRow(id);
    if (!row) throw notFound();
    if (row.companyId === null) assertHoldingAdmin(req);
    else assertCompanyAdmin(req, row.companyId);
    return row;
  }

  async function assertAudience(req, companyId) {
    if (companyId === null) return assertHoldingAdmin(req);
    assertCompanyAdmin(req, companyId);
    if (!(await store.getCompany(companyId))) {
      throw new HttpError(400, 'unknown_company', 'That company does not exist.');
    }
  }

  async function withStats(rows) {
    const stats = await store.audienceCounts(rows);
    const at = now();
    return rows.map((row) => adminItem(row, at, stats.get(row.id)));
  }

  /* ---------------------------------------------------------------- admin */

  async function listForAdmin(req, { status, category, companyId, page, pageSize }) {
    const allowed = adminCompanyIdsFor(req);
    let audience;
    if (companyId === 'holding') {
      audience =
        allowed === null
          ? { companyIds: [], holdingWide: true }
          : { companyIds: [], holdingWide: false };
    } else if (companyId) {
      const ok = allowed === null || allowed.includes(companyId);
      audience = { companyIds: ok ? [companyId] : [], holdingWide: false };
    } else {
      audience = allowed === null ? { all: true } : { companyIds: allowed, holdingWide: false };
    }

    const list = await store.listAdmin({
      audience,
      status,
      category,
      now: now(),
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: await withStats(list.items), total: list.total, page, pageSize };
  }

  async function getForAdmin(req, id) {
    const row = await managedRow(req, id);
    const stats = await store.audienceCounts([row]);
    return adminDetail(row, now(), stats.get(id));
  }

  /** Content fields from a request, cleaned, as columns. */
  function contentPatch(body) {
    const patch = {};
    for (const key of ['titleEn', 'titleAr', 'summaryEn', 'summaryAr', 'bodyEn', 'bodyAr']) {
      if (body[key] !== undefined) patch[key] = clean(body[key]);
    }
    for (const key of ['coverAltEn', 'coverAltAr']) {
      if (body[key] !== undefined) patch[key] = clean(body[key]);
    }
    for (const key of ['category', 'isPinned']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    for (const key of ['publishAt', 'expiresAt']) {
      if (body[key] !== undefined) patch[key] = toDate(body[key]);
    }
    return patch;
  }

  async function create(req, body) {
    const user = requireUser(req);
    await assertAudience(req, body.companyId);

    const at = now();
    const data = {
      companyId: body.companyId,
      authorId: user.id,
      titleEn: '',
      titleAr: '',
      summaryEn: '',
      summaryAr: '',
      bodyEn: '',
      bodyAr: '',
      category: 'General',
      coverAltEn: '',
      coverAltAr: '',
      isPinned: false,
      publishAt: null,
      expiresAt: null,
      ...contentPatch(body),
    };
    validate(data, at, { checkExpiry: true });

    return store.transaction(async (tx) => {
      const created = await tx.create(data);
      await writeAudit(
        req,
        'announcement.create',
        'Announcement',
        null,
        snapshot(created, at),
        {
          tx,
          entityId: created.id,
          companyId: created.companyId,
        }
      );
      return adminDetail(created, at, { read: 0, audience: 0 });
    });
  }

  async function update(req, id, { updatedAt, companyId, ...changes }) {
    const existing = await managedRow(req, id);
    if (companyId !== undefined && companyId !== existing.companyId) {
      await assertAudience(req, companyId);
    }

    const at = now();
    const patch = contentPatch(changes);
    if (companyId !== undefined) patch.companyId = companyId;
    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, 'nothing_to_change', 'Nothing to change.');
    }

    const merged = { ...existing, ...patch };
    validate(merged, at, {
      checkExpiry: patch.publishAt !== undefined || patch.expiresAt !== undefined,
    });

    const result = await store.transaction(async (tx) => {
      const before = await tx.getRow(id);
      if (!before) throw notFound();
      const after = await tx.update(id, patch, new Date(updatedAt));
      if (!after) throw stale();

      await writeAudit(
        req,
        'announcement.update',
        'Announcement',
        snapshot(before, at),
        snapshot(after, at),
        { tx, entityId: id, companyId: after.companyId }
      );
      const stats = await tx.audienceCounts([after]);
      return adminDetail(after, at, stats.get(id));
    });
    // Pinning a post that is already out announces it (once, whatever is edited later).
    if (patch.isPinned === true) await tellPinned(await store.getRow(id), at);
    return result;
  }

  /** Publish now, or at a given future instant. */
  async function publish(req, id, { updatedAt, publishAt }) {
    const existing = await managedRow(req, id);
    const at = now();
    const target = publishAt ? new Date(publishAt) : at;

    // Already out and no new time asked for: nothing to do.
    if (!publishAt && statusOf(existing, at) === 'Published') {
      if (new Date(updatedAt).getTime() !== new Date(existing.updatedAt).getTime())
        throw stale();
      const stats = await store.audienceCounts([existing]);
      return adminDetail(existing, at, stats.get(id));
    }

    validate({ ...existing, publishAt: target }, at, { checkExpiry: true });

    const result = await store.transaction(async (tx) => {
      const before = await tx.getRow(id);
      if (!before) throw notFound();
      const after = await tx.update(id, { publishAt: target }, new Date(updatedAt));
      if (!after) throw stale();

      await writeAudit(
        req,
        'announcement.publish',
        'Announcement',
        snapshot(before, at),
        snapshot(after, at),
        { tx, entityId: id, companyId: after.companyId }
      );
      const stats = await tx.audienceCounts([after]);
      return adminDetail(after, at, stats.get(id));
    });
    // Published pinned and already live: told now. Scheduled: the job tells them when it is time.
    await tellPinned(await store.getRow(id), at);
    return result;
  }

  /** Back to a draft. Readers lose it at once; nothing is deleted. */
  async function unpublish(req, id, updatedAt) {
    const existing = await managedRow(req, id);
    const at = now();

    if (!existing.publishAt) {
      if (new Date(updatedAt).getTime() !== new Date(existing.updatedAt).getTime())
        throw stale();
      const stats = await store.audienceCounts([existing]);
      return adminDetail(existing, at, stats.get(id));
    }

    return store.transaction(async (tx) => {
      const before = await tx.getRow(id);
      if (!before) throw notFound();
      const after = await tx.update(id, { publishAt: null }, new Date(updatedAt));
      if (!after) throw stale();

      await writeAudit(
        req,
        'announcement.unpublish',
        'Announcement',
        snapshot(before, at),
        snapshot(after, at),
        { tx, entityId: id, companyId: after.companyId }
      );
      const stats = await tx.audienceCounts([after]);
      return adminDetail(after, at, stats.get(id));
    });
  }

  /** A new draft with the same content, audience and cover. */
  async function duplicate(req, id) {
    const source = await managedRow(req, id);
    const user = requireUser(req);
    const at = now();

    let coverKey = null;
    let coverUrl = null;
    const newId = randomUUID();
    if (source.coverKey) {
      // A cover that is not (or not yet) clean is not copied: the copy starts without one.
      const bytes = await storage.get(source.coverKey).catch(() => null);
      const kind = bytes && detectImage(bytes);
      if (kind) {
        const token = randomUUID();
        coverKey = `cover-${newId}-${token}.${kind.ext}`;
        coverUrl = `/api/announcements/${newId}/cover?v=${token}`;
        await storage.put(coverKey, bytes, {
          uploadedById: user.id,
          fileName: `cover.${kind.ext}`,
          link: '#announcements/manage',
        });
      }
    }

    const suffix = { En: ' (copy)', Ar: ' (نسخة)' };
    const data = {
      id: newId,
      companyId: source.companyId,
      authorId: user.id,
      titleEn: source.titleEn ? `${source.titleEn}${suffix.En}`.slice(0, 200) : '',
      titleAr: source.titleAr ? `${source.titleAr}${suffix.Ar}`.slice(0, 200) : '',
      summaryEn: source.summaryEn,
      summaryAr: source.summaryAr,
      bodyEn: source.bodyEn,
      bodyAr: source.bodyAr,
      category: source.category,
      coverKey,
      coverUrl: coverKey ? coverUrl : null,
      coverAltEn: coverKey ? source.coverAltEn : '',
      coverAltAr: coverKey ? source.coverAltAr : '',
      isPinned: false,
      publishAt: null,
      expiresAt: null,
    };

    try {
      return await store.transaction(async (tx) => {
        const created = await tx.create(data);
        await writeAudit(
          req,
          'announcement.duplicate',
          'Announcement',
          null,
          { ...snapshot(created, at), copiedFrom: id },
          { tx, entityId: created.id, companyId: created.companyId }
        );
        return adminDetail(created, at, { read: 0, audience: 0 });
      });
    } catch (err) {
      if (coverKey) await storage.remove(coverKey);
      throw err;
    }
  }

  /** Drafts only. A post that has been out is unpublished instead. */
  async function remove(req, id) {
    const existing = await managedRow(req, id);
    if (existing.publishAt) {
      throw new HttpError(
        409,
        'not_a_draft',
        'Only drafts can be deleted. Unpublish this announcement first.'
      );
    }
    const at = now();

    await store.transaction(async (tx) => {
      const before = await tx.getRow(id);
      if (!before) throw notFound();
      if (before.publishAt)
        throw new HttpError(409, 'not_a_draft', 'Only drafts can be deleted.');
      await tx.remove(id);
      await writeAudit(req, 'announcement.delete', 'Announcement', snapshot(before, at), null, {
        tx,
        entityId: id,
        companyId: before.companyId,
      });
    });

    if (existing.coverKey) await storage.remove(existing.coverKey);
    return { id };
  }

  /* ---------------------------------------------------------------- cover */

  async function setCover(req, id, buffer, updatedAt) {
    const existing = await managedRow(req, id);

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new HttpError(400, 'empty_upload', 'No file was sent.');
    }
    if (buffer.length > MAX_COVER_BYTES) {
      throw new HttpError(413, 'cover_too_large', 'The cover image is larger than 2 MB.');
    }
    const kind = detectImage(buffer);
    if (!kind) {
      throw new HttpError(
        415,
        'unsupported_image',
        'The cover must be a PNG, JPEG or WebP image.'
      );
    }

    const token = randomUUID();
    const coverKey = `cover-${id}-${token}.${kind.ext}`;
    const coverUrl = `/api/announcements/${id}/cover?v=${token}`;
    validate({ ...existing, coverKey }, now(), { checkExpiry: false });

    const at = now();
    await storage.put(coverKey, buffer, {
      uploadedById: req.user?.id,
      fileName: `cover.${kind.ext}`,
      link: '#announcements/manage',
    });
    let after;
    try {
      after = await store.transaction(async (tx) => {
        const before = await tx.getRow(id);
        if (!before) throw notFound();
        const updated = await tx.update(id, { coverKey, coverUrl }, new Date(updatedAt));
        if (!updated) throw stale();
        await writeAudit(
          req,
          'announcement.cover.update',
          'Announcement',
          snapshot(before, at),
          snapshot(updated, at),
          { tx, entityId: id, companyId: updated.companyId }
        );
        return updated;
      });
    } catch (err) {
      await storage.remove(coverKey);
      throw err;
    }

    if (existing.coverKey && existing.coverKey !== coverKey) {
      await storage.remove(existing.coverKey);
    }
    const stats = await store.audienceCounts([after]);
    return adminDetail(after, at, stats.get(id));
  }

  async function removeCover(req, id, updatedAt) {
    const existing = await managedRow(req, id);
    const at = now();
    if (!existing.coverKey) {
      const stats = await store.audienceCounts([existing]);
      return adminDetail(existing, at, stats.get(id));
    }

    const after = await store.transaction(async (tx) => {
      const before = await tx.getRow(id);
      if (!before) throw notFound();
      const updated = await tx.update(
        id,
        { coverKey: null, coverUrl: null, coverAltEn: '', coverAltAr: '' },
        new Date(updatedAt)
      );
      if (!updated) throw stale();
      await writeAudit(
        req,
        'announcement.cover.remove',
        'Announcement',
        snapshot(before, at),
        snapshot(updated, at),
        { tx, entityId: id, companyId: updated.companyId }
      );
      return updated;
    });

    await storage.remove(existing.coverKey);
    const stats = await store.audienceCounts([after]);
    return adminDetail(after, at, stats.get(id));
  }

  /** The cover's bytes, for a reader who may see the post or an admin who runs it. */
  async function readCover(req, id) {
    const user = requireUser(req);
    const row = await store.getRow(id);
    if (!row?.coverKey) throw notFound();

    let allowed = visibleToReader(row, user, now());
    if (!allowed) {
      try {
        if (row.companyId === null) assertHoldingAdmin(req);
        else assertCompanyAdmin(req, row.companyId);
        allowed = true;
      } catch {
        allowed = false;
      }
    }
    if (!allowed) throw notFound();

    const buffer = await storage.get(row.coverKey);
    const kind = buffer && detectImage(buffer);
    if (!kind) throw notFound();
    return { type: kind.type, buffer };
  }

  return {
    listForReader,
    unreadCount,
    getForReader,
    listForAdmin,
    getForAdmin,
    create,
    update,
    publish,
    unpublish,
    duplicate,
    remove,
    setCover,
    removeCover,
    readCover,
    notifyPinned,
  };
}
