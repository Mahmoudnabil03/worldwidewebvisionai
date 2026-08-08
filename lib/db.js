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
     firebase_uid TEXT,
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
  `CREATE TABLE IF NOT EXISTS meta_events (
     id TEXT PRIMARY KEY,
     event TEXT NOT NULL,
     event_id TEXT,
     source_url TEXT,
     value INTEGER,
     currency TEXT,
     user_id TEXT,
     external_id TEXT,
     email TEXT,
     phone TEXT,
     client_ip TEXT,
     user_agent TEXT,
     created_at TEXT NOT NULL,
     /* Which products the event was about, as a JSON array of product ids —
        e.g. ["imou-3mp"]. This is what turns "412 ViewContent events" into
        "3 views of the Imou 3MP", which is the only form of that number
        anyone can act on. Always valid JSON or NULL; functions/api/capi.js
        is the sole writer and guarantees it, because the per-product query
        in admin/stats.js runs json_each over this column. */
     content_ids TEXT,
     /* The product name as it was at the time, so the report can name a
        product that has since been renamed or deleted. */
     content_name TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_meta_events_created ON meta_events (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_meta_events_event ON meta_events (event, created_at DESC)`,
  /* The catalogue. Seeded from public/catalog.js, which stays the fallback
     until every read path is switched over — see lib/products.js. Money is
     whole EGP, as everywhere else in this schema. */
  `CREATE TABLE IF NOT EXISTS products (
     id TEXT PRIMARY KEY,
     cat TEXT NOT NULL,
     brand TEXT,
     name TEXT NOT NULL,
     ar TEXT,
     en TEXT,
     img TEXT,
     price INTEGER NOT NULL,
     was INTEGER NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1,
     updated_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_products_cat ON products (cat, sort)`,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users (google_sub)`,
  /* Firebase Auth is the credential authority; this is the join to it. Same
     reasoning as google_sub: the uid is stable, an email address is not, so
     the uid is what gets stored and indexed. */
  `ALTER TABLE users ADD COLUMN firebase_uid TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase ON users (firebase_uid)`,
  /* Per-product event counting. meta_events predates these two, so every
     database that already has the table needs them added rather than created
     — and EXPECTED_META_EVENT_COLUMNS below has to list them, or schemaReady()
     answers "ready" and this never runs. */
  `ALTER TABLE meta_events ADD COLUMN content_ids TEXT`,
  `ALTER TABLE meta_events ADD COLUMN content_name TEXT`
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

/* -------------------------------------------------------------------------
   Is the schema already there?

   WHY THIS EXISTS. The DDL above is idempotent, so running it on every cold
   isolate is harmless — but it is not free. It is 8 statements plus up to 5
   migrations, and a Worker isolate is created per burst of traffic, not per
   deploy. Under load that meant every new isolate spent thirteen D1 round
   trips before it could answer the request it was actually woken for, on all
   eleven endpoints that touch the database. Measured against production at
   100 concurrent requests, /api/auth/me had a p95 of 2.2s while a static
   asset over the same burst stayed at 0.38s.

   So the healing is kept and the cost is not: one statement establishes
   whether anything needs doing, and the thirteen only run against a database
   that genuinely lacks something.

   The check has to cover BOTH halves or it is worse than useless. Looking
   only for tables would pass a database created before firebase_uid existed
   — every table present, one column missing — and skip the migration that
   adds it, which is a broken sign-in that heals itself in staging and not in
   production. So it counts tables and the columns the migrations add, in a
   single round trip.

   Adding a table or a migration means adding it here too. That coupling is
   the price of the check, and it is why both lists are written out rather
   than derived. */
const EXPECTED_TABLES = ['users', 'orders', 'attendance', 'newsletter', 'rate', 'products', 'meta_events'];
const EXPECTED_USER_COLUMNS = ['google_sub', 'firebase_uid'];
/* Every table a migration adds a column to needs its own line here. Miss one
   and the failure is the quiet kind this check was built to prevent: the
   table exists, the users columns exist, so schemaReady() says yes, migrate()
   never runs, and the new column is missing forever on exactly the databases
   that already had data — production, and nowhere else. */
const EXPECTED_META_EVENT_COLUMNS = ['content_ids', 'content_name'];

async function schemaReady(d1) {
  try {
    const row = await d1.prepare(
      `SELECT
         (SELECT COUNT(*) FROM sqlite_master
           WHERE type = 'table' AND name IN (${EXPECTED_TABLES.map((n) => `'${n}'`).join(',')})) AS tables,
         (SELECT COUNT(*) FROM pragma_table_info('users')
           WHERE name IN (${EXPECTED_USER_COLUMNS.map((n) => `'${n}'`).join(',')})) AS cols,
         (SELECT COUNT(*) FROM pragma_table_info('meta_events')
           WHERE name IN (${EXPECTED_META_EVENT_COLUMNS.map((n) => `'${n}'`).join(',')})) AS eventCols`
    ).first();
    return !!row &&
      row.tables === EXPECTED_TABLES.length &&
      row.cols === EXPECTED_USER_COLUMNS.length &&
      row.eventCols === EXPECTED_META_EVENT_COLUMNS.length;
  } catch (err) {
    /* A brand-new database has no sqlite_master rows to read and pragma on a
       missing table can throw. Either way the answer is "not ready". */
    return false;
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
    ready = (async () => {
      /* The common case, and the whole point: one round trip, then straight
         on to the query this request was actually made for. */
      if (await schemaReady(d1)) return;
      await d1.batch(DDL.map((sql) => d1.prepare(sql)));
      await migrate(d1);
    })().catch((err) => { ready = null; throw err; });
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
