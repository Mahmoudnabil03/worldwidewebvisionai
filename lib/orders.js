/* =========================================================================
   Order pricing, numbering and the message that lands on WhatsApp.

   The one rule here: the client's prices are never used. The cart that
   arrives is a list of {id, qty}; everything else — name, unit price, line
   total, order total — is rebuilt from public/catalog.js on the server. A
   tampered cart cannot change what an order costs.
   ========================================================================= */
import { PRODUCTS, findProduct, GOVERNORATES } from '../public/catalog.js';
import { ApiError, clean, cairoDate, cairoStamp, displayPhoneEg } from './util.js';

export const MAX_LINES = 40;
export const MAX_QTY = 99;

/* The default is the WhatsApp number already published across the site.
   WHATSAPP_TO overrides it without touching code. */
export const DEFAULT_MERCHANT_WA = '201105006854';

export function merchantWa(env) {
  const raw = clean((env && (env.WHATSAPP_TO || env.MERCHANT_WHATSAPP)) || '', 20).replace(/\D/g, '');
  return raw || DEFAULT_MERCHANT_WA;
}

/* Unambiguous alphabet: no O/0, no I/1. These numbers get read aloud down a
   phone line. */
const ALPHABET = '23456789ACDEFGHJKLMNPQRSTUVWXYZ';

export function orderNumber(date) {
  const ymd = cairoDate(date).slice(2).replace(/-/g, '');   // 260731
  const rand = crypto.getRandomValues(new Uint8Array(4));
  let tail = '';
  for (let i = 0; i < 4; i++) tail += ALPHABET[rand[i] % ALPHABET.length];
  return `VG-${ymd}-${tail}`;
}

/* -------------------------------------------------------------------------
   Pricing
   ------------------------------------------------------------------------- */
export function priceCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new ApiError(400, 'empty_cart', 'Your cart is empty.');
  }
  if (cart.length > MAX_LINES) {
    throw new ApiError(400, 'too_many_lines', `An order can hold at most ${MAX_LINES} different products.`);
  }

  const merged = new Map();
  for (const raw of cart) {
    if (!raw || typeof raw !== 'object') continue;
    const id = clean(raw.id, 64);
    const product = findProduct(id);
    if (!product) {
      throw new ApiError(400, 'unknown_product', 'One of the products is no longer available.', { id });
    }
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new ApiError(400, 'bad_qty', 'Quantity must be a whole number of at least 1.', { id });
    }
    if (qty > MAX_QTY) {
      throw new ApiError(400, 'bad_qty', `Maximum ${MAX_QTY} per product. For more, message us on WhatsApp.`, { id });
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }

  if (merged.size === 0) throw new ApiError(400, 'empty_cart', 'Your cart is empty.');

  const items = [];
  let subtotal = 0;
  for (const [id, qtyRaw] of merged) {
    const qty = Math.min(qtyRaw, MAX_QTY);
    const p = findProduct(id);
    const line = p.price * qty;
    subtotal += line;
    items.push({
      id: p.id,
      name: p.name,
      cat: p.cat,
      specAr: p.ar,
      specEn: p.en,
      qty,
      unit: p.price,
      line
    });
  }
  return { items, subtotal };
}

/* Shipping is quoted per governorate at confirmation rather than guessed
   here — the store publishes no shipping table, and inventing one would put
   a wrong number in front of a customer. Set SHIPPING_FLAT to a whole number
   of pounds if you want a fixed fee applied instead. */
export function shippingFor(env) {
  const n = parseInt((env && env.SHIPPING_FLAT) || '', 10);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : 0;
}

export function isGovernorate(value) {
  const v = clean(value, 60);
  return GOVERNORATES.some((g) => g.ar === v || g.en === v) ? v : '';
}

export const PAYMENTS = ['cod', 'transfer'];

const PAYMENT_LABEL = {
  cod:      { ar: 'الدفع عند الاستلام', en: 'Cash on delivery' },
  transfer: { ar: 'تحويل بنكي / محفظة إلكترونية', en: 'Bank transfer / e-wallet' }
};

export function paymentLabel(code, lang) {
  const l = PAYMENT_LABEL[code] || PAYMENT_LABEL.cod;
  return lang === 'en' ? l.en : l.ar;
}

/* -------------------------------------------------------------------------
   The WhatsApp body

   Plain text, Arabic-first, ordered so the first two lines are what you need
   at a glance on a phone lock screen: what it is, and its number.
   ------------------------------------------------------------------------- */
export function orderMessage(order, env) {
  const money = (n) => `${Number(n).toLocaleString('en-US')} ج.م`;
  const lines = [];

  lines.push('🔔 طلب جديد من الموقع — Vision Guard');
  lines.push(`رقم الطلب: ${order.id}`);
  lines.push(`الوقت: ${cairoStamp(new Date(order.created_at))}`);
  lines.push('');
  lines.push(`الاسم: ${order.name}`);
  lines.push(`الموبايل: ${displayPhoneEg(order.phone)}`);
  if (order.phone_alt) lines.push(`موبايل بديل: ${displayPhoneEg(order.phone_alt)}`);
  if (order.email) lines.push(`الإيميل: ${order.email}`);
  lines.push(`المحافظة: ${order.governorate}`);
  lines.push(`العنوان: ${order.address}`);
  lines.push(`طريقة الدفع: ${paymentLabel(order.payment, 'ar')}`);
  lines.push('');
  lines.push('المنتجات:');
  for (const it of order.items) {
    lines.push(`• ${it.name} × ${it.qty} — ${money(it.line)}`);
  }
  lines.push('');
  lines.push(`الإجمالي: ${money(order.subtotal)}`);
  lines.push(
    order.shipping > 0
      ? `الشحن: ${money(order.shipping)}`
      : 'الشحن: يتحدد حسب المحافظة ويتأكد مع العميل'
  );
  if (order.shipping > 0) lines.push(`الإجمالي شامل الشحن: ${money(order.total)}`);
  if (order.notes) {
    lines.push('');
    lines.push(`ملاحظات العميل: ${order.notes}`);
  }
  lines.push('');
  lines.push(`رد على العميل: https://wa.me/${order.phone}`);

  return lines.join('\n');
}

/* Back-office only: a one-tap link that opens the order summary in the shop's
   own WhatsApp. It is NOT returned to the customer — the message body carries
   their full details and the internal summary. Kept for an admin view or a
   manual re-send. */
export function orderWaLink(order, env) {
  return `https://wa.me/${merchantWa(env)}?text=${encodeURIComponent(orderMessage(order, env))}`;
}

export function publicOrder(order) {
  return {
    id: order.id,
    items: order.items,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    currency: order.currency || 'EGP',
    payment: order.payment,
    status: order.status || 'new',
    governorate: order.governorate,
    createdAt: order.created_at
  };
}

export const CATALOG_SIZE = PRODUCTS.length;
