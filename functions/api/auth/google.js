/* POST /api/auth/google  { credential }

   One endpoint for both "sign in with Google" and "sign up with Google" —
   from the customer's side those are the same click, and which one it turns
   out to be depends on whether we have seen the account before.

   Three cases:
     known google_sub  -> sign in
     known email       -> LINK Google to the existing account and sign in
     neither           -> create the account and sign in

   The link case is the one that needs care. It is only safe because
   verifyGoogleIdToken() refuses any token whose email is not verified by
   Google — otherwise anyone could make a Google account claiming a
   customer's address and walk into it. With that guarantee, linking is
   right: someone who signed up with a password and later clicks the Google
   button should land in their own account, not a duplicate. */
import {
  json, handle, readJson, requireSameOrigin, ApiError, clean, clientIp
} from '../../../lib/util.js';
import { db, enforceRate } from '../../../lib/db.js';
import {
  signSession, sessionCookie, randomId, publicUser, isStaffEmail, secretOf,
  GOOGLE_ONLY_PW
} from '../../../lib/auth.js';
import { verifyGoogleIdToken } from '../../../lib/google.js';
import { GOOGLE_CLIENT_ID } from '../../../public/google-auth.js';

export const onRequestPost = handle(async (context) => {
  const { request, env } = context;
  requireSameOrigin(request);
  secretOf(env);

  const d1 = await db(env);
  await enforceRate(d1, `google:${clientIp(request)}`, 20, 900);

  const body = await readJson(request);
  const profile = await verifyGoogleIdToken(body.credential, GOOGLE_CLIENT_ID);

  const now = new Date().toISOString();
  const lang = body.lang === 'en' ? 'en' : 'ar';

  /* by google_sub first — the only identifier Google guarantees is stable.
     An address can be reassigned; a sub cannot. */
  let row = await d1.prepare(
    `SELECT id, email, name, phone, role, marketing, newsletter, lang, created_at
       FROM users WHERE google_sub = ?1`
  ).bind(profile.sub).first();

  let created = false;

  if (!row) {
    const byEmail = await d1.prepare(
      `SELECT id, email, name, phone, role, marketing, newsletter, lang, created_at
         FROM users WHERE email = ?1`
    ).bind(profile.email).first();

    if (byEmail) {
      /* Link. The password, if there is one, is left exactly as it was —
         both ways in still work. */
      await d1.prepare('UPDATE users SET google_sub = ?1 WHERE id = ?2')
        .bind(profile.sub, byEmail.id).run();
      row = byEmail;
    } else {
      const id = randomId(16);
      const name = clean(profile.name || profile.givenName, 120) || profile.email.split('@')[0];
      const role = isStaffEmail(profile.email) ? 'staff' : 'customer';

      try {
        await d1.prepare(
          `INSERT INTO users
             (id, email, name, phone, pw_hash, google_sub, role, marketing, newsletter,
              terms_at, lang, created_at, last_login_at)
           VALUES (?1,?2,?3,NULL,?4,?5,?6,0,0,?7,?8,?7,?7)`
        ).bind(id, profile.email, name, GOOGLE_ONLY_PW, profile.sub, role, now, lang).run();
      } catch (err) {
        /* Two clicks racing, or an account created between the two SELECTs
           above. Re-read rather than fail the customer. */
        if (String(err && err.message).includes('UNIQUE')) {
          row = await d1.prepare(
            `SELECT id, email, name, phone, role, marketing, newsletter, lang, created_at
               FROM users WHERE google_sub = ?1 OR email = ?2`
          ).bind(profile.sub, profile.email).first();
          if (!row) throw err;
        } else {
          throw err;
        }
      }

      if (!row) {
        created = true;
        row = {
          id, email: profile.email, name, phone: '', role,
          marketing: 0, newsletter: 0, lang, created_at: now
        };
      }
    }
  }

  await d1.prepare('UPDATE users SET last_login_at = ?1 WHERE id = ?2')
    .bind(now, row.id).run();

  const token = await signSession(env, row.id);
  return json(
    { ok: true, created, user: publicUser(row) },
    created ? 201 : 200,
    { 'set-cookie': sessionCookie(request, token) }
  );
});
