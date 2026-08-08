/* =========================================================================
   Vision Guard — shop.js
   Browse, cart, checkout. One page, three views.

   The cart holds {id, qty} and nothing else. Prices are read from
   catalog.js for display and re-derived from the same module on the server
   at checkout, so what the customer sees and what the order costs cannot
   drift — and a hand-edited localStorage cart buys nothing cheaply.
   ========================================================================= */
import {
  PRODUCTS as STATIC_PRODUCTS, CATEGORIES, GOVERNORATES,
  findProduct as staticFind, imageFor
} from './catalog.js?v=31';

/* The catalogue the page renders and prices FROM DISPLAY only.

   It starts as the static file so the grid can paint immediately even if
   the network is slow, then is replaced by /api/catalog — which reads the
   products table — so an admin's edit shows up on the next page load rather
   than the next deploy.

   None of this decides what an order costs. functions/api/orders.js prices
   every line server-side from the same table; the cart still travels as
   {id, qty} and nothing else. If this list were stale, or edited in the
   browser, the checkout would simply disagree with it — which is the point. */
let PRODUCTS = STATIC_PRODUCTS;
let BY_ID = null;

function findProduct(id) {
  if (!BY_ID) return staticFind(id);
  return BY_ID.get(String(id)) || null;
}
/* LANG is a live binding: site.js reassigns it on a language switch and this
   module sees the new value without re-importing. */
import {
  $, $$, initChrome, onLang, LANG, t, money, currency, esc, api, toast
} from './site.js?v=31';

initChrome();

/* =========================================================================
   1. CART STATE
   ========================================================================= */
const KEY = 'vg-cart';
const MAX_QTY = 99;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    /* Anything the catalogue no longer has is dropped silently — a product
       that was discontinued between visits must not wedge the cart. */
    return raw
      .map((l) => ({ id: String(l && l.id), qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(l && l.qty)) || 0)) }))
      .filter((l) => l.qty > 0 && findProduct(l.id));
  } catch (e) {
    return [];
  }
}

let cart = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {}
}

function qtyOf(id) {
  const line = cart.find((l) => l.id === id);
  return line ? line.qty : 0;
}

/* The cart in the shape the pixel wants, derived from cartLines() below
   rather than rebuilt — one definition of what is in the cart.

   These prices are for measurement only. What an order actually costs is
   recomputed on the server from the catalogue and never taken from the
   browser; see lib/orders.js. */
function pixelLines() {
  return cartLines()
    .filter((l) => l.product)
    .map((l) => ({ id: l.product.id, qty: l.qty, unit: l.product.price, name: l.product.name }));
}

function setQty(id, qty) {
  const n = Math.max(0, Math.min(MAX_QTY, Math.floor(qty) || 0));
  const i = cart.findIndex((l) => l.id === id);
  if (n === 0) { if (i >= 0) cart.splice(i, 1); }
  else if (i >= 0) cart[i].qty = n;
  else cart.push({ id, qty: n });
  save();
  renderCart();
  renderGridQuantities();
}

function cartCount() {
  return cart.reduce((n, l) => n + l.qty, 0);
}

function cartLines() {
  return cart.map((l) => {
    const p = findProduct(l.id);
    return { product: p, qty: l.qty, line: p.price * l.qty };
  });
}

function subtotal() {
  return cartLines().reduce((sum, l) => sum + l.line, 0);
}

/* =========================================================================
   2. COPY OWNED BY JS
   ========================================================================= */
