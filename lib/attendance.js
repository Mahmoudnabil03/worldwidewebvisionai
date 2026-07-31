/* =========================================================================
   Attendance rules.

   The contract is six hours a day. Everything here is expressed against that
   one number so changing it is a single environment variable, not a hunt
   through the code.

   A day is a Cairo day, and a shift belongs to the day it STARTED — a shift
   from 23:00 to 01:00 counts entirely against the day it began on, which is
   how a person would describe it themselves.
   ========================================================================= */
import { cairoDate } from './util.js';

export const DEFAULT_TARGET_HOURS = 6;

/* A shift left open past this is not a real shift, it is a forgotten
   clock-out. See closeStale(). */
export const STALE_HOURS = 16;

export function targetSeconds(env) {
  const h = parseFloat((env && env.WORK_DAY_HOURS) || '');
  const hours = Number.isFinite(h) && h > 0 && h <= 24 ? h : DEFAULT_TARGET_HOURS;
  return Math.round(hours * 3600);
}

export function statusOf(seconds, target) {
  if (seconds <= 0) return 'absent';
  if (seconds < target - 300) return 'short';        // 5-minute grace either side
  if (seconds > target + 300) return 'overtime';
  return 'complete';
}

/* Someone who forgets to clock out would otherwise accrue an open shift
   forever, and every later total would be nonsense. We close it at exactly
   the contracted length and label the row, so the number is visibly an
   estimate a manager can correct rather than a silent invention. */
export async function closeStale(d1, userId, env) {
  const target = targetSeconds(env);
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600000).toISOString();
  const open = await d1.prepare(
    'SELECT id, clock_in FROM attendance WHERE user_id = ?1 AND clock_out IS NULL AND clock_in < ?2'
  ).bind(userId, cutoff).first();
  if (!open) return null;

  const out = new Date(new Date(open.clock_in).getTime() + target * 1000).toISOString();
  await d1.prepare(
    `UPDATE attendance
        SET clock_out = ?1, seconds = ?2, note = 'auto-closed: no clock-out recorded'
      WHERE id = ?3`
  ).bind(out, target, open.id).run();
  return open.id;
}

export async function openShift(d1, userId) {
  return d1.prepare(
    'SELECT id, work_date, clock_in FROM attendance WHERE user_id = ?1 AND clock_out IS NULL'
  ).bind(userId).first();
}

export function elapsedSeconds(clockInIso, now) {
  const start = new Date(clockInIso).getTime();
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor(((now || Date.now()) - start) / 1000));
}

/* Groups raw rows into Cairo days. Rows are expected newest-first. */
export function groupDays(rows, env, now) {
  const target = targetSeconds(env);
  const byDate = new Map();

  for (const row of rows || []) {
    const date = row.work_date || cairoDate(new Date(row.clock_in));
    if (!byDate.has(date)) byDate.set(date, { date, seconds: 0, open: false, sessions: [] });
    const day = byDate.get(date);

    const live = row.clock_out === null || row.clock_out === undefined;
    const seconds = live
      ? elapsedSeconds(row.clock_in, now)
      : (Number(row.seconds) || 0);

    day.seconds += seconds;
    if (live) day.open = true;
    day.sessions.push({
      id: row.id,
      in: row.clock_in,
      out: row.clock_out || null,
      seconds,
      live,
      note: row.note || ''
    });
  }

  /* A day with a recorded shift is never "absent", even if the shift rounds
     to zero seconds — absent means nothing was recorded at all, and the two
     must not look the same on a timesheet. */
  const days = Array.from(byDate.values()).map((d) => Object.assign(d, {
    target,
    status: d.open ? 'open'
          : d.sessions.length ? (d.seconds > 0 ? statusOf(d.seconds, target) : 'short')
          : 'absent',
    balance: d.seconds - target
  }));

  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

export function summarise(days, env) {
  const target = targetSeconds(env);
  /* Counted by "did they clock in", not "did the total round above zero" —
     otherwise a short shift silently vanishes from the month. */
  const worked = days.filter((d) => (d.sessions ? d.sessions.length > 0 : d.seconds > 0));
  const seconds = worked.reduce((sum, d) => sum + d.seconds, 0);
  return {
    targetSeconds: target,
    daysWorked: worked.length,
    seconds,
    expected: worked.length * target,
    balance: seconds - worked.length * target
  };
}
