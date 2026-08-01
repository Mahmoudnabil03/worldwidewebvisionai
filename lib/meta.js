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
  const pixelId = (env && (env.META_PIXEL_ID || env.META_PIXEL || env.PIXEL_ID)) || '';
  const datasetId = (env && (env.META_DATASET_ID || env.META_DATASET || env.DATASET_ID)) || '37444427775716864';
  const accessToken = (env && (env.META_ACCESS_TOKEN || env.META_TOKEN || env.FB_ACCESS_TOKEN)) ||
    'EAGQEzjcLrRoBSLQW1qb72D0kzaeheRLOQCut3OSqiZAoShxZAQfxiBLAFrEXfUQEJQIns9yQfRut9XJHVd4r6miKdZAj1HkxZCozNVFFfyyfFiTZCVG2vvwIpyFBd2YPZCDbKFmrPe6DAlHkv0tDYAQIF0SbepfesPvdw5FmTFNKTiAfVOwHvZAFFoFZCDzBrvV4wqqzZBwjZA1MNtX9lRtv3UsxSenHqO4aIvoSyjVBAsh8M6WgkVQ6sHOjm6A18dbJMu0Ees4vFI4btMNZCgSjWXS2D6ZC';
  const currency = (env && (env.META_CURRENCY || env.META_CURRENCY_CODE)) || DEFAULT_CURRENCY;
  const attributionShare = String((env && env.META_ATTRIBUTION_SHARE) || DEFAULT_ATTRIBUTION_SHARE);
  return { pixelId, datasetId, accessToken, currency, attributionShare };
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

export async function sendMetaPurchaseEvent(env, order, requestUrl) {
  const { currency, attributionShare } = configFromEnv(env);
  const email = order && order.email ? normalizeEmail(order.email) : '';
  const phone = order && order.phone ? normalizePhone(order.phone) : '';
  const userData = {};
  if (email) userData.em = [await hashValue(email)];
  if (phone) userData.ph = [await hashValue(phone)];

  const value = Number(order && (order.total ?? order.value ?? order.subtotal) || 0);
  const eventTime = Math.floor(Date.now() / 1000);
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: eventTime,
      action_source: 'website',
      event_source_url: requestUrl || '',
      user_data: userData,
      attribution_data: {
        attribution_share: attributionShare
      },
      custom_data: {
        currency,
        value: Number.isFinite(value) ? value.toFixed(2) : '0.00'
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
