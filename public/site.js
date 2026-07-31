/* =========================================================================
   Vision Guard — site.js
   The chrome that every page other than the landing page shares: language,
   nav, menu, and the small helpers the shop and account pages both need.

   index.html deliberately does NOT use this — it has main.js, which owns the
   hero canvas and the weighted scrolling as well. The language mechanism is
   identical in both, and on purpose: Arabic lives in the markup, English in
   data-en, and the original Arabic is captured into data-ar at boot so there
   is never a second dictionary to drift.
   ========================================================================= */

export const root = document.documentElement;

export function $(sel, scope) { return (scope || document).querySelector(sel); }
export function $$(sel, scope) { return [].slice.call((scope || document).querySelectorAll(sel)); }

/* -------------------------------------------------------------------------
   Language
   ------------------------------------------------------------------------- */
const i18nEls = $$('[data-en]');
i18nEls.forEach((el) => el.setAttribute('data-ar', el.innerHTML));

/* Placeholders are an attribute, not content, so they need their own pair:
   the Arabic sits in placeholder=, the English in data-ph-en. */
const phEls = $$('[data-ph-en]');
phEls.forEach((el) => el.setAttribute('data-ph-ar', el.getAttribute('placeholder') || ''));

export let LANG = 'ar';
try { LANG = localStorage.getItem('vg-lang') === 'en' ? 'en' : 'ar'; } catch (e) {}

const renderers = [];

/* Markup translated by data-en swaps itself. Anything built by JS cannot, so
   it re-renders instead — register it here and it stays in step. */
export function onLang(fn) {
  renderers.push(fn);
  return fn;
}

