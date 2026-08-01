/* =========================================================================
   Vision Guard — assistant.js
   The floating assistant that replaced the WhatsApp button.

   Deliberately standalone: it imports nothing. index.html runs main.js and
   the shop and account pages run site.js, and those two own the language
   switch in incompatible ways — main.js fires a `langchange` event, site.js
   calls registered callbacks. Rather than depend on either, this watches the
   one thing both of them set, the lang attribute on <html>, and re-renders
   off that. One file, three pages, no coupling.

   The thread lives in sessionStorage so walking from the shop to the landing
   page does not throw away the conversation, and dies with the tab. Nothing
   is stored on the server — see functions/api/assist.js.
   ========================================================================= */
(function () {
  'use strict';

  var WA = 'https://wa.me/201105006854';
  var KEY = 'vg-assist';
  var MAX_TURNS = 12;
  var MAX_CHARS = 1200;

  var COPY = {
    open:    { ar: 'افتح المساعد الذكي', en: 'Open the AI assistant' },
    close:   { ar: 'إغلاق المساعد', en: 'Close the assistant' },
    title:   { ar: 'مساعد Vision Guard', en: 'Vision Guard assistant' },
    sub:     { ar: 'بيرد على أسئلة الكاميرات وأنظمة المراقبة', en: 'Answers questions about cameras and CCTV systems' },
    hello:   {
      ar: 'أهلاً بيك. اسألني عن أي كاميرا أو جهاز تسجيل، أو قول لي المكان اللي عايز تغطيه وأنا أرشّحلك النظام المناسب.',
      en: 'Hello. Ask me about any camera or recorder, or tell me the place you want covered and I will size the right system for it.'
    },
    ph:      { ar: 'اكتب سؤالك…', en: 'Type your question…' },
    send:    { ar: 'إرسال', en: 'Send' },
    think:   { ar: 'بيفكر…', en: 'Thinking…' },
    human:   { ar: 'تحب تكلم حد من الفريق؟ واتساب', en: 'Rather talk to a person? WhatsApp' },
    clear:   { ar: 'محادثة جديدة', en: 'New chat' },
    chips:   {
      ar: ['عايز أغطي شقة', 'إيه الفرق بين الوايرلس والأنالوج؟', 'كام كاميرا أحتاج لمحل؟'],
      en: ['Cover a flat', 'Wi-Fi or analog?', 'How many cameras for a shop?']
    },
    /* Keyed by the server's error code so the wording never half-translates
       at the exact moment something breaks. */
    err: {
      assistant_off:         { ar: 'المساعد مش مفعّل على النسخة دي. راسلنا على واتساب وهنرد عليك.', en: 'The assistant is not switched on here yet. Message us on WhatsApp and we will answer.' },
      assistant_unavailable: { ar: 'مش قادر أرد دلوقتي. جرّب تاني، أو راسلنا على واتساب.', en: 'I could not answer just now. Try again, or message us on WhatsApp.' },
      rate_limited:          { ar: 'أسئلة كتير في وقت قصير. استنى شوية وجرّب تاني.', en: 'Too many questions in a short time. Wait a moment and try again.' },
      network:               { ar: 'مافيش اتصال بالسيرفر. اتأكد من الإنترنت وجرّب تاني.', en: 'Could not reach the server. Check your connection and try again.' },
      fallback:              { ar: 'حصل خطأ. جرّب تاني، أو راسلنا على واتساب.', en: 'Something went wrong. Try again, or message us on WhatsApp.' }
    }
  };

  function lang() {
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }
  function t(pair) {
    return pair ? (lang() === 'en' ? pair.en : pair.ar) : '';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------------- thread ---------------- */
  var thread = [];
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) {
      thread = saved
        .filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'; })
        .slice(-MAX_TURNS);
    }
  } catch (e) {}

  function persist() {
    try { sessionStorage.setItem(KEY, JSON.stringify(thread.slice(-MAX_TURNS))); } catch (e) {}
  }

  /* ---------------- markup ---------------- */
  var wrap   = el('div', 'vga');
  var fab    = el('button', 'vga__fab');
  var panel  = el('section', 'vga__panel');
  var head   = el('header', 'vga__head');
  var titles = el('div', 'vga__titles');
  var title  = el('p', 'vga__title');
  var sub    = el('p', 'vga__sub');
  var newBtn = el('button', 'vga__new');
  var log    = el('div', 'vga__log');
  var chips  = el('div', 'vga__chips');
  var form   = el('form', 'vga__form');
  var input  = el('input', 'vga__input');
  var send   = el('button', 'vga__send');
  var foot   = el('p', 'vga__foot');
  var waLink = el('a');

  fab.type = 'button';
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'vgaPanel');
  fab.innerHTML =
    '<svg class="vga__i vga__i--open" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.6c0 4-3.9 7.2-8.7 7.2a10 10 0 0 1-2.4-.3L4.6 21l1.2-3.9A6.8 6.8 0 0 1 3.6 11.6C3.6 7.6 7.5 4.4 12.3 4.4S21 7.6 21 11.6Z"/>' +
      '<path d="M9.4 11.6h.01M12.3 11.6h.01M15.2 11.6h.01"/>' +
    '</svg>' +
    '<svg class="vga__i vga__i--close" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M6 6l12 12M18 6 6 18"/>' +
    '</svg>';

  panel.id = 'vgaPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'vgaTitle');
  panel.setAttribute('inert', '');

  title.id = 'vgaTitle';
  newBtn.type = 'button';
  newBtn.className = 'vga__new';

  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('tabindex', '0');

  input.type = 'text';
  input.autocomplete = 'off';
  input.maxLength = MAX_CHARS;
  input.className = 'vga__input';

  send.type = 'submit';
  send.className = 'vga__send';
  send.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 12h15M13 6l6 6-6 6"/>' +
    '</svg>';

  waLink.href = WA;
  waLink.target = '_blank';
  waLink.rel = 'noopener';

  titles.appendChild(title);
  titles.appendChild(sub);
  head.appendChild(titles);
  head.appendChild(newBtn);
  form.appendChild(input);
  form.appendChild(send);
  foot.appendChild(waLink);
  panel.appendChild(head);
  panel.appendChild(log);
  panel.appendChild(chips);
  panel.appendChild(form);
  panel.appendChild(foot);
  wrap.appendChild(panel);
  wrap.appendChild(fab);
  document.body.appendChild(wrap);

  /* ---------------- rendering ---------------- */
  /* Model output is text, and it is put on the page as text. It is the one
     string here that neither we nor the customer wrote. */
  function bubble(role, text) {
    var b = el('div', 'vga__msg vga__msg--' + (role === 'user' ? 'me' : 'bot'), text);
    log.appendChild(b);
    return b;
  }

  function renderThread() {
    log.textContent = '';
    bubble('assistant', t(COPY.hello));
    thread.forEach(function (m) { bubble(m.role, m.content); });
    log.scrollTop = log.scrollHeight;
  }

  function renderChips() {
    chips.textContent = '';
    /* Only worth the space before the customer has said anything. */
    if (thread.length) { chips.hidden = true; return; }
    chips.hidden = false;
    (lang() === 'en' ? COPY.chips.en : COPY.chips.ar).forEach(function (q) {
      var c = el('button', 'vga__chip', q);
      c.type = 'button';
      c.addEventListener('click', function () { ask(q); });
      chips.appendChild(c);
    });
  }

  function applyCopy() {
    fab.setAttribute('aria-label', t(open_ ? COPY.close : COPY.open));
    fab.title = t(open_ ? COPY.close : COPY.open);
    title.textContent = t(COPY.title);
    sub.textContent = t(COPY.sub);
    newBtn.textContent = t(COPY.clear);
    input.placeholder = t(COPY.ph);
    send.setAttribute('aria-label', t(COPY.send));
    send.title = t(COPY.send);
    waLink.textContent = t(COPY.human);
    renderThread();
    renderChips();
  }

  /* ---------------- open / close ---------------- */
  var open_ = false;

  function setOpen(next) {
    open_ = !!next;
    wrap.classList.toggle('is-open', open_);
    fab.setAttribute('aria-expanded', open_ ? 'true' : 'false');
    fab.setAttribute('aria-label', t(open_ ? COPY.close : COPY.open));
    fab.title = t(open_ ? COPY.close : COPY.open);
    if (open_) {
      panel.removeAttribute('inert');
      log.scrollTop = log.scrollHeight;
      input.focus();
    } else {
      panel.setAttribute('inert', '');
    }
  }

  fab.addEventListener('click', function () { setOpen(!open_); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open_) { setOpen(false); fab.focus(); }
  });

  newBtn.addEventListener('click', function () {
    thread = [];
    persist();
    renderThread();
    renderChips();
    input.focus();
  });

  /* ---------------- asking ---------------- */
  var busy = false;

  function errorFor(code) {
    return t(COPY.err[code] || COPY.err.fallback);
  }

  async function ask(text) {
    var question = String(text || '').trim().slice(0, MAX_CHARS);
    if (!question || busy) return;

    busy = true;
    input.value = '';
    input.disabled = true;
    send.disabled = true;

    thread.push({ role: 'user', content: question });
    persist();
    bubble('user', question);
    renderChips();

    var pending = bubble('assistant', t(COPY.think));
    pending.classList.add('is-pending');
    log.scrollTop = log.scrollHeight;

    var res, data = {};
    try {
      res = await fetch('/api/assist', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: thread.slice(-MAX_TURNS) })
      });
      try { data = await res.json(); } catch (e) {}
    } catch (e) {
      data = { ok: false, code: 'network' };
    }

    pending.classList.remove('is-pending');

    if (res && res.ok && data.ok && data.reply) {
      pending.textContent = data.reply;
      thread.push({ role: 'assistant', content: data.reply });
      persist();
    } else {
      pending.classList.add('is-err');
      pending.textContent = errorFor(data.code);
      /* The failed turn is dropped so the next question does not resend a
         question the model never actually answered. */
      thread.pop();
      persist();
      renderChips();
    }

    busy = false;
    input.disabled = false;
    send.disabled = false;
    log.scrollTop = log.scrollHeight;
    if (open_) input.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask(input.value);
  });

  /* ---------------- language ---------------- */
  /* main.js and site.js both write lang on <html>; neither knows this file
     exists. Watching the attribute keeps all three independent. */
  new MutationObserver(function () { applyCopy(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  applyCopy();
})();
