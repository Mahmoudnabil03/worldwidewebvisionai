const DEFAULT_CURRENCY = 'EGP';
const DEFAULT_ATTRIBUTION_SHARE = '0.3';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

async function hashValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function configFromEnv(env) {
  /* The pixel — which Meta now also calls the dataset; one object, one id.
     Here it is "visionguardeg", 2037293923502315.

     It has a default for the third time in this repository, and for the same
     reason each time (see WHATSAPP_TEMPLATE in lib/whatsapp.js and
     FIREBASE_PROJECT_ID in lib/firebase.js): wrangler.toml [vars] have not
     reliably reached this Pages project's runtime, and an empty value here
     does not fail loudly — sendMetaEvent returns `missing_config` and every
     conversion is silently dropped. The id is public: it ships in the markup
     of every page and identifies the dataset, nothing more. It is NOT the
     access token, which is a real credential and has no default anywhere.

     It must stay identical to PIXEL_ID in public/pixel.js, or the browser
     and the server would report to two different datasets and neither set of
     numbers would be complete. Change one, change both. */
  const pixelId = (env && (env.META_PIXEL_ID || env.META_PIXEL || env.PIXEL_ID)) || '2037293923502315';
  /* The dataset (or pixel) events are posted to.

     There used to be a hardcoded default here — '37444427775716864' — and it
     was wrong by one digit: the real dataset on this account is
     3744427775716864, sixteen digits, not seventeen. Because sendMetaEvent
     prefers the dataset over the pixel, EVERY server-side event was posted to
     an object that does not exist. Graph answers "Object with ID ... does not
     exist", the send fails, and nothing downstream notices, because the
     failure is logged and the order carries on. Server-side Purchase events
     had therefore never arrived, whatever the token said.

     No default now. Unset means "use the pixel id", which is always correct
     and always exists — the pixel is what the browser already reports to, so
     the two halves land in the same place by construction. Set
     META_DATASET_ID only if you deliberately want a different destination,
     and then a typo shows up as events missing from ONE named place rather
     than silently vanishing. */
  const datasetId = (env && (env.META_DATASET_ID || env.META_DATASET || env.DATASET_ID)) || '';
  /* No hardcoded fallback, deliberately. A Conversions API token is a
     long-lived credential with write access to the ad account's dataset, and
     lib/ is committed — a default here is a secret published to whoever can
     read the repository. If the variable is missing, sendMetaEvent returns a
     'not configured' result and the site carries on; that is the correct
     failure, and it is visible. */
  const accessToken = (env && (env.META_ACCESS_TOKEN || env.META_TOKEN || env.FB_ACCESS_TOKEN)) || '';
  const currency = (env && (env.META_CURRENCY || env.META_CURRENCY_CODE)) || DEFAULT_CURRENCY;
  const attributionShare = Number((env && env.META_ATTRIBUTION_SHARE) || DEFAULT_ATTRIBUTION_SHARE);
  return { pixelId, datasetId, accessToken, currency, attributionShare };
}

/* =========================================================================
   A single conversion, sent server-to-server.

   This is what /api/capi uses. It is the same Conversions API the Purchase
   event below has always used, generalised so any event the browser fires
   can be mirrored from the server.

   WHY MIRROR AT ALL. The browser pixel is blocked for a large share of real
   traffic — ad blockers, Safari's tracking protection, privacy browsers. A
   server-sent copy is not blocked, because it does not come from the
   browser. Meta collapses the pair into one event when both carry the same
   event_id, which is why track.js generates one per event and sends it to
   both.

   WHAT MAKES IT MATCH. An event with no identifiers is nearly useless to
   Meta — it cannot attribute it to anyone who saw an ad. The three things
   that matter most here are the _fbp / _fbc cookies (Meta's own browser and
   click identifiers), the customer's IP, and the user agent. All three are
   read server-side, where the browser cannot get them wrong and an ad
   blocker cannot strip them.

   WHAT NEVER LEAVES RAW. Email and phone are hashed with SHA-256 before the
   request is built, which is what Meta requires and what makes this safe:
   Meta receives an irreversible fingerprint it can match against its own
   hashes, never the address itself.
   ========================================================================= */
