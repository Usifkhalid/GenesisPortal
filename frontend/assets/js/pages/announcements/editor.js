/**
 * pages/announcements/editor.js — write or change an announcement.
 *
 * English and Arabic are tabs over one form: both languages stay in the page,
 * only one is shown. The preview beside it is drawn from the same text by the
 * same Markdown renderer the server uses (frontend/assets/js/markdown.js), in
 * the shown language's own direction. Times are entered and shown as Cairo
 * time whatever zone the device is in.
 *
 * Saving is a short sequence, so a failure in the middle leaves something
 * sensible: the text first (a draft exists from then on), then the cover, then
 * publishing. The server checks every rule again.
 */

import { ApiError, api } from '../../api.js';
import { loadFailedNotice } from '../../components/notice.js';
import {
  describedBy,
  field,
  focusFirstError,
  setBusy,
  setFieldError,
} from '../../components/form.js';
import { showToast } from '../../components/toast.js';
import { fromCairoInput, toCairoInput } from '../../format.js';
import { esc } from '../../html.js';
import { localized, t } from '../../i18n.js';
import { plainText, renderMarkdown, sanitizeMarkdown } from '../../markdown.js';
import {
  CATEGORIES,
  announceChange,
  cardHtml,
  categoryLabel,
  dirOf,
  errorText,
} from './shared.js';

const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LANGS = ['en', 'ar'];
const cap = (lang) => (lang === 'ar' ? 'Ar' : 'En');
const SUMMARY_CHARS = 160;

/** Tomorrow 09:00, Cairo, as a datetime-local value: a sensible schedule default. */
function tomorrowMorning() {
  const day = toCairoInput(new Date(Date.now() + 24 * 3_600_000));
  return `${day.slice(0, 10)}T09:00`;
}

/**
 * @param {HTMLElement} root
 * @param {{ route: import('../../router.js').Match, company: object }} ctx
 */
