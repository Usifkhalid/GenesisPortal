/**
 * pages/administration/companies.js — the companies whose people may use the
 * IT Helpdesk, and their mail domains (GET/POST/PATCH /api/admin/companies).
 * A person signs in to a company by their email's domain, so a company that
 * is missing here, or inactive, has no way in. Every change is audited.
 */

import { api } from '../../api.js';
import { icon } from '../../components/icons.js';
import { loadFailedNotice } from '../../components/notice.js';
import { showToast } from '../../components/toast.js';
import { formatNumber } from '../../format.js';
import { applyCss, esc } from '../../html.js';
import { t } from '../../i18n.js';
import { editRecord } from '../tickets/config.js';
import { errorText } from '../tickets/shared.js';

const CODES = ['code_taken', 'domain_taken', 'accent_not_accessible', 'stale_record'];
/** A field the server refused, and what to say about it. */
const FIELD_ERRORS = {
  code: 'code_invalid',
  domains: 'domains_invalid',
  accentColor: 'accent_invalid',
};

/** What a failed save says: the company's own words where there are some. */
function companyError(err) {
  if (CODES.includes(err?.code)) return t(`hdApp.companies.error.${err.code}`);
  if (err?.code === 'validation_failed' && Array.isArray(err.details)) {
    const bad = err.details
      .map((d) => FIELD_ERRORS[String(d.path).split('.')[0]])
      .find(Boolean);
    if (bad) return t(`hdApp.companies.error.${bad}`);
  }
  return errorText(err);
}

/** "a.eg\n b.eg ,c.eg" → ['a.eg', 'b.eg', 'c.eg'] */
const domainList = (text) =>
  String(text)
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

const statusBadge = (isActive) =>
  isActive
    ? `<span class="badge badge--success">${esc(t('admin.status.active'))}</span>`
    : `<span class="badge">${esc(t('admin.status.inactive'))}</span>`;

const nameOf = (c) => (document.documentElement.lang === 'ar' ? c.nameAr : c.nameEn);

/** The fields of the form; the code only when adding. */
function fields({ adding }) {
  const list = [];
  if (adding) {
    list.push({
      key: 'code',
      label: t('hdApp.companies.code'),
      help: t('hdApp.companies.codeHelp'),
      required: true,
      maxlength: 5,
      dir: 'ltr',
    });
  }
  list.push(
    { key: 'nameEn', label: t('hdApp.companies.nameEn'), required: true, dir: 'ltr' },
    { key: 'nameAr', label: t('hdApp.companies.nameAr'), required: true, dir: 'rtl' },
    {
      key: 'domains',
      label: t('hdApp.companies.domains'),
      help: t('hdApp.companies.domainsHelp'),
      kind: 'textarea',
      rows: 3,
      maxlength: 1300,
      required: true,
      dir: 'ltr',
    },
    {
      key: 'accentColor',
      label: t('hdApp.companies.accent'),
      help: t('hdApp.companies.accentHelp'),
      required: true,
      maxlength: 7,
      dir: 'ltr',
    }
  );
  if (!adding)
    list.push({ key: 'isActive', label: t('hdApp.companies.active'), kind: 'checkbox' });
  return list;
}

