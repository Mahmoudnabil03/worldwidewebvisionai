/* =========================================================================
   Vision Guard — account.js
   Sign in / sign up, order history, consent preferences, and the staff
   attendance tab.

   The attendance tab is shown when the signed-in address is on the company
   domain — but showing it is only presentation. Every attendance endpoint
   re-checks the domain server-side, so hiding the tab is a courtesy, not the
   control. See lib/auth.js -> requireStaff.
   ========================================================================= */
import {
  $, $$, initChrome, onLang, LANG, t, money, currency, esc, api, toast,
  hoursLabel, hhmm, localDate, localTime, THEME, onTheme
} from './site.js';
import { mountGoogleButtons } from './google-auth.js';

initChrome();

const STAFF_DOMAIN = '@visionguardeg.com';

const T = {
  hello:        { ar: 'أهلاً', en: 'Hello' },
  noOrders:     { ar: 'لسه مافيش طلبات على الحساب ده.', en: 'No orders on this account yet.' },
  noOrdersHint: { ar: 'أول طلب هيظهر هنا فورًا بعد ما تأكده.', en: 'Your first order shows up here the moment you place it.' },
  items:        { ar: 'منتج', en: 'items' },
  saved:        { ar: 'اتحفظت التغييرات.', en: 'Changes saved.' },
  saving:       { ar: 'جاري الحفظ…', en: 'Saving…' },
  save:         { ar: 'احفظ التغييرات', en: 'Save changes' },
  signingIn:    { ar: 'جاري الدخول…', en: 'Signing in…' },
  signIn:       { ar: 'تسجيل الدخول', en: 'Sign in' },
  creating:     { ar: 'جاري إنشاء الحساب…', en: 'Creating your account…' },
  create:       { ar: 'اعمل الحساب', en: 'Create account' },

  clockIn:      { ar: 'تسجيل حضور', en: 'Clock in' },
  clockOut:     { ar: 'تسجيل انصراف', en: 'Clock out' },
  working:      { ar: 'مسجّل حضور دلوقتي', en: 'Clocked in' },
  notWorking:   { ar: 'مش مسجّل حضور', en: 'Not clocked in' },
  since:        { ar: 'من', en: 'since' },
  ofTarget:     { ar: 'من الهدف', en: 'of target' },
  targetNote:   {
    ar: 'يوم العمل ٦ ساعات. الدائرة بتملى مع الوقت المسجّل النهارده.',
    en: 'The working day is 6 hours. The dial fills with the time recorded today.'
  },
  attFoot:      {
    ar: 'الأوقات بتتسجل على ساعة السيرفر بتوقيت القاهرة — مش ساعة جهازك. لو نسيت تسجّل انصراف، اليوم بيتقفل تلقائيًا على مدة اليوم المتعاقد عليها وبيتعلّم عليه.',
    en: 'Times come from the server clock on Cairo time, not your device. If you forget to clock out, the shift is auto-closed at the contracted day length and flagged.'
  },
  daysWorked:   { ar: 'أيام حضور', en: 'Days worked' },
  totalHours:   { ar: 'إجمالي الساعات', en: 'Total hours' },
  expected:     { ar: 'المطلوب', en: 'Expected' },
  balance:      { ar: 'الفرق', en: 'Balance' },
  noAtt:        { ar: 'مافيش أيام مسجّلة في الفترة دي.', en: 'Nothing recorded in this period.' },
  stillIn:      { ar: 'مستمر', en: 'open' },

  st_complete:  { ar: 'مكتمل', en: 'Complete' },
  st_short:     { ar: 'ناقص', en: 'Short' },
  st_overtime:  { ar: 'إضافي', en: 'Overtime' },
  st_open:      { ar: 'شغّال', en: 'Open' },
  st_absent:    { ar: 'غياب', en: 'Absent' },

  o_new:        { ar: 'جديد', en: 'New' },
  o_confirmed:  { ar: 'مؤكد', en: 'Confirmed' },
  o_shipped:    { ar: 'اتشحن', en: 'Shipped' },
  o_done:       { ar: 'تم', en: 'Done' },
  o_cancelled:  { ar: 'ملغي', en: 'Cancelled' }
};

let me = null;
let attData = null;
let tickTimer = null;

/* =========================================================================
   1. VIEWS
   ========================================================================= */
const views = { loading: $('#viewLoading'), auth: $('#viewAuth'), dash: $('#viewDash') };

function showView(name) {
  Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
}

/* =========================================================================
   2. AUTH TABS
   ========================================================================= */