export async function sendMetaConversion(env, event) {
  const { currency, attributionShare } = configFromEnv(env);

  const userData = {};
  if (event.email) userData.em = [await hashValue(normalizeEmail(event.email))];
  if (event.phone) userData.ph = [await hashValue(normalizePhone(event.phone))];
  /* Meta's own identifiers. fbp is the browser id it sets itself; fbc is
     derived from the fbclid on an ad click and is the single strongest
     attribution signal there is. */
  if (event.fbp) userData.fbp = event.fbp;
  if (event.fbc) userData.fbc = event.fbc;
  if (event.clientIp) userData.client_ip_address = event.clientIp;
  if (event.userAgent) userData.client_user_agent = event.userAgent;
  if (event.externalId) userData.external_id = [await hashValue(event.externalId)];

  const custom = Object.assign({}, event.customData || {});
  if (custom.value !== undefined) custom.value = Number(custom.value) || 0;
  if (!custom.currency) custom.currency = currency;
  if (Number.isFinite(custom.value)) custom.value = Number(custom.value.toFixed(2));

  const eventTime = Math.floor(Date.now() / 1000);
  const payload = {
    data: [{
      event_name: event.eventName,
      event_time: eventTime,
      event_id: event.eventId || '',
      action_source: 'website',
      event_source_url: event.sourceUrl || '',
      user_data: userData,
      attribution_data: { attribution_share: attributionShare },
      custom_data: custom,
      original_event_data: {
        event_name: event.eventName,
        event_time: eventTime
      }
    }]
  };

  if (env && env.META_TEST_EVENT_CODE) {
    payload.data[0].test_event_code = env.META_TEST_EVENT_CODE;
  }

  return sendMetaEvent(env, payload);
}

export async function sendMetaEvent(env, payload) {
  const { pixelId, datasetId, accessToken } = configFromEnv(env);
  if (!pixelId || !accessToken) {
    return { ok: false, skipped: true, reason: 'missing_config' };
  }

  if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
    return { ok: false, skipped: false, error: 'missing_data' };
  }

  const targetId = datasetId || pixelId;
  const endpoint = `https://graph.facebook.com/v22.0/${encodeURIComponent(targetId)}/events?access_token=${encodeURIComponent(accessToken)}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const bodyText = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      body: bodyText,
      skipped: false
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error && error.message ? error.message : String(error)
    };
  }
}

/* =========================================================================
   Purchase, server side.

   DEDUPLICATION — the part that was missing and silently doubled every
   number in Ads Manager.

   This event is deliberately sent twice: once from the browser (public/
   track.js, when the confirmation screen appears) and once from here. The
   server copy is the one that survives ad blockers and Safari's tracking
   protection, which is most of this shop's traffic; the browser copy carries
   the cookies Meta matches on. Sending both is correct and is what Meta
   recommends.

   But Meta only collapses the pair into ONE conversion when both copies
   carry the same `event_id` alongside the same `event_name`. Neither copy
   had one. Every order was therefore counted as two purchases at twice the
   revenue — and nothing anywhere reports that, because both events are
   individually valid.

   The order number is the id. It already exists, it is unique per order by
   construction, it is known to both sides at the moment each fires, and it
   is not personal data.
   ========================================================================= */
export async function sendMetaPurchaseEvent(env, order, requestUrl) {
  const { currency, attributionShare } = configFromEnv(env);
  const email = order && order.email ? normalizeEmail(order.email) : '';
  const phone = order && order.phone ? normalizePhone(order.phone) : '';
  const userData = {};
  if (email) userData.em = [await hashValue(email)];
  if (phone) userData.ph = [await hashValue(phone)];

  const value = Number(order && (order.total ?? order.value ?? order.subtotal) || 0);
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = order && order.id ? String(order.id) : '';

  /* The same contents the browser sends, so the two copies describe one
     order rather than merely agreeing on a total. */
  const items = Array.isArray(order && order.items) ? order.items : [];
  const contents = items.map((i) => ({
    id: String(i.id),
    quantity: Number(i.qty) || 0,
    item_price: Number(i.unit) || 0
  }));

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      /* Must match the browser's eventID exactly, or Meta counts this order
         twice. See the note above. */
      event_id: eventId,
      action_source: 'website',
      event_source_url: requestUrl || '',
      user_data: userData,
      attribution_data: {
        attribution_share: attributionShare
      },
      custom_data: {
        currency,
        value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
        content_type: 'product',
        order_id: eventId,
        ...(contents.length
          ? {
              contents,
              content_ids: contents.map((c) => c.id),
              num_items: contents.reduce((n, c) => n + c.quantity, 0)
            }
          : {})
      },
      original_event_data: {
        event_name: 'Purchase',
        event_time: eventTime
      }
    }]
  };

  if (env && env.META_TEST_EVENT_CODE) {
    payload.data[0].test_event_code = env.META_TEST_EVENT_CODE;
  }

  return await sendMetaEvent(env, payload);
}