/** @param {HTMLElement} root */
export async function render(root) {
  let items;
  try {
    ({ items } = await api('/api/admin/companies', { quiet: true }));
  } catch {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root));
    return;
  }

  root.innerHTML = `<section class="card stack">
    <div class="tk-config__head">
      <div><h2 class="card__title">${esc(t('hdApp.admin.companies'))}</h2>
      <p class="tk-config__help">${esc(t('hdApp.companies.lead'))}</p></div>
      <button type="button" class="btn btn--primary btn--sm" data-add>
        ${icon('plus', 'btn__icon')}<span class="btn__label">${esc(t('hdApp.companies.add'))}</span>
      </button>
    </div>
    ${
      items.length
        ? `<div class="table-wrap" data-density="compact" tabindex="0" role="region"
            aria-label="${esc(t('hdApp.admin.companies'))}"><table class="table"><thead><tr>
            <th scope="col">${esc(t('hdApp.companies.code'))}</th>
            <th scope="col">${esc(t('tk.cfg.name'))}</th>
            <th scope="col">${esc(t('hdApp.companies.domains'))}</th>
            <th scope="col">${esc(t('hdApp.companies.people'))}</th>
            <th scope="col">${esc(t('hdApp.companies.status'))}</th>
            <th scope="col"><span class="u-visually-hidden">${esc(t('admin.field.actions'))}</span></th>
          </tr></thead><tbody>
          ${items
            .map(
              (c) => `<tr>
                <td data-label="${esc(t('hdApp.companies.code'))}">
                  <span class="hd-swatch" data-css="background-color:${esc(c.accentColor)}"></span>
                  <span class="admin-code">${esc(c.code)}</span></td>
                <td data-label="${esc(t('tk.cfg.name'))}">${esc(nameOf(c))}</td>
                <td data-label="${esc(t('hdApp.companies.domains'))}"><ul class="hd-domains">
                  ${c.domains.map((d) => `<li><bdi dir="ltr">${esc(d)}</bdi></li>`).join('')}</ul></td>
                <td data-label="${esc(t('hdApp.companies.people'))}">${esc(formatNumber(c.userCount))}</td>
                <td data-label="${esc(t('hdApp.companies.status'))}">${statusBadge(c.isActive)}</td>
                <td class="admin-actions"><button type="button" class="btn btn--secondary btn--sm"
                  data-edit="${esc(c.id)}"><span class="btn__label">${esc(t('action.edit'))}</span>
                  </button></td></tr>`
            )
            .join('')}
          </tbody></table></div>`
        : `<div class="empty empty--inline">${icon('blankLabel', 'empty__mark')}
            <div class="empty__copy"><p class="empty__title">${esc(t('hdApp.companies.none'))}</p></div></div>`
    }
  </section>`;
  applyCss(root);

  root.querySelector('[data-add]').addEventListener('click', async () => {
    let added = null;
    const saved = await editRecord({
      title: t('hdApp.companies.add'),
      fields: fields({ adding: true }),
      values: { accentColor: '#1c7a4a' },
      errorMessage: companyError,
      save: async (v) => {
        added = await api('/api/admin/companies', {
          method: 'POST',
          quiet: true,
          body: {
            code: v.code.toUpperCase(),
            nameEn: v.nameEn,
            nameAr: v.nameAr,
            domains: domainList(v.domains),
            accentColor: v.accentColor.toLowerCase(),
          },
        });
      },
    });
    if (!saved) return;
    showToast({
      tone: 'success',
      titleKey: 'tk.cfg.saved',
      text: t('hdApp.companies.added', { name: nameOf(added) }),
    });
    render(root);
  });

  for (const button of root.querySelectorAll('[data-edit]')) {
    button.addEventListener('click', async () => {
      const company = items.find((c) => c.id === button.dataset.edit);
      let after = null;
      const saved = await editRecord({
        title: t('hdApp.companies.edit', { name: nameOf(company) }),
        fields: fields({ adding: false }),
        values: { ...company, domains: company.domains.join('\n') },
        errorMessage: companyError,
        save: async (v) => {
          after = await api(`/api/admin/companies/${encodeURIComponent(company.id)}`, {
            method: 'PATCH',
            quiet: true,
            body: {
              updatedAt: company.updatedAt,
              nameEn: v.nameEn,
              nameAr: v.nameAr,
              domains: domainList(v.domains),
              accentColor: v.accentColor.toLowerCase(),
              isActive: v.isActive,
            },
          });
        },
      });
      if (!saved) return;
      showToast({
        tone: 'success',
        titleKey: 'tk.cfg.saved',
        text: t('hdApp.companies.saved', { name: nameOf(after) }),
      });
      render(root);
    });
  }
}