const T = {
  all:          { ar: 'الكل', en: 'All' },
  add:          { ar: 'أضف للسلة', en: 'Add to cart' },
  inCart:       { ar: 'في السلة', en: 'In cart' },
  remove:       { ar: 'حذف', en: 'Remove' },
  empty:        { ar: 'السلة فاضية لسه.', en: 'Your cart is empty.' },
  emptyHint:    { ar: 'ضيف منتج وابدأ الطلب.', en: 'Add a product to start an order.' },
  subtotal:     { ar: 'الإجمالي', en: 'Subtotal' },
  shipping:     { ar: 'الشحن', en: 'Shipping' },
  shipTbd:      { ar: 'يتحدد حسب المحافظة', en: 'Quoted per governorate' },
  checkout:     { ar: 'إتمام الطلب', en: 'Checkout' },
  results:      { ar: 'منتج', en: 'products' },
  resultsOne:   { ar: 'منتج واحد', en: '1 product' },
  details:      { ar: 'عرض التفاصيل', en: 'View details' },
  placing:      { ar: 'جاري إرسال الطلب…', en: 'Sending your order…' },
  place:        { ar: 'أكّد الطلب', en: 'Place the order' },
  added:        { ar: 'اتضاف للسلة', en: 'Added to cart' },
  chooseGov:    { ar: 'اختار المحافظة', en: 'Choose a governorate' },
  orderNo:      { ar: 'رقم الطلب', en: 'Order number' },
  doneNote:     {
    ar: 'استلمنا طلبك وهو دلوقتي عندنا. هنكلمك على الرقم اللي كتبته عشان نأكد التفاصيل والشحن.',
    en: 'Your order is with us. We will call the number you gave to confirm the details and the shipping.'
  },
  qtyLabel:     { ar: 'الكمية', en: 'Quantity' },
  minus:        { ar: 'قلل واحد', en: 'Decrease by one' },
  plus:         { ar: 'زوّد واحد', en: 'Increase by one' },
  barOne:       { ar: 'منتج واحد في السلة', en: '1 item in your cart' },
  barMany:      { ar: 'منتجات في السلة', en: 'items in your cart' }
};

/* =========================================================================
   3. FILTER STATE + GRID
   ========================================================================= */
const grid = $('#grid');
const chipsWrap = $('#chips');
const resultLine = $('#resultLine');
const emptyMsg = $('#empty');

const params = new URLSearchParams(location.search);
let activeCat = CATEGORIES.some((c) => c.id === params.get('cat')) ? params.get('cat') : 'all';
let query = '';
let sort = 'default';

