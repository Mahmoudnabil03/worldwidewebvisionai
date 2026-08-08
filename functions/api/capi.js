/* POST /api/capi   { event, eventId, sourceUrl, data }

   The Conversions API endpoint, on this site's own domain.

   This is the first-party alternative to Meta's Conversions API Gateway. The
   Gateway is a server you deploy and pay for on your own cloud account; this
   is the same idea — events reaching Meta from a server rather than from the
   browser — running inside the Pages Function that already exists, using the
   access token already configured, with nothing new to maintain.

   What it buys, concretely:

     Ad blockers and Safari's tracking protection stop the browser pixel for
     a large share of real traffic. They cannot stop this, because it is not
     the browser that talks to Meta.

     Match quality. The IP, the user agent and Meta's own _fbp / _fbc cookies
     are read here, server-side, where they cannot be stripped. fbc in
     particular is derived from the fbclid on an ad click and is the
     strongest attribution signal available.

   Every event is ALSO fired by the browser pixel with the same event_id, and
   Meta collapses the pair into one. That is the whole design: two paths, one
   event, so a blocked browser costs the measurement nothing and an unblocked
   one is not counted twice.

   ---------------------------------------------------------------------------
   Why this endpoint is not simply "post anything to Meta"
   ---------------------------------------------------------------------------
   It is public and unauthenticated — it has to be, since it measures visitors
   who are not signed in. So it is written as if hostile input is the norm:

     - same-origin only, so another site cannot drive it
     - the event name must be one this shop actually fires; an allowlist, not
       a passthrough. Otherwise anyone could mint Purchase events into the ad
       account and poison both the reporting and the delivery optimisation
     - `value` is clamped, so a scripted "Purchase, value 10000000" cannot
       skew the numbers
     - rate limited per IP
     - it never accepts an email or phone from the request body. Identifiers
       come from the signed-in session or not at all — otherwise the endpoint
       would happily hash and forward any address anybody typed into it,
       which is a data-laundering hole, not a feature.
*/
import { json, handle, readJson, requireSameOrigin, clean, clientIp } from '../../lib/util.js';
import { db, rateLimit } from '../../lib/db.js';
import { currentUser } from '../../lib/auth.js';
import { sendMetaConversion } from '../../lib/meta.js';

/* Exactly the events public/track.js fires. Adding one here without adding
   it there (or the reverse) is the bug this list exists to make obvious. */
const ALLOWED = new Set([
  'PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout',
  'AddPaymentInfo', 'Purchase', 'CompleteRegistration', 'Lead', 'Contact'
]);

/* A single order in this shop is a few thousand pounds. Anything past this is
   not a real basket, it is someone testing what the endpoint accepts. */
const MAX_VALUE = 2000000;

function cookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/* Meta's click id. If the visitor arrived on an ad, fbclid is in the URL and
   fbevents.js turns it into an _fbc cookie — but only after it has loaded,
   which is exactly what a blocked pixel never does. Rebuilding it from the
   URL means the click is still attributable when the pixel is blocked, which
   is the case this endpoint exists for. */
