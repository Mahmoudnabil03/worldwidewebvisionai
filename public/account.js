/* =========================================================================
   Vision Guard — account.js
   Sign in / sign up, order history, consent preferences, the staff
   attendance tab and the administrator's team timesheet.

   The attendance tab is shown when the signed-in address is on the company
   domain, and the team tab when the account is an administrator — but
   showing either is only presentation. Every attendance endpoint re-checks
   server-side, so hiding a tab is a courtesy, not the control. See
   lib/auth.js -> requireStaff and requireAdmin.
   ========================================================================= */
import {
  $, $$, initChrome, onLang, LANG, t, money, currency, esc, api, toast,
  hoursLabel, hhmm, localDate, localTime, THEME, onTheme, ApiError
} from './site.js?v=31';
import {
  firebaseReady, emailSignIn, emailSignUp, googleSignIn, passwordReset,
  sendVerification, firebaseSignOut, idTokenOf
} from './firebase-auth.js?v=31';

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
  resetSent:    {
    ar: 'لو فيه حساب بالإيميل ده، هيوصلك لينك تغيير كلمة السر. بص في الـ Spam كمان.',
    en: 'If an account exists for that address, a reset link is on its way. Check your spam folder too.'
  },
  verifySent:   {
    ar: 'اتبعتلك رسالة تأكيد على الإيميل. مش لازم تأكد دلوقتي عشان تشتري.',
    en: 'We sent you a confirmation email. You do not need to confirm it before ordering.'
  },

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

  teamNote:     {
    ar: 'كل حساب على دومين الشركة، ليوم واحد. الترتيب بالأهم: الغياب والناقص الأول.',
    en: 'Every account on the company domain, for one day. Ordered by what needs attention: absent and short first.'
  },
  teamFoot:     {
    ar: 'العرض ده للقراءة بس — مافيش تعديل على سجلات الحضور من هنا. لو حد نسي يسجّل انصراف، الوردية بتتقفل تلقائيًا على ٦ ساعات وبيتعلّم عليها في تبويب الموظف نفسه.',
    en: 'This view is read-only — attendance records cannot be edited from here. A forgotten clock-out is auto-closed at 6 hours and flagged on the employee’s own tab.'
  },
  allComplete:  { ar: 'كل الموظفين كمّلوا يومهم.', en: 'Everyone completed their day.' },
  notComplete:  { ar: 'فيه حالات محتاجة مراجعة.', en: 'Some days need a look.' },
  noStaff:      { ar: 'مافيش حسابات موظفين على الدومين لسه.', en: 'No staff accounts on the domain yet.' },
  employees:    { ar: 'موظفين', en: 'Employees' },
  complete:     { ar: 'مكمّلين', en: 'Complete' },
  shortCount:   { ar: 'ناقصين', en: 'Short' },
  absentCount:  { ar: 'غياب', en: 'Absent' },
  openCount:    { ar: 'لسه شغّالين', en: 'Still in' },
  shortDays:    { ar: 'أيام ناقصة', en: 'Short days' },
  rangeTitle:   { ar: 'إجمالي الفترة', en: 'Totals for the range' },
  you:          { ar: 'إنت', en: 'you' },

  revenue:      { ar: 'الإيرادات', en: 'Revenue' },
  ordersWord:   { ar: 'طلبات', en: 'Orders' },
  avgOrder:     { ar: 'متوسط الطلب', en: 'Average order' },
  customersWord:{ ar: 'عملاء', en: 'Customers' },
  todayWord:    { ar: 'النهارده', en: 'Today' },
  trafficWord:  { ar: 'الزيارات', en: 'Traffic' },
  visitorsWord: { ar: 'الزوار', en: 'Visitors' },
  pageViews:    { ar: 'صفحات', en: 'Page views' },
  searchesWord: { ar: 'بحث', en: 'Searches' },
  addToCartWord:{ ar: 'إضافة للعربة', en: 'Add to cart' },
  checkoutWord: { ar: 'بدء الدفع', en: 'Checkout started' },
  purchasesWord:{ ar: 'مبيعات', en: 'Purchases' },
  marketingWord:{ ar: 'التسويق', en: 'Marketing' },
  pixelStatus:  { ar: 'حالة البيكسل', en: 'Pixel status' },
  noFile:       { ar: 'مافيش صورة متختارة', en: 'No image chosen' },
  productWord:  { ar: 'المنتج', en: 'Product' },
  totalWord:    { ar: 'الإجمالي', en: 'Total' },
  /* Column headings for the events-by-product table. Keyed by the Meta event
     name so renderPerf can look one up directly; an event with no entry here
     falls back to showing its raw name, which is why a new event in track.js
     needs no change on this side to appear. */
  ev_ViewContent:      { ar: 'مشاهدات', en: 'Views' },
  ev_Search:           { ar: 'بحث', en: 'Searches' },
  ev_AddToCart:        { ar: 'للسلة', en: 'Add to cart' },
  ev_InitiateCheckout: { ar: 'بدء الدفع', en: 'Checkout' },
  ev_AddPaymentInfo:   { ar: 'طريقة الدفع', en: 'Payment info' },
  ev_Purchase:         { ar: 'شراء', en: 'Purchases' },
  eventBreakdown:{ ar: 'تفصيل الأحداث', en: 'Event breakdown' },
  eventWord:    { ar: 'حدث', en: 'Event' },
  countWord:    { ar: 'العدد', en: 'Count' },
  directPasswordUpdate:{ ar: 'تم تحديث كلمة السر.', en: 'Password updated.' },
  directPasswordSet:{ ar: 'تحديث كلمة السر', en: 'Update password' },
  vsPrevious:   { ar: 'مقارنة بالفترة اللي قبلها', en: 'vs the period before' },
  noCompare:    { ar: 'مافيش فترة سابقة نقارن بيها لسه.', en: 'No earlier period to compare with yet.' },
  busiest:      { ar: 'أعلى يوم', en: 'Busiest day' },
  noData:       { ar: 'مافيش بيانات في الفترة دي.', en: 'Nothing in this period.' },
  alertsFailed: { ar: 'تنبيهات ماوصلتش', en: 'Alerts that never arrived' },
  allDelivered: { ar: 'كل تنبيهات الطلبات وصلت.', en: 'Every order alert was delivered.' },
  alertsNotDelivered: { ar: 'تنبيهات ماوصلتش', en: 'Alerts not delivered' },
  cancelledWord:{ ar: 'ملغية', en: 'Cancelled' },
  accountsWord: { ar: 'حسابات', en: 'Accounts' },
  mailingList:  { ar: 'القائمة البريدية', en: 'Mailing list' },
  onShiftNow:   { ar: 'على الشيفت دلوقتي', en: 'On shift now' },

  mDelete:      { ar: 'حذف', en: 'Delete' },
  mReset:       { ar: 'إعادة تعيين كلمة السر', en: 'Reset password' },
  mTerminate:   { ar: 'إنهاء الحساب', en: 'Terminate' },
  mNone:        { ar: 'مافيش نتائج.', en: 'Nothing to show.' },
  mSaved:       { ar: 'اتحفظ.', en: 'Saved.' },
  mResetSent:   { ar: 'اتبعتت رسالة تغيير كلمة السر.', en: 'Password reset email sent.' },
  mNotReg:      { ar: 'الحساب ده لسه معملش كلمة سر. لازم يسجل من صفحة الدخول الأول.', en: 'No password set yet — they need to register from the sign-in page first.' },
  mCreated:     { ar: 'اتعمل الحساب واتبعتت رسالة كلمة السر.', en: 'Account created and a password email sent.' },
  mAdminRow:    { ar: 'إدارة', en: 'Admin' },
  mStaffRow:    { ar: 'موظف', en: 'Staff' },
  mCustRow:     { ar: 'عميل', en: 'Customer' },
  mNever:       { ar: 'عمره ما دخل', en: 'never' },
  mConfirmDel:  { ar: 'حذف الطلب ده نهائيًا؟ ده بيشيله من سجلاتك الضريبية ومش هينفع يترجع.', en: 'Delete this order permanently? It leaves your tax records and cannot be undone.' },
  mConfirmTerm: { ar: 'إنهاء حساب {name} نهائيًا؟ الطلبات هتفضل بس من غير بياناته.', en: 'Terminate {name} permanently? Their orders are kept but anonymised.' },
  cNotice:      { ar: 'التعديلات هنا بتتحفظ في قاعدة البيانات، بس المتجر لسه بيقرا الأسعار من الملف — التبديل ده خطوة لوحدها عشان التسعير على السيرفر ميتكسرش.', en: 'Edits here are saved to the database, but the shop still prices from the file — switching that over is its own step, so server-side pricing cannot break silently.' },
  cAdd:         { ar: 'أضف منتج', en: 'Add a product' },
  cEditT:       { ar: 'تعديل منتج', en: 'Edit product' },
  cNewT:        { ar: 'منتج جديد', en: 'New product' },
  cEdit:        { ar: 'تعديل', en: 'Edit' },
  cShown:       { ar: 'ظاهر', en: 'Shown' },
  cHidden:      { ar: 'مخفي', en: 'Hidden' },
  cSaved:       { ar: 'اتحفظ.', en: 'Saved.' },
  cNone:        { ar: 'مافيش منتجات.', en: 'No products.' },
  cDelConfirm:  { ar: 'حذف {name} نهائيًا من الكتالوج؟ الطلبات القديمة مش هتتأثر — كل طلب محتفظ بنسخته من الاسم والسعر.', en: 'Delete {name} from the catalogue permanently? Past orders are unaffected — each one keeps its own snapshot of the name and price.' },
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
let teamData = null;
let perfData = null;
let manageDebounce = null;
let catalogData = null;
let catalogDebounce = null;
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

