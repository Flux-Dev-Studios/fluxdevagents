import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running the staff reports migration.');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id UUID NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
        work_date DATE NOT NULL DEFAULT CURRENT_DATE,
        submitted_at TIMESTAMPTZ,
        title TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE staff_reports ADD COLUMN IF NOT EXISTS work_date DATE;
      UPDATE staff_reports SET work_date = created_at::date WHERE work_date IS NULL;
      ALTER TABLE staff_reports ALTER COLUMN work_date SET DEFAULT CURRENT_DATE;
      ALTER TABLE staff_reports ALTER COLUMN work_date SET NOT NULL;
      CREATE INDEX IF NOT EXISTS staff_reports_staff_day_idx ON staff_reports (staff_id, work_date, updated_at DESC);
    `);
    const { rows: columns } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'staff_reports' AND column_name = 'submitted_at'`,
    );
    if (!columns.length) {
      await pool.query('ALTER TABLE staff_reports ADD COLUMN submitted_at TIMESTAMPTZ');
    }
    await pool.query('UPDATE staff_reports SET submitted_at = NULL WHERE submitted_at = created_at');
    console.log('Staff reports are ready.');
  } catch (error) {
    console.error('Staff reports migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
