import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { transaction } from './db.js';

export const app = express();
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY must be set');
const origins = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.includes(origin)); }, allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key'], exposedHeaders: ['Retry-After'] }));
app.use(express.json({ limit: '100kb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use((req, res, next) => {
  const supplied = Buffer.from(req.get('X-API-Key') || ''); const expected = Buffer.from(apiKey);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'unauthorized' });
  next();
});
const fail = (status, error) => ({ status, body: { error } });
const send = (res, result) => { if (result.retryAfter) res.set('Retry-After', String(result.retryAfter)); return res.status(result.status).json(result.body); };
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const emailValid = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const dateValid = date => typeof date === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(date) && !Number.isNaN(Date.parse(date));
// Sort object keys so equivalent JSON bodies produce the same hash.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
app.post('/reset', asyncRoute(async (req, res) => {
  const slots = req.body?.slots;
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots must be an array' });
  const seen = new Set();
  for (const s of slots) {
    if (!s || !['id', 'provider', 'start', 'end'].every(k => typeof s[k] === 'string' && s[k].trim()) || seen.has(s.id) || !dateValid(s.start) || !dateValid(s.end) || Date.parse(s.end) <= Date.parse(s.start)) return res.status(400).json({ error: 'invalid slot' });
    seen.add(s.id);
  }
  await transaction(async db => {
    await db.query('DELETE FROM bookings'); await db.query('DELETE FROM slots');
    await db.query('DELETE FROM idempotency'); await db.query('DELETE FROM attempts');
    for (const s of slots) await db.query('INSERT INTO slots VALUES ($1,$2,$3,$4)', [s.id, s.provider, s.start, s.end]);
  });
  res.json({ ok: true });
}));
app.get('/slots', asyncRoute(async (req, res) => {
  const result = await transaction(db => db.query(`SELECT s.id, s.provider, s.start_time AS start, s.end_time AS end,
    NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
    FROM slots s ${req.query.provider !== undefined ? 'WHERE s.provider = $1' : ''}`,
    req.query.provider !== undefined ? [req.query.provider] : []));
  result.rows.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
  res.json({ slots: result.rows });
}));
app.post('/bookings', asyncRoute(async (req, res) => {
  const body = req.body; const key = req.get('Idempotency-Key');
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(body ?? null))).digest('hex');
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const result = await transaction(async db => {
    const now = Date.now();
    if (email) {
      await db.query('DELETE FROM attempts WHERE attempted_at <= $1', [now - 60000]);
      const attempts = await db.query('SELECT attempted_at FROM attempts WHERE email=$1 ORDER BY attempted_at', [email]);
      if (attempts.rowCount >= 5) return { ...fail(429, 'too many attempts'), retryAfter: Math.max(1, Math.ceil((Number(attempts.rows[0].attempted_at) + 60000 - now) / 1000)) };
      await db.query('INSERT INTO attempts VALUES ($1,$2)', [email, now]);
    }
    if (key !== undefined) {
      const previous = await db.query('SELECT * FROM idempotency WHERE key=$1', [key]);
      if (previous.rowCount) return previous.rows[0].body_hash === hash ? { status: previous.rows[0].status, body: previous.rows[0].response } : fail(422, 'idempotency key reused with different body');
    }
    let outcome;
    if (!body || !['slot_id','name','email'].every(k => typeof body[k] === 'string' && body[k].trim()) || !emailValid(email)) outcome = fail(400, 'invalid booking details');
    else {
      const slot = await db.query('SELECT * FROM slots WHERE id=$1', [body.slot_id]);
      if (!slot.rowCount) outcome = fail(404, 'slot not found');
      else if (Date.parse(slot.rows[0].start_time) <= now) outcome = fail(400, 'slot has already started');
      else if ((await db.query("SELECT id FROM bookings WHERE slot_id=$1 AND status='confirmed'", [body.slot_id])).rowCount) outcome = fail(409, 'slot already booked');
      else {
        const booking = { id: crypto.randomUUID(), slot_id: body.slot_id, name: body.name.trim(), email, status: 'confirmed', created_at: new Date(now).toISOString() };
        await db.query('INSERT INTO bookings VALUES ($1,$2,$3,$4,$5,$6)', Object.values(booking));
        outcome = { status: 201, body: booking };
      }
    }
    if (key !== undefined) await db.query('INSERT INTO idempotency VALUES ($1,$2,$3,$4)', [key, hash, outcome.status, JSON.stringify(outcome.body)]);
    return outcome;
  });
  send(res, result);
}));
app.get('/bookings', asyncRoute(async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const rawLimit = req.query.limit ?? '10';
  if (!email) return res.status(400).json({ error: 'email is required' });
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 50) return res.status(400).json({ error: 'invalid limit' });
  const limit = Number(rawLimit); let cursor;
  if (req.query.cursor !== undefined) {
    try { cursor = JSON.parse(Buffer.from(req.query.cursor, 'base64url').toString()); if (!Array.isArray(cursor) || cursor.length !== 2 || !cursor.every(x => typeof x === 'string')) throw Error(); }
    catch { return res.status(400).json({ error: 'invalid cursor' }); }
  }
  const rows = (await transaction(db => db.query(`SELECT * FROM bookings WHERE email=$1 ${cursor ? 'AND (created_at > $2 OR (created_at = $2 AND id > $3))' : ''} ORDER BY created_at,id LIMIT $${cursor ? 4 : 2}`, cursor ? [email, ...cursor, limit + 1] : [email, limit + 1]))).rows;
  const bookings = rows.slice(0, limit); const last = bookings.at(-1);
  res.json({ bookings, next_cursor: rows.length > limit ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString('base64url') : null });
}));
app.route('/bookings/:id').get(asyncRoute(async (req, res) => {
  const rows = (await transaction(db => db.query('SELECT * FROM bookings WHERE id=$1', [req.params.id]))).rows;
  return rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'booking not found' });
})).delete(asyncRoute(async (req, res) => {
  const result = await transaction(async db => {
    const rows = (await db.query('SELECT * FROM bookings WHERE id=$1', [req.params.id])).rows;
    if (!rows.length) return fail(404, 'booking not found');
    if (rows[0].status === 'cancelled') return fail(409, 'booking already cancelled');
    const updated = await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1 RETURNING *", [req.params.id]);
    return { status: 200, body: updated.rows[0] };
  });
  send(res, result);
}));
app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((error, req, res, next) => { console.error(error); res.status(error.status === 400 ? 400 : 500).json({ error: error.status === 400 ? 'invalid JSON' : 'internal server error' }); });