function visible() {
  const q = query.trim().toLowerCase();
  return PRODUCTS
    .filter((p) => activeCat === 'all' || p.cat === activeCat)
    .filter((p) => {
      if (!q) return true;
      return (p.name + ' ' + p.brand + ' ' + p.ar + ' ' + p.en + ' ' + p.id).toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => {
      if (sort === 'low') return a.price - b.price;
      if (sort === 'high') return b.price - a.price;
      if (sort === 'name') return a.name.localeCompare(b.name);
      return 0;
    });
}

function renderChips() {
  const cats = [{ id: 'all', ar: T.all.ar, en: T.all.en }].concat(CATEGORIES);
  chipsWrap.innerHTML = cats.map((c) => `
    <button class="chip${c.id === activeCat ? ' is-on' : ''}" type="button"
            data-cat="${esc(c.id)}" aria-pressed="${c.id === activeCat}">
      ${esc(t(c))}
    </button>`).join('');
}

function renderGrid() {
  const list = visible();

  resultLine.textContent = list.length === 1
    ? t(T.resultsOne)
    : `${list.length} ${t(T.results)}`;

  emptyMsg.hidden = list.length > 0;

  grid.innerHTML = list.map((p) => {
    const qty = qtyOf(p.id);
    return `
    <article class="pcard" data-id="${esc(p.id)}">
      <div class="pcard__plate">
        <img src="${esc(imageFor(p))}" alt="" loading="lazy" width="500" height="500">
      </div>
      <div class="pcard__body">
        <p class="pcard__cat">${esc(t(CATEGORIES.find((c) => c.id === p.cat) || {}))}</p>
        <h3 class="pcard__name" dir="ltr">${esc(p.name)}</h3>
        <p class="pcard__spec">${esc(LANG === 'en' ? p.en : p.ar)}</p>
        <div class="pcard__foot">
          <p class="pcard__price">
            <b>${money(p.price)}</b>
            ${p.was ? `<s>${money(p.was)}</s>` : ''}
            <em>${esc(currency())}</em>
          </p>
          <div class="pcard__buy">${qty ? stepper(p.id, qty) : addButton(p.id)}</div>
        </div>
        <a class="link pcard__link" href="product.html?id=${esc(p.id)}">${esc(t(T.details))}</a>
      </div>
    </article>`;
  }).join('');
}

function addButton(id) {
  return `<button class="btn btn--sm add" type="button" data-add="${esc(id)}">${esc(t(T.add))}</button>`;
}

function stepper(id, qty) {
  return `
    <div class="step2" role="group" aria-label="${esc(t(T.qtyLabel))}">
      <button type="button" class="step2__btn" data-dec="${esc(id)}" aria-label="${esc(t(T.minus))}">−</button>
      <span class="step2__n" aria-live="polite">${qty}</span>
      <button type="button" class="step2__btn" data-inc="${esc(id)}" aria-label="${esc(t(T.plus))}"
              ${qty >= MAX_QTY ? 'disabled' : ''}>+</button>
    </div>`;
}

/* Only the buy control changes when a quantity does, so the whole grid does
   not get rebuilt (and images do not flicker) on every tap. */
function renderGridQuantities() {
  $$('.pcard', grid).forEach((card) => {
    const id = card.getAttribute('data-id');
    const qty = qtyOf(id);
    const slot = $('.pcard__buy', card);
    if (!slot) return;
    const next = qty ? stepper(id, qty) : addButton(id);
    if (slot.innerHTML.trim() !== next.trim()) slot.innerHTML = next;
    card.classList.toggle('is-in-cart', qty > 0);
  });
}

chipsWrap.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  activeCat = btn.getAttribute('data-cat');
  const url = new URL(location.href);
  if (activeCat === 'all') url.searchParams.delete('cat');
  else url.searchParams.set('cat', activeCat);
  history.replaceState(null, '', url);
  renderChips();
  renderGrid();
  trackCategory();
});

/* ViewContent.

   This shop has no per-product page, so there is no "product viewed" moment
   to report — and firing one per card as it scrolls past would bury the real
   signal under dozens of events per visit. A category listing is the page
   here that corresponds to intent, so that is what ViewContent describes,
   with content_type 'product_group' rather than 'product' so the shape does
   not claim to be something it is not. Once per category per page load. */
function trackCategory() {
  if (!window.vgTrack) return;
  const shown = PRODUCTS.filter((p) => activeCat === 'all' || p.cat === activeCat);
  window.vgTrack.viewCategory(activeCat, shown.map((p) => ({ id: p.id })));
}

/* Including the one the page opened on — arriving from a category card on
   the landing page is exactly the case worth measuring. */
trackCategory();

/* One unit added is one AddToCart, whether it came from the add button or
   from the + stepper. Removing one is not an event — Meta has no
   RemoveFromCart standard event, and inventing one as a custom event would
   put a number in Ads Manager that no report knows what to do with. */
function trackAdd(id, qty) {
  if (!window.vgTrack) return;
  const p = findProduct(id);
  if (!p) return;
  window.vgTrack.addToCart({ id: p.id, qty: qty || 1, unit: p.price, name: p.name });
}

grid.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) {
    setQty(add.getAttribute('data-add'), 1);
    trackAdd(add.getAttribute('data-add'), 1);
    toast(t(T.added), 'good');
    return;
  }
  const inc = e.target.closest('[data-inc]');
  if (inc) {
    setQty(inc.getAttribute('data-inc'), qtyOf(inc.getAttribute('data-inc')) + 1);
    trackAdd(inc.getAttribute('data-inc'), 1);
    return;
  }
  const dec = e.target.closest('[data-dec]');
  if (dec) return setQty(dec.getAttribute('data-dec'), qtyOf(dec.getAttribute('data-dec')) - 1);

  const card = e.target.closest('.pcard');
  if (!card) return;
  if (e.target.closest('.pcard__buy, .pcard__link')) return;

  const id = card.getAttribute('data-id');
  if (id) location.href = `product.html?id=${encodeURIComponent(id)}`;
});

