/**
 * team-members.js — sets the IT team's members by email, from people who are
 * already in the database (`npm run db:live:setup -- --it-leads … --it-members …`).
 *
 * It adds people and changes a role; it never removes anyone (removing is the
 * HoldingAdmin's screen, `DELETE /api/admin/it-team/...`). Every email must be
 * an active user: if any is not, nothing is written. Each change is one
 * audit row, with the same actions and shape as the admin screen's
 * (`helpdesk.member.add`, `helpdesk.member.update`). The result and the errors
 * carry counts only, never an email.
 */

import { writeAudit } from '../../lib/audit.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, B@x.com" → ['a@x.com', 'b@x.com'], lower-cased, no repeats. */
export function parseEmails(value) {
  const list = String(value ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const bad = list.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new Error(`${bad.length} value(s) are not email addresses.`);
  return [...new Set(list)];
}

/** `--it-leads a,b --it-members c` (or `--flag=value`) → { leads, members }. */
export function parseTeamArgs(args) {
  const read = (flag) => {
    const values = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === flag) values.push(args[++i]);
      else if (args[i].startsWith(`${flag}=`)) values.push(args[i].slice(flag.length + 1));
    }
    return values.length ? parseEmails(values.join(',')) : null;
  };
  return { leads: read('--it-leads'), members: read('--it-members') };
}

const snapshot = (m) => ({ teamId: m.teamId, userId: m.userId, role: m.role });

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {{ teamId: string, leads?: string[] | null, members?: string[] | null }} input
 * @returns {Promise<{ added: number, changed: number, unchanged: number }>}
 */
export async function setItMembers(db, { teamId, leads, members }) {
  const wanted = [
    ...(leads ?? []).map((email) => ({ email, role: 'Lead' })),
    ...(members ?? []).map((email) => ({ email, role: 'Agent' })),
  ];
  if (new Set(wanted.map((w) => w.email)).size !== wanted.length) {
    throw new Error('A person is in both --it-leads and --it-members.');
  }

  const people = [];
  let unknown = 0;
  for (const w of wanted) {
    const user = await db.userProfile.findFirst({ where: { email: w.email } });
    if (user?.isActive) people.push({ ...w, userId: user.id });
    else unknown += 1;
  }
  if (unknown) {
    throw new Error(
      `${unknown} of ${wanted.length} email(s) are not active users. Nothing was changed.`
    );
  }

  // Taking the last active Lead down to Agent would leave nobody to assign tickets.
  const current = await db.supportTeamMember.findMany({ where: { teamId } });
  const after = new Map(current.map((m) => [m.userId, m.role]));
  for (const p of people) after.set(p.userId, p.role);
  let activeLeads = 0;
  for (const [userId, role] of after) {
    if (role !== 'Lead') continue;
    const user = await db.userProfile.findFirst({ where: { id: userId } });
    if (user?.isActive) activeLeads += 1;
  }
  if (people.length && !activeLeads) {
    throw new Error('The team needs at least one active lead. Nothing was changed.');
  }

  const counts = { added: 0, changed: 0, unchanged: 0 };
  const run = (fn) => (db.$transaction ? db.$transaction(fn) : fn(db));
  await run(async (tx) => {
    for (const p of people) {
      const existing = current.find((m) => m.userId === p.userId);
      if (existing?.role === p.role) {
        counts.unchanged += 1;
        continue;
      }
      const row = existing
        ? await tx.supportTeamMember.update({
            where: { id: existing.id },
            data: { role: p.role },
          })
        : await tx.supportTeamMember.create({
            data: { teamId, userId: p.userId, role: p.role },
          });
      await writeAudit(
        null,
        existing ? 'helpdesk.member.update' : 'helpdesk.member.add',
        'SupportTeamMember',
        existing ? snapshot(existing) : null,
        snapshot(row),
        { tx, companyId: null, entityId: row.id }
      );
      counts[existing ? 'changed' : 'added'] += 1;
    }
  });
  return counts;
}
