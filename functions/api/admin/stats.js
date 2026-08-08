/* GET /api/admin/stats?days=30

   How the shop is doing, for the administrator. Admin only, enforced here —
   see lib/auth.js -> requireAdmin.

   Everything below is derived from data this site already stores. There is
   no page-view or session tracking in it, deliberately: that lives in the
   Meta pixel, and building a second analytics system out of D1 rows would be
   both worse than the tools that do it properly and a new pile of personal
   data to hold. What this answers is the question the pixel cannot — what
   actually happened to the orders.

   Aggregation is done in SQL rather than by reading rows into the Worker:
   COUNT and SUM over an index is a few milliseconds, and pulling a year of
   orders into memory to add them up is how a dashboard becomes the slowest
   endpoint on the site. The one exception is the product breakdown, which
   has to parse the items JSON, and is therefore bounded by LIMIT.
*/
import { json, handle, cairoDate, TZ } from '../../../lib/util.js';
import { db } from '../../../lib/db.js';
import { requireAdmin } from '../../../lib/auth.js';
import { targetSeconds } from '../../../lib/attendance.js';

/* Orders carry an ISO-8601 UTC created_at, so a date comparison is a string
   comparison against the same prefix. Cheap, and index-friendly. */
const sinceIso = (days) => new Date(Date.now() - days * 86400000).toISOString();

