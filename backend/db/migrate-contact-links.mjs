import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL before running the contact links migration.');
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  try {
    await pool.query(`
      ALTER TABLE daily_calls
      ADD COLUMN IF NOT EXISTS source_contact_id UUID REFERENCES generated_contacts(id) ON DELETE CASCADE;
      UPDATE daily_calls call
      SET source_contact_id = (
        SELECT contact.id FROM generated_contacts contact
        WHERE contact.work_date = call.work_date
          AND contact.assigned_at IS NOT NULL
          AND NULLIF(regexp_replace(contact.phone, '[^0-9]', '', 'g'), '') = NULLIF(regexp_replace(call.phone, '[^0-9]', '', 'g'), '')
          AND NULLIF(regexp_replace(lower(contact.business_name), '[^[:alnum:]]', '', 'g'), '') = NULLIF(regexp_replace(lower(call.business_name), '[^[:alnum:]]', '', 'g'), '')
        ORDER BY contact.created_at DESC
        LIMIT 1
      )
      WHERE call.source_contact_id IS NULL
        AND EXISTS (
          SELECT 1 FROM generated_contacts contact
          WHERE contact.work_date = call.work_date AND contact.assigned_at IS NOT NULL
            AND NULLIF(regexp_replace(contact.phone, '[^0-9]', '', 'g'), '') = NULLIF(regexp_replace(call.phone, '[^0-9]', '', 'g'), '')
            AND NULLIF(regexp_replace(lower(contact.business_name), '[^[:alnum:]]', '', 'g'), '') = NULLIF(regexp_replace(lower(call.business_name), '[^[:alnum:]]', '', 'g'), '')
        );
      CREATE INDEX IF NOT EXISTS daily_calls_source_contact_idx
      ON daily_calls (source_contact_id) WHERE source_contact_id IS NOT NULL;
    `);
    console.log('Lead contact links are ready.');
  } catch (error) {
    console.error('Lead contact links migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
