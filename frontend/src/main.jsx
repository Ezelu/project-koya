import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function App() {
  const [key, setKey] = useState(sessionStorage.getItem('apiKey') || '');
  const [slots, setSlots] = useState([]); const [selected, setSelected] = useState(null);
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function call(path, options = {}) {
    const response = await fetch(API + path, { ...options, headers: { 'X-API-Key': key, ...options.headers } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
  }
  async function loadSlots() {
    setError(''); setBusy(true); sessionStorage.setItem('apiKey', key);
    try { const data = await call('/slots'); setSlots(data.slots); setSelected(null); if (!data.slots.length) setMessage('No slots are available.'); }
    catch (e) { setError(e.message || 'Could not reach the API.'); }
    finally { setBusy(false); }
  }
  async function book(e) {
    e.preventDefault(); if (!selected) return; setBusy(true); setError(''); setMessage('');
    // Reuse this key for an automatic retry after a network failure.
    const idempotencyKey = crypto.randomUUID();
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ slot_id: selected.id, name, email }) };
    try {
      let booking;
      try { booking = await call('/bookings', options); }
      catch (err) { if (err instanceof TypeError) booking = await call('/bookings', options); else throw err; }
      setMessage(`Confirmed! Booking ID: ${booking.id}. No email is sent by this demo.`); setSelected(null);
      try { const data = await call('/slots'); setSlots(data.slots); } catch { /* Confirmation remains visible if refresh fails. */ }
    } catch (err) { setError(err.message || 'Could not complete the booking.'); }
    finally { setBusy(false); }
  }
  const format = value => new Date(value).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  return <><header><nav><strong className="logo"><span>✳</span> carepoint</strong><small>Thoughtful care, made simple.</small></nav></header><main>
    <p className="eyebrow">Your health, your schedule</p><h1>A little care goes a long way.</h1><p className="intro">Find a time that works for you and book your next appointment in a few simple steps.</p>
    <div className="grid"><section className="card"><h2>Available appointments</h2><p>Choose a time below. Times are shown in your local time zone.</p>
      <label htmlFor="key">API key</label><div className="key-row"><input id="key" type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Enter the clinic API key"/><button onClick={loadSlots} disabled={!key || busy}>Load slots</button></div><p className="hint">Your key stays in this browser session and is sent with API requests.</p>
      <div className="slots">{slots.map(slot => { const unavailable = !slot.available || new Date(slot.start) <= new Date(); return <button type="button" className={'slot ' + (selected?.id === slot.id ? 'selected' : '')} key={slot.id} disabled={unavailable || busy} onClick={() => { setSelected(slot); setMessage(''); }}><span><b>{format(slot.start)}</b><small>{slot.provider}</small></span><span className="pill">{unavailable ? 'Unavailable' : 'Available'}</span></button>; })}</div>
    </section><section className="card"><h2>Book your visit</h2><p>Enter your details and we’ll confirm your appointment.</p><form onSubmit={book}>
      <label htmlFor="selected">Selected appointment</label><input id="selected" readOnly value={selected ? `${format(selected.start)} · ${selected.provider}` : ''} placeholder="Select an available time"/>
      <label htmlFor="name">Full name</label><input id="name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required placeholder="Your full name"/>
      <label htmlFor="email">Email address</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required placeholder="you@example.com"/>
      <button className="submit" disabled={!selected || busy}>Confirm appointment →</button></form>
      {message && <div className="notice" role="status">{message}</div>}{error && <div className="notice error" role="alert">{error}</div>}
    </section></div></main><footer>Carepoint · A simpler way to plan your care</footer></>;
}
createRoot(document.getElementById('root')).render(<App/>);
