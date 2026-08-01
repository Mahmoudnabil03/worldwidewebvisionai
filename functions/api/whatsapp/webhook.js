/* Meta WhatsApp webhook — https://www.visionguardeg.com/api/whatsapp/webhook
 *
 * Worth being clear about what this is FOR, because it is easy to assume it
 * is what sends order confirmations. It is not. Sending is an outbound call
 * to graph.facebook.com and needs no webhook at all — see lib/whatsapp.js.
 *
 * This endpoint exists for the other direction:
 *
 *   GET   Meta's one-time subscription check. It calls with hub.mode,
 *         hub.verify_token and hub.challenge, and expects the challenge
 *         echoed back as plain text if the token matches META_VERIFY_TOKEN.
 *         Without this, the Verify button in the Meta dashboard fails and no
 *         webhook fields can be subscribed at all.
 *
 *   POST  Delivery receipts and inbound replies. These are logged and
 *         acknowledged. Meta retries anything that is not answered 200 and
 *         will eventually disable a webhook that keeps failing, so this
 *         answers 200 even for payloads it does not understand — an
 *         unrecognised event is not a reason to have the subscription torn
 *         down.
 *
 * Delivery receipts are genuinely useful here: an order can be accepted by
 * the API and still never arrive, and `sent` vs `delivered` vs `failed` is
 * the only way to tell those apart.
 */
import { json } from '../../../lib/util.js';

/* Comparison whose duration does not depend on where the first difference is.
   The verify token is a shared secret and this endpoint is public. */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const expected = env && typeof env.META_VERIFY_TOKEN === 'string' ? env.META_VERIFY_TOKEN.trim() : '';
  if (!expected) {
    console.error('whatsapp webhook: META_VERIFY_TOKEN is not set');
    return new Response('webhook not configured', { status: 503 });
  }

  if (mode === 'subscribe' && timingSafeEqual(String(token || '').trim(), expected)) {
    /* Must be the bare challenge, as text/plain. Meta compares the body
       exactly — a JSON wrapper or a trailing newline fails the check. */
    return new Response(challenge || '', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  return new Response('forbidden', { status: 403 });
};

export const onRequestPost = async ({ request }) => {
  /* No requireSameOrigin here, deliberately: the caller is Meta, not our own
     pages, so an origin check would reject every real delivery. */
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: true, ignored: 'unparseable' }, 200);
  }

  try {
    for (const entry of (body && body.entry) || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const s of v.statuses || []) {
          const line = `whatsapp status: ${s.status} id=${s.id} to=${s.recipient_id}`;
          if (s.status === 'failed') {
            const err = (s.errors && s.errors[0]) || {};
            console.error(`${line} error=${err.code} ${err.title || ''} ${err.message || ''}`);
          } else {
            console.log(line);
          }
        }
        for (const m of v.messages || []) {
          console.log(`whatsapp inbound: from=${m.from} type=${m.type}`);
        }
      }
    }
  } catch (err) {
    /* Still acknowledge. A parsing slip on our side must not cost us the
       subscription. */
    console.error('whatsapp webhook parse', err && err.message);
  }

  return json({ ok: true }, 200);
};
