import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// A transaction-scoped advisory lock serializes writes across all API instances.
// This protects the rate limit and idempotency records as well as bookings.
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(78243651)');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function initializeDatabase() {
  await transaction(async db => {
    await db.query(`CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, slot_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL)`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot
      ON bookings(slot_id) WHERE status = 'confirmed'`);
    await db.query(`CREATE INDEX IF NOT EXISTS booking_email ON bookings(email, created_at, id)`);
    await db.query(`CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY, body_hash TEXT NOT NULL, status INTEGER NOT NULL, response JSONB NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS attempts (email TEXT NOT NULL, attempted_at BIGINT NOT NULL)`);
    await db.query(`CREATE INDEX IF NOT EXISTS attempts_email ON attempts(email, attempted_at)`);
    await db.query(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY)`);
    const initialized = await db.query("SELECT key FROM metadata WHERE key='initialized'");
    if (!initialized.rowCount) {
      // Seed once for the demo. /reset is free to replace these slots, even with an empty list.
      const day = new Date(); day.setUTCDate(day.getUTCDate() + 1); day.setUTCHours(9, 0, 0, 0);
      for (let i = 0; i < 6; i++) {
        const start = new Date(day.getTime() + Math.floor(i / 2) * 86400000 + (i % 2) * 1800000);
        await db.query('INSERT INTO slots VALUES ($1,$2,$3,$4)', [`demo-${i + 1}`, 'Dr Ade', start.toISOString(), new Date(start.getTime() + 1800000).toISOString()]);
      }
      await db.query("INSERT INTO metadata VALUES ('initialized')");
    }
  });
}