let searchTimer;
let lastTrackedQuery = '';
$('#q').addEventListener('input', (e) => {
  const value = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = value;
    renderGrid();
    /* Not per keystroke: the same debounce that redraws the grid, plus a
       floor of three characters and a check that the term actually changed.
       Otherwise "كاميرا" is seven Search events for one search. */
    const term = value.trim();
    if (term.length >= 3 && term !== lastTrackedQuery && window.vgTrack) {
      lastTrackedQuery = term;
      window.vgTrack.search(term);
    }
  }, 140);
});

$('#sort').addEventListener('change', (e) => { sort = e.target.value; renderGrid(); });

/* =========================================================================
   4. CART DRAWER
   ========================================================================= */
const cartEl = $('#cart');
const cartBtn = $('#cartBtn');
const scrim = $('#scrim');
const cartBody = $('#cartBody');
const cartFoot = $('#cartFoot');
const cartCountEl = $('#cartCount');

function openCart() {
  cartEl.classList.add('is-on');
  cartEl.removeAttribute('inert');
  cartEl.setAttribute('aria-hidden', 'false');
  cartBtn.setAttribute('aria-expanded', 'true');
  scrim.hidden = false;
  requestAnimationFrame(() => scrim.classList.add('is-on'));
  document.documentElement.style.overflow = 'hidden';
  renderCheckoutBar();
  const first = $('button, a, input', cartEl);
  if (first) first.focus();
}

function closeCart() {
  cartEl.classList.remove('is-on');
  cartEl.setAttribute('inert', '');
  cartEl.setAttribute('aria-hidden', 'true');
  cartBtn.setAttribute('aria-expanded', 'false');
  scrim.classList.remove('is-on');
  setTimeout(() => { if (!scrim.classList.contains('is-on')) scrim.hidden = true; }, 350);
  document.documentElement.style.overflow = '';
  renderCheckoutBar();
}

cartBtn.addEventListener('click', () => {
  cartEl.classList.contains('is-on') ? closeCart() : openCart();
});
$('#cartClose').addEventListener('click', closeCart);
scrim.addEventListener('click', closeCart);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cartEl.classList.contains('is-on')) closeCart();
});

/* =========================================================================
   4b. CHECKOUT BAR
   Up the moment the cart stops being empty, down when it empties again.
   Checkout otherwise lives only at the bottom of the drawer, which costs a
   tap to open and gives no reason to open it.
   ========================================================================= */
let currentView = 'shop';
const cobar = $('#cobar');
const cobarCount = $('#cobarCount');
const cobarTotal = $('#cobarTotal');
const cobarGo = $('#cobarGo');

/* Anything else pinned to the bottom of the viewport offsets by this. It is
   measured rather than assumed: the pill grows when the total wraps, and in
   Arabic the copy is a different length. */
function publishBarHeight(on) {
  document.body.style.setProperty('--cobar-h', on ? `${cobar.offsetHeight}px` : '0px');
}

function renderCheckoutBar() {
  const count = cartCount();
  /* Keep the checkout bar visible as long as the customer still has items in
     the cart, even if they have moved into the checkout step. It disappears
     only once the cart is empty or the final confirmation view is reached.
     It also stays off while the cart drawer itself is open, because the drawer
     already exposes its own checkout entry point. */
  const on = count > 0 && currentView !== 'done' && !cartEl.classList.contains('is-on');

  cobarCount.textContent = count === 1 ? t(T.barOne) : `${count} ${t(T.barMany)}`;
  cobarTotal.textContent = `${money(subtotal())} ${currency()}`;
  cobarGo.textContent = t(T.checkout);

  cobar.classList.toggle('is-on', on);
  if (on) cobar.removeAttribute('inert');
  else cobar.setAttribute('inert', '');
  publishBarHeight(on);
}

cobarGo.addEventListener('click', () => showView('checkout'));

