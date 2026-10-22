/**
 * csv.js — RFC 4180 CSV: written for the exports, read for the imports.
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

/**
 * Reads CSV text into rows of cells. Quoted fields may hold commas, quotes
 * ("") and line breaks; a leading BOM and blank lines are dropped. A file
 * saved by Excel in a locale that separates with semicolons is read too.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const firstLine = source.split(/\r?\n/, 1)[0];
  const separator = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') endRow();
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
