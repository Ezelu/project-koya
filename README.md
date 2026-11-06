# Clinic booking — JavaScript edition

Node.js + Express API, PostgreSQL database, React + Vite frontend. Implements levels 1–5 of the [assessment API specification](https://koyaacademy.com/assessment-api/openapi.json). The API is intended for Render, frontend for Netlify, and database for Neon.

## Deployment (Neon → Render → Netlify)

Upload this folder to GitHub first. Do not upload credentials or `.env` files. You'll create three resources:

1. **Neon database:** create a project and copy its PostgreSQL connection string (include `?sslmode=require` if provided). Keep it secret.
2. **Render API:** create a Web Service connected to your GitHub repo. Set the root directory to `backend`, runtime to Node, build command to `npm ci`, and start command to `npm start`. Add environment variables:
   - `DATABASE_URL`: your Neon connection string.
   - `API_KEY`: a long random key you choose (e.g. generated with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Save it securely; share it with the assessors separately.
   - `FRONTEND_URL`: initially your intended Netlify origin, or temporarily leave blank until you have it. This must be an exact origin such as `https://your-site.netlify.app`, without a trailing slash. Comma-separate multiple origins if needed.
   - Render provides `PORT` automatically. Set health check path to `/health` if desired.
   Deploy and copy the HTTPS service URL, e.g. `https://your-api.onrender.com`. Tables and demo slots are created on first startup. Free services may sleep; platform limits and pricing can change.
3. **Netlify frontend:** create a site from the same repository. Set base directory to `frontend`, build command `npm run build`, publish directory `dist`. Add build environment variable `VITE_API_URL` equal to the Render API URL, with no trailing slash. Deploy.
4. Copy your Netlify site origin into Render's `FRONTEND_URL`, save, and redeploy/restart the API. Visit the site, enter the API key, load slots, then book one. The key must match `API_KEY` on Render. Test your deployed API with:

```sh
curl -H 'X-API-Key: YOUR_KEY' https://YOUR-RENDER-URL/slots
```

The **API base URL** is the Render URL (no `/api` prefix). The **web page URL** is the Netlify URL. The GitHub URL is the repository you upload. Record your own video; a walkthrough is below. Keep both deployed resources running and don't change them after submitting, per the assessment rules.

## Run locally

Use Node 20+ and PostgreSQL (local or a separate Neon project). Create the database first. In `backend`, copy `.env.example` to `.env` and set the variables, then:

```sh
cd backend
npm ci
npm start
```

In another terminal:

```sh
cd frontend
cp .env.example .env
npm ci
npm run dev
```

Open the displayed Vite URL. In the backend `.env`, ensure `FRONTEND_URL` matches it exactly. Enter your `API_KEY` on the page. `VITE_API_URL` is public build configuration, not a secret.

## Tests

Tests **delete all slots and bookings** in the database specified by `DATABASE_URL`. Use a dedicated disposable test database, never your live database:

```sh
cd backend
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/TEST_DATABASE' npm test
```

The integration tests use real PostgreSQL and cover auth, validation, slot availability, concurrent booking, cancellation, idempotency, rate limiting and pagination. Build the frontend with `cd frontend && npm run build`.

## Code walkthrough

- `backend/src/server.js`: loads environment variables, initializes the database and starts Express.
- `backend/src/db.js`: PostgreSQL connection pool, schema and transactions. `pg_advisory_xact_lock` serializes transactions across instances; a partial unique index also enforces one confirmed booking per slot.
- `backend/src/app.js`: API-key authentication and contract routes: `/reset`, `/slots`, `/bookings`, `/bookings/:id`. Booking validates details, checks the email rate limit and idempotency, then creates a booking inside a transaction. Pagination uses an opaque cursor containing creation time and ID.
- `frontend/src/main.jsx`: React state, API calls, slot selection and booking confirmation; `style.css` handles presentation. The page sends `X-API-Key` on requests and an idempotency key on booking.
- Every attempt with a nonempty email counts toward the rolling limit, including failed requests and retries. Rate limiting takes priority over idempotency replay, so a sixth request returns 429 until the window clears. An absent email can't be assigned to an email bucket. `/reset` clears bookings, slots, rate-limit attempts and idempotency records.

## Important security and demo limitations

The assessment requires a single shared API key for every API request. The page asks the viewer to enter it rather than embedding it in the public frontend bundle, but anyone who has the key has access to all contract endpoints, including destructive `/reset` and other patients' bookings. CORS is not authorization. This is an assessment demo, **not a production patient portal**: a real clinic needs individual authentication/authorization, admin-only operations, privacy and security review, and stronger abuse prevention. The demo does not send confirmation emails. API rate limiting by email alone can be bypassed by changing email, or abused to block another person's bookings.