/* =========================================================================
   AUTHENTICATION — Firebase holds the credentials, this site holds the session

   Every path below is the same three steps:

     1. Firebase verifies the credential (password, or the Google popup) and
        hands back an ID token.
     2. That token goes to /api/auth/firebase, which checks its signature and
        audience server-side — a token minted by anyone else's Firebase
        project is refused there, which is the whole security of this.
     3. The server sets this site's own session cookie, and from that moment
        nothing else on the page knows or cares that Firebase was involved.
        Orders, preferences, attendance and the team timesheet all read the
        cookie exactly as they did before.

   The password never reaches our server, which is the point of the change.
   ========================================================================= */

/* Firebase's own rule is six characters and nothing else. The hint under the
   field promises more than that, so the promise is kept here — a rule shown
   to someone and then not enforced is worse than no rule. */
function checkPassword(password) {
  const p = typeof password === 'string' ? password : '';
  if (p.length < 8 || !/\p{L}/u.test(p) || !/\p{Nd}/u.test(p)) {
    throw new ApiError('weak_password', 'Password must be at least 8 characters, with a letter and a number.');
  }
}

/* Firebase errors carry a code but no Arabic. Re-wrapping them as the site's
   own ApiError is what gives them a .display in the language on screen. */
function asApiError(err) {
  if (err instanceof ApiError) return err;
  return new ApiError((err && err.code) || 'auth_failed', (err && err.message) || 'Sign-in failed.');
}

/* Step 2 and 3, shared by all four entry points. */
async function exchange(credential, extra) {
  const idToken = await idTokenOf(credential);
  const data = await api('/api/auth/firebase', {
    body: Object.assign({ idToken, lang: LANG }, extra || {})
  });

  /* CompleteRegistration, on `created` only. The server sets that flag when
     it actually inserted a row, so a returning customer signing in does not
     get reported as a new registration — which is the mistake that makes
     this event useless, because every sign-in inflates it. */
  if (data.created && window.vgTrack) {
    window.vgTrack.completeRegistration(
      (extra && extra.method) || 'email',
      data.user && data.user.id
    );
    if (extra && extra.newsletter) window.vgTrack.lead('signup');
  }

  await enter(data.user);
  return data;
}

/* Google sign-in goes through Firebase, and only through Firebase.

   There used to be two stacks: Google Identity Services posting an ID token
   to /api/auth/google, and Firebase's popup posting a Firebase token to
   /api/auth/firebase. They belonged to DIFFERENT Google Cloud projects —
   GSI used client 523216293057-…, while Firebase is project 54729456085
   (visionguard-7425d) — and only one of them was ever going to be the one
   whose authorised origins someone remembered to update. That is what the
   "Error 400: origin_mismatch" was: the domains were correctly registered on
   the Firebase project while the button on the page belonged to the other
   one.

   One project, one path. Firebase already lists visionguardeg.com and
   www.visionguardeg.com in its authorizedDomains, the server already verifies
   its tokens in lib/firebase.js against FIREBASE_PROJECT_ID, and the popup
   still collects credentials on accounts.google.com — the real Google page,
   not a look-alike. */
let authBusy = false;

async function googleFlow(errSel) {
  if (authBusy) return;
  authBusy = true;
  const errEl = $(errSel);
  if (errEl) errEl.hidden = true;
  try {
    const credential = await googleSignIn();
    /* Google has already verified the address, so the server may link it to
       an existing record. No consent flags: a Google sign-up accepts the
       terms by the note next to the button, and marketing stays off until
       someone actually ticks it in Preferences. */
    await exchange(credential, { terms: true, method: 'google' });
  } catch (err) {
    const e = asApiError(err);
    if (e.code === 'cancelled') return;          // they closed the popup; say nothing
    if (errEl) {
      errEl.textContent = e.display || e.message;
      errEl.hidden = false;
    } else {
      toast(e.display || e.message, 'bad');
    }
  } finally {
    authBusy = false;
  }
}

