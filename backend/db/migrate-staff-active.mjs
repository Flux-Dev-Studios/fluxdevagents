import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running the staff active status migration.');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await pool.query('ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE');
    console.log('Staff active status is ready.');
  } catch (error) {
    console.error('Could not add staff active status:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
