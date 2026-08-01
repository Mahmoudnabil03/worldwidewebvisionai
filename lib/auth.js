/* =========================================================================
   Passwords and sessions.

   No dependencies — WebCrypto only, which is what the Workers runtime gives
   us. Two deliberate choices worth knowing before you change anything:

   1. PBKDF2 iterations default to 25,000, not the 210,000 OWASP suggests.
      Pages Functions on the Cloudflare **Free** plan get 10 ms of CPU per
      request, and 210k PBKDF2-SHA256 blows straight through that — logins
      would fail with error 1102, not fail slowly. The gap is covered by a
      server-side pepper (below): the stored hash is useless to anyone who
      steals the database but not SESSION_SECRET, which lives outside it.
      On the Workers Paid plan raise it — set PBKDF2_ITERATIONS=210000 and
      existing hashes keep verifying, because the iteration count is stored
      inside each hash string.

   2. Sessions are stateless signed cookies, not rows. There is no session
      table to read on every request, and no cleanup job. The cost is that a
      logout only clears the cookie on that device; tokens elsewhere run to
      their 30-day expiry. Rotate SESSION_SECRET to invalidate all of them.
   ========================================================================= */
import { ApiError } from './util.js';

export const COOKIE = 'vg_session';
export const SESSION_DAYS = 30;
export const STAFF_DOMAIN = 'visionguardeg.com';

/* users.pw_hash is NOT NULL, and an account created through Google has no
   password at all. This is what goes in that column instead: a deliberate
   non-hash. verifyPassword() requires the stored value to split into exactly
   four `$`-separated parts starting with "pbkdf2", so this can never verify
   against any input — a Google-only account cannot be signed into with a
   password, including an empty one. */
export const GOOGLE_ONLY_PW = 'google-oauth-no-password';

const enc = new TextEncoder();

/* ---------------- encoding ---------------- */
function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Comparison whose duration does not depend on where the first difference
   is — otherwise a signature can be recovered one byte at a time. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomId(bytes) {
  const buf = new Uint8Array(bytes || 16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- the secret ---------------- */
export function secretOf(env) {
  const s = env && env.SESSION_SECRET;
  if (!s || String(s).length < 24) {
    throw new ApiError(
      503, 'no_secret',
      'Sign-in is not configured yet: set the SESSION_SECRET secret (32+ random characters). See README.'
    );
  }
  return String(s);
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}

async function hmac(secret, message) {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/* ---------------- passwords ---------------- */
function iterationsOf(env) {
  const n = parseInt((env && env.PBKDF2_ITERATIONS) || '', 10);
  return Number.isFinite(n) && n >= 1000 && n <= 1000000 ? n : 25000;
}

/* The pepper. Peppering before the KDF means a stolen `users` table cannot be
   attacked offline without also stealing SESSION_SECRET, which is held by the
   platform and never written to D1. */
async function pepper(secret, password) {
  return b64url(await hmac(secret, 'pw:' + password));
}

async function derive(peppered, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(peppered), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return b64url(bits);
}

export async function hashPassword(env, password) {
  const secret = secretOf(env);
  const iterations = iterationsOf(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(await pepper(secret, password), salt, iterations);
  return `pbkdf2$${iterations}$${b64url(salt)}$${hash}`;
}

export async function verifyPassword(env, password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 1000000) return false;
  let salt;
  try { salt = unb64url(parts[2]); } catch (e) { return false; }
  const hash = await derive(await pepper(secretOf(env), password), salt, iterations);
  return timingSafeEqual(hash, parts[3]);
}

export function checkPasswordStrength(password) {
  const p = typeof password === 'string' ? password : '';
  if (p.length < 8) {
    throw new ApiError(400, 'weak_password', 'Password must be at least 8 characters.', { field: 'password' });
  }
  if (p.length > 200) {
    throw new ApiError(400, 'weak_password', 'Password is too long.', { field: 'password' });
  }
  if (!/\p{L}/u.test(p) || !/\p{Nd}/u.test(p)) {
    throw new ApiError(
      400, 'weak_password',
      'Password needs at least one letter and one number.',
      { field: 'password' }
    );
  }
}

/* ---------------- sessions ---------------- */
export async function signSession(env, userId) {
  const secret = secretOf(env);
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${userId}.${exp}`;
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function readSession(env, token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);

  let secret;
  try { secret = secretOf(env); } catch (e) { return null; }
  if (!timingSafeEqual(b64url(await hmac(secret, payload)), sig)) return null;

  const dot = payload.indexOf('.');
  if (dot < 1) return null;
  const userId = payload.slice(0, dot);
  const exp = Number(payload.slice(dot + 1));
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { userId, exp };
}

export function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  const value = token || '';
  return `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

export function cookieValue(request, name) {
  const raw = request.headers.get('cookie');
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

/* ---------------- current user ---------------- */
export async function currentUser(context, d1) {
  const session = await readSession(context.env, cookieValue(context.request, COOKIE));
  if (!session) return null;
  const row = await d1.prepare(
    `SELECT id, email, name, phone, role, marketing, newsletter, lang, created_at
       FROM users WHERE id = ?1`
  ).bind(session.userId).first();
  return row || null;
}

export async function requireUser(context, d1) {
  const user = await currentUser(context, d1);
  if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in first.');
  return user;
}

export function isStaffEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@' + STAFF_DOMAIN);
}

export async function requireStaff(context, d1) {
  const user = await requireUser(context, d1);
  if (!isStaffEmail(user.email)) {
    throw new ApiError(403, 'not_staff', 'Attendance is for Vision Guard staff accounts only.');
  }
  return user;
}

/* What the client is allowed to see about itself. */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || '',
    role: user.role,
    staff: isStaffEmail(user.email),
    marketing: !!user.marketing,
    newsletter: !!user.newsletter,
    lang: user.lang || 'ar',
    createdAt: user.created_at
  };
}
