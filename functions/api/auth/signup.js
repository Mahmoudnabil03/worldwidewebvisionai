/* POST /api/auth/signup
   Creates the account, records the consent that was actually given, and signs
   the person in immediately — nobody should have to type a password twice to
   place one order. */
import {
  json, handle, readJson, requireSameOrigin, ApiError,
  required, normEmail, normPhoneEg, clientIp
} from '../../../lib/util.js';
import { db, enforceRate } from '../../../lib/db.js';
import {
  hashPassword, checkPasswordStrength, signSession, sessionCookie,
  randomId, publicUser, isStaffEmail, secretOf
} from '../../../lib/auth.js';

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  requireSameOrigin(request);
  secretOf(env);                      // fail loudly and early if unconfigured

  const d1 = await db(env);
  await enforceRate(d1, `signup:${clientIp(request)}`, 8, 3600);

  const body = await readJson(request);

  const name = required(body.name, 'name', 120);
  const email = normEmail(body.email);
  const phone = body.phone ? normPhoneEg(body.phone, 'phone', true) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  checkPasswordStrength(password);

  /* The one non-negotiable box. Marketing and newsletter are separate and
     genuinely optional — bundling them into the terms checkbox would make the
     consent worthless. */
  if (body.terms !== true) {
    throw new ApiError(
      400, 'terms_required',
      'You need to accept the terms of use and the privacy policy to create an account.',
      { field: 'terms' }
    );
  }

  const marketing = body.marketing === true ? 1 : 0;
  const newsletter = body.newsletter === true ? 1 : 0;
  const lang = body.lang === 'en' ? 'en' : 'ar';

  const existing = await d1.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first();
  if (existing) {
    throw new ApiError(409, 'email_taken', 'An account already exists with that email. Try signing in.', { field: 'email' });
  }

  const id = randomId(16);
  const now = new Date().toISOString();
  const pwHash = await hashPassword(env, password);
  const role = isStaffEmail(email) ? 'staff' : 'customer';

  try {
    await d1.prepare(
      `INSERT INTO users
         (id, email, name, phone, pw_hash, role, marketing, newsletter, terms_at, lang, created_at, last_login_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)`
    ).bind(id, email, name, phone || null, pwHash, role, marketing, newsletter, now, lang, now).run();
  } catch (err) {
    /* UNIQUE(email) can still fire if two signups race. */
    if (String(err && err.message).includes('UNIQUE')) {
      throw new ApiError(409, 'email_taken', 'An account already exists with that email. Try signing in.', { field: 'email' });
    }
    throw err;
  }

  if (newsletter) {
    try {
      await d1.prepare(
        `INSERT INTO newsletter (email, name, marketing, source, lang, created_at)
         VALUES (?1,?2,?3,'signup',?4,?5)
         ON CONFLICT(email) DO UPDATE SET
           marketing = MAX(newsletter.marketing, ?3),
           unsub_at  = NULL`
      ).bind(email, name, marketing, lang, now).run();
    } catch (err) {
      console.error('newsletter at signup', err && err.message);
    }
  }

  const token = await signSession(env, id);
  return json(
    {
      ok: true,
      user: publicUser({
        id, email, name, phone, role, marketing, newsletter, lang, created_at: now
      })
    },
    201,
    { 'set-cookie': sessionCookie(request, token) }
  );
});
