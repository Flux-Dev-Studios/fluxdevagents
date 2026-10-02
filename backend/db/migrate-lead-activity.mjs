import 'dotenv/config';
import { pool } from '../server/db.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running the lead activity migration.');
  process.exitCode = 1;
} else {
  try {
    await pool.query('ALTER TABLE generated_contacts ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ');
    await pool.query('CREATE INDEX IF NOT EXISTS generated_contacts_generator_day_idx ON generated_contacts (generator_id, work_date)');
    console.log('Lead activity tracking is ready. Existing generated contacts were preserved.');
  } catch (error) {
    console.error('Lead activity migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}