export function applyLang(lang) {
  LANG = lang === 'en' ? 'en' : 'ar';
  root.setAttribute('lang', LANG);
  root.setAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');
  i18nEls.forEach((el) => {
    const html = el.getAttribute(LANG === 'en' ? 'data-en' : 'data-ar');
    if (html !== null) el.innerHTML = html;
  });
  phEls.forEach((el) => {
    const ph = el.getAttribute(LANG === 'en' ? 'data-ph-en' : 'data-ph-ar');
    if (ph !== null) el.setAttribute('placeholder', ph);
  });
  const btn = $('#lang');
  if (btn) {
    btn.textContent = LANG === 'ar' ? 'EN' : 'ع';
    btn.setAttribute('aria-label', LANG === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
  }
  try { localStorage.setItem('vg-lang', LANG); } catch (e) {}
  renderers.forEach((fn) => { try { fn(LANG); } catch (e) { console.error(e); } });
}

/* Picks the right half of a {ar, en} pair. */
export function t(pair) {
  if (!pair) return '';
  return (LANG === 'en' ? pair.en : pair.ar) || pair.ar || pair.en || '';
}

/* -------------------------------------------------------------------------
   Theme — dark (default) / light

   The stored choice is applied by the inline <head> script before first
   paint; this only wires the button. The logo is an <img>, so its src is
   swapped rather than styled: light mode returns to logo-trim.png, the
   original artwork whose GUARD wordmark is the brand's own #58595B grey.
   ------------------------------------------------------------------------- */
const LOGO = { dark: 'assets/logo-dark.png', light: 'assets/logo-trim.png' };
const PAGE_COLOR = { dark: '#08090B', light: '#F6F7F9' };

export let THEME = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

const themeHooks = [];
export function onTheme(fn) { themeHooks.push(fn); return fn; }

export function applyTheme(theme, persist) {
  THEME = theme === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', THEME);

  const src = LOGO[THEME];
  $$('.brand__logo, .boot__mark img').forEach((img) => {
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  });

  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', PAGE_COLOR[THEME]);

  const btn = $('#theme');
  if (btn) {
    btn.setAttribute('aria-pressed', THEME === 'light' ? 'true' : 'false');
    btn.setAttribute('aria-label', THEME === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  }

  if (persist) { try { localStorage.setItem('vg-theme', THEME); } catch (e) {} }
  themeHooks.forEach((fn) => { try { fn(THEME); } catch (e) { console.error(e); } });
}

/* -------------------------------------------------------------------------
   Formatting
   ------------------------------------------------------------------------- */
export function money(n) {
  return Number(n || 0).toLocaleString('en-US');
}

export function currency() {
  return LANG === 'en' ? 'EGP' : 'ج.م';
}

export function hhmm(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function hoursLabel(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (LANG === 'en') return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${h} س ${String(m).padStart(2, '0')} د`;
}

/* Every string that reaches innerHTML goes through this. Product names come
   from our own catalogue, but order notes and account names do not. */
export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function localDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(LANG === 'en' ? 'en-GB' : 'ar-EG', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: 'short', year: 'numeric'
  }).format(d);
}

export function localTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(LANG === 'en' ? 'en-GB' : 'ar-EG', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: LANG !== 'en'
  }).format(d);
}

/* -------------------------------------------------------------------------
   API

   Server messages are English. Anything the customer can actually trigger
   gets an Arabic equivalent here, keyed by the stable error code, so the UI
   is never half-translated at the exact moment something goes wrong.
   ------------------------------------------------------------------------- */
const ERRORS_AR = {
  no_database:     'قاعدة البيانات مش متوصلة لسه. راجع إعداد D1 في الـ README.',
  no_secret:       'تسجيل الدخول مش مفعّل لسه على السيرفر. راجع إعداد SESSION_SECRET.',
  server_error:    'حصل خطأ. جرّب تاني بعد لحظات.',
  rate_limited:    'محاولات كتير في وقت قصير. استنى شوية وجرّب تاني.',
  bad_credentials: 'الإيميل أو كلمة السر غير صحيحة.',
  email_taken:     'فيه حساب بالإيميل ده بالفعل. جرّب تسجّل الدخول.',
  weak_password:   'كلمة السر لازم تكون ٨ حروف على الأقل وفيها حرف ورقم.',
  bad_email:       'الإيميل ده شكله مش مظبوط.',
  bad_phone:       'اكتب رقم موبايل مصري صحيح، مثال 01012345678.',
  terms_required:  'لازم توافق على شروط الاستخدام وسياسة الخصوصية.',
  empty_cart:      'السلة فاضية.',
  bad_governorate: 'اختار المحافظة من القائمة.',
  short_address:   'اكتب العنوان بالتفصيل — الشارع والعمارة والدور.',
  missing_field:   'فيه خانة مطلوبة فاضية.',
  unknown_product: 'واحد من المنتجات مابقاش متاح. حدّث الصفحة.',
  bad_qty:         'الكمية لازم تكون رقم صحيح من ١ لـ ٩٩.',
  unauthenticated: 'لازم تسجّل الدخول الأول.',
  not_staff:       'تبويب الحضور لموظفي Vision Guard فقط.',
  already_in:      'إنت مسجّل حضور بالفعل.',
  not_in:          'إنت مش مسجّل حضور دلوقتي.',
  bad_origin:      'الطلب اترفض لأسباب أمنية. حدّث الصفحة وجرّب تاني.',
  network:         'مافيش اتصال بالسيرفر. اتأكد من الإنترنت وجرّب تاني.'
};

export class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    Object.assign(this, extra || {});
  }
  /* The message to actually show, in whichever language is on screen. */
  get display() {
    return LANG === 'ar' ? (ERRORS_AR[this.code] || this.message) : this.message;
  }
}

export async function api(path, options) {
  const opts = options || {};
  const init = {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: {}
  };
  if (opts.body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError('network', 'Could not reach the server. Check your connection.');
  }

  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON error page */ }

  if (!res.ok || data.ok === false) {
    throw new ApiError(
      data.code || 'server_error',
      data.message || `Request failed (${res.status}).`,
      { status: res.status, field: data.field, retryAfter: data.retryAfter }
    );
  }
  return data;
}

/* -------------------------------------------------------------------------
   Chrome: nav shadow, burger menu, language button, footer year
   ------------------------------------------------------------------------- */
export function initChrome() {
  applyLang(LANG);
  applyTheme(THEME, false);

  const langBtn = $('#lang');
  if (langBtn) langBtn.addEventListener('click', () => applyLang(LANG === 'ar' ? 'en' : 'ar'));

  const themeBtn = $('#theme');
  if (themeBtn) themeBtn.addEventListener('click', () => applyTheme(THEME === 'light' ? 'dark' : 'light', true));

  const nav = $('#nav');
  if (nav) {
    let stuck = false;
    const onScroll = () => {
      const now = window.scrollY > 40;
      if (now !== stuck) { nav.classList.toggle('is-stuck', now); stuck = now; }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const burger = $('#burger');
  const menu = $('#menu');
  if (burger && menu) {
    menu.removeAttribute('hidden');
    menu.setAttribute('inert', '');
    const close = () => {
      if (!document.body.classList.contains('is-menu')) return;
      document.body.classList.remove('is-menu');
      burger.setAttribute('aria-expanded', 'false');
      menu.setAttribute('inert', '');
      root.style.overflow = '';
    };
    burger.addEventListener('click', () => {
      if (document.body.classList.contains('is-menu')) return close();
      document.body.classList.add('is-menu');
      burger.setAttribute('aria-expanded', 'true');
      menu.removeAttribute('inert');
      root.style.overflow = 'hidden';
    });
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
}

/* -------------------------------------------------------------------------
   Toast — one at a time, replaced rather than stacked
   ------------------------------------------------------------------------- */
let toastEl, toastTimer;

export function toast(message, kind) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.remove('is-bad', 'is-good');
  if (kind) toastEl.classList.add(kind === 'bad' ? 'is-bad' : 'is-good');
  /* Force a reflow so a repeated message re-triggers the entry transition. */
  void toastEl.offsetWidth;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 4200);
}
