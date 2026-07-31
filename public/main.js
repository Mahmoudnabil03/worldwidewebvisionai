/* =========================================================================
   Vision Guard — main.js
   Zero dependencies. One rAF loop drives every scroll-linked effect and
   shuts itself down when nothing needs a frame.
   ========================================================================= */
(function () {
  'use strict';

  var root    = document.documentElement;
  var reduce  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse  = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  /* ---------------- math ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(v, a, b)   { return b === a ? (v >= b ? 1 : 0) : clamp((v - a) / (b - a), 0, 1); }
  function ease(t)        { return t * t * (3 - 2 * t); }
  function inOutCubic(t)  { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* =======================================================================
     1. FRAME SCHEDULER
     Subscribers return `true` while they still need frames. When every
     subscriber is idle the loop stops — no background battery cost.
     ======================================================================= */
  var jobs = [], running = false;

  function onFrame(fn) { jobs.push(fn); }
  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }
  function tick(t) {
    var busy = false;
    for (var i = 0; i < jobs.length; i++) if (jobs[i](t) === true) busy = true;
    if (busy) requestAnimationFrame(tick);
    else running = false;
  }

  /* Runs once the scroll settles. IntersectionObserver never fires for
     content the viewport jumps clean over (hash landings, scroll
     restoration, a hard flick), which would leave that content hidden for
     good. These sweeps rescue it, and cost nothing once everything has
     resolved. */
  var idleFns = [], idleT;
  function onScrollIdle(fn) { idleFns.push(fn); }
  window.addEventListener('scroll', function () {
    clearTimeout(idleT);
    idleT = setTimeout(function () {
      for (var i = idleFns.length - 1; i >= 0; i--) {
        if (idleFns[i]() === 'done') idleFns.splice(i, 1);
      }
    }, 150);
  }, { passive: true });

  /* =======================================================================
     2. LANGUAGE — Arabic default, English on demand
     Every translatable node carries data-en; the Arabic original is
     captured from the markup itself, so the HTML stays readable and there
     is no separate dictionary to drift out of sync.
     ======================================================================= */
  var i18nEls = [].slice.call(document.querySelectorAll('[data-en]'));
  i18nEls.forEach(function (el) { el.setAttribute('data-ar', el.innerHTML); });

  var LANG = 'ar';
  try { LANG = localStorage.getItem('vg-lang') || 'ar'; } catch (e) {}

  var langBtn = document.getElementById('lang');

  function applyLang(lang, resplit) {
    LANG = lang === 'en' ? 'en' : 'ar';
    root.setAttribute('lang', LANG);
    root.setAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');
    i18nEls.forEach(function (el) {
      el.innerHTML = el.getAttribute(LANG === 'en' ? 'data-en' : 'data-ar');
    });
    if (langBtn) {
      langBtn.textContent = LANG === 'ar' ? 'EN' : 'ع';
      langBtn.setAttribute('aria-label', LANG === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    }
    try { localStorage.setItem('vg-lang', LANG); } catch (e) {}
    if (resplit) resplitAll();
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: LANG } }));
  }

  applyLang(LANG, false);   /* before splitting, so splits use final text */

  if (langBtn) {
    langBtn.addEventListener('click', function () {
      applyLang(LANG === 'ar' ? 'en' : 'ar', true);
      kick();
    });
  }

  /* =======================================================================
     2b. THEME — dark (default) / light

     The stored choice is already applied by the inline <head> script, before
     first paint, so this only wires the button. The logo is an <img>, not a
     background, so its src is swapped here: light mode returns to
     logo-trim.png — the original artwork with the brand's own grey GUARD.
     ======================================================================= */
  var LOGO = { dark: 'assets/logo-dark.png', light: 'assets/logo-trim.png' };
  var PAGE_COLOR = { dark: '#08090B', light: '#F6F7F9' };
  var themeBtn = document.getElementById('theme');
  var THEME = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

  function applyTheme(theme, persist) {
    THEME = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', THEME);

    var src = LOGO[THEME];
    [].slice.call(document.querySelectorAll('.brand__logo, .boot__mark img'))
      .forEach(function (img) { if (img.getAttribute('src') !== src) img.setAttribute('src', src); });

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', PAGE_COLOR[THEME]);

    if (themeBtn) {
      themeBtn.setAttribute('aria-pressed', THEME === 'light' ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', THEME === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    }
    if (persist) { try { localStorage.setItem('vg-theme', THEME); } catch (e) {} }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: THEME } }));
  }

  applyTheme(THEME, false);

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      applyTheme(THEME === 'light' ? 'dark' : 'light', true);
      kick();
    });
  }

  /* =======================================================================
     3. WEIGHTED SMOOTH SCROLL
     Lerps the real scroll position (not a transformed wrapper) so sticky,
     anchors, the scrollbar and find-in-page all keep working. Touch and
     coarse pointers keep native momentum — hijacking it always feels worse
     than the platform default.
     ======================================================================= */
  var smooth = {
    on: !reduce && !coarse,
    target: window.scrollY, current: window.scrollY,
    active: false, lock: false
  };

  function maxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  if (smooth.on) {
    window.addEventListener('wheel', function (e) {
      if (smooth.lock || document.body.classList.contains('is-menu') || e.ctrlKey) return;
      e.preventDefault();
      var d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
      smooth.target = clamp(smooth.target + d, 0, maxScroll());
      smooth.active = true;
      kick();
    }, { passive: false });

    onFrame(function () {
      if (!smooth.active) return false;
      var diff = smooth.target - smooth.current;
      if (Math.abs(diff) < .4) {
        smooth.current = smooth.target;
        window.scrollTo(0, smooth.current);
        smooth.active = false;
        return false;
      }
      smooth.current += diff * .105;                 // the "weight"
      window.scrollTo(0, smooth.current);
      return true;
    });
  }

  window.addEventListener('scroll', function () {
    if (!smooth.active && !smooth.lock) smooth.target = smooth.current = window.scrollY;
    kick();
  }, { passive: true });

  function scrollToY(to) {
    to = clamp(to, 0, maxScroll());
    if (reduce) { window.scrollTo(0, to); smooth.target = smooth.current = to; return; }
    var from = window.scrollY, dist = to - from;
    if (Math.abs(dist) < 2) return;
    var ms = clamp(420 + Math.abs(dist) * .38, 520, 1500), start = null;
    smooth.lock = true; smooth.active = false;
    requestAnimationFrame(function step(t) {
      if (start === null) start = t;
      var k = clamp((t - start) / ms, 0, 1);
      var y = from + dist * inOutCubic(k);
      window.scrollTo(0, y);
      smooth.target = smooth.current = y;
      if (k < 1) requestAnimationFrame(step);
      else smooth.lock = false;
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id === '#') return;
    var el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    closeMenu();
    scrollToY(el.getBoundingClientRect().top + window.scrollY - (id === '#top' ? 0 : 74));
    if (history.replaceState) history.replaceState(null, '', id);
  });

  /* =======================================================================
     4. NAV — stuck state, progress bar, active section, menu, WhatsApp fab
     ======================================================================= */
  var nav      = document.getElementById('nav');
  var bar      = document.getElementById('progressBar');
  var burger   = document.getElementById('burger');
  var menu     = document.getElementById('menu');
  var fab      = document.querySelector('.wafab');
  var navLinks = [].slice.call(document.querySelectorAll('[data-nav]'));
  var wasStuck = false, wasFab = false;

  onFrame(function () {
    var y = window.scrollY, max = maxScroll();
    var stuck = y > 40;
    if (stuck !== wasStuck) { nav.classList.toggle('is-stuck', stuck); wasStuck = stuck; }
    if (bar) bar.style.transform = 'scaleX(' + (max ? y / max : 0) + ')';
    if (fab) {
      var show = y > window.innerHeight * .9;
      if (show !== wasFab) { fab.classList.toggle('is-on', show); wasFab = show; }
    }
    return false;
  });

  if (menu) { menu.removeAttribute('hidden'); menu.setAttribute('inert', ''); }

  function openMenu() {
    document.body.classList.add('is-menu');
    burger.setAttribute('aria-expanded', 'true');
    menu.removeAttribute('inert');
    root.style.overflow = 'hidden';
  }
  function closeMenu() {
    if (!document.body.classList.contains('is-menu')) return;
    document.body.classList.remove('is-menu');
    burger.setAttribute('aria-expanded', 'false');
    menu.setAttribute('inert', '');
    root.style.overflow = '';
  }
  if (burger) {
    burger.addEventListener('click', function () {
      document.body.classList.contains('is-menu') ? closeMenu() : openMenu();
    });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  if ('IntersectionObserver' in window && navLinks.length) {
    var sectionObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navLinks.forEach(function (l) {
          l.classList.toggle('is-active', l.getAttribute('data-nav') === en.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    ['categories', 'products', 'how', 'why', 'contact'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) sectionObs.observe(el);
    });
  }

  /* =======================================================================
     5. SPLIT TYPE + REVEALS
     ======================================================================= */
  function splitWords(el) {
    var words = el.textContent.trim().split(/\s+/);
    var frag  = document.createDocumentFragment();
    words.forEach(function (w, i) {
      var outer = document.createElement('span');
      outer.className = 'w';
      var inner = document.createElement('span');
      inner.className = 'wi';
      inner.textContent = w;
      inner.style.setProperty('--d', (i * 38) + 'ms');
      outer.appendChild(inner);
      frag.appendChild(outer);
      if (i < words.length - 1) frag.appendChild(document.createTextNode(' '));
    });
    el.textContent = '';
    el.appendChild(frag);
  }

  var splitEls = [].slice.call(document.querySelectorAll('[data-split]'));
  splitEls.forEach(splitWords);

  /* language swap replaces innerHTML, so the word spans must be rebuilt */
  function resplitAll() {
    splitEls.forEach(function (el) {
      var wasIn = el.classList.contains('is-in');
      splitWords(el);
      if (wasIn) el.classList.add('is-in');
    });
  }

  var heroTitle = document.querySelector('.hero__title');
  var watchSplits = splitEls.filter(function (el) { return el !== heroTitle; });
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        revealObs.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: .06 });

    var watched = reveals.concat(watchSplits);
    watched.forEach(function (el) { revealObs.observe(el); });

    onScrollIdle(function () {
      for (var i = watched.length - 1; i >= 0; i--) {
        var el = watched[i];
        if (el.classList.contains('is-in')) { watched.splice(i, 1); continue; }
        if (el.getBoundingClientRect().bottom < 0) {
          el.classList.add('no-anim', 'is-in');
          revealObs.unobserve(el);
          watched.splice(i, 1);
        }
      }
      return watched.length ? null : 'done';
    });
  } else {
    reveals.concat(watchSplits).forEach(function (el) { el.classList.add('is-in'); });
  }

  ['.cats', '.pillars'].forEach(function (sel) {
    var wrap = document.querySelector(sel);
    if (!wrap) return;
    [].slice.call(wrap.children).forEach(function (c, i) {
      c.style.setProperty('--d', (i * 70) + 'ms');
    });
  });

  /* Hero copy is hidden up front and choreographed against the boot
     curtain, so the reveal must be guaranteed: `load` is preferred, with a
     hard timeout behind it so a slow subresource can never strand it. */
  if (!reduce) {
    ['.hero__eyebrow', '.hero__lede', '.hero__actions'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) { el.style.opacity = '0'; el.style.transform = 'translateY(18px)'; }
    });
  }
  var introDone = false;
  function heroIntro() {
    if (introDone) return;
    introDone = true;
    if (heroTitle) heroTitle.classList.add('is-in');
    ['.hero__eyebrow', '.hero__lede', '.hero__actions'].forEach(function (sel, i) {
      var el = document.querySelector(sel);
      if (!el) return;
      var d = i * 75 + 130;
      el.style.transition = 'opacity .9s var(--e-out) ' + d + 'ms, transform .9s var(--e-out) ' + d + 'ms';
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }
  /* Must land just after the boot curtain clears (.52s delay + .42s fade in
     styles.css). Change one and change the other. */
  var introDelay = reduce ? 0 : 560;
  if (document.readyState === 'complete') setTimeout(heroIntro, introDelay);
  else window.addEventListener('load', function () { setTimeout(heroIntro, introDelay); });
  setTimeout(heroIntro, introDelay + 1100);

  /* =======================================================================
     6. HERO — scroll-scrubbed sensor field
     A perspective dot field powers on, a scan pass sweeps it, the
     classifier locks on, then the feed reaches the phone.
     ======================================================================= */
  (function heroCanvas() {
    var cv = document.getElementById('heroCanvas');
    if (!cv || !cv.getContext) return;

    var track   = document.querySelector('.hero__track');
    var stage   = document.querySelector('.hero__stage');
    var content = document.querySelector('.hero__content');
    var cue     = document.querySelector('.hero__cue');
    var hudLis  = [].slice.call(document.querySelectorAll('.hud__list li'));
    var ctx     = cv.getContext('2d');

    /* Both colours come straight from CSS so the tokens stay the single
       source of truth for the whole site, canvas included. They are re-read
       on every resize/refresh, which is also what a theme change triggers —
       a near-white dot field would be invisible on the light background. */
    var ACC = '27,157,217';
    var INK = '242,245,247';

    function readColours() {
      var cs = getComputedStyle(root);
      ACC = (cs.getPropertyValue('--accent-rgb') || '').trim() || '27,157,217';
      INK = (cs.getPropertyValue('--canvas-ink-rgb') || '').trim() || '242,245,247';
    }

    var W = 0, H = 0, DPR = 1, HZ = 0, narrow = false;
    var field = [], glow = null, RET = [];
    var lastHud = -1;

    function buildField() {
      var pts = [], rows = narrow ? 13 : 17, cols = narrow ? 20 : 30;
      for (var r = 0; r < rows; r++) {
        var d = r / (rows - 1);
        var y = HZ + Math.pow(d, 2.25) * (H - HZ) * 1.06;
        var spread = .16 + Math.pow(d, 1.6) * 2.2;
        for (var c = 0; c < cols; c++) {
          var u = c / (cols - 1) - .5;
          var x = W * .5 + u * W * spread;
          if (x < -30 || x > W + 30) continue;
          pts.push({ x: x, y: y, d: d, r: .55 + d * 1.5, s: (c * 7 + r * 13) % 20 });
        }
      }
      return pts;
    }

    function resize() {
      readColours();
      var r = cv.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      narrow = W < 760;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      cv.width  = Math.round(W * DPR);
      cv.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      HZ = Math.round(H * (narrow ? .46 : .50));
      field = buildField();

      glow = ctx.createLinearGradient(0, HZ - H * .26, 0, HZ + H * .16);
      glow.addColorStop(0,   'rgba(' + ACC + ',0)');
      glow.addColorStop(.74, 'rgba(' + ACC + ',.055)');
      glow.addColorStop(1,   'rgba(' + ACC + ',0)');

      RET = narrow
        ? [{ x: .30, y: .70, w: .12, h: .19, at: .40, l: 'MOTION' },
           { x: .72, y: .80, w: .20, h: .11, at: .52, l: 'VEHICLE' }]
        : [{ x: .575, y: .625, w: .050, h: .150, at: .40, l: 'MOTION' },
           { x: .775, y: .720, w: .110, h: .085, at: .50, l: 'VEHICLE' },
           { x: .665, y: .570, w: .034, h: .098, at: .59, l: 'MOTION' }];

      /* the headline sits on the leading side, so mirror the detections to
         the trailing side rather than letting them sit under the type */
      if (root.getAttribute('dir') === 'rtl' && !narrow) {
        RET = RET.map(function (q) { return Object.assign({}, q, { x: 1 - q.x }); });
      }
    }

    function brackets(x, y, w, h, len, a) {
      ctx.strokeStyle = 'rgba(' + ACC + ',' + a + ')';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x, y + len);         ctx.lineTo(x, y);         ctx.lineTo(x + len, y);
      ctx.moveTo(x + w - len, y);     ctx.lineTo(x + w, y);     ctx.lineTo(x + w, y + len);
      ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
      ctx.moveTo(x + len, y + h);     ctx.lineTo(x, y + h);     ctx.lineTo(x, y + h - len);
      ctx.stroke();
    }

    function draw(p, t) {
      ctx.clearRect(0, 0, W, H);

      /* already alive at rest, deepening as you scroll */
      var power = .52 + .48 * ease(rng(p, 0, .18));

      ctx.globalAlpha = power;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;

      /* No horizon hairline: the headline is vertically centred and a hard
         rule at the same height reads as a strikethrough through the type.
         The bloom plus the dot field carry the ground plane on their own. */

      var sk = rng(p, .10, .42);
      var scanY = sk > 0 && sk < 1 ? HZ + (H - HZ) * ease(sk) : -1;

      var front = .34 + p * 1.5;
      var shimmer = reduce ? 0 : t * .0011;
      ctx.fillStyle = 'rgba(' + INK + ',1)';
      for (var i = 0; i < field.length; i++) {
        var d = field[i];
        var a = clamp((front - d.d) / .28, 0, 1);
        if (a <= .01) continue;
        a *= (.07 + d.d * .34) * power;
        if (!reduce) a *= .78 + .22 * Math.sin(shimmer + d.s);
        var rad = d.r;
        if (scanY > 0) {
          var dist = Math.abs(d.y - scanY);
          if (dist < 46) { var b = 1 - dist / 46; a += b * .5; rad += b * .7; }
        }
        if (a <= .012) continue;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.beginPath(); ctx.arc(d.x, d.y, rad, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (scanY > 0) {
        var sa = Math.sin(sk * Math.PI) * .9;
        var sg = ctx.createLinearGradient(0, 0, W, 0);
        sg.addColorStop(0,  'rgba(' + ACC + ',0)');
        sg.addColorStop(.5, 'rgba(' + ACC + ',' + sa + ')');
        sg.addColorStop(1,  'rgba(' + ACC + ',0)');
        ctx.strokeStyle = sg; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, scanY + .5); ctx.lineTo(W, scanY + .5); ctx.stroke();
      }

      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      var hub = { x: W * (narrow ? .5 : .60), y: H * (narrow ? .30 : .26) };
      var linked = rng(p, .68, .86);

      for (var j = 0; j < RET.length; j++) {
        var q = RET[j];
        var k = ease(rng(p, q.at, q.at + .085));
        if (k <= .01) continue;
        var bw = W * q.w, bh = H * q.h;
        var bx = W * q.x - bw / 2, by = H * q.y - bh / 2;
        var gr = (1 - k) * 14;
        bx -= gr; by -= gr; bw += gr * 2; bh += gr * 2;

        brackets(bx, by, bw, bh, Math.min(13, bw * .34), k * .95);

        ctx.globalAlpha = k;
        ctx.fillStyle = 'rgba(' + ACC + ',.95)';
        ctx.fillText(q.l, bx, by - 8);
        ctx.globalAlpha = 1;

        if (linked > 0) {
          ctx.save();
          ctx.globalAlpha = linked * .5;
          ctx.strokeStyle = 'rgba(' + ACC + ',.75)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 5]);
          ctx.lineDashOffset = reduce ? 0 : -t * .022;
          ctx.beginPath();
          ctx.moveTo(bx + bw / 2, by);
          ctx.lineTo(hub.x, hub.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (linked > 0) {
        ctx.globalAlpha = linked;
        ctx.strokeStyle = 'rgba(' + ACC + ',.9)';
        ctx.lineWidth = 1.25;
        /* a phone outline — where the feed actually lands */
        var pw = 26, ph = 46;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(hub.x - pw / 2, hub.y - ph / 2, pw, ph, 5);
        else ctx.rect(hub.x - pw / 2, hub.y - ph / 2, pw, ph);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hub.x, hub.y, 2 + (reduce ? 0 : Math.sin(t * .004) * .8), 0, 6.2832);
        ctx.fillStyle = 'rgba(' + ACC + ',1)'; ctx.fill();
        ctx.fillStyle = 'rgba(' + INK + ',.5)';
        ctx.fillText('LIVE', hub.x + pw / 2 + 10, hub.y + 3.5);
        ctx.globalAlpha = 1;
      }

      var arm = ease(rng(p, .84, .97));
      if (arm > .01) {
        var m = 26;
        ctx.globalAlpha = arm * .8;
        brackets(m, m, W - m * 2, H - m * 2, 22, .55);
        ctx.globalAlpha = 1;
      }
    }

    /* Visibility comes from the rect we already measure for progress, so
       there is no observer lifecycle to get wrong: off screen the job
       returns false and the loop idles; the next scroll kicks it back. */
    onFrame(function (t) {
      if (!track) return false;
      var r = track.getBoundingClientRect();
      var span = r.height - (stage ? stage.offsetHeight : window.innerHeight);
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return false;

      var p = span <= 0 ? 0 : clamp(-r.top / span, 0, 1);
      draw(p, t || 0);

      if (content) {
        content.style.transform = 'translate3d(0,' + (-p * 74) + 'px,0)';
        content.style.opacity   = String(1 - ease(rng(p, .76, .98)));
      }
      if (cue) cue.style.opacity = String(1 - rng(p, .01, .10));

      var idx = p >= .74 ? 3 : p >= .52 ? 2 : p >= .30 ? 1 : 0;
      if (idx !== lastHud) {
        hudLis.forEach(function (li, i) {
          li.classList.toggle('is-on',  i <= idx);
          li.classList.toggle('is-cur', i === idx);
        });
        lastHud = idx;
      }
      return true;
    });

    function refresh() { resize(); kick(); }
    refresh();

    /* the first measurement can land before layout settles (webfont still
       blocking render), so track the real box rather than one read */
    var sizeObs, rswait;
    if ('ResizeObserver' in window) {
      sizeObs = new ResizeObserver(function () {
        clearTimeout(rswait);
        rswait = setTimeout(refresh, 60);
      });
      sizeObs.observe(cv);
    }
    window.addEventListener('load', refresh);
    document.addEventListener('langchange', refresh);    // re-mirror detections
    document.addEventListener('themechange', refresh);   // re-read the palette

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(refresh, 140);
    }, { passive: true });
  })();

  /* =======================================================================
     7. HOW TO ORDER — sticky visual follows the step crossing the viewport
     ======================================================================= */
  (function process() {
    var steps = [].slice.call(document.querySelectorAll('.step'));
    var num   = document.getElementById('stepNum');
    var note  = document.getElementById('stepNote');
    var arts  = [].slice.call(document.querySelectorAll('.sv'));
    if (!steps.length) return;

    var NOTES = {
      ar: [
        'قول لنا المكان وعدد النقط، ونرشّح النظام المناسب.',
        'سعر مفصّل لكل قطعة قبل ما تأكّد أي حاجة.',
        'شحن سريع، ودعم معاك لحد ما التطبيق يشتغل.'
      ],
      en: [
        'Tell us the place and the number of points, and we size the system.',
        'An itemised price for every part before anything is confirmed.',
        'Fast shipping, and support with you until the app is running.'
      ]
    };
    var cur = -1;

    function paint() {
      if (note && cur >= 0) note.textContent = NOTES[LANG][cur];
    }
    function set(i) {
      if (i === cur) return;
      cur = i;
      steps.forEach(function (s, k) { s.classList.toggle('is-cur', k === i); });
      arts.forEach(function (a, k)  { a.classList.toggle('is-on',  k === i); });
      if (num) num.textContent = '0' + (i + 1);
      paint();
    }
    set(0);
    document.addEventListener('langchange', paint);

    if (!('IntersectionObserver' in window)) {
      steps.forEach(function (s) { s.classList.add('is-cur'); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) set(+en.target.getAttribute('data-step'));
      });
    }, { rootMargin: '-42% 0px -42% 0px', threshold: 0 });
    steps.forEach(function (s) { obs.observe(s); });
  })();

  /* =======================================================================
     8. PARALLAX
     ======================================================================= */
  (function parallax() {
    var els = [].slice.call(document.querySelectorAll('[data-parallax]'));
    if (!els.length || reduce) return;

    var live = [];
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var i = live.indexOf(en.target);
          if (en.isIntersecting && i < 0) live.push(en.target);
          if (!en.isIntersecting && i >= 0) live.splice(i, 1);
        });
        kick();
      }, { rootMargin: '20% 0px 20% 0px' });
      els.forEach(function (el) { obs.observe(el); });
    } else { live = els; }

    onFrame(function () {
      if (!live.length) return false;
      var mid = window.innerHeight / 2;
      for (var i = 0; i < live.length; i++) {
        var el = live[i], r = el.getBoundingClientRect();
        var off = (r.top + r.height / 2 - mid) * (parseFloat(el.getAttribute('data-parallax')) || .1);
        el.style.transform = 'translate3d(0,' + off.toFixed(2) + 'px,0)';
      }
      return false;
    });
  })();

  /* =======================================================================
     9. MISC
     ======================================================================= */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  window.addEventListener('resize', kick, { passive: true });
  kick();
})();