function fbcFrom(request, sourceUrl) {
  const existing = cookie(request, '_fbc');
  if (existing) return existing;
  try {
    const fbclid = new URL(sourceUrl).searchParams.get('fbclid');
    if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  } catch (e) { /* not a URL we can parse; no click id then */ }
  return '';
}

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  requireSameOrigin(request);

  const body = await readJson(request);
  const eventName = clean(body.event, 40);

  /* Answer 204 to everything plausible rather than describing what was wrong.
     This is a measurement endpoint on a public page: it should never become a
     way to probe what the ad account accepts, and a browser has nothing
     useful to do with the answer either way. */
  const drop = () => new Response(null, { status: 204 });
  if (!ALLOWED.has(eventName)) return drop();

  const d1 = await db(env);
  /* Generous — a real visit fires several events — but bounded, so one
     machine cannot flood the dataset. Fails open, like every other limiter
     here: losing measurement is better than losing the page. */
  const ip = clientIp(request);
  const limit = await rateLimit(d1, `capi:${ip}`, 120, 600);
  if (!limit.ok) return drop();

  /* Identity, if there is any, comes from the session cookie — never from
     the request body. */
  let user = null;
  try { user = await currentUser(context, d1); } catch (e) { /* signed out */ }

  const data = (body.data && typeof body.data === 'object') ? body.data : {};
  if (data.value !== undefined) {
    const v = Number(data.value);
    data.value = Number.isFinite(v) ? Math.min(Math.max(v, 0), MAX_VALUE) : 0;
  }

  const sourceUrl = clean(body.sourceUrl, 500) || request.headers.get('referer') || '';
  const eventId = clean(body.eventId, 100);
  const value = data.value !== undefined ? Number(data.value) : null;
  const currency = clean(data.currency, 10) || 'EGP';

  /* Which products this event was about.

     Without it the admin can only be told "412 ViewContent events", which is
     a number nobody can act on. With it the same rows answer "3 views of the
     Imou 3MP, 2 purchases of the UNV 2MP" — see the per-product table in
     functions/api/admin/stats.js, which runs json_each over this column.

     That query is why the value is ALWAYS valid JSON or NULL, never a
     half-formed string: json_each on malformed JSON errors, and it would take
     the whole stats endpoint down rather than one table with it. Ids are
     clamped in count and length because this is a public endpoint and the
     body is attacker-controlled. */
  const rawIds = Array.isArray(data.content_ids) ? data.content_ids : [];
  const contentIds = rawIds
    .map((v) => clean(v, 64))
    .filter(Boolean)
    .slice(0, 40);
  const contentName = clean(data.content_name, 120) ||
    /* AddToCart carries the name at the top level; the cart-shaped events
       carry per-line objects instead, so fall back to the first line. */
    (Array.isArray(data.contents) && data.contents.length ? clean(data.contents[0].name, 120) : '');

  const metaEventRow = {
    content_ids: contentIds.length ? JSON.stringify(contentIds) : null,
    content_name: contentName || null,
    id: eventId || `${eventName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event: eventName,
    event_id: eventId,
    source_url: sourceUrl,
    value: Number.isFinite(value) ? Math.round(value) : null,
    currency,
    user_id: user ? user.id : null,
    external_id: user ? user.id : null,
    email: user ? user.email : null,
    phone: user ? user.phone : null,
    client_ip: ip,
    user_agent: request.headers.get('user-agent') || '',
    created_at: new Date().toISOString()
  };

  await d1.prepare(
    `INSERT INTO meta_events
       (id, event, event_id, source_url, value, currency, user_id, external_id, email, phone, client_ip, user_agent, created_at, content_ids, content_name)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`
  ).bind(
    metaEventRow.id,
    metaEventRow.event,
    metaEventRow.event_id,
    metaEventRow.source_url,
    metaEventRow.value,
    metaEventRow.currency,
    metaEventRow.user_id,
    metaEventRow.external_id,
    metaEventRow.email,
    metaEventRow.phone,
    metaEventRow.client_ip,
    metaEventRow.user_agent,
    metaEventRow.created_at,
    metaEventRow.content_ids,
    metaEventRow.content_name
  ).run().catch((err) => {
    /* This row is the ONLY source for the admin Performance tab's traffic
       numbers — nothing else writes meta_events. Swallowing the error meant a
       failing insert looked exactly like a quiet week: every figure zero,
       nothing anywhere saying why. Measurement still must not break the page,
       so it stays non-fatal, but it no longer fails invisibly. */
    console.error('meta_events insert failed', eventName, err && err.message);
  });

  /* Fired through waitUntil: the visitor's browser must never wait on
     Meta's API to finish, and a slow or failing Graph call must not turn
     into a slow page. */
  context.waitUntil(
    sendMetaConversion(env, {
      eventName,
      eventId,
      sourceUrl,
      customData: data,
      email: user ? user.email : '',
      phone: user ? user.phone : '',
      externalId: user ? user.id : '',
      fbp: cookie(request, '_fbp'),
      fbc: fbcFrom(request, sourceUrl),
      clientIp: ip,
      userAgent: request.headers.get('user-agent') || ''
    }).then((res) => {
      if (!res || (res.ok !== true && res.skipped !== true)) {
        console.error('capi', eventName, JSON.stringify(res).slice(0, 300));
      }
    })
  );

  return drop();
});

/* A GET is what you get from pasting the URL into a browser to check the
   endpoint exists. Say so, rather than answering 405. */
export const onRequestGet = handle(async () =>
  json({
    ok: true,
    endpoint: 'Conversions API relay',
    method: 'POST',
    events: Array.from(ALLOWED)
  })
);