function showAuthTab(which) {
  const login = which === 'login';
  $('#tabLogin').classList.toggle('is-on', login);
  $('#tabSignup').classList.toggle('is-on', !login);
  $('#tabLogin').setAttribute('aria-selected', String(login));
  $('#tabSignup').setAttribute('aria-selected', String(!login));
  $('#paneLogin').hidden = !login;
  $('#paneSignup').hidden = login;
}

$('#tabLogin').addEventListener('click', () => showAuthTab('login'));
$('#tabSignup').addEventListener('click', () => showAuthTab('signup'));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => showAuthTab(b.getAttribute('data-goto'))));

/* Tells an employee they are at the right door before they submit. */
function wireStaffHint(inputSel, hintSel) {
  const input = $(inputSel);
  const hint = $(hintSel);
  const check = () => { hint.hidden = !input.value.trim().toLowerCase().endsWith(STAFF_DOMAIN); };
  input.addEventListener('input', check);
  input.addEventListener('blur', check);
}
wireStaffHint('#lEmail', '#loginStaffHint');
wireStaffHint('#sEmail', '#signupStaffHint');

function showFormError(errSel, err) {
  const el = $(errSel);
  el.textContent = err.display || err.message;
  el.hidden = false;
}

function busy(btn, label) {
  btn.disabled = true;
  btn.innerHTML = `<span>${esc(label)}</span>`;
}
function unbusy(btn, label) {
  btn.disabled = false;
  btn.innerHTML = `<span>${esc(label)}</span>`;
}

/* -------------------------------------------------------------------------
   Continue with Google

   One handler for both buttons: from here it is the same call, and the
   server decides whether it turned out to be a sign-in, a link onto an
   existing account, or a new account.

   The button is Google's own iframe, so it is re-rendered rather than
   restyled when the theme or the language changes.
   ------------------------------------------------------------------------- */
(function googleAuth() {
  const slots = [$('#googleLogin'), $('#googleSignup')].filter(Boolean);
  if (!slots.length) return;

  const errEl = $('#googleErr');
  let working = false;

  async function onCredential(credential) {
    if (working) return;
    working = true;
    if (errEl) errEl.hidden = true;
    try {
      const data = await api('/api/auth/google', { body: { credential, lang: LANG } });
      await enter(data.user);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.display || err.message;
        errEl.hidden = false;
      } else {
        toast(err.display || err.message, 'bad');
      }
    } finally {
      working = false;
    }
  }

  let mounting = null;
  function mount() {
    /* Google's script is fetched from accounts.google.com. A blocked or
       failed load must not leave a dead area where a button should be: the
       whole block is hidden and the email form carries on alone. */
    mounting = mountGoogleButtons(slots, onCredential, {
      theme: THEME,
      locale: LANG,
      text: 'signin_with',
      width: 320
    }).then((ok) => {
      document.querySelectorAll('.gauth').forEach((g) => { g.hidden = !ok; });
      return ok;
    });
    return mounting;
  }

  mount();
  onLang(() => mount());
  onTheme(() => mount());
})();

/* ---- sign in ---- */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').hidden = true;
  const btn = $('#loginBtn');
  busy(btn, t(T.signingIn));
  try {
    const data = await api('/api/auth/login', {
      body: { email: $('#lEmail').value, password: $('#lPass').value }
    });
    $('#lPass').value = '';
    await enter(data.user);
  } catch (err) {
    showFormError('#loginErr', err);
  } finally {
    unbusy(btn, t(T.signIn));
  }
});

/* ---- sign up ---- */
$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#signupErr').hidden = true;
  const btn = $('#signupBtn');

  if (!$('#sTerms').checked) {
    return showFormError('#signupErr', {
      display: t({
        ar: 'لازم توافق على شروط الاستخدام وسياسة الخصوصية.',
        en: 'You need to accept the terms of use and the privacy policy.'
      })
    });
  }

  busy(btn, t(T.creating));
  try {
    const data = await api('/api/auth/signup', {
      body: {
        name: $('#sName').value,
        email: $('#sEmail').value,
        phone: $('#sPhone').value,
        password: $('#sPass').value,
        terms: true,
        newsletter: $('#sNews').checked,
        marketing: $('#sMarketing').checked,
        lang: LANG
      }
    });
    $('#sPass').value = '';
    await enter(data.user);
  } catch (err) {
    showFormError('#signupErr', err);
  } finally {
    unbusy(btn, t(T.create));
  }
});

/* =========================================================================
   3. DASHBOARD
   ========================================================================= */