/* The Google buttons.

   They are the site's own markup now, styled like every other button here and
   translated with the same data-en mechanism, rather than an iframe Google
   renders and owns. That is a deliberate consequence of moving to Firebase:
   signInWithPopup is triggered by an ordinary click handler, so there is no
   rendered widget to host — and no second theme to keep in step with ours,
   which is what the light/dark bug was.

   It is still Google's real sign-in. The popup goes to accounts.google.com
   and the password is typed there; nothing on this page ever sees it. What is
   NOT allowed, and is not done here, is a form of our own that collects a
   Google password — that is the phishing pattern, and it is a different thing
   from a button that opens Google's page. */
const googleButtons = [$('#googleLogin'), $('#googleSignup')];

firebaseReady().then((ok) => {
  /* No Firebase, no Google button. Email and password still work, and an
     enabled button that cannot complete is worse than an absent one. */
  $$('.gauth').forEach((g) => { g.hidden = !ok; });
  googleButtons.forEach((b) => { if (b) b.hidden = !ok; });

  if (!ok) {
    console.warn('Firebase Auth was not reachable; Google sign-in is hidden and email sign-in still works.');
    return;
  }

  googleButtons.forEach((b) => {
    if (b) b.addEventListener('click', () => googleFlow('#googleErr'));
  });
});

/* ---- sign in ----

   Firebase first, then the local password path.

   The fallback is not belt-and-braces, it is load-bearing. Firebase owns
   customer credentials, but it cannot hold the ADMINISTRATOR account: that
   one is seeded straight into D1 by scripts/create-admin.mjs, because
   creating a Firebase user needs a service-account key this project does not
   have. Without this fallback the administrator has no way to sign in
   through the site at all — which is exactly what happened when sign-in
   moved to Firebase and this form stopped calling /api/auth/login.

   It is not a weakening. /api/auth/login is unchanged: same peppered PBKDF2,
   same rate limit, same deliberately identical error either way. Every
   account Firebase creates carries the GOOGLE_ONLY_PW sentinel in pw_hash,
   which can never verify against any input — so the only accounts this can
   let in are ones seeded out of band on purpose. */
const FIREBASE_CANT_AUTHENTICATE = new Set([
  'bad_credentials',      // no such Firebase user, or wrong password there
  'auth_not_enabled',     // Authentication not switched on for the project
  'firebase_unavailable', // CDN blocked, offline, ad blocker
  'provider_disabled',    // email/password provider turned off
  'auth_failed'           // anything else Firebase would not explain
]);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').hidden = true;
  $('#loginOk').hidden = true;
  const btn = $('#loginBtn');
  const email = $('#lEmail').value;
  const password = $('#lPass').value;
  busy(btn, t(T.signingIn));

  try {
    const credential = await emailSignIn(email, password);
    $('#lPass').value = '';
    await exchange(credential);
  } catch (err) {
    const e1 = asApiError(err);

    if (FIREBASE_CANT_AUTHENTICATE.has(e1.code)) {
      try {
        const data = await api('/api/auth/login', { body: { email, password } });
        $('#lPass').value = '';
        await enter(data.user);
        return;
      } catch (localErr) {
        /* Show the local failure, not Firebase's. If neither knows this
           address, "email or password is incorrect" is the honest answer and
           the one that does not leak which system holds the account. */
        showFormError('#loginErr', localErr);
        return;
      } finally {
        unbusy(btn, t(T.signIn));
      }
    }

    showFormError('#loginErr', e1);
  } finally {
    unbusy(btn, t(T.signIn));
  }
});

/* ---- forgot password ----
   New with Firebase: there was no way to reset a password before, because
   nothing here can send email. Firebase does.

   The answer is identical whether or not the address is registered. Saying
   "no such account" would turn this box into a way to test who has one. */
$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#lEmail').value.trim();
  $('#loginErr').hidden = true;
  $('#loginOk').hidden = true;

  if (!email) {
    $('#lEmail').focus();
    return showFormError('#loginErr', new ApiError('missing_field', 'Type your email address first, then tap this again.'));
  }

  try {
    await passwordReset(email);
  } catch (err) {
    const e = asApiError(err);
    /* Only a genuinely broken address or a rate limit is worth reporting. */
    if (e.code === 'bad_email' || e.code === 'rate_limited') {
      return showFormError('#loginErr', e);
    }
  }
  $('#loginOk').textContent = t(T.resetSent);
  $('#loginOk').hidden = false;
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
    checkPassword($('#sPass').value);
    const credential = await emailSignUp($('#sEmail').value, $('#sPass').value);
    $('#sPass').value = '';

    /* Fired off but not waited on. The account exists either way, and the
       verification email only matters later — see the linking rules in
       functions/api/auth/firebase.js. */
    sendVerification(credential);

    await exchange(credential, {
      name: $('#sName').value,
      phone: $('#sPhone').value,
      terms: true,
      newsletter: $('#sNews').checked,
      marketing: $('#sMarketing').checked
    });
    toast(t(T.verifySent), 'good');
  } catch (err) {
    showFormError('#signupErr', asApiError(err));
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
  /* Administrators are staff too — isStaffEmail() in lib/auth.js is true for
     every @visionguardeg.com address, admin@ included — so the admin check
     has to come first or the administrator is labelled an employee, which is
     exactly what it used to do. */
  $('#dashBadge').hidden = !user.staff;
  $('#dashBadgeAdmin').hidden = !user.admin;
  $('#dashBadgeStaff').hidden = !(user.staff && !user.admin);
  $('#tabAttendance').hidden = !user.staff;
  $('#tabTeam').hidden = !user.admin;
  $('#tabPerf').hidden = !user.admin;
  $('#tabManage').hidden = !user.admin;
  $('#tabCatalog').hidden = !user.admin;

  /* Advanced Matching: from here on, events from this browser carry a hashed
     identifier, so Meta can attribute them. Signed-in customers only — a
     visitor who has not told us who they are is not identified. */
  if (window.vgTrack) {
    window.vgTrack.identify({ email: user.email, phone: user.phone, externalId: user.id });
  }

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
  /* Both sessions, in that order: ours is the one that authorises anything,
     so it goes first and a slow Firebase call cannot leave someone looking
     signed out while their cookie is still live. */
  try { await api('/api/auth/logout', { body: {} }); } catch (e) {}
  try { await firebaseSignOut(); } catch (e) {}
  me = null;
  attData = null;
  teamData = null;
  perfData = null;
  stopTick();
  showView('auth');
  showAuthTab('login');
});