export async function render(root, ctx) {
  const [first, second] = ctx.route.params;
  const editingId = second === 'edit' ? first : null;

  let scope;
  let item = null;
  try {
    scope = await api('/api/admin/scope', { quiet: true });
    if (editingId) {
      item = await api(`/api/admin/announcements/${encodeURIComponent(editingId)}`, {
        quiet: true,
      });
    }
  } catch (err) {
    root.innerHTML = loadFailedNotice();
    root.querySelector('[data-retry]').addEventListener('click', () => render(root, ctx));
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      location.hash = '#announcements/manage';
    }
    return undefined;
  }

  /** The server's record as of the last save; null for a new one. */
  let current = item;
  const status = item?.status ?? 'Draft';
  const own =
    (ctx.company && scope.companies.find((c) => c.id === ctx.company.id)) ?? scope.companies[0];

  const audienceOptions = [
    ...(scope.holdingAdmin ? [{ value: '', label: t('ann.editor.audienceHolding') }] : []),
    ...scope.companies.map((c) => ({ value: c.id, label: `${c.code} · ${localized(c)}` })),
  ];
  const initialAudience = item
    ? (item.companyId ?? '')
    : scope.holdingAdmin
      ? ''
      : (own?.id ?? '');

  /* The "when" choices that make sense for where this post is. */
  const modes =
    status === 'Published'
      ? ['keep', 'draft']
      : status === 'Expired'
        ? ['keep', 'now', 'draft']
        : status === 'Scheduled'
          ? ['later', 'now', 'draft']
          : ['draft', 'now', 'later'];
  const MODE_LABEL = {
    keep: 'ann.editor.whenKeep',
    draft: status === 'Draft' ? 'ann.editor.whenDraft' : 'ann.editor.whenUnpublish',
    now: 'ann.editor.whenNow',
    later: 'ann.editor.whenLater',
  };
  const SAVE_LABEL = {
    keep: 'ann.editor.saveChanges',
    draft: 'ann.editor.saveDraft',
    now: 'ann.editor.publishNow',
    later: 'ann.editor.schedule',
  };

  let activeLang = document.documentElement.lang === 'ar' ? 'ar' : 'en';
  let pendingFile = null;
  let pendingUrl = null;
  let removeCover = false;

  const textField = (lang, name, label, control, help) =>
    field({ id: `f-${name}${cap(lang)}`, label, control, help });

  const panel = (lang) => {
    const L = cap(lang);
    const attrs = `lang="${lang}" dir="${dirOf(lang)}"`;
    return `<div class="stack" data-panel="${lang}" ${lang === activeLang ? '' : 'hidden'}>
      ${textField(
        lang,
        'title',
        t('ann.editor.title'),
        `<input class="input" id="f-title${L}" type="text" maxlength="200" ${attrs}
           value="${esc(item?.[`title${L}`] ?? '')}" aria-describedby="${describedBy(`f-title${L}`, false)}" />`
      )}
      ${textField(
        lang,
        'summary',
        t('ann.editor.summary'),
        `<textarea class="textarea" id="f-summary${L}" rows="2" maxlength="400" ${attrs}
           aria-describedby="${describedBy(`f-summary${L}`)}">${esc(item?.[`summary${L}`] ?? '')}</textarea>`,
        t('ann.editor.summaryHelp')
      )}
      ${textField(
        lang,
        'body',
        t('ann.editor.body'),
        `<textarea class="textarea ann-editor__body" id="f-body${L}" rows="12" maxlength="20000" ${attrs}
           aria-describedby="${describedBy(`f-body${L}`)}">${esc(item?.[`body${L}`] ?? '')}</textarea>`,
        t('ann.editor.bodyHelp')
      )}
    </div>`;
  };

  const langButton = (
    lang
  ) => `<button type="button" class="segmented__option" data-lang="${lang}"
      aria-pressed="${lang === activeLang}" lang="${lang}" dir="${dirOf(lang)}">
      <span>${esc(t(`ann.editor.tab.${lang}`))}</span>
      <span class="tag ann-editor__flag" data-flag="${lang}" hidden>${esc(t('ann.editor.incomplete'))}</span>
    </button>`;

  const hasCover = Boolean(item?.coverUrl);

  root.innerHTML = `<div class="stack ann ann-editor-page">
    <header class="page__header">
      <div class="page__heading">
        <h1>${esc(t(item ? 'ann.editor.editTitle' : 'ann.editor.newTitle'))}</h1>
        <p class="page__lead">${esc(t('ann.editor.lead'))}</p>
      </div>
      <div class="page__actions">
        <a class="btn btn--secondary" href="#announcements/manage">
          <span class="btn__label">${esc(t('ann.manage'))}</span>
        </a>
      </div>
    </header>

    <form class="ann-editor" id="annForm" novalidate aria-label="${esc(t('ann.editor.formLabel'))}">
      <div class="ann-editor__main stack">
        <section class="card stack" aria-labelledby="annTextHead">
          <div class="ann-editor__langhead">
            <h2 class="card__title" id="annTextHead">${esc(t('ann.editor.body'))}</h2>
            <div class="segmented" role="group" aria-label="${esc(t('ann.editor.tabs'))}">
              ${LANGS.map(langButton).join('')}
            </div>
          </div>
          ${LANGS.map(panel).join('')}
        </section>

        <section class="card stack" aria-labelledby="annCoverHead">
          <h2 class="card__title" id="annCoverHead">${esc(t('ann.editor.cover'))}</h2>
          <div class="ann-editor__cover" id="coverCurrent" ${hasCover ? '' : 'hidden'}>
            <img id="coverImg" src="${esc(item?.coverUrl ?? '')}" alt="" />
            <button type="button" class="btn btn--ghost btn--sm" id="coverRemove">
              <span class="btn__label">${esc(t('ann.editor.coverRemove'))}</span>
            </button>
          </div>
          <p class="field__help" id="coverRemoved" hidden>${esc(t('ann.editor.removeUndo'))}</p>
          ${field({
            id: 'f-cover',
            label: t('ann.editor.cover'),
            help: t('ann.editor.coverHelp'),
            control: `<input class="input" id="f-cover" type="file"
              accept="image/png,image/jpeg,image/webp" aria-describedby="${describedBy('f-cover')}" />`,
          })}
          <div class="stack" id="altFields" ${hasCover ? '' : 'hidden'}>
            ${LANGS.map((lang) =>
              field({
                id: `f-coverAlt${cap(lang)}`,
                label: t(`ann.editor.alt${cap(lang)}`),
                help: lang === 'en' ? t('ann.editor.altHelp') : '',
                control: `<input class="input" id="f-coverAlt${cap(lang)}" type="text" maxlength="300"
                  lang="${lang}" dir="${dirOf(lang)}" value="${esc(item?.[`coverAlt${cap(lang)}`] ?? '')}"
                  aria-describedby="${describedBy(`f-coverAlt${cap(lang)}`, lang === 'en')}" />`,
              })
            ).join('')}
          </div>
        </section>

        <section class="card stack" aria-labelledby="annSettingsHead">
          <h2 class="card__title" id="annSettingsHead">${esc(t('ann.editor.audience'))}</h2>
          <div class="field-row">
            ${field({
              id: 'f-category',
              label: t('ann.editor.category'),
              control: `<select class="select" id="f-category" aria-describedby="${describedBy('f-category', false)}">
                ${CATEGORIES.map(
                  (c) =>
                    `<option value="${c}" ${c === (item?.category ?? 'General') ? 'selected' : ''}>${esc(
                      categoryLabel(c)
                    )}</option>`
                ).join('')}
              </select>`,
            })}
            ${field({
              id: 'f-audience',
              label: t('ann.editor.audience'),
              help: t('ann.editor.audienceHelp'),
              control: `<select class="select" id="f-audience" aria-describedby="${describedBy('f-audience')}">
                ${audienceOptions
                  .map(
                    (o) =>
                      `<option value="${esc(o.value)}" ${o.value === initialAudience ? 'selected' : ''}>${esc(
                        o.label
                      )}</option>`
                  )
                  .join('')}
              </select>`,
            })}
          </div>
          <label class="switch">
            <input class="switch__input" type="checkbox" id="f-pin" ${item?.isPinned ? 'checked' : ''} />
            <span class="switch__track"><span class="switch__knob"></span></span>
            <span class="switch__text">${esc(t('ann.editor.pin'))}</span>
          </label>
          <p class="field__help">${esc(t('ann.editor.pinHelp'))}</p>
        </section>

        <section class="card stack" aria-labelledby="annWhenHead">
          <h2 class="card__title" id="annWhenHead">${esc(t('ann.editor.when'))}</h2>
          ${
            item
              ? `<p class="field__help">${esc(t('ann.editor.statusNow'))}: <strong>${esc(
                  t(`ann.admin.status.${status}`)
                )}</strong></p>`
              : ''
          }
          <fieldset class="stack ann-editor__when">
            <legend class="u-visually-hidden">${esc(t('ann.editor.when'))}</legend>
            ${modes
              .map(
                (mode, i) => `<label class="choice">
                  <input class="choice__control" type="radio" name="when" value="${mode}" ${i === 0 ? 'checked' : ''} />
                  <span class="choice__text"><span class="choice__label">${esc(t(MODE_LABEL[mode]))}</span></span>
                </label>`
              )
              .join('')}
          </fieldset>
          <div class="field-row">
            <div id="publishAtWrap" ${modes[0] === 'later' ? '' : 'hidden'}>
              ${field({
                id: 'f-publishAt',
                label: t('ann.editor.publishAt'),
                help: t('ann.editor.expiresHelp'),
                control: `<input class="input" id="f-publishAt" type="datetime-local"
                  value="${esc(toCairoInput(item?.publishAt) || tomorrowMorning())}"
                  aria-describedby="${describedBy('f-publishAt')}" />`,
              })}
            </div>
            ${field({
              id: 'f-expiresAt',
              label: t('ann.editor.expiresAt'),
              help: t('ann.editor.expiresHelp'),
              control: `<input class="input" id="f-expiresAt" type="datetime-local"
                value="${esc(toCairoInput(item?.expiresAt))}" aria-describedby="${describedBy('f-expiresAt')}" />`,
            })}
          </div>
        </section>

        <p class="field__error" id="formError" role="alert" hidden></p>
        <div class="btn-row">
          <button type="submit" class="btn btn--primary" id="saveBtn">
            <span class="btn__label" id="saveLabel"></span>
          </button>
          <a class="btn btn--ghost" href="#announcements/manage">
            <span class="btn__label">${esc(t('ann.editor.cancel'))}</span>
          </a>
        </div>
      </div>

      <aside class="ann-editor__aside" aria-labelledby="annPreviewHead">
        <div class="card stack ann-preview">
          <h2 class="card__title" id="annPreviewHead" data-preview-title></h2>
          <div class="stack" data-preview></div>
        </div>
      </aside>
    </form>
  </div>`;

  const form = root.querySelector('#annForm');
  const $ = (id) => form.querySelector(`#${id}`);
  const value = (id) => $(id).value;
  const mode = () => form.querySelector('input[name="when"]:checked')?.value ?? modes[0];

  const completeOf = (lang) => {
    const L = cap(lang);
    return Boolean(value(`f-title${L}`).trim() && value(`f-body${L}`).trim());
  };
  const anyOf = (lang) => {
    const L = cap(lang);
    return Boolean(value(`f-title${L}`).trim() || value(`f-body${L}`).trim());
  };

  /* ---- preview */
  function drawPreview() {
    const lang = activeLang;
    const L = cap(lang);
    const title = value(`f-title${L}`).trim();
    const body = sanitizeMarkdown(value(`f-body${L}`));
    const written = sanitizeMarkdown(value(`f-summary${L}`));
    const text = plainText(body);
    const summary =
      written || (text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS - 1)}…` : text);
    const coverVisible = !removeCover && (pendingUrl || item?.coverUrl);
    const audienceId = value('f-audience');
    const company = scope.companies.find((c) => c.id === audienceId) ?? null;

    const preview = {
      id: 'preview',
      category: value('f-category'),
      isPinned: $('f-pin').checked,
      isRead: true,
      coverUrl: coverVisible ? pendingUrl || current?.coverUrl || item?.coverUrl : null,
      languages: { en: completeOf('en'), ar: completeOf('ar') },
      company,
      publishAt: new Date().toISOString(),
      [`title${L}`]: title,
      [`summary${L}`]: summary,
      [`coverAlt${L}`]: value(`f-coverAlt${L}`),
    };

    form.querySelector('[data-preview-title]').textContent = t('ann.editor.previewIn', {
      language: t(`ann.lang.${lang}`),
    });
    const target = form.querySelector('[data-preview]');
    const empty = !title && !body;
    target.innerHTML = empty
      ? `<p class="field__help" lang="${lang}" dir="${dirOf(lang)}">${esc(t('ann.editor.previewEmpty'))}</p>`
      : `<p class="u-microlabel">${esc(t('ann.editor.previewCard'))}</p>
         <ul class="ann-grid ann-grid--one">${cardHtml(preview, { preview: true, lang })}</ul>
         <p class="u-microlabel">${esc(t('ann.editor.previewPage'))}</p>
         <article class="ann-preview__page" lang="${lang}" dir="${dirOf(lang)}">
           <h3 class="ann-preview__title">${esc(title)}</h3>
           <div class="prose">${renderMarkdown(body)}</div>
         </article>`;
  }

  function drawFlags() {
    const bothSet = completeOf('en') || completeOf('ar');
    for (const lang of LANGS) {
      const flag = form.querySelector(`[data-flag="${lang}"]`);
      // Said only when it matters: something is typed but it cannot stand alone.
      flag.hidden = !(anyOf(lang) && !completeOf(lang) && (bothSet || mode() !== 'draft'));
    }
  }

  function drawMode() {
    const current_ = mode();
    form.querySelector('#publishAtWrap').hidden = current_ !== 'later';
    $('saveLabel').textContent = t(SAVE_LABEL[current_]);
  }

  function showLang(lang) {
    activeLang = lang;
    for (const p of form.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== lang;
    for (const b of form.querySelectorAll('[data-lang]')) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    }
    drawPreview();
  }

  function drawCover() {
    const shown = !removeCover && (pendingUrl || item?.coverUrl);
    $('coverCurrent').hidden = !shown;
    if (shown) $('coverImg').src = pendingUrl || item.coverUrl;
    $('coverRemoved').hidden = !(removeCover && item?.coverUrl && !pendingFile);
    $('altFields').hidden = !shown;
  }

  const refresh = () => {
    drawFlags();
    drawPreview();
  };
  form.addEventListener('input', refresh);
  form.addEventListener('change', (event) => {
    if (event.target.name === 'when') drawMode();
    refresh();
  });
  for (const b of form.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', () => showLang(b.dataset.lang));
  }

  $('f-cover').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    setFieldError(form, 'f-cover', '');
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pendingFile = null;
    pendingUrl = null;
    if (file) {
      if (!COVER_TYPES.includes(file.type)) {
        setFieldError(form, 'f-cover', t('ann.error.unsupported_image'));
        event.target.value = '';
      } else if (file.size > MAX_COVER_BYTES) {
        setFieldError(form, 'f-cover', t('ann.error.cover_too_large'));
        event.target.value = '';
      } else {
        pendingFile = file;
        pendingUrl = URL.createObjectURL(file);
        removeCover = false;
      }
    }
    drawCover();
    drawPreview();
  });

  $('coverRemove').addEventListener('click', () => {
    if (pendingFile) {
      URL.revokeObjectURL(pendingUrl);
      pendingFile = null;
      pendingUrl = null;
      $('f-cover').value = '';
    } else {
      removeCover = true;
    }
    drawCover();
    drawPreview();
  });

  /* ---- validation and saving */
  const formError = $('formError');
  const showFormError = (message) => {
    formError.textContent = message ?? '';
    formError.hidden = !message;
  };

  const expiresChanged = () =>
    value('f-expiresAt') !== toCairoInput(current?.expiresAt ?? item?.expiresAt);

  function clientErrors() {
    const errors = [];
    const m = mode();
    const publishing = m === 'now' || m === 'later';
    const titled = LANGS.filter((l) => value(`f-title${cap(l)}`).trim());

    if (titled.length === 0) {
      errors.push({
        lang: activeLang,
        id: `f-title${cap(activeLang)}`,
        message: t('ann.error.title_required'),
      });
    } else if (publishing && !completeOf('en') && !completeOf('ar')) {
      const lang = titled[0];
      errors.push({
        lang,
        id: `f-body${cap(lang)}`,
        message: t('ann.error.language_incomplete'),
      });
    }

    const coverShown = !removeCover && (pendingFile || item?.coverUrl);
    if (coverShown) {
      for (const lang of titled) {
        if (!value(`f-coverAlt${cap(lang)}`).trim()) {
          errors.push({
            id: `f-coverAlt${cap(lang)}`,
            message: t('ann.error.cover_alt_required'),
          });
        }
      }
    }

    const at = m === 'later' ? fromCairoInput(value('f-publishAt')) : null;
    const expires = fromCairoInput(value('f-expiresAt'));
    if (m === 'later' && (!at || new Date(at) <= new Date())) {
      errors.push({ id: 'f-publishAt', message: t('ann.error.expiry_in_past') });
    }
    if (expires) {
      const start = at ?? (m === 'keep' ? item?.publishAt : null);
      if (start && new Date(expires) <= new Date(start)) {
        errors.push({ id: 'f-expiresAt', message: t('ann.error.expiry_before_publish') });
      }
      if (
        (expiresChanged() || m === 'now' || m === 'later') &&
        new Date(expires) <= new Date()
      ) {
        errors.push({ id: 'f-expiresAt', message: t('ann.error.expiry_in_past') });
      }
    }
    return errors;
  }

  function showErrors(errors) {
    for (const el of form.querySelectorAll('.field__error[id$="-error"]')) {
      el.replaceChildren();
      el.hidden = true;
    }
    for (const el of form.querySelectorAll('[aria-invalid]'))
      el.removeAttribute('aria-invalid');
    showFormError('');
    for (const e of errors) setFieldError(form, e.id, e.message);
    const firstBad = errors[0];
    if (firstBad?.lang) showLang(firstBad.lang);
    else if (firstBad) {
      const lang = /(En|Ar)$/.exec(firstBad.id)?.[1]?.toLowerCase();
      if (lang && form.querySelector(`[data-panel="${lang}"] #${firstBad.id}`)) showLang(lang);
    }
    focusFirstError(form);
  }

  function applyServerError(err) {
    const code = err?.code;
    if (code === 'title_required') {
      showErrors([{ id: `f-title${cap(activeLang)}`, message: errorText(err) }]);
    } else if (code === 'cover_alt_required') {
      const langs = err.details?.languages ?? LANGS;
      showErrors(langs.map((l) => ({ id: `f-coverAlt${cap(l)}`, message: errorText(err) })));
    } else if (code === 'expiry_before_publish' || code === 'expiry_in_past') {
      showErrors([{ id: 'f-expiresAt', message: errorText(err) }]);
    } else if (code === 'unsupported_image' || code === 'cover_too_large') {
      showErrors([{ id: 'f-cover', message: errorText(err) }]);
    } else {
      showFormError(errorText(err));
      formError.scrollIntoView({ block: 'center' });
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errors = clientErrors();
    if (errors.length) {
      showErrors(errors);
      return;
    }
    showErrors([]);

    const m = mode();
    const saveBtn = $('saveBtn');
    setBusy(saveBtn, true, t('ann.editor.saving'));

    const content = {
      titleEn: value('f-titleEn').trim(),
      titleAr: value('f-titleAr').trim(),
      summaryEn: value('f-summaryEn').trim(),
      summaryAr: value('f-summaryAr').trim(),
      bodyEn: value('f-bodyEn'),
      bodyAr: value('f-bodyAr'),
      category: value('f-category'),
      isPinned: $('f-pin').checked,
      coverAltEn: value('f-coverAltEn').trim(),
      coverAltAr: value('f-coverAltAr').trim(),
    };
    // Sent only when changed, so the text of an expired post can be edited.
    if (expiresChanged()) content.expiresAt = fromCairoInput(value('f-expiresAt'));
    if (m === 'draft') content.publishAt = null;
    if (m === 'later') content.publishAt = fromCairoInput(value('f-publishAt'));
    const companyId = value('f-audience') || null;

    let step = 'save';
    try {
      // A cover being removed goes first: its alt text may be cleared in the same save.
      if (current && removeCover && current.coverUrl && !pendingFile) {
        current = await api(
          `/api/admin/announcements/${current.id}/cover?updatedAt=${encodeURIComponent(current.updatedAt)}`,
          { method: 'DELETE', quiet: true }
        );
        removeCover = false;
        item = { ...item, coverUrl: null };
      }

      if (current) {
        const body = { updatedAt: current.updatedAt, ...content };
        if (companyId !== current.companyId) body.companyId = companyId;
        current = await api(`/api/admin/announcements/${current.id}`, {
          method: 'PATCH',
          body,
          quiet: true,
        });
      } else {
        current = await api('/api/admin/announcements', {
          method: 'POST',
          body: { companyId, ...content, publishAt: content.publishAt ?? null },
          quiet: true,
        });
      }

      if (pendingFile) {
        step = 'cover';
        current = await api(
          `/api/admin/announcements/${current.id}/cover?updatedAt=${encodeURIComponent(current.updatedAt)}`,
          { method: 'PUT', body: pendingFile, quiet: true }
        );
        pendingFile = null;
      }

      if (m === 'now') {
        step = 'publish';
        current = await api(`/api/admin/announcements/${current.id}/publish`, {
          method: 'POST',
          body: { updatedAt: current.updatedAt },
          quiet: true,
        });
      }
    } catch (err) {
      setBusy(saveBtn, false, t(SAVE_LABEL[m]));
      if (current && !editingId) {
        // The text is saved as a draft; carry on from its own address.
        showToast({ tone: 'warning', titleKey: 'ann.toast.created' });
        showToast({ tone: 'danger', titleKey: 'ann.error.title', text: errorText(err) });
        announceChange();
        location.hash = `#announcements/${current.id}/edit`;
        return;
      }
      if (step === 'cover') {
        showToast({ tone: 'warning', titleKey: 'ann.toast.coverFailed', text: errorText(err) });
      }
      applyServerError(err);
      return;
    }

    showToast({
      tone: 'success',
      titleKey:
        m === 'now'
          ? 'ann.toast.published'
          : m === 'later'
            ? 'ann.toast.scheduled'
            : editingId
              ? 'ann.toast.saved'
              : 'ann.toast.created',
    });
    announceChange();
    location.hash = '#announcements/manage';
  });

  drawMode();
  drawFlags();
  drawPreview();

  return () => {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  };
}