async function enter(user) {
  me = user;
  $('#dashName').textContent = `${t(T.hello)}${LANG === 'en' ? ', ' : ' يا '}${user.name}`;
  $('#dashEmail').textContent = user.email;
  $('#dashBadge').hidden = !user.staff;
  $('#tabAttendance').hidden = !user.staff;

  $('#pName').value = user.name || '';
  $('#pPhone').value = user.phone ? '0' + String(user.phone).replace(/^20/, '') : '';
  $('#pNews').checked = !!user.newsletter;
  $('#pMarketing').checked = !!user.marketing;

  showView('dash');
  showTab('orders');
  loadOrders();
  if (user.staff) loadAttendance();
}

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { body: {} }); } catch (e) {}
  me = null;
  stopTick();
  showView('auth');
  showAuthTab('login');
});

const panels = {
  orders: $('#panelOrders'),
  attendance: $('#panelAttendance'),
  prefs: $('#panelPrefs')
};

function showTab(name) {
  Object.keys(panels).forEach((k) => { panels[k].hidden = k !== name; });
  $$('.tab').forEach((b) => {
    const on = b.getAttribute('data-tab') === name;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (name === 'attendance') loadAttendance();
}

$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.getAttribute('data-tab'))));

/* ---- orders ---- */
async function loadOrders() {
  const box = $('#ordersList');
  try {
    const { orders } = await api('/api/orders');
    if (!orders.length) {
      box.innerHTML = `
        <p class="card__note">${esc(t(T.noOrders))}</p>
        <p class="card__note">${esc(t(T.noOrdersHint))}</p>`;
      return;
    }
    box.innerHTML = orders.map((o) => {
      const count = (o.items || []).reduce((n, i) => n + i.qty, 0);
      const names = (o.items || []).map((i) => `${i.name} × ${i.qty}`).join(' · ');
      const statusKey = 'o_' + o.status;
      return `
        <div class="orow">
          <span class="orow__id" dir="ltr">${esc(o.id)}</span>
          <span class="orow__meta">
            ${esc(localDate(o.createdAt))} ·
            ${count} ${esc(t(T.items))} ·
            <span class="pill${o.status === 'new' ? ' pill--new' : ''}">${esc(t(T[statusKey] || T.o_new))}</span>
          </span>
          <span class="orow__total">${money(o.total)} ${esc(currency())}</span>
          <span class="orow__items" dir="ltr">${esc(names)}</span>
        </div>`;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p class="card__note">${esc(err.display || err.message)}</p>`;
  }
}

/* ---- preferences ---- */
$('#prefsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#prefsErr').hidden = true;
  $('#prefsOk').hidden = true;
  const btn = $('#prefsBtn');
  busy(btn, t(T.saving));
  try {
    const { user } = await api('/api/account/preferences', {
      body: {
        name: $('#pName').value,
        phone: $('#pPhone').value,
        newsletter: $('#pNews').checked,
        marketing: $('#pMarketing').checked,
        lang: LANG
      }
    });
    me = user;
    $('#dashName').textContent = `${t(T.hello)}${LANG === 'en' ? ', ' : ' يا '}${user.name}`;
    $('#prefsOk').textContent = t(T.saved);
    $('#prefsOk').hidden = false;
    toast(t(T.saved), 'good');
  } catch (err) {
    showFormError('#prefsErr', err);
  } finally {
    unbusy(btn, t(T.save));
  }
});

/* =========================================================================
   4. ATTENDANCE
   ========================================================================= */
const DIAL_LEN = 2 * Math.PI * 52;      // must match r=52 in account.html

function paintDial(seconds, target) {
  const ratio = target > 0 ? seconds / target : 0;
  const fill = $('#dialFill');
  fill.style.strokeDasharray = String(DIAL_LEN);
  fill.style.strokeDashoffset = String(DIAL_LEN * (1 - Math.min(1, ratio)));
  fill.classList.toggle('is-over', ratio >= 1);
  $('#dialBig').textContent = hhmm(seconds);
  $('#dialSub').textContent = `${Math.round(ratio * 100)}% ${t(T.ofTarget)}`;
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

/* The open shift keeps counting on screen without asking the server every
   second: the server gave us the start instant, so the browser can do the
   arithmetic itself. Any drift is corrected on the next clock action. */
function startTick() {
  stopTick();
  if (!attData || !attData.open) return;
  const startedAt = new Date(attData.open.clockIn).getTime();
  const baseline = attData.today.seconds - attData.open.seconds;
  tickTimer = setInterval(() => {
    const live = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    paintDial(baseline + live, attData.targetSeconds);
  }, 1000);
}

function statusTag(status) {
  const key = 'st_' + status;
  return `<span class="tag tag--${esc(status)}">${esc(t(T[key] || T.st_short))}</span>`;
}

function signed(seconds) {
  const s = Math.round(seconds);
  const sign = s >= 0 ? '+' : '−';
  return sign + hoursLabel(Math.abs(s));
}

function renderAttendance() {
  if (!attData) return;
  const target = attData.targetSeconds;
  const today = attData.today;
  const open = attData.open;

  $('#attTarget').textContent = t(T.targetNote);
  $('#attFoot').textContent = t(T.attFoot);

  paintDial(today.seconds, target);

  const state = $('#clockState');
  state.classList.toggle('is-live', !!open);
  state.classList.toggle('is-off', !open);
  $('#clockStateText').textContent = open ? t(T.working) : t(T.notWorking);
  $('#clockSince').innerHTML = open
    ? `${esc(t(T.since))} <b dir="ltr">${esc(localTime(open.clockIn))}</b>`
    : '';

  const btn = $('#clockBtn');
  btn.textContent = open ? t(T.clockOut) : t(T.clockIn);
  btn.classList.toggle('btn--out', !!open);

  /* stats */
  const s = attData.summary;
  $('#attStats').innerHTML = `
    <div class="stat"><span class="stat__k">${esc(t(T.daysWorked))}</span><span class="stat__v">${s.daysWorked}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.totalHours))}</span><span class="stat__v">${esc(hoursLabel(s.seconds))}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.expected))}</span><span class="stat__v">${esc(hoursLabel(s.expected))}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.balance))}</span><span class="stat__v ${s.balance >= 0 ? 'is-pos' : 'is-neg'}">${esc(signed(s.balance))}</span></div>`;

  /* table */
  const rows = attData.days.filter((d) => d.sessions.length);
  $('#attRows').innerHTML = rows.length
    ? rows.map((d) => {
        const first = d.sessions[d.sessions.length - 1];
        const last = d.sessions[0];
        const outLabel = last.out ? localTime(last.out) : t(T.stillIn);
        const note = d.sessions.find((x) => x.note);
        return `
          <tr class="${d.date === attData.today.date ? 'is-today' : ''}">
            <td>${esc(localDate(d.sessions[0].in))}</td>
            <td class="num" dir="ltr">${esc(localTime(first.in))} — ${esc(outLabel)}</td>
            <td class="num">${esc(hoursLabel(d.seconds))}</td>
            <td class="num ${d.balance >= 0 ? '' : ''}">${esc(signed(d.balance))}</td>
            <td>${statusTag(d.status)}${note ? `<div class="att__note">${esc(note.note)}</div>` : ''}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="5">${esc(t(T.noAtt))}</td></tr>`;

  startTick();
}

async function loadAttendance() {
  if (!me || !me.staff) return;
  try {
    attData = await api('/api/attendance?days=30');
    $('#attErr').hidden = true;
    renderAttendance();
  } catch (err) {
    stopTick();
    $('#attErr').textContent = err.display || err.message;
    $('#attErr').hidden = false;
  }
}

let clocking = false;
$('#clockBtn').addEventListener('click', async () => {
  if (clocking || !attData) return;
  clocking = true;
  const btn = $('#clockBtn');
  btn.disabled = true;
  $('#attErr').hidden = true;
  try {
    const action = attData.open ? 'out' : 'in';
    const res = await api('/api/attendance/clock', { body: { action } });
    toast(
      action === 'in'
        ? t({ ar: `اتسجل حضورك ${res.at}`, en: `Clocked in at ${res.at}` })
        : t({ ar: `اتسجل انصرافك ${res.at} — ${hoursLabel(res.shift.seconds)}`, en: `Clocked out at ${res.at} — ${hoursLabel(res.shift.seconds)}` }),
      'good'
    );
    await loadAttendance();
  } catch (err) {
    /* "already in" / "not in" means our snapshot is stale, not that the user
       did something wrong — resync and let them try again. */
    if (err.code === 'already_in' || err.code === 'not_in') await loadAttendance();
    $('#attErr').textContent = err.display || err.message;
    $('#attErr').hidden = false;
  } finally {
    clocking = false;
    btn.disabled = false;
  }
});

/* =========================================================================
   5. LANGUAGE + BOOT
   ========================================================================= */
onLang(() => {
  if (!me) return;
  $('#dashName').textContent = `${t(T.hello)}${LANG === 'en' ? ', ' : ' يا '}${me.name}`;
  loadOrders();
  if (me.staff && attData) renderAttendance();
});

(async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    if (user) return enter(user);
  } catch (err) {
    /* A backend that is not wired up yet must not leave a blank page. */
    if (err.code !== 'unauthenticated') {
      toast(err.display || err.message, 'bad');
    }
  }
  showView('auth');
  showAuthTab('login');
})();
