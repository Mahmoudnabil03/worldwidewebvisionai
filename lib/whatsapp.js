/* =========================================================================
   WhatsApp notification.

   Four providers, picked by whichever credentials you actually set. Nothing
   here is required for the shop to work: an order is written to D1 first and
   the notification is fired afterwards through waitUntil(), so a WhatsApp
   outage, a wrong token or an expired 24-hour window can slow nothing down
   and lose nothing. Failures are recorded on the order row
   (notified / notify_error) instead of being thrown at the customer.

   ---------------------------------------------------------------------------
   Choosing a provider
   ---------------------------------------------------------------------------
   meta      Official WhatsApp Cloud API. Free tier, needs a Meta Business
             account and a verified number. Business-initiated messages
             outside a 24-hour customer window MUST use an approved template,
             so set WHATSAPP_TEMPLATE to your approved template name. Plain
             text is used only if WHATSAPP_ALLOW_TEXT=1 and you know the
             recipient messaged you in the last 24 hours.
   ultramsg  Unofficial bridge to a normal WhatsApp account. No template
             approval, no 24-hour rule. Paid, and it is not Meta-sanctioned.
   twilio    Twilio's WhatsApp channel. Same template rules as Meta.
   callmebot Free, one recipient, plain text. Fine for "ping my phone".

   Set WHATSAPP_PROVIDER to force one; otherwise the first provider with
   complete credentials wins, in the order above.
   ========================================================================= */
import { merchantWa } from './orders.js';

const TIMEOUT_MS = 8000;

function has(env, ...keys) {
  return keys.every((k) => env && typeof env[k] === 'string' && env[k].trim().length > 0);
}

/* Reads the first of several names that is actually set.

   This exists because the names Meta uses in its own dashboard and docs
   (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID) are not the shorter ones
   this file was originally written against. Secrets were provisioned under
   Meta's names, pickProvider looked for the short ones, found nothing, and
   every order recorded `none: no_provider_configured` while the credentials
   sat there correctly configured. Accepting both spellings costs nothing and
   removes a failure mode that is invisible until you read the order rows. */
function firstOf(env, ...keys) {
  for (const k of keys) {
    const v = env && env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function metaToken(env)   { return firstOf(env, 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN'); }
export function metaPhoneId(env) { return firstOf(env, 'WHATSAPP_PHONE_ID', 'WHATSAPP_PHONE_NUMBER_ID'); }

export function pickProvider(env) {
  const forced = (env && env.WHATSAPP_PROVIDER ? String(env.WHATSAPP_PROVIDER) : '').trim().toLowerCase();
  if (forced) return forced;
  if (metaToken(env) && metaPhoneId(env)) return 'meta';
  if (has(env, 'ULTRAMSG_INSTANCE', 'ULTRAMSG_TOKEN')) return 'ultramsg';
  if (has(env, 'TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM')) return 'twilio';
  if (has(env, 'CALLMEBOT_KEY')) return 'callmebot';
  return 'none';
}

async function post(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, Object.assign({ signal: ctl.signal }, init));
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Meta WhatsApp Cloud API ----------------

   Two shapes of message, and which one you get matters more than it looks.

   A plain text message is only deliverable inside a 24-hour "customer service
   window" — that is, within a day of the recipient messaging the business
   number. An order alert to the shop's own phone is almost never inside that
   window, so plain text fails with error 131047 and the alert is lost exactly
   when it is wanted. A template has no such restriction, which is why one is
   used whenever WHATSAPP_TEMPLATE names one.

   Template body parameters cannot contain newlines, and Meta rejects four or
   more consecutive spaces, so anything passed here is flattened first. */
function templatePayload(env, to, params) {
  const clean = (s) => String(s).replace(/\s*\n\s*/g, ' · ').replace(/ {4,}/g, ' ').slice(0, 1024);
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: (env.WHATSAPP_TEMPLATE || '').trim(),
      language: { code: (env.WHATSAPP_TEMPLATE_LANG || 'ar').trim() },
      components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: clean(p) })) }]
    }
  };
}

function textPayload(to, text) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body: text.slice(0, 4096) }
  };
}

