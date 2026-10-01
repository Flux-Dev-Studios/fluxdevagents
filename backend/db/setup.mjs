import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Client } = pg;

const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
if (!process.env.DATABASE_URL || !process.env.JWT_SECRET || !adminEmail || !adminPassword || adminPassword.length < 12) {
  console.error('Set DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters in .env first.');
  process.exitCode = 1;
} else {
  const targetUrl = new URL(process.env.DATABASE_URL);
  const databaseName = decodeURIComponent(targetUrl.pathname.slice(1));
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
    console.error('DATABASE_URL must use a simple PostgreSQL database name.');
    process.exitCode = 1;
  } else {
    const createDatabase = process.env.DB_CREATE_IF_MISSING !== 'false';
    let adminClient;
    let databaseClient;
  try {
    if (createDatabase) {
      const adminUrl = new URL(targetUrl);
      adminUrl.pathname = '/postgres';
      adminClient = new Client({ connectionString: adminUrl.toString(), ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
      await adminClient.connect();
      const exists = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
      if (!exists.rowCount) await adminClient.query(`CREATE DATABASE "${databaseName}"`);
      await adminClient.end();
      adminClient = undefined;
    }

    databaseClient = new Client({ connectionString: targetUrl.toString(), ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
    await databaseClient.connect();
    const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await databaseClient.query(schema);
    await databaseClient.query(
      `DELETE FROM staff_users WHERE email = ANY($1::text[])`,
      [['maya@fluxdev.local', 'noah@fluxdev.local', 'ellis@fluxdev.local']],
    );
    const adminHash = await bcrypt.hash(adminPassword, 12);
    await databaseClient.query(
      `INSERT INTO staff_users (full_name, email, password_hash, role, approved)
       VALUES ($1, $2, $3, 'admin', TRUE)
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = 'admin', approved = TRUE`,
      [process.env.ADMIN_NAME?.trim() || 'Flux Dev Admin', adminEmail, adminHash],
    );

    console.log('PostgreSQL schema is ready and the admin account has been initialized.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exitCode = 1;
  } finally {
    if (databaseClient) await databaseClient.end().catch(() => {});
    if (adminClient) await adminClient.end().catch(() => {});
  }
  }
}
