/* =========================================================================
   /api/orders

   POST  place an order (guest or signed in)
   GET   list the signed-in customer's own orders

   Order of operations on POST is deliberate: validate, re-price from the
   catalogue, write to D1, respond, and only then reach for WhatsApp. The
   customer's confirmation never waits on Meta's API, and a failed
   notification can never lose an order that was already taken.
   ========================================================================= */
import {
  json, handle, readJson, requireSameOrigin, ApiError,
  clean, required, normEmail, normPhoneEg, clientIp
} from '../../lib/util.js';
import { db, enforceRate } from '../../lib/db.js';
import { currentUser } from '../../lib/auth.js';
import {
  priceCart, shippingFor, orderNumber, isGovernorate, PAYMENTS,
  orderMessage, publicOrder
} from '../../lib/orders.js';
import { notifyWhatsApp, recordNotify } from '../../lib/whatsapp.js';
import { sendMetaPurchaseEvent } from '../../lib/meta.js';
import { loadCatalog } from '../../lib/products.js';

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  requireSameOrigin(request);

  const d1 = await db(env);
  const ip = clientIp(request);
  await enforceRate(d1, `order:${ip}`, 12, 3600);

  const body = await readJson(request);
  const user = await currentUser(context, d1);

  /* --- who and where --- */
  const name = required(body.name, 'name', 120);
  const phone = normPhoneEg(body.phone, 'phone');
  const phoneAlt = body.phoneAlt ? normPhoneEg(body.phoneAlt, 'phoneAlt', true) : '';
  const email = body.email ? normEmail(body.email) : (user ? user.email : '');

  const governorate = isGovernorate(body.governorate);
  if (!governorate) {
    throw new ApiError(400, 'bad_governorate', 'Choose a governorate from the list.', { field: 'governorate' });
  }

  const address = required(body.address, 'address', 400);
  if (address.length < 8) {
    throw new ApiError(400, 'short_address', 'Give a full address — street, building and floor.', { field: 'address' });
  }

  const notes = clean(body.notes, 600);
  const payment = PAYMENTS.includes(body.payment) ? body.payment : 'cod';
  const lang = body.lang === 'en' ? 'en' : 'ar';

  if (body.terms !== true) {
    throw new ApiError(400, 'terms_required', 'Please accept the terms and the exchange policy.', { field: 'terms' });
  }

  /* --- what, priced here and only here --- */
  /* Prices come from D1 when the products table has rows, and from
     public/catalog.js if it does not — see lib/products.js. Either way they
     come from the SERVER; the cart only ever supplied ids and quantities. */
  const catalog = await loadCatalog(d1);
  const { items, subtotal } = priceCart(body.cart, catalog.resolve);
  const shipping = shippingFor(env);
  const total = subtotal + shipping;

  const id = orderNumber();
  const createdAt = new Date().toISOString();

  await d1.prepare(
    `INSERT INTO orders
       (id, user_id, name, phone, phone_alt, email, governorate, address, notes,
        payment, items, subtotal, shipping, total, currency, status, lang,
        notified, notify_error, ip, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'EGP','new',?15,0,NULL,?16,?17)`
  ).bind(
    id, user ? user.id : null, name, phone, phoneAlt || null, email || null,
    governorate, address, notes || null, payment, JSON.stringify(items),
    subtotal, shipping, total, lang, ip, createdAt
  ).run();

  /* Optional newsletter opt-in taken at checkout. Never blocks the order. */
  if (body.newsletter === true && email) {
    try {
      await d1.prepare(
        `INSERT INTO newsletter (email, name, marketing, source, lang, created_at)
         VALUES (?1, ?2, ?3, 'checkout', ?4, ?5)
         ON CONFLICT(email) DO UPDATE SET
           marketing = MAX(newsletter.marketing, ?3),
           unsub_at  = NULL`
      ).bind(email, name, body.marketing === true ? 1 : 0, lang, createdAt).run();
    } catch (err) {
      console.error('newsletter at checkout', err && err.message);
    }
  }

  const order = {
    id, name, phone, phone_alt: phoneAlt, email, governorate, address, notes,
    payment, items, subtotal, shipping, total, currency: 'EGP', status: 'new',
    lang, created_at: createdAt
  };

  /* The WhatsApp push is a BACK-OFFICE notification and nothing else. It goes
     to the shop's own number, it is never surfaced to the customer, and the
     message body — which carries the full order and the customer's details —
     is deliberately not returned in this response. From the customer's side
     this is an ordinary online order: they get a number and a confirmation.

     Fired after the write and through waitUntil, so a WhatsApp outage cannot
     slow down or fail an order that has already been taken. */
  const text = orderMessage(order, env);
  /* The two template parameters, in the order the approved template declares
     them: {{1}} the order number, {{2}} the total. They are passed separately
     from `text` because a template cannot carry the full multi-line summary —
     `text` is still used for the plain-text path and for the fallback when a
     template send is rejected. See lib/whatsapp.js. */
  const templateParams = [id, `${total} EGP`];
  context.waitUntil(
    notifyWhatsApp(env, text, null, templateParams).then((result) => recordNotify(d1, id, result))
  );

  /* Advertising measurement, only if the customer allowed it.

     This is the half of consent a browser cannot enforce: the relay below
     runs here, on the server, and reaches Meta whether or not the pixel was
     ever loaded — that is the entire point of it, and it is also why it has
     to be checked here. public/consent.js decides, public/shop.js sends the
     answer as `adConsent`, and a missing or false value means no.

     Defaulting a missing field to "no" is deliberate. An older cached
     shop.js that does not send the field yet will under-report for as long
     as it is cached, which costs some measurement; the other default would
     silently report customers who refused, which costs the promise the
     cookie bar makes. The order itself is unaffected either way. */
  if (body.adConsent === true) {
    const requestUrl = request.url || '';
    context.waitUntil(
      sendMetaPurchaseEvent(env, {
        ...order,
        total,
        value: total,
        subtotal,
        shipping
      }, requestUrl).then((result) => {
        if (!result || result.ok !== true) {
          console.info('meta purchase skipped or failed', result);
        }
      })
    );
  }

  return json({ ok: true, order: publicOrder(order) }, 201);
});

export const onRequestGet = handle(async (context) => {
  const d1 = await db(context.env);
  const user = await currentUser(context, d1);
  if (!user) return json({ ok: true, orders: [] });

  const { results } = await d1.prepare(
    `SELECT id, items, subtotal, shipping, total, currency, payment, status,
            governorate, created_at
       FROM orders WHERE user_id = ?1
      ORDER BY created_at DESC LIMIT 50`
  ).bind(user.id).all();

  return json({
    ok: true,
    orders: (results || []).map((row) => {
      let items = [];
      try { items = JSON.parse(row.items); } catch (e) { /* keep the row usable */ }
      return publicOrder(Object.assign({}, row, { items }));
    })
  });
});
