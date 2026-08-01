/* =========================================================================
   D1 access.

   The schema is applied lazily, once per isolate, so a brand-new database
   works on first request without anyone remembering to run a migration. The
   statements are all IF NOT EXISTS, so this is idempotent and cheap; the
   module-level flag keeps it to one batch per isolate rather than one per
   request.
   ========================================================================= */
import { ApiError } from './util.js';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     phone TEXT,
     pw_hash TEXT NOT NULL,
     google_sub TEXT,
     role TEXT NOT NULL DEFAULT 'customer',
     marketing INTEGER NOT NULL DEFAULT 0,
     newsletter INTEGER NOT NULL DEFAULT 0,
     terms_at TEXT,
     lang TEXT NOT NULL DEFAULT 'ar',
     created_at TEXT NOT NULL,
     last_login_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS orders (
     id TEXT PRIMARY KEY,
     user_id TEXT,
     name TEXT NOT NULL,
     phone TEXT NOT NULL,
     phone_alt TEXT,
     email TEXT,
     governorate TEXT NOT NULL,
     address TEXT NOT NULL,
     notes TEXT,
     payment TEXT NOT NULL DEFAULT 'cod',
     items TEXT NOT NULL,
     subtotal INTEGER NOT NULL,
     shipping INTEGER NOT NULL DEFAULT 0,
     total INTEGER NOT NULL,
     currency TEXT NOT NULL DEFAULT 'EGP',
     status TEXT NOT NULL DEFAULT 'new',
     lang TEXT NOT NULL DEFAULT 'ar',
     notified INTEGER NOT NULL DEFAULT 0,
     notify_error TEXT,
     ip TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS attendance (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     work_date TEXT NOT NULL,
     clock_in TEXT NOT NULL,
     clock_out TEXT,
     seconds INTEGER,
     in_ip TEXT,
     out_ip TEXT,
     note TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance (user_id, work_date DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_att_open ON attendance (user_id) WHERE clock_out IS NULL`,
  `CREATE TABLE IF NOT EXISTS newsletter (
     email TEXT PRIMARY KEY,
     name TEXT,
     marketing INTEGER NOT NULL DEFAULT 0,
     source TEXT,
     lang TEXT NOT NULL DEFAULT 'ar',
     created_at TEXT NOT NULL,
     unsub_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS rate (
     k TEXT PRIMARY KEY,
     n INTEGER NOT NULL,
     reset_at INTEGER NOT NULL
   )`
];

/* Statements that change a table that already exists. The DDL above is all
   CREATE ... IF NOT EXISTS, which is idempotent but also inert: it will not
   add a column to a `users` table that was created before that column
   existed. These run after it, each one allowed to fail.

   "allowed to fail" is the whole design. SQLite has no ADD COLUMN IF NOT
   EXISTS, so the second time this runs it errors with "duplicate column
   name" — which means the migration is already applied, which is success.
   Anything else is logged and skipped rather than taking the site down,
   because a Worker that cannot boot is worse than one missing a column. */
const MIGRATIONS = [
  `ALTER TABLE users ADD COLUMN google_sub TEXT`,
  /* NULLs do not collide in a SQLite unique index, so password-only accounts
     are unaffected; this only stops one Google identity being attached to
     two rows. */
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users (google_sub)`
];

async function migrate(d1) {
  for (const sql of MIGRATIONS) {
    try {
      await d1.prepare(sql).run();
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (/duplicate column name/i.test(msg)) continue;   // already applied
      console.error('migration skipped:', sql.slice(0, 60), msg);
    }
  }
}

let ready = null;

export function getDb(env) {
  if (!env || !env.DB) {
    throw new ApiError(
      503, 'no_database',
      'The database is not connected yet. Create a D1 database and bind it as DB — see README.'
    );
  }
  return env.DB;
}

export async function db(env) {
  const d1 = getDb(env);
  if (!ready) {
    ready = d1.batch(DDL.map((sql) => d1.prepare(sql)))
      .then(() => migrate(d1))
      .catch((err) => { ready = null; throw err; });
  }
  await ready;
  return d1;
}

/* -------------------------------------------------------------------------
   Fixed-window rate limit.

   Keyed by action + identity (IP, or email for credential stuffing). Fails
   OPEN: if the counter itself errors we would rather take the request than
   lock every customer out of checkout because one table misbehaved.
   ------------------------------------------------------------------------- */
export async function rateLimit(d1, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const reset = now + windowSec;
  try {
    const row = await d1.prepare(
      `INSERT INTO rate (k, n, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(k) DO UPDATE SET
         n        = CASE WHEN rate.reset_at <= ?3 THEN 1   ELSE rate.n + 1     END,
         reset_at = CASE WHEN rate.reset_at <= ?3 THEN ?2  ELSE rate.reset_at  END
       RETURNING n, reset_at`
    ).bind(key, reset, now).first();
    if (!row) return { ok: true, retryAfter: 0 };
    return { ok: row.n <= max, retryAfter: Math.max(1, row.reset_at - now) };
  } catch (err) {
    console.error('rateLimit', err && err.message);
    return { ok: true, retryAfter: 0 };
  }
}

export async function enforceRate(d1, key, max, windowSec) {
  const r = await rateLimit(d1, key, max, windowSec);
  if (!r.ok) {
    throw new ApiError(
      429, 'rate_limited',
      'Too many attempts. Please wait a moment and try again.',
      { retryAfter: r.retryAfter }
    );
  }
}