function renderCart() {
  const lines = cartLines();
  const count = cartCount();

  cartCountEl.textContent = String(count);
  cartCountEl.hidden = count === 0;
  cartBtn.classList.toggle('has-items', count > 0);

  if (!lines.length) {
    cartBody.innerHTML = `
      <div class="cart__empty">
        <p class="cart__emptytitle">${esc(t(T.empty))}</p>
        <p class="cart__emptyhint">${esc(t(T.emptyHint))}</p>
      </div>`;
    cartFoot.innerHTML = '';
    renderSummary();
    renderCheckoutBar();
    return;
  }

  cartBody.innerHTML = lines.map(({ product: p, qty, line }) => `
    <div class="cline" data-id="${esc(p.id)}">
      <div class="cline__plate"><img src="${esc(imageFor(p))}" alt="" loading="lazy" width="120" height="120"></div>
      <div class="cline__meta">
        <p class="cline__name" dir="ltr">${esc(p.name)}</p>
        <p class="cline__spec">${esc(LANG === 'en' ? p.en : p.ar)}</p>
        ${stepper(p.id, qty)}
      </div>
      <div class="cline__end">
        <p class="cline__price">${money(line)} <em>${esc(currency())}</em></p>
        <button class="cline__rm" type="button" data-rm="${esc(p.id)}">${esc(t(T.remove))}</button>
      </div>
    </div>`).join('');

  cartFoot.innerHTML = `
    <div class="crow">
      <span>${esc(t(T.subtotal))}</span>
      <b>${money(subtotal())} ${esc(currency())}</b>
    </div>
    <div class="crow crow--muted">
      <span>${esc(t(T.shipping))}</span>
      <span>${esc(t(T.shipTbd))}</span>
    </div>
    <button class="btn btn--wide" type="button" id="toCheckout">${esc(t(T.checkout))}</button>`;

  $('#toCheckout').addEventListener('click', () => { closeCart(); showView('checkout'); });
  renderSummary();
  renderCheckoutBar();
}

cartBody.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-rm]');
  if (rm) return setQty(rm.getAttribute('data-rm'), 0);
  const inc = e.target.closest('[data-inc]');
  if (inc) return setQty(inc.getAttribute('data-inc'), qtyOf(inc.getAttribute('data-inc')) + 1);
  const dec = e.target.closest('[data-dec]');
  if (dec) return setQty(dec.getAttribute('data-dec'), qtyOf(dec.getAttribute('data-dec')) - 1);
});

/* =========================================================================
   5. VIEWS
   ========================================================================= */
const views = {
  shop: $('#viewShop'),
  checkout: $('#viewCheckout'),
  done: $('#viewDone')
};

function showView(name) {
  if (name === 'checkout' && !cart.length) { openCart(); return; }
  Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
  currentView = name;
  renderCheckoutBar();
  window.scrollTo(0, 0);
  if (name === 'checkout') {
    renderSummary();
    /* InitiateCheckout belongs here rather than on the two buttons that lead
       here — the cart drawer's and the sticky bar's — because this is the
       one place both of them end up, and a third entry point added later
       gets it for free. Fired on every entry, not once: going back to the
       shop and returning is a real second attempt at checking out, and
       suppressing it would hide the drop-off this event exists to show. */
    if (window.vgTrack) window.vgTrack.initiateCheckout(pixelLines());
    const first = $('#oName');
    if (first && !first.value) first.focus();
  }
}

$('#backToShop').addEventListener('click', () => showView('shop'));

/* AddPaymentInfo. No card details are ever entered on this site — it is cash
   on delivery or a bank transfer — so what this reports is the customer
   committing to how they will pay, which is the same step in the funnel and
   the closest honest match among Meta's standard events. Once per method. */
$$('input[name="payment"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    if (radio.checked && window.vgTrack) window.vgTrack.addPaymentInfo(radio.value, pixelLines());
  });
});

/* =========================================================================
   6. CHECKOUT
   ========================================================================= */