async function sendMeta(env, to, text, templateParams) {
  const version = (env.WHATSAPP_API_VERSION || 'v21.0').trim();
  const url = `https://graph.facebook.com/${version}/${metaPhoneId(env)}/messages`;
  const headers = {
    authorization: `Bearer ${metaToken(env)}`,
    'content-type': 'application/json'
  };
  const send = (payload) => post(url, { method: 'POST', headers, body: JSON.stringify(payload) });

  const template = (env.WHATSAPP_TEMPLATE || '').trim();
  const allowText = String(env.WHATSAPP_ALLOW_TEXT || '') === '1';

  if (template && !allowText) {
    /* Caller-supplied parameters when the approved template expects several
       (order number, total); otherwise the whole summary in a single {{1}}. */
    const params = Array.isArray(templateParams) && templateParams.length
      ? templateParams
      : [text];
    try {
      return await send(templatePayload(env, to, params));
    } catch (err) {
      /* A template send fails for reasons worth surviving: the name is not
         approved yet, or the parameter count does not match what was
         approved. Plain text still works if someone happens to have messaged
         the number recently, so it is worth one attempt before giving up —
         a message that arrives is better than a correct-looking failure. */
      try {
        return await send(textPayload(to, text));
      } catch (textErr) {
        throw new Error(`template failed (${err.message}); text fallback also failed (${textErr.message})`);
      }
    }
  }

  return send(textPayload(to, text));
}

/* ---------------- UltraMsg ---------------- */
async function sendUltramsg(env, to, text) {
  const url = `https://api.ultramsg.com/${env.ULTRAMSG_INSTANCE.trim()}/messages/chat`;
  const form = new URLSearchParams({
    token: env.ULTRAMSG_TOKEN.trim(),
    to: '+' + to,
    body: text.slice(0, 4096)
  });
  return post(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
}

/* ---------------- Twilio ---------------- */
async function sendTwilio(env, to, text) {
  const sid = env.TWILIO_SID.trim();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({
    From: `whatsapp:+${env.TWILIO_FROM.trim().replace(/\D/g, '')}`,
    To: `whatsapp:+${to}`,
    Body: text.slice(0, 1600)
  });
  return post(url, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(`${sid}:${env.TWILIO_TOKEN.trim()}`),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  });
}

/* ---------------- CallMeBot ---------------- */
async function sendCallmebot(env, to, text) {
  const url = 'https://api.callmebot.com/whatsapp.php?' + new URLSearchParams({
    phone: '+' + to,
    apikey: env.CALLMEBOT_KEY.trim(),
    text: text.slice(0, 1000)
  }).toString();
  return post(url, { method: 'GET' });
}

/* -------------------------------------------------------------------------
   The one entry point. Never throws.
   ------------------------------------------------------------------------- */
export async function notifyWhatsApp(env, text, toOverride, templateParams) {
  const provider = pickProvider(env);
  const to = (toOverride || merchantWa(env)).replace(/\D/g, '');

  if (provider === 'none') {
    return { ok: false, provider, error: 'no_provider_configured' };
  }
  if (!to) {
    return { ok: false, provider, error: 'no_recipient' };
  }

  try {
    switch (provider) {
      case 'meta':      await sendMeta(env, to, text, templateParams); break;
      case 'ultramsg':  await sendUltramsg(env, to, text); break;
      case 'twilio':    await sendTwilio(env, to, text); break;
      case 'callmebot': await sendCallmebot(env, to, text); break;
      default:
        return { ok: false, provider, error: `unknown_provider:${provider}` };
    }
    return { ok: true, provider, error: '' };
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err);
    console.error('whatsapp', provider, message);
    return { ok: false, provider, error: message.slice(0, 500) };
  }
}

/* Persists the outcome without ever letting a logging failure surface. Called
   from waitUntil, so the customer's response has already been sent. */
export async function recordNotify(d1, orderId, result) {
  try {
    await d1.prepare(
      'UPDATE orders SET notified = ?1, notify_error = ?2 WHERE id = ?3'
    ).bind(
      result.ok ? 1 : 0,
      result.ok ? null : `${result.provider}: ${result.error}`,
      orderId
    ).run();
  } catch (err) {
    console.error('recordNotify', err && err.message);
  }
}
