import 'dotenv/config';
if (!process.env.DATABASE_URL || !process.env.API_KEY) throw new Error('DATABASE_URL and API_KEY are required');
const { initializeDatabase } = await import('./db.js');
const { app } = await import('./app.js');
await initializeDatabase();
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`API listening on port ${port}`));
