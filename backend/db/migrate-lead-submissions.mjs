import 'dotenv/config';
import { pool } from '../server/db.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running the lead submissions migration.');
  process.exitCode = 1;
} else {
  try {
    await pool.query('ALTER TABLE generated_contacts ADD COLUMN IF NOT EXISTS submission_id UUID');
    await pool.query('ALTER TABLE generated_contacts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ');
    await pool.query(
      'CREATE INDEX IF NOT EXISTS generated_contacts_submission_idx ON generated_contacts (work_date, submission_id) WHERE approved_at IS NULL AND submission_id IS NOT NULL',
    );
    await pool.query(
      `UPDATE generated_contacts
       SET submission_id = gen_random_uuid(), approved_at = NULL
       WHERE submission_id IS NULL AND assigned_at IS NULL`,
    );
    await pool.query(
      'UPDATE generated_contacts SET approved_at = created_at WHERE approved_at IS NULL AND assigned_at IS NOT NULL',
    );
    console.log('Unassigned existing leads are waiting for admin approval; already assigned leads were preserved.');
  } catch (error) {
    console.error('Lead submissions migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