const govSelect = $('#oGov');

function renderGovernorates() {
  const current = govSelect.value;
  govSelect.innerHTML =
    `<option value="" disabled ${current ? '' : 'selected'}>${esc(t(T.chooseGov))}</option>` +
    GOVERNORATES.map((g) => {
      const value = LANG === 'en' ? g.en : g.ar;
      return `<option value="${esc(value)}">${esc(value)}</option>`;
    }).join('');
  /* The value is the localised name, so a language flip has to re-map it. */
  if (current) {
    const match = GOVERNORATES.find((g) => g.ar === current || g.en === current);
    if (match) govSelect.value = LANG === 'en' ? match.en : match.ar;
  }
}

function renderSummary() {
  const lines = cartLines();
  const sumLines = $('#sumLines');
  const sumTotals = $('#sumTotals');
  if (!sumLines || !sumTotals) return;

  sumLines.innerHTML = lines.map(({ product: p, qty, line }) => `
    <div class="sline">
      <span class="sline__name" dir="ltr">${esc(p.name)}</span>
      <span class="sline__qty">× ${qty}</span>
      <span class="sline__price">${money(line)}</span>
    </div>`).join('');

  sumTotals.innerHTML = `
    <div class="crow">
      <span>${esc(t(T.subtotal))}</span>
      <b>${money(subtotal())} ${esc(currency())}</b>
    </div>
    <div class="crow crow--muted">
      <span>${esc(t(T.shipping))}</span>
      <span>${esc(t(T.shipTbd))}</span>
    </div>`;
}

/* Prefills from the account when there is one. Signed-out checkout stays
   fully available — making people register to buy loses orders. */
(async function prefill() {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) return;
    if (!$('#oName').value) $('#oName').value = user.name || '';
    if (!$('#oPhone').value && user.phone) $('#oPhone').value = '0' + String(user.phone).replace(/^20/, '');
    if (!$('#oEmail').value) $('#oEmail').value = user.email || '';
    if (user.newsletter) $('#oNews').checked = true;
  } catch (e) {
    /* Signed out, or the API is not wired up yet. Checkout still works. */
  }
})();

const orderForm = $('#orderForm');
const orderErr = $('#orderErr');
const placeBtn = $('#placeBtn');

