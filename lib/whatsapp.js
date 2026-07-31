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

export function pickProvider(env) {
  const forced = (env && env.WHATSAPP_PROVIDER ? String(env.WHATSAPP_PROVIDER) : '').trim().toLowerCase();
  if (forced) return forced;
  if (has(env, 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID')) return 'meta';
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

/* ---------------- Meta WhatsApp Cloud API ---------------- */
async function sendMeta(env, to, text) {
  const version = (env.WHATSAPP_API_VERSION || 'v21.0').trim();
  const url = `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_ID.trim()}/messages`;

  const template = (env.WHATSAPP_TEMPLATE || '').trim();
  const allowText = String(env.WHATSAPP_ALLOW_TEXT || '') === '1';

  let payload;
  if (template && !allowText) {
    /* Templates cannot contain newlines in a body parameter, and Meta rejects
       four or more consecutive spaces. One parameter carrying the whole
       summary keeps the template itself trivial: "{{1}}". */
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template,
        language: { code: (env.WHATSAPP_TEMPLATE_LANG || 'ar').trim() },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: text.replace(/\s*\n\s*/g, ' · ').replace(/ {4,}/g, ' ').slice(0, 1024) }]
        }]
      }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4096) }
    };
  }

  return post(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.WHATSAPP_TOKEN.trim()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
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
export async function notifyWhatsApp(env, text, toOverride) {
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
      case 'meta':      await sendMeta(env, to, text); break;
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
