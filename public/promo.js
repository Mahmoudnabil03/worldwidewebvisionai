/* =========================================================================
   Vision Guard — promo.js
   The "try the coverage planner" bar, on every page.

   A classic script, not a module, for the same reason consent.js is one:
   index.html's main.js is a classic script and could not import a module, so
   anything that has to run on EVERY page has to be loadable by both halves of
   the site.

   RULES IT FOLLOWS, BECAUSE A PROMO THAT IGNORES THEM IS AN ANNOYANCE
   -------------------------------------------------------------------
   - Dismissed once, gone for the session. sessionStorage, not localStorage:
     a new visit is a fair second chance to notice a new feature, and a
     permanent hide would mean nobody who dismissed it on day one ever hears
     about it again.
   - Never on the planner itself, and never on checkout. Advertising a thing
     to someone already using it is noise; advertising anything to someone
     mid-purchase is worse than noise.
   - Not a modal, nothing blocked, no auto-focus. It sits in a corner and can
     be ignored forever.
   - It waits for the cookie bar. Two bars stacked on a first visit is how a
     site looks desperate — see the delay in show().
   ========================================================================= */
(function () {
  'use strict';

  var KEY = 'vg-promo-planner';
  var HREF = 'game.html';

  /* Pages that must never show it. */
  var path = location.pathname.replace(/\/+$/, '');
  var page = path.slice(path.lastIndexOf('/') + 1) || 'index';
  if (page === 'game' || page === 'game.html') return;
  /* Mid-checkout is not the moment. shop.js puts #checkout on the URL when
     the checkout view is open. */
  if (location.hash === '#checkout') return;

  try { if (sessionStorage.getItem(KEY) === 'x') return; } catch (e) {}

  function lang() {
    try { return localStorage.getItem('vg-lang') === 'en' ? 'en' : 'ar'; } catch (e) { return 'ar'; }
  }

  var COPY = {
    ar: {
      title: 'جرّب مخطّط التغطية',
      body: 'صمّم نظام المراقبة بتاعك وشوف هيغطي إيه — قبل ما تشتري.',
      cta: 'يلا نجرّب',
      close: 'إغلاق'
    },
    en: {
      title: 'Try the coverage planner',
      body: 'Design your camera setup and see what it would actually cover — before you buy.',
      cta: 'Try it',
      close: 'Dismiss'
    }
  };

  var box, titleEl, bodyEl, ctaEl, closeEl;

  function build() {
    box = document.createElement('aside');
    box.className = 'promo';
    box.id = 'promo';
    box.setAttribute('role', 'complementary');

    var inner = document.createElement('div');
    inner.className = 'promo__in';

    var icon = document.createElement('span');
    icon.className = 'promo__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🎮';

    var text = document.createElement('div');
    text.className = 'promo__text';
    titleEl = document.createElement('p');
    titleEl.className = 'promo__title';
    bodyEl = document.createElement('p');
    bodyEl.className = 'promo__body';
    text.appendChild(titleEl);
    text.appendChild(bodyEl);

    ctaEl = document.createElement('a');
    ctaEl.className = 'btn btn--sm promo__cta';
    ctaEl.href = HREF;

    closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'promo__x';
    closeEl.innerHTML = '&times;';
    closeEl.addEventListener('click', dismiss);

    inner.appendChild(icon);
    inner.appendChild(text);
    inner.appendChild(ctaEl);
    inner.appendChild(closeEl);
    box.appendChild(inner);
    document.body.appendChild(box);

    /* Following the link is as good as dismissing it. */
    ctaEl.addEventListener('click', function () {
      try { sessionStorage.setItem(KEY, 'x'); } catch (e) {}
    });
  }

  function render() {
    if (!box) return;
    var c = COPY[lang()];
    titleEl.textContent = c.title;
    bodyEl.textContent = c.body;
    ctaEl.textContent = c.cta;
    closeEl.setAttribute('aria-label', c.close);
  }

  function dismiss() {
    try { sessionStorage.setItem(KEY, 'x'); } catch (e) {}
    if (box) box.classList.remove('is-on');
  }

  function show() {
    build();
    render();
    void box.offsetWidth;
    box.classList.add('is-on');
  }

  function boot() {
    /* Hold back while the cookie bar is up — it is the one thing on screen
       that genuinely needs answering first, and stacking a promotion under it
       makes both look like clutter. consent.js hides its bar as soon as a
       decision exists, so on every visit after the first this is immediate. */
    var waited = 0;
    (function wait() {
      var barUp = document.querySelector('.cookiebar.is-on');
      if (!barUp || waited > 20000) return void setTimeout(show, barUp ? 0 : 1200);
      waited += 600;
      setTimeout(wait, 600);
    })();
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);

  document.addEventListener('langchange', render);
})();
