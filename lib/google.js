/* =========================================================================
   Verifying a Google ID token.

   The browser hands us a JWT that Google signed. Everything that makes this
   safe happens here, and every one of these checks matters:

     signature  — proves Google minted it and nobody edited the claims. Keys
                  come from Google's published JWKS, matched by the token's
                  `kid`.
     iss        — must be Google.
     aud        — must be OUR client ID. Without this, a token issued to any
                  other Google app would be accepted, and anyone running a
                  site with Google sign-in could mint one and log in as your
                  customers. This is the check people leave out.
     exp / iat  — a token is good for about an hour; a stolen old one is not.
     email_verified — Google will assert an email it has not proven for some
                  account types. Linking such a token to an existing local
                  account by email would be a takeover, so unverified tokens
                  are refused outright.

   No client secret is involved. The ID-token flow does not use one: the
   proof is Google's signature, which is verified against public keys.
   ========================================================================= */
import { ApiError } from './util.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/* Small clock tolerance. Workers clocks are good, but a customer's token can
   legitimately arrive a second either side of a boundary. */
const SKEW_SEC = 60;

function b64urlToBytes(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}

/* Cached per isolate. Google rotates these keys and the response says how
   long it may be held; honouring that is what keeps a rotation from causing
   an hour of failed sign-ins. */
let jwksCache = { keys: null, expires: 0 };

async function fetchJwks() {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.expires) return jwksCache.keys;

  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new ApiError(502, 'google_unavailable', 'Could not reach Google to verify the sign-in.');
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) {
    throw new ApiError(502, 'google_unavailable', 'Google returned an unexpected key set.');
  }

  const cc = res.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/.exec(cc);
  const ttl = m ? Math.min(86400, Math.max(300, parseInt(m[1], 10))) : 3600;
  jwksCache = { keys: body.keys, expires: now + ttl * 1000 };
  return body.keys;
}

async function verifySignature(token, kid) {
  const keys = await fetchJwks();
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    /* Almost always a rotation we have cached past. Drop the cache and take
       one more look before calling it a forgery. */
    jwksCache = { keys: null, expires: 0 };
    const fresh = await fetchJwks();
    const retry = fresh.find((k) => k.kid === kid);
    if (!retry) return false;
    return verifyWith(retry, token);
  }
  return verifyWith(jwk, token);
}

async function verifyWith(jwk, token) {
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const dot = token.lastIndexOf('.');
  const signed = new TextEncoder().encode(token.slice(0, dot));
  const sig = b64urlToBytes(token.slice(dot + 1));
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed);
}

/* Returns the trustworthy bits of a verified token, or throws ApiError. */
export async function verifyGoogleIdToken(idToken, clientId) {
  if (typeof idToken !== 'string' || idToken.length < 40 || idToken.length > 8192) {
    throw new ApiError(400, 'bad_google_token', 'That Google sign-in could not be read. Please try again.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new ApiError(400, 'bad_google_token', 'That Google sign-in could not be read. Please try again.');
  }

  let header, claims;
  try {
    header = b64urlToJson(parts[0]);
    claims = b64urlToJson(parts[1]);
  } catch (e) {
    throw new ApiError(400, 'bad_google_token', 'That Google sign-in could not be read. Please try again.');
  }

  /* Pin the algorithm. Accepting whatever the token names is how "alg: none"
     and HMAC-with-the-public-key forgeries get in. */
  if (header.alg !== 'RS256' || !header.kid) {
    throw new ApiError(401, 'bad_google_token', 'That Google sign-in was not signed in a form we accept.');
  }

  const ok = await verifySignature(idToken, header.kid);
  if (!ok) {
    throw new ApiError(401, 'bad_google_token', 'That Google sign-in could not be verified.');
  }

  if (!ISSUERS.includes(claims.iss)) {
    throw new ApiError(401, 'bad_google_token', 'That sign-in did not come from Google.');
  }
  if (claims.aud !== clientId) {
    throw new ApiError(401, 'bad_google_token', 'That Google sign-in was issued for a different application.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp + SKEW_SEC < now) {
    throw new ApiError(401, 'google_expired', 'That Google sign-in has expired. Please try again.');
  }
  if (Number.isFinite(claims.iat) && claims.iat - SKEW_SEC > now) {
    throw new ApiError(401, 'bad_google_token', 'That Google sign-in is dated in the future.');
  }

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !verified) {
    throw new ApiError(
      401, 'google_unverified',
      'That Google account has no verified email address, so it cannot be used to sign in here.'
    );
  }
  if (!claims.sub) {
    throw new ApiError(401, 'bad_google_token', 'That Google sign-in is missing an account id.');
  }

  return {
    sub: String(claims.sub),
    email,
    name: typeof claims.name === 'string' ? claims.name : '',
    givenName: typeof claims.given_name === 'string' ? claims.given_name : ''
  };
}
