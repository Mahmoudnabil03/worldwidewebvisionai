-- =========================================================================
-- Vision Guard — D1 schema
--
-- You do not have to run this by hand: lib/db.js applies the same statements
-- once per Worker isolate, so a fresh database heals itself on first request.
-- It is kept here so the shape is reviewable, and so you can run it against a
-- new database up front:
--
--   npx wrangler d1 execute visionguard --remote --file=./schema.sql
--
-- Money is stored in whole Egyptian pounds as INTEGER. The catalogue has no
-- piastres in it, and integers cannot drift the way floats do.
-- =========================================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,          -- always lowercased before write
  name          TEXT NOT NULL,
  phone         TEXT,                          -- E.164 without '+', e.g. 201012345678
  pw_hash       TEXT NOT NULL,                 -- pbkdf2$<iters>$<saltB64>$<hashB64>
  role          TEXT NOT NULL DEFAULT 'customer',  -- 'customer' | 'staff'
  marketing     INTEGER NOT NULL DEFAULT 0,
  newsletter    INTEGER NOT NULL DEFAULT 0,
  terms_at      TEXT,                          -- when the required consent was given
  lang          TEXT NOT NULL DEFAULT 'ar',
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,               -- human order number, e.g. VG-260731-K3QX
  user_id      TEXT,                           -- null for guest checkout
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  phone_alt    TEXT,
  email        TEXT,
  governorate  TEXT NOT NULL,
  address      TEXT NOT NULL,
  notes        TEXT,
  payment      TEXT NOT NULL DEFAULT 'cod',    -- 'cod' | 'transfer'
  items        TEXT NOT NULL,                  -- JSON array, priced server-side
  subtotal     INTEGER NOT NULL,
  shipping     INTEGER NOT NULL DEFAULT 0,     -- 0 = quoted on confirmation
  total        INTEGER NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EGP',
  status       TEXT NOT NULL DEFAULT 'new',    -- new | confirmed | shipped | done | cancelled
  lang         TEXT NOT NULL DEFAULT 'ar',
  notified     INTEGER NOT NULL DEFAULT 0,     -- 1 once WhatsApp accepted it
  notify_error TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

-- One row per shift. A day can hold several — a break is a clock-out and a
-- clock-in, and the day's total is the sum of its rows.
CREATE TABLE IF NOT EXISTS attendance (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  work_date  TEXT NOT NULL,                    -- YYYY-MM-DD, Africa/Cairo, day the shift STARTED
  clock_in   TEXT NOT NULL,                    -- ISO 8601 UTC
  clock_out  TEXT,                             -- null while the shift is open
  seconds    INTEGER,                          -- filled on clock-out
  in_ip      TEXT,
  out_ip     TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_user_date ON attendance (user_id, work_date DESC);
-- At most one open shift per employee. A partial index is the cheapest way to
-- make a double clock-in impossible at the storage layer rather than only in
-- the handler.
CREATE UNIQUE INDEX IF NOT EXISTS idx_att_open ON attendance (user_id) WHERE clock_out IS NULL;

CREATE TABLE IF NOT EXISTS newsletter (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  marketing  INTEGER NOT NULL DEFAULT 0,
  source     TEXT,                             -- 'signup' | 'footer' | 'checkout'
  lang       TEXT NOT NULL DEFAULT 'ar',
  created_at TEXT NOT NULL,
  unsub_at   TEXT
);

-- Fixed-window counters for login/signup/order abuse. Rows are self-expiring:
-- an entry whose reset_at has passed is reset in place on next use.
CREATE TABLE IF NOT EXISTS rate (
  k        TEXT PRIMARY KEY,
  n        INTEGER NOT NULL,
  reset_at INTEGER NOT NULL                    -- unix seconds
);
