/**
 * csv.js — RFC 4180 CSV for the audit export.
 *
 * Every field is quoted. A field that starts with = + - @ or a control
 * character would be read as a formula by a spreadsheet, and audit rows hold
 * text people typed, so it is prefixed with an apostrophe to stay text.
 * A BOM leads the file so Excel reads the Arabic as UTF-8.
 */

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

function field(value) {
  let text = value == null ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** @param {unknown[][]} rows */
export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}