function showError(err) {
  orderErr.textContent = err.display || err.message;
  orderErr.hidden = false;
  const field = err.field && ({
    name: '#oName', phone: '#oPhone', phoneAlt: '#oPhoneAlt', email: '#oEmail',
    governorate: '#oGov', address: '#oAddress', terms: '#oTerms'
  })[err.field];
  const el = field && $(field);
  if (el) { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else orderErr.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

let placing = false;

orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (placing) return;
  orderErr.hidden = true;

  if (!cart.length) { showView('shop'); openCart(); return; }

  if (!$('#oTerms').checked) {
    return showError({ code: 'terms_required', field: 'terms', display: t({
      ar: 'لازم توافق على الشروط وسياسة الاستبدال قبل تأكيد الطلب.',
      en: 'Please accept the terms and the exchange policy before ordering.'
    }) });
  }

  placing = true;
  placeBtn.disabled = true;
  placeBtn.innerHTML = `<span>${esc(t(T.placing))}</span>`;

  try {
    const payment = ($$('input[name="payment"]').find((r) => r.checked) || {}).value || 'cod';
    const data = await api('/api/orders', {
      body: {
        name: $('#oName').value,
        phone: $('#oPhone').value,
        phoneAlt: $('#oPhoneAlt').value,
        email: $('#oEmail').value,
        governorate: govSelect.value,
        address: $('#oAddress').value,
        notes: $('#oNotes').value,
        payment,
        terms: true,
        newsletter: $('#oNews').checked,
        marketing: $('#oNews').checked,
        lang: LANG,
        /* The advertising-measurement answer from the cookie bar, which is a
           different thing from the newsletter box above it: one is about
           emails we send, this is about whether the order may be reported to
           Meta at all.

           It has to travel with the order because the server relays Purchase
           to the Conversions API on its own, in functions/api/orders.js —
           that path does not go through the browser, so nothing the browser
           blocks can stop it. Without this field a visitor who pressed
           Reject would still have their order sent, which would make the
           Reject button a lie. */
        adConsent: !!(window.vgConsent && window.vgConsent.marketing()),
        cart: cart.map((l) => ({ id: l.id, qty: l.qty }))
      }
    });

    cart = [];
    save();
    renderCart();
    renderGridQuantities();

    $('#doneNum').textContent = data.order.id;
    $('#doneNote').textContent = t(T.doneNote);

    /* Purchase, browser side. The order number is passed as the event id and
       functions/api/orders.js sends the same one to the Conversions API, so
       Meta collapses the two copies into a single conversion. Without that
       every order was reported twice, at twice the revenue. See track.js.

       Read off data.order, not the local cart: the cart has already been
       emptied above, and the server's copy is the priced, authoritative one. */
    if (window.vgTrack) {
      /* Guest checkout is most of this shop's orders, so this is where the
         majority of identifiable events come from. Identify BEFORE the
         Purchase fires, so the purchase itself carries the matching rather
         than only whatever comes after it. */
      window.vgTrack.identify({ email: $('#oEmail').value, phone: $('#oPhone').value });
      const lines = (data.order.items || []).map((i) => ({ id: i.id, qty: i.qty, unit: i.unit, name: i.name }));
      window.vgTrack.purchase(data.order.id, lines, data.order.total);
      /* A ticked newsletter box at checkout is a mailing-list opt-in, which
         is the thing Meta calls a Lead. */
      if ($('#oNews').checked) window.vgTrack.lead('checkout');
    }

    showView('done');
  } catch (err) {
    showError(err);
  } finally {
    placing = false;
    placeBtn.disabled = false;
    placeBtn.innerHTML = `<span>${esc(t(T.place))}</span>`;
  }
});

/* =========================================================================
   7. BOOT + LANGUAGE
   ========================================================================= */
onLang(() => {
  renderChips();
  renderGrid();
  renderCart();
  renderGovernorates();
  const num = $('#doneNum');
  if (num && num.textContent) $('#doneNote').textContent = t(T.doneNote);
});

renderChips();
renderGrid();

/* Live prices. Deliberately after the first paint: a slow or failed fetch
   must never leave a customer looking at an empty shop, so the static list
   is what they see until the real one arrives, and the grid is redrawn once
   it does. A failure here is logged and otherwise ignored — the static
   prices are the ones the site shipped with, not nonsense. */
(async function liveCatalog() {
  try {
    const res = await fetch('/api/catalog', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.products) || !data.products.length) return;

    PRODUCTS = data.products;
    BY_ID = new Map(PRODUCTS.map(function (p) { return [p.id, p]; }));

    /* Anything already in the cart that no longer exists is dropped, and
       quantities are kept. A cart holding a withdrawn product would fail at
       checkout with "no longer available"; better to clear it here, while
       the customer can still see what changed. */
    const before = cart.length;
    cart = cart.filter(function (l) { return findProduct(l.id); });
    if (cart.length !== before) save();

    renderChips();
    renderGrid();
    renderCart();
  } catch (e) {
    console.info('live catalogue unavailable, using the built-in prices', e && e.message);
  }
})();
renderCart();
renderGovernorates();

/* #checkout on arrival.

   The coverage planner (game.html) builds a whole system — cameras, recorder,
   drive, power, cable — writes it into this same cart, and sends the customer
   straight here. Without this they landed on the product grid with a full
   cart and no indication that anything had happened.

   Guarded on the cart being non-empty, so a stale bookmarked #checkout on an
   empty cart still shows the shop rather than an empty checkout form. */
if (location.hash === '#checkout' && cart.length) showView('checkout');

/* A cart edited in a second tab should not be silently overwritten by this
   one the next time something is added. */
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  cart = load();
  renderCart();
  renderGridQuantities();
});