const panels = {
  orders: $('#panelOrders'),
  attendance: $('#panelAttendance'),
  team: $('#panelTeam'),
  perf: $('#panelPerf'),
  manage: $('#panelManage'),
  catalog: $('#panelCatalog'),
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
  if (name === 'team') loadTeam();
  if (name === 'perf') loadPerf();
  if (name === 'manage') loadManage();
  if (name === 'catalog') loadCatalog();
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
   5. TEAM — the administrator's timesheet

   Read-only by design. The question it answers is "did everyone work their
   six hours", and the answer to that is a fact about the records, not
   something to be edited from a browser tab. Correcting a forgotten
   clock-out is a conversation and then a deliberate database change.
   ========================================================================= */
function teamLabel(person) {
  return person.id === (me && me.id) ? `${person.name} (${t(T.you)})` : person.name;
}

/* Days that were recorded but came up short. An absent day is counted
   separately — nobody was there to be short. */
function shortDayCount(person) {
  return (person.days || []).filter((d) => d.sessions.length && d.status === 'short').length;
}

function renderTeam() {
  if (!teamData) return;

  $('#teamNote').textContent = t(T.teamNote);
  $('#teamFoot').textContent = t(T.teamFoot);
  $('#teamRangeTitle').textContent =
    `${t(T.rangeTitle)} — ${localDate(teamData.range.from + 'T12:00:00Z')} → ${localDate(teamData.range.to + 'T12:00:00Z')}`;
  $('#teamDate').value = teamData.date;
  /* The server clamps a future date anyway; this stops the picker offering
     one. Cairo's today, not the browser's. */
  if (teamData.isToday) $('#teamDate').max = teamData.date;
  $('#teamDays').value = String(teamData.range.days);

  const totals = teamData.totals;
  const verdict = $('#teamVerdict');
  verdict.textContent = totals.staff === 0
    ? t(T.noStaff)
    : (totals.allComplete ? t(T.allComplete) : t(T.notComplete));
  verdict.classList.toggle('is-good', totals.staff > 0 && totals.allComplete);
  verdict.classList.toggle('is-bad', totals.staff > 0 && !totals.allComplete);

  $('#teamStats').innerHTML = `
    <div class="stat"><span class="stat__k">${esc(t(T.employees))}</span><span class="stat__v">${totals.staff}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.complete))}</span><span class="stat__v ${totals.complete + totals.overtime === totals.staff ? 'is-pos' : ''}">${totals.complete + totals.overtime}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.shortCount))}</span><span class="stat__v ${totals.short ? 'is-neg' : ''}">${totals.short}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.absentCount))}</span><span class="stat__v ${totals.absent ? 'is-neg' : ''}">${totals.absent}</span></div>
    <div class="stat"><span class="stat__k">${esc(t(T.openCount))}</span><span class="stat__v">${totals.open}</span></div>`;

  $('#teamRows').innerHTML = teamData.staff.length
    ? teamData.staff.map((p) => {
        const inOut = p.day.firstIn
          ? `${localTime(p.day.firstIn)} — ${p.day.lastOut ? localTime(p.day.lastOut) : t(T.stillIn)}`
          : '—';
        const note = (p.day.sessions || []).find((s) => s.note);
        return `
          <tr>
            <td>
              <b>${esc(teamLabel(p))}</b>
              <div class="att__note" dir="ltr">${esc(p.email)}</div>
            </td>
            <td class="num" dir="ltr">${esc(inOut)}</td>
            <td class="num">${esc(hoursLabel(p.day.seconds))}</td>
            <td class="num">${p.day.sessions.length ? esc(signed(p.day.balance)) : '—'}</td>
            <td>${statusTag(p.day.status)}${note ? `<div class="att__note">${esc(note.note)}</div>` : ''}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="5">${esc(t(T.noStaff))}</td></tr>`;

  $('#teamRange').innerHTML = teamData.staff.length
    ? teamData.staff.map((p) => {
        const s = p.summary;
        const short = shortDayCount(p);
        return `
          <tr>
            <td>${esc(teamLabel(p))}</td>
            <td class="num">${s.daysWorked}</td>
            <td class="num">${esc(hoursLabel(s.seconds))}</td>
            <td class="num">${esc(hoursLabel(s.expected))}</td>
            <td class="num ${s.balance >= 0 ? 'is-pos' : 'is-neg'}">${esc(signed(s.balance))}</td>
            <td class="num ${short ? 'is-neg' : ''}">${short}</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="6">${esc(t(T.noStaff))}</td></tr>`;
}

async function loadTeam(overrideDate) {
  if (!me || !me.admin) return;
  const qs = new URLSearchParams({ days: $('#teamDays').value || '7' });
  /* No date parameter on the first load: the server knows what "today" is in
     Cairo, and the browser — which may be in another timezone entirely —
     does not. Its answer comes back and fills the picker. */
  const date = overrideDate !== undefined ? overrideDate : $('#teamDate').value;
  if (date) qs.set('date', date);

  try {
    teamData = await api('/api/attendance/team?' + qs.toString());
    $('#teamErr').hidden = true;
    renderTeam();
  } catch (err) {
    $('#teamErr').textContent = err.display || err.message;
    $('#teamErr').hidden = false;
  }
}

$('#teamDate').addEventListener('change', () => loadTeam());
$('#teamDays').addEventListener('change', () => loadTeam());
$('#teamToday').addEventListener('click', () => loadTeam(''));

/* =========================================================================
   6. PERFORMANCE — how the shop is doing

   Business numbers, not web analytics. Page views and ad attribution live in
   the Meta pixel, which does that properly; this answers what the pixel
   cannot — what happened to the orders once they arrived.
   ========================================================================= */
function pct(n) {
  if (n === null || n === undefined) return '';
  const s = n >= 0 ? '+' : '−';
  return ` ${s}${Math.abs(n)}%`;
}

function statTile(label, value, cls) {
  return `<div class="stat"><span class="stat__k">${esc(label)}</span><span class="stat__v ${cls || ''}">${esc(value)}</span></div>`;
}

/* A bar per day, drawn with divs. A charting library for twelve bars would
   be a bigger download than the whole page. */
function renderSpark(daily) {
  const box = $('#perfSpark');
  if (!daily.length) {
    box.innerHTML = `<p class="card__note">${esc(t(T.noData))}</p>`;
    $('#perfSparkNote').textContent = '';
    return;
  }
  const max = Math.max(...daily.map((d) => d.orders), 1);
  box.innerHTML = daily.map((d) => {
    const h = Math.max(4, Math.round((d.orders / max) * 100));
    const title = `${d.day} — ${d.orders} ${t(T.ordersWord)} · ${money(d.revenue)} ${currency()}`;
    return `<div class="spark__bar" style="height:${h}%" title="${esc(title)}"><span>${d.orders}</span></div>`;
  }).join('');
  const busiest = daily.slice().sort((a, b) => b.orders - a.orders)[0];
  $('#perfSparkNote').textContent =
    `${t(T.busiest)}: ${localDate(busiest.day + 'T12:00:00Z')} — ${busiest.orders} ${t(T.ordersWord)}`;
}

/* Every block below is rendered through this.

   The panel used to be one straight run of assignments, which meant the FIRST
   missing field took every block after it with it: `d.traffic.totalEvents` on
   a response with no `traffic` key threw, and the tab rendered its headline
   stats and then simply stopped — no error, no empty state, just nothing.
   That is the worst way for a dashboard to fail, because it looks like the
   numbers are zero rather than like something is broken.

   One try/catch per block means a section that cannot render says so and the
   other nine still work. `safe()` supplies the shape each block expects, so
   an older or partial /api/admin/stats response degrades to empty states
   instead of a blank tab. */
function perfBlock(id, render) {
  const node = $(id);
  if (!node) return;
  try {
    render(node);
  } catch (err) {
    console.error('perf block failed', id, err && err.message);
    node.innerHTML = `<p class="card__note is-bad">${esc(t(T.noData))}</p>`;
  }
}

/* Defaults for every section this panel reads, so a missing key is an empty
   state rather than a thrown TypeError. */
function perfShape(d) {
  const o = d || {};
  return {
    orders: Object.assign(
      { revenue: 0, count: 0, average: 0, customers: 0, unnotified: 0, cancelled: 0, change: {} },
      o.orders
    ),
    today: Object.assign({ orders: 0, revenue: 0 }, o.today),
    traffic: Object.assign(
      { totalEvents: 0, uniqueVisitors: 0, pageViews: 0, searches: 0, addToCart: 0, checkoutStarted: 0, purchases: 0 },
      o.traffic
    ),
    marketing: Object.assign({ pixelConfigured: false, eventBreakdown: [] }, o.marketing),
    accounts: Object.assign({ total: 0, created: 0, subscribed: 0 }, o.accounts),
    newsletter: Object.assign({ total: 0, unsubscribed: 0 }, o.newsletter),
    staff: Object.assign({ onShift: 0 }, o.staff),
    statuses: o.statuses || [],
    payments: o.payments || [],
    governorates: o.governorates || [],
    daily: o.daily || [],
    topProducts: o.topProducts || []
  };
}

function renderPerf() {
  if (!perfData) return;
  const d = perfShape(perfData);

  perfBlock('#perfHeadline', (n) => {
    n.innerHTML = [
      statTile(t(T.revenue), `${money(d.orders.revenue)} ${currency()}`),
      statTile(t(T.ordersWord), String(d.orders.count)),
      statTile(t(T.avgOrder), `${money(d.orders.average)} ${currency()}`),
      statTile(t(T.customersWord), String(d.orders.customers)),
      statTile(t(T.todayWord), `${d.today.orders} · ${money(d.today.revenue)} ${currency()}`)
    ].join('');
  });

  perfBlock('#perfTraffic', (n) => {
    n.innerHTML = [
      statTile(t(T.trafficWord), String(d.traffic.totalEvents)),
      statTile(t(T.visitorsWord), String(d.traffic.uniqueVisitors)),
      statTile(t(T.pageViews), String(d.traffic.pageViews)),
      statTile(t(T.searchesWord), String(d.traffic.searches)),
      statTile(t(T.addToCartWord), String(d.traffic.addToCart)),
      statTile(t(T.checkoutWord), String(d.traffic.checkoutStarted)),
      statTile(t(T.purchasesWord), String(d.traffic.purchases))
    ].join('');
  });

  perfBlock('#perfMarketing', (n) => {
    n.innerHTML = [
      statTile(t(T.pixelStatus), d.marketing.pixelConfigured ? 'OK' : 'OFF'),
      statTile(t(T.marketingWord), String(d.marketing.eventBreakdown.length))
    ].join('');
  });

  perfBlock('#perfEvents', (n) => {
    n.innerHTML = d.marketing.eventBreakdown.length
      ? d.marketing.eventBreakdown.map((row) => `
          <tr><td>${esc(row.event)}</td><td class="num">${row.n}</td></tr>`).join('')
      : `<tr><td colspan="2">${esc(t(T.noData))}</td></tr>`;
  });

  /* Events by product — "3 views of the Imou 3MP, 2 purchases of the UNV 2MP".

     The columns are derived from the events actually present rather than
     hard-coded, so adding an event to track.js makes a column appear here
     with no change to this function or to account.html. EVENT_ORDER just
     fixes the funnel order for the ones we know; anything new lands after
     them in whatever order it arrives. */
  perfBlock('#perfProductEvents', (body) => {
    const rows = d.marketing.productEvents || [];
    const head = $('#perfProductEventsHead');

    if (!rows.length) {
      if (head) head.innerHTML = `<th data-en="Product">المنتج</th>`;
      body.innerHTML = `<tr><td>${esc(t(T.noData))}</td></tr>`;
      return;
    }

    const EVENT_ORDER = ['ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];
    const present = new Set();
    rows.forEach((r) => Object.keys(r.events || {}).forEach((k) => present.add(k)));
    const cols = EVENT_ORDER.filter((e) => present.has(e))
      .concat(Array.from(present).filter((e) => EVENT_ORDER.indexOf(e) < 0).sort());

    if (head) {
      head.innerHTML = `<th>${esc(t(T.productWord))}</th>` +
        cols.map((c) => `<th class="num">${esc(t(T['ev_' + c] || { ar: c, en: c }))}</th>`).join('') +
        `<th class="num">${esc(t(T.totalWord))}</th>`;
    }

    body.innerHTML = rows.map((r) => `
      <tr>
        <td><b>${esc(r.name || r.id)}</b><div class="att__note" dir="ltr">${esc(r.id)}</div></td>
        ${cols.map((c) => `<td class="num">${Number(r.events[c] || 0)}</td>`).join('')}
        <td class="num"><b>${Number(r.total || 0)}</b></td>
      </tr>`).join('');
  });

  perfBlock('#perfCompare', (n) => {
    const c = d.orders.change || {};
    n.textContent = (c.orders === null || c.orders === undefined) && (c.revenue === null || c.revenue === undefined)
      ? t(T.noCompare)
      : `${t(T.vsPrevious)}: ${t(T.ordersWord)}${pct(c.orders)} · ${t(T.revenue)}${pct(c.revenue)}`;
  });

  perfBlock('#perfSpark', () => renderSpark(d.daily));

  perfBlock('#perfProducts', (n) => {
    n.innerHTML = d.topProducts.length
      ? d.topProducts.map((p) => `
          <tr><td>${esc(p.name || p.id)}</td>
              <td class="num">${p.qty}</td>
              <td class="num">${money(p.value)} ${esc(currency())}</td></tr>`).join('')
      : `<tr><td colspan="3">${esc(t(T.noData))}</td></tr>`;
  });

  perfBlock('#perfGovs', (n) => {
    n.innerHTML = d.governorates.length
      ? d.governorates.map((g) => `
          <tr><td>${esc(g.name)}</td>
              <td class="num">${g.n}</td>
              <td class="num">${money(g.value)} ${esc(currency())}</td></tr>`).join('')
      : `<tr><td colspan="3">${esc(t(T.noData))}</td></tr>`;
  });

  perfBlock('#perfStatuses', (n) => {
    n.innerHTML = d.statuses.length
      ? d.statuses.map((s) => statTile(t(T['o_' + s.status] || T.o_new), `${s.n}`)).join('')
      : `<p class="card__note">${esc(t(T.noData))}</p>`;
  });

  /* Health. The one number here that is an alarm rather than a metric. */
  perfBlock('#perfHealth', (health) => {
    const bad = d.orders.unnotified > 0;
    health.textContent = bad
      ? `${t(T.alertsFailed)}: ${d.orders.unnotified}`
      : t(T.allDelivered);
    health.classList.toggle('is-bad', bad);
    health.classList.toggle('is-good', !bad);
  });

  perfBlock('#perfSecondary', (n) => {
    n.innerHTML = [
      statTile(t(T.alertsNotDelivered), String(d.orders.unnotified), d.orders.unnotified ? 'is-neg' : 'is-pos'),
      statTile(t(T.cancelledWord), String(d.orders.cancelled)),
      statTile(t(T.accountsWord), `${d.accounts.total} (+${d.accounts.created})`),
      statTile(t(T.mailingList), String(d.newsletter.total - d.newsletter.unsubscribed)),
      statTile(t(T.onShiftNow), String(d.staff.onShift))
    ].join('');
  });
}

async function loadPerf() {
  if (!me || !me.admin) return;
  try {
    perfData = await api('/api/admin/stats?days=' + ($('#perfDays').value || '30'));
    $('#perfErr').hidden = true;
    renderPerf();
  } catch (err) {
    $('#perfErr').textContent = err.display || err.message;
    $('#perfErr').hidden = false;
  }
}

$('#perfDays').addEventListener('change', () => loadPerf());

/* =========================================================================
   7. MANAGE — the administrator's write operations

   Every button here posts to /api/admin/manage, which re-checks that the
   caller is an administrator. Nothing is trusted because a tab was visible.

   The two irreversible actions — deleting an order, terminating a person —
   confirm by saying what will actually be lost, rather than asking "are you
   sure?". A confirmation nobody reads is not a safeguard.
   ========================================================================= */
function mSay(msg, bad) {
  const ok = $('#mOk'), err = $('#mErr');
  ok.hidden = true; err.hidden = true;
  const el = bad ? err : ok;
  el.textContent = msg;
  el.hidden = false;
}

function manageCall(payload) {
  return api('/api/admin/manage', { body: payload });
}

function roleLabel(u) {
  return u.admin ? t(T.mAdminRow) : (u.role === 'staff' ? t(T.mStaffRow) : t(T.mCustRow));
}

const ORDER_STATES = ['new', 'confirmed', 'shipped', 'done', 'cancelled'];

function renderOrders(orders) {
  $('#mOrders').innerHTML = orders.length ? orders.map(function (o) {
    const opts = ORDER_STATES.map(function (st) {
      return `<option value="${esc(st)}"${st === o.status ? " selected" : ""}>${esc(t(T["o_" + st] || T.o_new))}</option>`;
    }).join("");
    return `
      <tr>
        <td><b dir="ltr">${esc(o.id)}</b><div class="att__note">${esc(localDate(o.created_at))}${o.notified ? "" : " · ⚠"}</div></td>
        <td>${esc(o.name)}<div class="att__note" dir="ltr">${esc(o.phone)}</div></td>
        <td class="num">${money(o.total)} ${esc(currency())}</td>
        <td><select class="m-status" data-id="${esc(o.id)}">${opts}</select></td>
        <td><button class="btn btn--ghost btn--sm m-del" type="button" data-id="${esc(o.id)}">${esc(t(T.mDelete))}</button></td>
      </tr>`;
  }).join("") : `<tr><td colspan="5">${esc(t(T.mNone))}</td></tr>`;
}

function renderUsers(users) {
  $('#mUsers').innerHTML = users.length ? users.map(function (u) {
    /* No terminate button for an administrator: the API refuses it, and a
       button that always errors is worse than no button. */
    const term = u.admin ? "" : `<button class="btn btn--ghost btn--sm m-term" type="button" data-id="${esc(u.id)}" data-name="${esc(u.name)}">${esc(t(T.mTerminate))}</button>`;
    return `
      <tr>
        <td>${esc(u.name)}<div class="att__note" dir="ltr">${esc(u.email)}</div></td>
        <td>${esc(roleLabel(u))}</td>
        <td class="num">${u.last_login_at ? esc(localDate(u.last_login_at)) : esc(t(T.mNever))}</td>
        <td><button class="btn btn--ghost btn--sm m-reset" type="button" data-email="${esc(u.email)}">${esc(t(T.mReset))}</button> ${term}</td>
      </tr>`;
  }).join("") : `<tr><td colspan="4">${esc(t(T.mNone))}</td></tr>`;
}

async function loadManage() {
  if (!me || !me.admin) return;
  try {
    const oq = encodeURIComponent($('#mOrderQ').value.trim());
    const uq = encodeURIComponent($('#mUserQ').value.trim());
    const both = await Promise.all([
      api('/api/admin/manage?entity=orders&q=' + oq),
      api('/api/admin/manage?entity=users&q=' + uq)
    ]);
    renderOrders(both[0].orders);
    renderUsers(both[1].users);
  } catch (err) {
    mSay(err.display || err.message, true);
  }
}

/* Delegated: both tables are re-rendered after every change. */
$('#panelManage').addEventListener('change', async function (e) {
  const sel = e.target.closest('.m-status');
  if (!sel) return;
  try {
    await manageCall({ entity: 'order', action: 'status', id: sel.dataset.id, status: sel.value });
    mSay(t(T.mSaved));
  } catch (err) { mSay(err.display || err.message, true); loadManage(); }
});

$('#mPasswordForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  $('#mPasswordErr').hidden = true;
  $('#mPasswordOk').hidden = true;
  const btn = $('#mPasswordBtn');
  busy(btn, t(T.directPasswordSet));
  try {
    const email = $('#mSetEmail').value.trim();
    const password = $('#mSetPassword').value;
    checkPassword(password);
    const r = await manageCall({ entity: 'user', action: 'password', email, password });
    $('#mSetPassword').value = '';
    mSay(r.updated ? t(T.directPasswordUpdate) : t(T.mNotReg), !r.updated);
  } catch (err) {
    showFormError('#mPasswordErr', err);
  } finally {
    unbusy(btn, t(T.directPasswordSet));
  }
});

$('#panelManage').addEventListener('click', async function (e) {
  const del = e.target.closest('.m-del');
  const reset = e.target.closest('.m-reset');
  const term = e.target.closest('.m-term');

  if (del) {
    if (!confirm(t(T.mConfirmDel))) return;
    try {
      await manageCall({ entity: 'order', action: 'delete', id: del.dataset.id, confirm: true });
      mSay(t(T.mSaved)); loadManage();
    } catch (err) { mSay(err.display || err.message, true); }
    return;
  }

  if (reset) {
    try {
      const r = await manageCall({ entity: 'user', action: 'reset', email: reset.dataset.email });
      mSay(r.sent ? t(T.mResetSent) : t(T.mNotReg), !r.sent);
    } catch (err) { mSay(err.display || err.message, true); }
    return;
  }

  if (term) {
    if (!confirm(t(T.mConfirmTerm).replace('{name}', term.dataset.name))) return;
    try {
      await manageCall({ entity: 'user', action: 'terminate', id: term.dataset.id, confirm: true });
      mSay(t(T.mSaved)); loadManage();
    } catch (err) { mSay(err.display || err.message, true); }
  }
});

$('#mCreateForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  $('#mCreateErr').hidden = true;
  const btn = $('#mCreateBtn');
  busy(btn, t(T.saving));
  try {
    await manageCall({
      entity: 'user', action: 'create',
      email: $('#mNewEmail').value, name: $('#mNewName').value, phone: $('#mNewPhone').value
    });
    $('#mNewEmail').value = ''; $('#mNewName').value = ''; $('#mNewPhone').value = '';
    mSay(t(T.mCreated));
    loadManage();
  } catch (err) {
    showFormError('#mCreateErr', err);
  } finally {
    unbusy(btn, t(T.create));
  }
});

/* Search re-queries the server rather than filtering what is on screen: the
   list is capped, so filtering locally would only ever search the first
   page of it. */
function manageSearch() {
  clearTimeout(manageDebounce);
  manageDebounce = setTimeout(loadManage, 250);
}
$('#mOrderQ').addEventListener('input', manageSearch);
$('#mUserQ').addEventListener('input', manageSearch);
$('#mOrderRefresh').addEventListener('click', function () { loadManage(); });

/* =========================================================================
   8. CATALOGUE — products in D1

   Reads and writes /api/admin/catalog. The shop itself still prices from
   public/catalog.js, so the banner at the top of the tab says so: an
   administrator who changes a price here and then cannot find the change in
   the shop should be told why, not left to work it out.
   ========================================================================= */
function cSay(msg, bad) {
  const ok = $('#cOk'), err = $('#cErr');
  ok.hidden = true; err.hidden = true;
  const el = bad ? err : ok;
  el.textContent = msg; el.hidden = false;
}

function catName(id) {
  const c = (catalogData && catalogData.categories || []).find(function (x) { return x.id === id; });
  return c ? t(c) : id;
}

function renderCatalog() {
  if (!catalogData) return;
  $('#cNotice').textContent = t(T.cNotice);
  $('#cNotice').classList.add('is-bad');

  const q = $('#cQ').value.trim().toLowerCase();
  const list = catalogData.products.filter(function (p) {
    if (!q) return true;
    return ((p.name || '') + ' ' + (p.id || '') + ' ' + (p.brand || '')).toLowerCase().indexOf(q) >= 0;
  });

  $('#cRows').innerHTML = list.length ? list.map(function (p) {
    return `
      <tr>
        <td class="c-thumb-cell">
          ${p.img ? `<img class="c-thumb" src="${esc(thumbSrc(p))}" alt="${esc(p.name)}" loading="lazy">` : `<span class="c-thumb c-thumb--empty">${esc(t(T.cNone))}</span>`}
        </td>
        <td><b>${esc(p.name)}</b><div class="att__note" dir="ltr">${esc(p.id)}${p.brand ? " · " + esc(p.brand) : ""}</div></td>
        <td>${esc(catName(p.cat))}</td>
        <td class="num">${money(p.price)} ${esc(currency())}${p.was ? `<div class="att__note"><s>${money(p.was)}</s></div>` : ""}</td>
        <td><button class="btn btn--ghost btn--sm c-toggle" type="button" data-id="${esc(p.id)}" data-active="${p.active ? 1 : 0}">${esc(p.active ? t(T.cShown) : t(T.cHidden))}</button></td>
        <td>
          <button class="btn btn--ghost btn--sm c-edit" type="button" data-id="${esc(p.id)}">${esc(t(T.cEdit))}</button>
          <button class="btn btn--ghost btn--sm c-del" type="button" data-id="${esc(p.id)}" data-name="${esc(p.name)}">${esc(t(T.mDelete))}</button>
        </td>
      </tr>`;
  }).join("") : `<tr><td colspan="6">${esc(t(T.cNone))}</td></tr>`;
}

async function loadCatalog() {
  if (!me || !me.admin) return;
  try {
    catalogData = await api('/api/admin/catalog');
    const sel = $('#cCat');
    sel.innerHTML = catalogData.categories.map(function (c) {
      return `<option value="${esc(c.id)}">${esc(t(c))}</option>`;
    }).join("");
    renderCatalog();
  } catch (err) {
    cSay(err.display || err.message, true);
  }
}

let previewUrl = null;

/* Removing an image has to be sent as its own instruction, not inferred from
   an empty img field. The server keeps whatever is already stored unless it
   is told otherwise — that is what stops a form round-trip from silently
   dropping a picture — so "remove" needs a flag of its own. */
let imageRemoved = false;

function revokePreviewUrl() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

/* Uploaded images keep the same URL when they are replaced, and are served
   with a short cache rather than an immutable one (see
   functions/assets/products/[[path]].js). In the shop that is exactly right.
   In the admin it is not: the whole point of the screen is to look at the
   image you just changed. updated_at changes on every save, so it is a free
   cache key. */
/* The chosen filename, next to our own picker button. It replaces the text
   the native control used to print for itself, which was English on an Arabic
   page and untranslatable — see the note in account.html.

   No data-en on the span: site.js would overwrite it with the attribute on
   every language switch and wipe out whichever file is actually selected. The
   text is set from here instead, and re-set from the onLang hook. */
function renderFileName() {
  const el = $('#cImgName');
  if (!el) return;
  const input = $('#cImgFile');
  const file = input && input.files && input.files[0];
  el.textContent = file ? file.name : t(T.noFile);
  el.classList.toggle('is-set', !!file);
}

function thumbSrc(p) {
  if (!p.img) return '';
  if (/^(data|https?):/i.test(p.img)) return p.img;
  return p.img + (p.updated_at ? '?t=' + encodeURIComponent(p.updated_at) : '');
}

function updateImagePreview(src) {
  const preview = $('#cImgPreview');
  const hidden = $('#cImgHidden');
  if (!src) {
    revokePreviewUrl();
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute('src');
    }
    if (hidden) hidden.value = '';
    return;
  }
  if (preview) {
    preview.src = src;
    preview.hidden = false;
  }
}

function openEditor(product) {
  const p = product || {};
  $('#cEditorCard').hidden = false;
  $('#cEditorTitle').textContent = product ? t(T.cEditT) : t(T.cNewT);
  /* The id is the key past orders reference, so it is fixed once created. */
  $('#cId').value = p.id || '';
  $('#cId').disabled = !!product;
  $('#cCat').value = p.cat || (catalogData.categories[0] && catalogData.categories[0].id);
  $('#cName').value = p.name || '';
  $('#cBrand').value = p.brand || '';
  $('#cPrice').value = p.price === undefined ? '' : p.price;
  $('#cWas').value = p.was || 0;
  $('#cAr').value = p.ar || '';
  $('#cEn').value = p.en || '';
  $('#cImgFile').value = '';
  imageRemoved = false;
  renderFileName();
  const hidden = $('#cImgHidden');
  if (hidden) hidden.value = p.img || '';
  updateImagePreview(p.img ? thumbSrc(p) : '');
  $('#cActive').checked = product ? !!p.active : true;
  $('#cFormErr').hidden = true;
  $('#cEditorCard').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

$('#cNew').addEventListener('click', function () { openEditor(null); });
$('#cCancel').addEventListener('click', function () {
  $('#cEditorCard').hidden = true;
  $('#cImgFile').value = '';
  imageRemoved = false;
  renderFileName();
  revokePreviewUrl();
  const preview = $('#cImgPreview');
  if (preview) preview.hidden = true;
  const hidden = $('#cImgHidden');
  if (hidden) hidden.value = '';
});
$('#cRefresh').addEventListener('click', function () { loadCatalog(); });
$('#cQ').addEventListener('input', function () {
  clearTimeout(catalogDebounce);
  catalogDebounce = setTimeout(renderCatalog, 200);
});

$('#panelCatalog').addEventListener('click', async function (e) {
  const ed = e.target.closest('.c-edit');
  const del = e.target.closest('.c-del');
  const tog = e.target.closest('.c-toggle');

  if (ed) {
    const p = catalogData.products.find(function (x) { return x.id === ed.dataset.id; });
    if (p) openEditor(p);
    return;
  }

  if (tog) {
    try {
      await api('/api/admin/catalog', { body: { action: 'active', id: tog.dataset.id, active: tog.dataset.active !== '1' } });
      cSay(t(T.cSaved)); loadCatalog();
    } catch (err) { cSay(err.display || err.message, true); }
    return;
  }

  if (del) {
    if (!confirm(t(T.cDelConfirm).replace('{name}', del.dataset.name))) return;
    try {
      await api('/api/admin/catalog', { body: { action: 'delete', id: del.dataset.id, confirm: true } });
      cSay(t(T.cSaved)); $('#cEditorCard').hidden = true; loadCatalog();
    } catch (err) { cSay(err.display || err.message, true); }
  }
});

$('#cImgFile').addEventListener('change', function () {
  const file = this.files && this.files[0];
  if (!file) return;
  /* Picking a file after pressing remove is a change of mind, not both
     instructions at once. */
  imageRemoved = false;
  revokePreviewUrl();
  previewUrl = URL.createObjectURL(file);
  updateImagePreview(previewUrl);
  renderFileName();
});

$('#cImgRemove').addEventListener('click', function () {
  $('#cImgFile').value = '';
  imageRemoved = true;
  renderFileName();
  const hidden = $('#cImgHidden');
  if (hidden) hidden.value = '';
  updateImagePreview('');
});

$('#cForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  $('#cFormErr').hidden = true;
  const btn = $('#cSave');
  busy(btn, t(T.saving));
  try {
    const formData = new FormData();
    const hidden = $('#cImgHidden');
    formData.append('action', 'save');
    formData.append('id', $('#cId').value);
    formData.append('cat', $('#cCat').value);
    formData.append('name', $('#cName').value);
    formData.append('brand', $('#cBrand').value);
    formData.append('price', $('#cPrice').value);
    formData.append('was', $('#cWas').value);
    formData.append('ar', $('#cAr').value);
    formData.append('en', $('#cEn').value);
    formData.append('img', hidden ? hidden.value : '');
    formData.append('active', $('#cActive').checked ? '1' : '0');
    if (imageRemoved) formData.append('removeImage', '1');

    const file = $('#cImgFile').files && $('#cImgFile').files[0];
    if (file) formData.append('file', file);

    await api('/api/admin/catalog', { body: formData });
    $('#cEditorCard').hidden = true;
    cSay(t(T.cSaved));
    loadCatalog();
  } catch (err) {
    showFormError('#cFormErr', err);
  } finally {
    unbusy(btn, t({ ar: 'احفظ', en: 'Save' }));
  }
});

/* =========================================================================
   9. LANGUAGE + BOOT
   ========================================================================= */
onLang(() => {
  /* The Google button is ordinary markup with a data-en attribute now, so
     site.js translates it for us — nothing to re-render here for it any more.
     That was only ever needed because Google rendered it inside an iframe. */
  /* The picker's "no image chosen" text is owned by JavaScript, not by a
     data-en attribute, so it has to be re-rendered here like anything else
     site.js cannot swap for us. */
  renderFileName();

  if (!me) return;
  $('#dashName').textContent = `${t(T.hello)}${LANG === 'en' ? ', ' : ' يا '}${me.name}`;
  loadOrders();
  if (me.staff && attData) renderAttendance();
  if (me.admin && teamData) renderTeam();
  if (me.admin && perfData) renderPerf();
  if (me.admin && !panels.manage.hidden) loadManage();
  if (me.admin && catalogData) renderCatalog();
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
