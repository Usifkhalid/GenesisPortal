/**
 * email.js — a notification as an email, in the reader's language, wearing
 * their company's branding.
 *
 * The words are the ones the bell shows (frontend/assets/js/notification-text.js
 * over assets/i18n). The branding is the company's accent colour, derived
 * exactly as the pages derive it (accent.js), so the button's label is
 * readable on any accent. Mail clients ignore stylesheets and custom
 * properties, so the colours here are inline values by necessity; the neutrals
 * are the portal's stone scale written out.
 */

import { deriveAccent } from '../../../../frontend/assets/js/accent.js';
import { describe } from '../../../../frontend/assets/js/notification-text.js';
import { translator } from '../../lib/messages.js';

const FALLBACK_ACCENT = '#1e5aa8';
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);

/**
 * @param {object} input
 * @param {string} input.templateKey
 * @param {{ link?: string | null, vars?: object }} input.payload
 * @param {string} input.language  'en' | 'ar'
 * @param {{ nameEn: string, nameAr: string, accentColor: string }} input.company  the
 *   recipient's company
 * @param {string} input.baseUrl  the portal's public origin, no trailing slash
 * @returns {{ subject: string, html: string, text: string }}
 */
export function renderEmail({ templateKey, payload, language, company, baseUrl }) {
  const lang = language === 'ar' ? 'ar' : 'en';
  const tr = translator(lang);
  const { title, detail } = describe(templateKey, payload, lang, tr);
  const companyName = lang === 'ar' ? company.nameAr || company.nameEn : company.nameEn;
  // "#tickets/<id>" is the portal's; "/helpdesk#tickets/<id>" the IT Helpdesk's (D135).
  const path = String(payload?.link ?? '').replace(/^\//, '');
  const link = path ? `${baseUrl}/${path}` : baseUrl;
  const page = path.startsWith('helpdesk') ? 'helpdesk' : '';
  const settings = `${baseUrl}/${page}#notifications/preferences`;

  let brand;
  try {
    brand = deriveAccent(company.accentColor);
  } catch {
    brand = deriveAccent(FALLBACK_ACCENT);
  }

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const font = "'IBM Plex Sans','IBM Plex Sans Arabic',Segoe UI,Tahoma,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f2ee;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #d9d4cb;border-radius:8px;font-family:${font};color:#1c1917;">
<tr><td style="padding:14px 24px;background:${brand.fill};color:${brand.on};font-size:15px;font-weight:700;text-align:${align};">${esc(companyName)}</td></tr>
<tr><td style="padding:24px;text-align:${align};">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;font-weight:700;">${esc(title)}</h1>
${detail ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#44403c;">${esc(detail)}</p>` : ''}
<a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:${brand.fill};color:${brand.on};border-radius:6px;font-size:15px;font-weight:700;text-decoration:none;">${esc(tr('email.open'))}</a>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #d9d4cb;font-size:12px;line-height:1.6;color:#57534e;text-align:${align};">
${esc(tr('email.why'))}<br><a href="${esc(settings)}" style="color:#57534e;">${esc(tr('email.settings'))}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    title,
    detail,
    link,
    '',
    tr('email.why'),
    `${tr('email.settings')}: ${settings}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  return { subject: title, html, text };
}
