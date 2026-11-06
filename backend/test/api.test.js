import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to a disposable PostgreSQL database; tests erase its data');
process.env.API_KEY = 'test-key';
const { app } = await import('../src/app.js');
const { pool, initializeDatabase } = await import('../src/db.js');
const auth = { 'X-API-Key': 'test-key' };
const booking = (slot_id, email = 'Ada@Example.com') => ({ slot_id, email, name: ' Ada ' });
const slots = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, provider: 'Dr Ade', start: '2099-12-10T09:00:00Z', end: '2099-12-10T09:30:00Z' }));
before(async () => { await initializeDatabase(); await request(app).post('/reset').set(auth).send({ slots }).expect(200); });
after(async () => { await pool.end(); });
test('authentication, validation, lookup and availability', async () => {
 await request(app).get('/slots').expect(401); await request(app).post('/bookings').set(auth).send(booking('s0', 'bad')).expect(400);
 await request(app).post('/bookings').set(auth).send(booking('missing')).expect(404);
 const r = await request(app).post('/bookings').set(auth).send(booking('s0')).expect(201);
 assert.equal(r.body.name, 'Ada'); assert.equal(r.body.email, 'ada@example.com');
 assert.deepEqual((await request(app).get('/bookings/' + r.body.id).set(auth).expect(200)).body, r.body);
 const listed = await request(app).get('/slots?provider=Dr%20Ade').set(auth).expect(200);
 assert.equal(listed.body.slots.find(s => s.id === 's0').available, false);
});
test('concurrency, cancellation and rebooking', async () => {
 const results = await Promise.all(Array.from({length: 12}, (_, i) => request(app).post('/bookings').set(auth).send(booking('s1', `person${i}@example.com`))));
 assert.equal(results.filter(r => r.status === 201).length, 1); assert.equal(results.filter(r => r.status === 409).length, 11);
 const id = results.find(r => r.status === 201).body.id;
 assert.equal((await request(app).delete('/bookings/' + id).set(auth).expect(200)).body.status, 'cancelled');
 await request(app).delete('/bookings/' + id).set(auth).expect(409);
 await request(app).post('/bookings').set(auth).send(booking('s1', 'new@example.com')).expect(201);
});
test('idempotency and mismatched body', async () => {
 const action = () => request(app).post('/bookings').set(auth).set('Idempotency-Key', 'same-key').send(booking('s2', 'retry@example.com'));
 const [a, b] = await Promise.all([action(), action()]); assert.equal(a.status, 201); assert.equal(b.status, 201); assert.deepEqual(a.body, b.body);
 await request(app).post('/bookings').set(auth).set('Idempotency-Key', 'same-key').send(booking('s3', 'retry@example.com')).expect(422);
});
test('rate limit counts failures and isolates emails', async () => {
 for (let i = 0; i < 5; i++) await request(app).post('/bookings').set(auth).send(booking('missing', 'rate@example.com')).expect(404);
 const r = await request(app).post('/bookings').set(auth).send(booking('missing', 'RATE@example.com')).expect(429);
 assert.ok(Number(r.headers['retry-after']) > 0); await request(app).post('/bookings').set(auth).send(booking('s4', 'other@example.com')).expect(201);
});
test('cursor pagination and invalid limits', async () => {
 for (let i = 5; i < 9; i++) await request(app).post('/bookings').set(auth).send(booking(`s${i}`, 'pages@example.com')).expect(201);
 const a = (await request(app).get('/bookings').query({email:'PAGES@example.com', limit:2}).set(auth).expect(200)).body;
 const b = (await request(app).get('/bookings').query({email:'pages@example.com', limit:2, cursor:a.next_cursor}).set(auth).expect(200)).body;
 assert.equal(a.bookings.length,2); assert.equal(b.bookings.length,2); assert.equal(b.next_cursor,null);
 assert.equal(new Set([...a.bookings, ...b.bookings].map(x => x.id)).size,4);
 await request(app).get('/bookings?email=a&limit=51').set(auth).expect(400);
});
