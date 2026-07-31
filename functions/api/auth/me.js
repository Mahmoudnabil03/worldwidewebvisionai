/* GET /api/auth/me — who the cookie belongs to, or null. Answers 200 with
   user:null rather than 401 so the page can boot without treating "signed
   out" as an error. */
import { json, handle } from '../../../lib/util.js';
import { db } from '../../../lib/db.js';
import { currentUser, publicUser } from '../../../lib/auth.js';

export const onRequestGet = handle(async (context) => {
  const d1 = await db(context.env);
  const user = await currentUser(context, d1);
  return json({ ok: true, user: user ? publicUser(user) : null });
});