export const onRequestGet = handle(async (context) => {
  const { request, env } = context;
  const d1 = await db(env);
  await requireAdmin(context, d1);

  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 365) : 30;

  const from = sinceIso(days);
  const prevFrom = sinceIso(days * 2);          // the window before it, to compare against
  const today = cairoDate();

  /* ---- orders: this window, and the one before it ---- */
  const window = await d1.prepare(
    `SELECT COUNT(*) AS orders,
            COALESCE(SUM(total), 0) AS revenue,
            COUNT(DISTINCT COALESCE(user_id, phone)) AS customers,
            COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
            COALESCE(SUM(CASE WHEN notified = 0 THEN 1 ELSE 0 END), 0) AS unnotified
       FROM orders WHERE created_at >= ?1`
  ).bind(from).first();

  const previous = await d1.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE created_at >= ?1 AND created_at < ?2`
  ).bind(prevFrom, from).first();

  const todayRow = await d1.prepare(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE created_at >= ?1`
  ).bind(today + 'T00:00:00.000Z').first();

  /* ---- status breakdown ---- */
  const { results: statusRows } = await d1.prepare(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS value
       FROM orders WHERE created_at >= ?1 GROUP BY status`
  ).bind(from).all();

  /* ---- a daily series, for the sparkline ---- */
  const { results: daily } = await d1.prepare(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE created_at >= ?1
      GROUP BY day ORDER BY day ASC`
  ).bind(from).all();

  /* ---- governorates: where the orders actually come from ---- */
  const { results: govs } = await d1.prepare(
    `SELECT governorate, COUNT(*) AS n, COALESCE(SUM(total), 0) AS value
       FROM orders WHERE created_at >= ?1
      GROUP BY governorate ORDER BY n DESC LIMIT 8`
  ).bind(from).all();

  /* ---- payment split ---- */
  const { results: payments } = await d1.prepare(
    `SELECT payment, COUNT(*) AS n FROM orders WHERE created_at >= ?1 GROUP BY payment`
  ).bind(from).all();

  /* ---- accounts and the mailing list ---- */
  const accounts = await d1.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN created_at >= ?1 THEN 1 ELSE 0 END), 0) AS created,
            COALESCE(SUM(CASE WHEN newsletter = 1 THEN 1 ELSE 0 END), 0) AS subscribed
       FROM users`
  ).bind(from).first();

  const list = await d1.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN unsub_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS unsubscribed
       FROM newsletter`
  ).first();

  /* ---- who is on the clock right now ---- */
  const onShift = await d1.prepare(
    `SELECT COUNT(*) AS n FROM attendance WHERE clock_out IS NULL`
  ).first();

  const workedToday = await d1.prepare(
    `SELECT COUNT(DISTINCT user_id) AS people, COALESCE(SUM(seconds), 0) AS seconds
       FROM attendance WHERE work_date = ?1`
  ).bind(today).first();

  /* ---- Meta event telemetry: traffic, visitors, and marketing signals ----

     Every field below is filled in even when there is nothing to report. The
     admin panel reads d.traffic.* positionally and a missing object there
     took the whole rest of the panel down with it — headline stats rendered,
     then nothing. An analytics section with no data is a legitimate state
     (a new deployment, an empty window, a rejected consent); it must read as
     zeroes, never as an absent key. */
  const EMPTY_TRAFFIC = {
    total_events: 0, unique_visitors: 0, page_views: 0, searches: 0,
    add_to_cart: 0, checkout_started: 0, purchases: 0
  };
  let metaTraffic = null;
  let eventBreakdown = [];
  try {
    metaTraffic = await d1.prepare(
      `SELECT COUNT(*) AS total_events,
              COUNT(DISTINCT COALESCE(user_id, external_id, client_ip)) AS unique_visitors,
              COALESCE(SUM(CASE WHEN event = 'PageView' THEN 1 ELSE 0 END), 0) AS page_views,
              COALESCE(SUM(CASE WHEN event = 'Search' THEN 1 ELSE 0 END), 0) AS searches,
              COALESCE(SUM(CASE WHEN event = 'AddToCart' THEN 1 ELSE 0 END), 0) AS add_to_cart,
              COALESCE(SUM(CASE WHEN event = 'InitiateCheckout' THEN 1 ELSE 0 END), 0) AS checkout_started,
              COALESCE(SUM(CASE WHEN event = 'Purchase' THEN 1 ELSE 0 END), 0) AS purchases
         FROM meta_events WHERE created_at >= ?1`
    ).bind(from).first();

    const breakdown = await d1.prepare(
      `SELECT event, COUNT(*) AS n
         FROM meta_events WHERE created_at >= ?1
        GROUP BY event ORDER BY n DESC LIMIT 8`
    ).bind(from).all();
    eventBreakdown = breakdown.results || [];
  } catch (err) {
    /* meta_events table missing or query failed — analytics unavailable but
       the rest of the dashboard should still load. */
    console.error('meta_events query failed:', err && err.message);
    metaTraffic = null;
  }
  /* An aggregate SELECT returns one row, so this should not be reachable —
     but `.first()` is typed to return null and the old code dereferenced it
     without checking, which is a 500 on the whole dashboard rather than a
     missing number. Belt to the catch above's braces. */
  if (!metaTraffic) metaTraffic = EMPTY_TRAFFIC;

  /* ---- per-product pixel events ----

     "3 views of the Imou 3MP, 2 purchases of the UNV 2MP" — the event mix
     broken down by the product it was about, rather than one total per event
     name. content_ids is a JSON array written by functions/api/capi.js, so
     json_each expands one row per product mentioned: an AddToCart naming
     three products counts once against each of them, which is what the
     numbers are supposed to mean.

     LEFT JOIN on products, not INNER: an event about a product that has since
     been deleted or renamed still has to appear, or the report quietly stops
     adding up. content_name is the name captured at event time and is the
     fallback when the row is gone.

     Wrapped, because it is the only query here that depends both on a
     migration having run and on the JSON1 extension. Neither is worth taking
     the rest of the dashboard down for. */
  let productEvents = [];
  try {
    const { results: perProduct } = await d1.prepare(
      `SELECT je.value        AS product_id,
              m.event         AS event,
              COUNT(*)        AS n,
              MAX(COALESCE(p.name, m.content_name, je.value)) AS name
         FROM meta_events m
         JOIN json_each(m.content_ids) je
         LEFT JOIN products p ON p.id = je.value
        WHERE m.created_at >= ?1
          AND m.content_ids IS NOT NULL
        GROUP BY product_id, m.event`
    ).bind(from).all();

    /* Pivoted here rather than in SQL: the set of event names is open (see
       the allowlist in capi.js) and a fixed set of CASE columns would silently
       drop any event added later. */
    const byProduct = new Map();
    for (const row of perProduct || []) {
      const id = String(row.product_id);
      const entry = byProduct.get(id) || { id, name: row.name || id, events: {}, total: 0 };
      entry.events[row.event] = Number(row.n) || 0;
      entry.total += Number(row.n) || 0;
      if (row.name) entry.name = row.name;
      byProduct.set(id, entry);
    }
    productEvents = Array.from(byProduct.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  } catch (err) {
    console.error('per-product events query failed:', err && err.message);
    productEvents = [];
  }

  /* ---- top products ----
     The only part that has to parse JSON. Bounded by LIMIT so a busy year
     cannot turn this into a scan. */
  const { results: recent } = await d1.prepare(
    `SELECT items FROM orders WHERE created_at >= ?1 ORDER BY created_at DESC LIMIT 400`
  ).bind(from).all();

  const tally = new Map();
  for (const row of recent || []) {
    let items = [];
    try { items = JSON.parse(row.items); } catch (e) { continue; }
    for (const it of items) {
      const key = it.id;
      const prev = tally.get(key) || { id: key, name: it.name, qty: 0, value: 0 };
      prev.qty += Number(it.qty) || 0;
      prev.value += Number(it.line) || 0;
      tally.set(key, prev);
    }
  }
  const topProducts = Array.from(tally.values()).sort((a, b) => b.qty - a.qty).slice(0, 8);

  const orders = Number(window.orders) || 0;
  const revenue = Number(window.revenue) || 0;
  const prevOrders = Number(previous && previous.orders) || 0;
  const prevRevenue = Number(previous && previous.revenue) || 0;

  /* A percentage change against zero is not 100%, it is undefined — and
     showing "+100%" for the first order ever is a lie a dashboard should not
     tell. null means "nothing to compare with". */
  const delta = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

  return json({
    ok: true,
    timezone: TZ,
    range: { days, from, to: new Date().toISOString() },
    today: {
      date: today,
      orders: Number(todayRow.orders) || 0,
      revenue: Number(todayRow.revenue) || 0
    },
    orders: {
      count: orders,
      revenue,
      customers: Number(window.customers) || 0,
      cancelled: Number(window.cancelled) || 0,
      average: orders > 0 ? Math.round(revenue / orders) : 0,
      /* Alerts that never reached anyone. A number that should be 0, and the
         only place a silent Telegram/WhatsApp failure is visible. */
      unnotified: Number(window.unnotified) || 0,
      previous: { count: prevOrders, revenue: prevRevenue },
      change: { orders: delta(orders, prevOrders), revenue: delta(revenue, prevRevenue) }
    },
    statuses: (statusRows || []).map((r) => ({ status: r.status, n: Number(r.n), value: Number(r.value) })),
    payments: (payments || []).map((r) => ({ payment: r.payment, n: Number(r.n) })),
    governorates: (govs || []).map((r) => ({ name: r.governorate, n: Number(r.n), value: Number(r.value) })),
    daily: (daily || []).map((r) => ({ day: r.day, orders: Number(r.orders), revenue: Number(r.revenue) })),
    topProducts,
    accounts: {
      total: Number(accounts.total) || 0,
      created: Number(accounts.created) || 0,
      subscribed: Number(accounts.subscribed) || 0
    },
    newsletter: {
      total: Number(list.total) || 0,
      unsubscribed: Number(list.unsubscribed) || 0
    },
    traffic: {
      totalEvents: Number(metaTraffic.total_events) || 0,
      uniqueVisitors: Number(metaTraffic.unique_visitors) || 0,
      pageViews: Number(metaTraffic.page_views) || 0,
      searches: Number(metaTraffic.searches) || 0,
      addToCart: Number(metaTraffic.add_to_cart) || 0,
      checkoutStarted: Number(metaTraffic.checkout_started) || 0,
      purchases: Number(metaTraffic.purchases) || 0
    },
    marketing: {
      pixelConfigured: Boolean(env.META_PIXEL_ID && env.META_ACCESS_TOKEN),
      eventBreakdown: (eventBreakdown || []).map((row) => ({ event: row.event, n: Number(row.n) })),
      /* [{ id, name, total, events: { ViewContent: 3, Purchase: 2, ... } }] */
      productEvents
    },
    staff: {
      onShift: Number(onShift.n) || 0,
      workedToday: Number(workedToday.people) || 0,
      secondsToday: Number(workedToday.seconds) || 0,
      targetSeconds: targetSeconds(env)
    }
  });
});
