/* POST /api/auth/login */
import {
  json, handle, readJson, requireSameOrigin, ApiError, normEmail, clientIp
} from '../../../lib/util.js';
import { db, enforceRate } from '../../../lib/db.js';
import {
  verifyPassword, signSession, sessionCookie, publicUser, secretOf
} from '../../../lib/auth.js';

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  requireSameOrigin(request);
  secretOf(env);

  const d1 = await db(env);
  const body = await readJson(request);
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  /* Two buckets: one on the address being attacked, one on the source doing
     the attacking. Either alone is trivially worked around. */
  await enforceRate(d1, `login-ip:${clientIp(request)}`, 30, 900);
  await enforceRate(d1, `login-em:${email}`, 10, 900);

  const row = await d1.prepare(
    `SELECT id, email, name, phone, pw_hash, role, marketing, newsletter, lang, created_at
       FROM users WHERE email = ?1`
  ).bind(email).first();

  /* Same message and roughly the same work either way, so the response does
     not reveal whether the address is registered. */
  const ok = row ? await verifyPassword(env, password, row.pw_hash) : false;
  if (!ok) {
    throw new ApiError(401, 'bad_credentials', 'Email or password is incorrect.');
  }

  const now = new Date().toISOString();
  await d1.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2').bind(now, row.id).run();

  const token = await signSession(env, row.id);
  return json(
    { ok: true, user: publicUser(row) },
    200,
    { 'set-cookie': sessionCookie(request, token) }
  );
});
