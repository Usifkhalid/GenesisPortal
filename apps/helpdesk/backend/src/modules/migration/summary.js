/**
 * summary.js — the terminal's view of a portal migration's report
 * (from-portal.js): counts per table and per company, the ticket counters,
 * the attachments, warnings and, after a real run, the check. Counts only:
 * no names, no emails. Pure, for tests.
 */

import { TABLES } from './from-portal.js';

/** @param {object} report  migrateFromPortal()'s, with `verification` after a real run */
export function formatSummary(report, { reportPath = '' } = {}) {
  const lines = [];
  lines.push(
    report.dryRun
      ? 'Dry run: nothing was written. What a real run would do:'
      : `Copied from the portal (run ${report.runId}):`
  );
  const codes = [
    ...new Set(Object.values(report.tables).flatMap((t) => Object.keys(t.byCompany))),
  ].sort();
  const head = ['portal', 'new', 'matched', 'done', 'skipped'];
  lines.push('table'.padEnd(24) + head.map((h) => h.padStart(9)).join('') + '   per company');
  for (const table of TABLES) {
    const t = report.tables[table];
    if (!t) continue;
    const per = codes
      .filter((c) => t.byCompany[c])
      .map((c) => `${c} ${t.byCompany[c]}`)
      .join(', ');
    const reasons = Object.entries(t.reasons)
      .map(([r, n]) => `${r} ${n}`)
      .join(', ');
    lines.push(
      table.padEnd(24) +
        [t.source, t.created, t.matched, t.already, t.skipped]
          .map((n) => String(n).padStart(9))
          .join('') +
        (per ? `   ${per}` : '') +
        (reasons ? `   (skipped: ${reasons})` : '')
    );
  }
  for (const s of report.sequences) {
    lines.push(`Ticket counter ${s.prefix}-${s.year}: next number is ${s.last + 1}.`);
  }
  const a = report.attachments;
  lines.push(
    `Attachments: ${a.files} file(s), ${a.bytes} bytes` +
      (a.infected ? `, ${a.infected} blocked as infected (no file)` : '') +
      (a.missingInSource ? `, ${a.missingInSource} already missing in the portal` : '') +
      '.'
  );
  for (const w of report.warnings) lines.push(`Warning: ${w}`);
  if (report.verification) {
    const v = report.verification;
    lines.push(
      v.ok
        ? `Check passed: every table's count, all ${v.checked.ticketNumbers} ticket numbers, ` +
            `${v.checked.attachmentFiles} attachment file(s) with the same size and hash.`
        : `CHECK FAILED (${v.problems.length}):`
    );
    for (const p of v.problems) lines.push(`  ${p}`);
  }
  if (reportPath) lines.push(`Report: ${reportPath}`);
  return lines.join('\n');
}
