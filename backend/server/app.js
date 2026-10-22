import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { findCallDuplicates } from './duplicates.js';
import { clearSession, createSession, requireAdmin, requireRole, requireUser } from './middleware.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters. Set it in .env.');
}

const app = express();
const frontendBuild = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
app.disable('x-powered-by');
app.set('trust proxy', process.env.VERCEL || process.env.RENDER === 'true' ? 1 : false);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  next();
});
app.use((req, res, next) => { req.db = pool; next(); });

const rateLimitBuckets = new Map();
const createIpRateLimit = ({ windowMs, max }) => (req, res, next) => {
  const now = Date.now();
  const key = `${req.path}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateLimitBuckets.set(key, bucket);
  }
  if (rateLimitBuckets.size > 5000) {
    for (const [bucketKey, value] of rateLimitBuckets) if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    while (rateLimitBuckets.size > 5000) rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
  }
  res.setHeader('RateLimit-Limit', String(max));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count - 1)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count >= max) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  bucket.count += 1;
  return next();
};
const loginRateLimit = createIpRateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const registrationRateLimit = createIpRateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

const publicUser = (user) => ({ id: user.id, name: user.full_name, email: user.email, role: user.role, approved: user.approved, active: user.active });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validRole = (role) => role === 'call-agent' || role === 'contact-generator';
const alreadySharedContactSql = (contactAlias) => `EXISTS (
  SELECT 1 FROM daily_calls shared_call
  WHERE shared_call.status <> 'pending'
    AND (NULLIF(regexp_replace(shared_call.phone, '[^0-9]', '', 'g'), '') = NULLIF(regexp_replace(${contactAlias}.phone, '[^0-9]', '', 'g'), '')
     OR NULLIF(regexp_replace(lower(shared_call.business_name), '[^[:alnum:]]', '', 'g'), '') = NULLIF(regexp_replace(lower(${contactAlias}.business_name), '[^[:alnum:]]', '', 'g'), '')
    )
)`;
const findWorkspaceCallDuplicates = async (client, calls, contactIds = []) => {
  const [existingCalls, pendingContacts] = await Promise.all([
    client.query(`SELECT id::text AS id, business_name AS business, phone FROM daily_calls WHERE status <> 'pending'`),
    client.query(`SELECT id::text AS id, business_name AS business, phone FROM generated_contacts WHERE work_date = CURRENT_DATE AND assigned_at IS NULL`),
  ]);
  const selectedContactIds = new Set(contactIds.map(String));
  const existing = [
    ...existingCalls.rows.map((row) => ({ ...row, source: 'previously called leads' })),
    ...pendingContacts.rows.filter((row) => !selectedContactIds.has(row.id)).map((row) => ({ ...row, source: 'pending lead submissions' })),
  ];
  return findCallDuplicates(existing, calls);
};

async function distributeApprovedContacts(client, contactIds = null, agentIds = null) {
  const { rows: agents } = await client.query(
    `SELECT id FROM staff_users
     WHERE approved = TRUE AND active = TRUE AND role = 'call-agent'
       AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
     ORDER BY created_at, id`,
    [agentIds],
  );
  if (!agents.length) return [];

  const pending = await client.query(
    `SELECT gc.id, gc.business_name AS business, gc.phone,
            (SELECT pending_call.id FROM daily_calls pending_call
             WHERE pending_call.source_contact_id = gc.id AND pending_call.work_date = gc.work_date
               AND pending_call.status = 'pending'
             ORDER BY pending_call.call_order LIMIT 1) AS "existingCallId"
     FROM generated_contacts gc
     WHERE gc.work_date = CURRENT_DATE AND gc.approved_at IS NOT NULL
       AND ($1::uuid[] IS NULL OR gc.id = ANY($1::uuid[]))
       AND NOT EXISTS (
         SELECT 1 FROM daily_calls assigned_call
         JOIN staff_users assigned_agent ON assigned_agent.id = assigned_call.staff_id
         WHERE assigned_call.source_contact_id = gc.id AND assigned_call.work_date = gc.work_date
           AND assigned_agent.approved = TRUE AND assigned_agent.active = TRUE AND assigned_agent.role = 'call-agent'
       )
       AND (
         NOT EXISTS (SELECT 1 FROM daily_calls any_call WHERE any_call.source_contact_id = gc.id AND any_call.work_date = gc.work_date)
         OR EXISTS (SELECT 1 FROM daily_calls pending_call
                    WHERE pending_call.source_contact_id = gc.id AND pending_call.work_date = gc.work_date AND pending_call.status = 'pending')
       )
     ORDER BY gc.created_at, gc.id FOR UPDATE OF gc`,
    [contactIds],
  );
  if (!pending.rows.length) return [];

  const counts = Object.fromEntries(agents.map(({ id }) => [id, 0]));
  const existing = await client.query(
    `SELECT staff_id, COUNT(*)::int AS count FROM daily_calls
     WHERE work_date = CURRENT_DATE AND staff_id = ANY($1::uuid[]) GROUP BY staff_id`,
    [agents.map(({ id }) => id)],
  );
  for (const row of existing.rows) counts[row.staff_id] = row.count;

  const calls = [];
  for (const contact of pending.rows) {
    const agent = agents.reduce((lowest, candidate) => counts[candidate.id] < counts[lowest.id] ? candidate : lowest, agents[0]);
    const { rows } = contact.existingCallId
      ? await client.query(
        `UPDATE daily_calls SET business_name = $2, phone = $3, staff_id = $4
         WHERE id = $1
         RETURNING id, source_contact_id AS "sourceContactId", business_name AS business, phone, staff_id AS "staffId", status, notes, work_date AS "workDate"`,
        [contact.existingCallId, contact.business, contact.phone, agent.id],
      )
      : await client.query(
        `INSERT INTO daily_calls (business_name, phone, staff_id, source_contact_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, source_contact_id AS "sourceContactId", business_name AS business, phone, staff_id AS "staffId", status, notes, work_date AS "workDate"`,
        [contact.business, contact.phone, agent.id, contact.id],
      );
    calls.push(rows[0]);
    counts[agent.id] += 1;
  }
  await client.query(
    `UPDATE generated_contacts SET assigned_at = NOW()
     WHERE id = ANY($1::uuid[]) AND approved_at IS NOT NULL`,
    [pending.rows.map(({ id }) => id)],
  );
  return calls;
}

const normalizeReportData = (value) => {
  if (!Array.isArray(value) || value.length > 201) return null;
  const rows = value.map((row) => {
    if (!Array.isArray(row) || row.length > 12) return null;
    return Array.from({ length: 12 }, (_, index) => String(row[index] ?? '').slice(0, 350));
  });
  return rows.some((row) => row === null) ? null : rows;
};

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/register', registrationRateLimit, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  if (!name || name.length > 100 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid work email and a name of no more than 100 characters.' });
  }
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Choose a password of at least 12 characters and no more than 72 UTF-8 bytes.' });
  }
  if (!validRole(role)) return res.status(400).json({ error: 'Choose Call agent or Lead agent.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    await pool.query(
      `INSERT INTO staff_users (full_name, email, password_hash, role, approved)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [name, email, hash, role],
    );
    return res.status(201).json({ status: 'pending' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account already exists for that email.' });
    throw error;
  }
}));

app.post('/api/auth/login', loginRateLimit, asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (email.length > 254 || Buffer.byteLength(password, 'utf8') > 72) return res.status(401).json({ error: 'Email or password was not recognized.' });
  const { rows } = await pool.query('SELECT * FROM staff_users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password was not recognized.' });
  if (!user.approved) return res.status(403).json({ code: 'pending', error: 'Your account is waiting for admin approval.' });
  if (!user.active) return res.status(403).json({ code: 'inactive', error: 'This account has been deactivated. Contact your admin.' });
  createSession(res, user);
  return res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
app.get('/api/auth/session', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/bootstrap', requireUser, asyncRoute(async (req, res) => {
  if (req.user.role === 'admin') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE daily_calls IN SHARE ROW EXCLUSIVE MODE');
      await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
      await distributeApprovedContacts(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const callsQuery = req.user.role === 'admin'
    ? `SELECT c.id, c.source_contact_id AS "sourceContactId", gc.submission_id AS "submissionId", gc.generator_id AS "generatorId",
             gc.area, gc.category, c.business_name AS business, c.phone, c.staff_id AS "staffId", c.status, c.notes, c.work_date AS "workDate"
      FROM daily_calls c LEFT JOIN generated_contacts gc ON gc.id = c.source_contact_id
      WHERE c.work_date = CURRENT_DATE ORDER BY c.call_order`
    : `SELECT c.id, c.source_contact_id AS "sourceContactId", c.business_name AS business, c.phone, c.staff_id AS "staffId", c.status, c.notes, c.work_date AS "workDate"
      FROM daily_calls c WHERE c.work_date = CURRENT_DATE AND c.staff_id = $1 ORDER BY c.call_order`;
  const callsPromise = req.user.role === 'admin'
    ? pool.query(callsQuery)
    : req.user.role === 'call-agent' ? pool.query(callsQuery, [req.user.id]) : Promise.resolve({ rows: [] });
  const staffPromise = req.user.role === 'admin'
    ? pool.query('SELECT id, full_name AS name, email, role, approved, active FROM staff_users WHERE role <> $1 ORDER BY created_at, full_name', ['admin'])
    : Promise.resolve({ rows: [] });
  const shiftPromise = req.user.role === 'admin'
    ? pool.query(`SELECT staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt" FROM daily_shifts WHERE work_date = CURRENT_DATE`)
    : pool.query(`SELECT staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt" FROM daily_shifts WHERE work_date = CURRENT_DATE AND staff_id = $1`, [req.user.id]);
  const contactsPromise = req.user.role === 'admin'
    ? pool.query(`SELECT id, submission_id AS "submissionId", business_name AS business, phone, area, category, map_query AS "mapQuery", generator_id AS "generatorId", work_date AS "workDate" FROM generated_contacts WHERE work_date = CURRENT_DATE AND approved_at IS NOT NULL AND assigned_at IS NULL ORDER BY created_at`)
    : Promise.resolve({ rows: [] });
  const contactActivityPromise = req.user.role === 'admin'
    ? pool.query(`SELECT generator_id AS "generatorId", COUNT(*)::int AS submitted FROM generated_contacts WHERE work_date = CURRENT_DATE GROUP BY generator_id`)
    : Promise.resolve({ rows: [] });
  const contactSubmissionsPromise = req.user.role === 'admin'
    ? pool.query(
      `SELECT gc.submission_id AS id, gc.generator_id AS "generatorId", su.full_name AS "generatorName",
              MIN(gc.created_at) AS "submittedAt", COUNT(*)::int AS count,
              json_agg(json_build_object(
                'id', gc.id, 'business', gc.business_name, 'phone', gc.phone, 'area', gc.area, 'category', gc.category,
                'alreadyShared', ${alreadySharedContactSql('gc')},
                'isDuplicate', EXISTS (
                  SELECT 1 FROM generated_contacts other_contact
                  WHERE other_contact.id <> gc.id
                    AND (
                      (NULLIF(regexp_replace(other_contact.phone, '[^0-9]', '', 'g'), '') IS NOT NULL
                        AND NULLIF(regexp_replace(other_contact.phone, '[^0-9]', '', 'g'), '') = NULLIF(regexp_replace(gc.phone, '[^0-9]', '', 'g'), ''))
                      OR
                      (NULLIF(regexp_replace(lower(other_contact.business_name), '[^[:alnum:]]', '', 'g'), '') IS NOT NULL
                        AND NULLIF(regexp_replace(lower(other_contact.business_name), '[^[:alnum:]]', '', 'g'), '') = NULLIF(regexp_replace(lower(gc.business_name), '[^[:alnum:]]', '', 'g'), ''))
                    )
                )
              ) ORDER BY gc.created_at) AS contacts
       FROM generated_contacts gc
       JOIN staff_users su ON su.id = gc.generator_id
       WHERE gc.work_date = CURRENT_DATE AND gc.approved_at IS NULL AND gc.submission_id IS NOT NULL
       GROUP BY gc.submission_id, gc.generator_id, su.full_name
       ORDER BY MIN(gc.created_at)`,
    )
    : Promise.resolve({ rows: [] });
  const savedLeadsPromise = req.user.role === 'admin'
    ? pool.query(
      `SELECT gc.id, gc.business_name AS business, gc.phone, gc.area, gc.category,
              gc.work_date AS "workDate", gc.assigned_at AS "assignedAt",
              c.staff_id AS "staffId", su.full_name AS "agentName", c.status, c.notes
       FROM generated_contacts gc
       LEFT JOIN daily_calls c ON c.source_contact_id = gc.id AND c.work_date = gc.work_date
       LEFT JOIN staff_users su ON su.id = c.staff_id
       WHERE gc.work_date = CURRENT_DATE AND gc.approved_at IS NOT NULL AND gc.assigned_at IS NOT NULL
       ORDER BY gc.assigned_at DESC, gc.created_at DESC`,
    )
    : Promise.resolve({ rows: [] });
  const myContactsPromise = req.user.role === 'contact-generator'
    ? pool.query(
      `SELECT id, submission_id AS "submissionId", business_name AS business, phone, area, category,
              work_date AS "workDate", (approved_at IS NULL AND assigned_at IS NULL) AS "canEdit", created_at AS "createdAt"
       FROM generated_contacts WHERE generator_id = $1 ORDER BY created_at DESC`,
      [req.user.id],
    )
    : Promise.resolve({ rows: [] });
  const [calls, staff, shifts, contacts, contactActivity, contactSubmissions, savedLeads, myContacts] = await Promise.all([
    callsPromise, staffPromise, shiftPromise, contactsPromise, contactActivityPromise, contactSubmissionsPromise, savedLeadsPromise, myContactsPromise,
  ]);
  return res.json({
    user: publicUser(req.user),
    calls: calls.rows,
    staff: staff.rows,
    shifts: shifts.rows,
    contacts: contacts.rows,
    contactActivity: contactActivity.rows,
    contactSubmissions: contactSubmissions.rows,
    savedLeads: savedLeads.rows,
    myContacts: myContacts.rows,
  });
}));

app.get('/api/team/pending', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, full_name AS name, email, role, approved, active FROM staff_users WHERE role <> 'admin' ORDER BY approved, created_at`);
  res.json({ staff: rows });
}));
app.get('/api/shifts/today', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt"
     FROM daily_shifts WHERE work_date = CURRENT_DATE`,
  );
  res.json({ shifts: rows });
}));
app.get('/api/calls/today', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, business_name AS business, phone, staff_id AS "staffId", status, notes, work_date AS "workDate"
     FROM daily_calls WHERE work_date = CURRENT_DATE ORDER BY call_order`,
  );
  return res.json({ calls: rows });
}));
app.patch('/api/team/:id/approval', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const role = String(req.body.role || '');
  if (!validRole(role)) return res.status(400).json({ error: 'Choose Call agent or Lead agent.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE daily_calls IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(`UPDATE staff_users SET role = $2, approved = TRUE WHERE id = $1 AND role <> 'admin' RETURNING id, full_name AS name, email, role, approved, active`, [req.params.id, role]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Staff account not found.' }); }
    await distributeApprovedContacts(client);
    await client.query('COMMIT');
    return res.json({ staff: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
app.delete('/api/team/:id/approval', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM staff_users WHERE id = $1 AND approved = FALSE AND role <> 'admin' RETURNING id`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Pending signup request not found.' });
  return res.status(204).end();
}));
app.patch('/api/team/:id/role', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const role = String(req.body.role || '');
  if (!validRole(role)) return res.status(400).json({ error: 'Choose Call agent or Lead agent.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(`UPDATE staff_users SET role = $2 WHERE id = $1 AND approved = TRUE AND role <> 'admin' RETURNING id`, [req.params.id, role]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Approved staff account not found.' }); }
    await distributeApprovedContacts(client);
    await client.query('COMMIT');
    return res.json({ status: 'updated' });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
app.patch('/api/team/:id/active', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active must be true or false.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(
      `UPDATE staff_users SET active = $2 WHERE id = $1 AND approved = TRUE AND role <> 'admin'
       RETURNING id, full_name AS name, email, role, approved, active`,
      [req.params.id, req.body.active],
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Approved staff account not found.' }); }
    await distributeApprovedContacts(client);
    await client.query('COMMIT');
    return res.json({ staff: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));
app.delete('/api/team/:id', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const staff = await client.query('SELECT id FROM staff_users WHERE id = $1 AND role <> $2 FOR UPDATE', [req.params.id, 'admin']);
    if (!staff.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Staff account not found.' }); }
    const archive = await client.query('SELECT 1 FROM staff_reports WHERE staff_id = $1 LIMIT 1', [req.params.id]);
    if (archive.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This account has saved reports. Deactivate it to preserve the report archive.' });
    }
    await client.query('DELETE FROM staff_users WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    return res.status(204).end();
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/contacts/batch', requireUser, requireRole('contact-generator'), asyncRoute(async (req, res) => {
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  if (!contacts.length || contacts.length > 1000) return res.status(400).json({ error: 'Submit between 1 and 1000 contacts.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const submissionId = randomUUID();
    const created = [];
    const candidates = contacts.map((contact, index) => ({
      id: String(contact.id || index),
      business: String(contact.business || '').trim(),
      phone: String(contact.phone || '').trim(),
    })).filter((contact) => contact.business && contact.phone);
    if (!candidates.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No valid business and phone pairs found.' }); }
    for (const contact of candidates) {
      const business = String(contact.business || '').trim();
      const phone = String(contact.phone || '').trim();
      const { rows } = await client.query(
        `INSERT INTO generated_contacts (submission_id, business_name, phone, area, category, map_query, generator_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, submission_id AS "submissionId", business_name AS business, phone, area, category, map_query AS "mapQuery", generator_id AS "generatorId", work_date AS "workDate", TRUE AS "canEdit", created_at AS "createdAt"`,
        [submissionId, business, phone, String(contact.area || ''), String(contact.category || ''), String(contact.mapQuery || ''), req.user.id],
      );
      created.push(rows[0]);
    }
    await client.query('COMMIT');
    return res.status(201).json({ submissionId: created.length ? submissionId : null, contacts: created });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.patch('/api/my-contacts/:id', requireUser, requireRole('contact-generator'), asyncRoute(async (req, res) => {
  const business = String(req.body.business || '').trim().slice(0, 200);
  const phone = String(req.body.phone || '').trim().slice(0, 80);
  const area = String(req.body.area || '').trim().slice(0, 160);
  const category = String(req.body.category || '').trim().slice(0, 120);
  if (!business || !phone) return res.status(400).json({ error: 'Business name and phone number are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows: currentRows } = await client.query(
      `SELECT id::text AS id, business_name AS business, phone, approved_at AS "approvedAt", assigned_at AS "assignedAt"
       FROM generated_contacts
       WHERE id = $1 AND generator_id = $2 AND work_date = CURRENT_DATE
       FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    const current = currentRows[0];
    if (!current) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Today’s saved contact was not found.' }); }
    if (current.approvedAt || current.assignedAt) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This saved contact is now managed by your admin.' }); }
    const { rows } = await client.query(
      `UPDATE generated_contacts
       SET business_name = $3, phone = $4, area = $5, category = $6,
           map_query = concat_ws(' ', NULLIF($6, ''), NULLIF($5, '')),
           submission_id = $7, approved_at = NULL, assigned_at = NULL, created_at = NOW()
       WHERE id = $1 AND generator_id = $2
       RETURNING id, submission_id AS "submissionId", business_name AS business, phone, area, category,
                 work_date AS "workDate", TRUE AS "canEdit", created_at AS "createdAt"`,
      [current.id, req.user.id, business, phone, area, category, randomUUID()],
    );
    await client.query('COMMIT');
    return res.json({ contact: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.delete('/api/my-contacts/:id', requireUser, requireRole('contact-generator'), asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows: currentRows } = await client.query(
      `SELECT approved_at AS "approvedAt", assigned_at AS "assignedAt" FROM generated_contacts
       WHERE id = $1 AND generator_id = $2 AND work_date = CURRENT_DATE FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    if (!currentRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Today’s saved contact was not found.' }); }
    if (currentRows[0].approvedAt || currentRows[0].assignedAt) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'This saved contact is now managed by your admin.' }); }
    const { rows } = await client.query(
      `DELETE FROM generated_contacts
       WHERE id = $1 AND generator_id = $2 AND work_date = CURRENT_DATE AND approved_at IS NULL AND assigned_at IS NULL
       RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Today’s saved contact was not found.' }); }
    await client.query('COMMIT');
    return res.status(200).json({ deleted: true });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/contact-agents/:id/approval', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const contactIds = Array.isArray(req.body.contactIds) ? [...new Set(req.body.contactIds.map(String))] : [];
  const agentIds = Array.isArray(req.body.agentIds) ? [...new Set(req.body.agentIds.map(String))] : [];
  const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!contactIds.length || contactIds.length > 1000 || contactIds.some((id) => !validUuid.test(id))) {
    return res.status(400).json({ error: 'Select between 1 and 1000 valid leads to approve.' });
  }
  if (!agentIds.length || agentIds.some((id) => !validUuid.test(id))) {
    return res.status(400).json({ error: 'Choose at least one valid active Call agent to receive these leads.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE daily_calls IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const pending = await client.query(
      `SELECT id::text AS id, business_name AS business, phone
       FROM generated_contacts
       WHERE id = ANY($1::uuid[]) AND generator_id = $2 AND work_date = CURRENT_DATE AND approved_at IS NULL
       FOR UPDATE`,
      [contactIds, req.params.id],
    );
    if (!pending.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No selected pending leads were found for this lead agent.' });
    }
    const availableAgents = await client.query(
      `SELECT id FROM staff_users
       WHERE approved = TRUE AND active = TRUE AND role = 'call-agent'
         AND id = ANY($1::uuid[])
       ORDER BY created_at, id`,
      [agentIds],
    );
    if (availableAgents.rows.length !== agentIds.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'One or more selected Call agents are no longer active. Refresh and choose active agents.' });
    }
    const pendingIds = pending.rows.map((contact) => contact.id);
    const alreadyShared = await client.query(
      `SELECT current_contact.id::text AS id
       FROM generated_contacts current_contact
       WHERE current_contact.id = ANY($1::uuid[])
         AND ${alreadySharedContactSql('current_contact')}`,
      [pendingIds],
    );
    const alreadySharedIds = alreadyShared.rows.map((contact) => contact.id);
    const duplicateIds = [];
    const eligibleIds = pendingIds;
    const approved = eligibleIds.length
      ? await client.query(
        `UPDATE generated_contacts
         SET approved_at = NOW()
         WHERE id = ANY($1::uuid[]) AND generator_id = $2 AND work_date = CURRENT_DATE AND approved_at IS NULL
         RETURNING id, submission_id AS "submissionId", business_name AS business, phone, area, category,
                   map_query AS "mapQuery", generator_id AS "generatorId", work_date AS "workDate"`,
        [eligibleIds, req.params.id],
      )
      : { rows: [] };
    const calls = await distributeApprovedContacts(client, approved.rows.map((contact) => contact.id), agentIds);
    if (calls.length !== approved.rows.length) {
      throw new Error(`Lead distribution mismatch: approved ${approved.rows.length}, assigned ${calls.length}.`);
    }
    await client.query('COMMIT');
    if (!approved.rows.length) {
      return res.status(409).json({
        error: 'No selected leads could be approved. They may no longer be pending review.',
        alreadySharedIds,
        duplicateIds,
      });
    }
    return res.json({ contacts: approved.rows, calls, alreadySharedIds, duplicateIds });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/generated-contacts/:id', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const business = String(req.body.business || '').trim().slice(0, 200);
  const phone = String(req.body.phone || '').trim().slice(0, 80);
  const area = String(req.body.area || '').trim().slice(0, 160);
  const category = String(req.body.category || '').trim().slice(0, 120);
  if (!business || !phone) return res.status(400).json({ error: 'Business name and phone number are required.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE generated_contacts SET business_name = $2, phone = $3, area = $4, category = $5,
         map_query = concat_ws(' ', NULLIF($5, ''), NULLIF($4, ''))
       WHERE id = $1 AND work_date = CURRENT_DATE
       RETURNING id, submission_id AS "submissionId", generator_id AS "generatorId", business_name AS business, phone, area, category,
                 work_date AS "workDate", approved_at AS "approvedAt", assigned_at AS "assignedAt"`,
      [req.params.id, business, phone, area, category],
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Today’s lead was not found.' }); }
    await client.query('UPDATE daily_calls SET business_name = $2, phone = $3 WHERE source_contact_id = $1 AND work_date = CURRENT_DATE', [req.params.id, business, phone]);
    await client.query('COMMIT');
    return res.json({ contact: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.delete('/api/generated-contacts/:id', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM generated_contacts
     WHERE id = $1 AND work_date = CURRENT_DATE
     RETURNING id`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Today’s lead not found.' });
  return res.status(204).end();
}));

app.delete('/api/contact-agents/:id/pending-leads', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!validUuid.test(req.params.id)) return res.status(400).json({ error: 'Invalid lead agent.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(
      `DELETE FROM generated_contacts
       WHERE generator_id = $1 AND work_date = CURRENT_DATE AND approved_at IS NULL
       RETURNING id::text AS id`,
      [req.params.id],
    );
    await client.query('COMMIT');
    return res.json({ deletedIds: rows.map((row) => row.id) });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/calls/assign', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const calls = Array.isArray(req.body.calls) ? req.body.calls : [];
  const contactIds = Array.isArray(req.body.contactIds) ? req.body.contactIds : [];
  if (!calls.length || calls.length > 1000) return res.status(400).json({ error: 'Submit between 1 and 1000 calls.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE daily_calls IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE generated_contacts IN SHARE ROW EXCLUSIVE MODE');
    const selectedContactIds = [...new Set(contactIds.map(String))];
    if (selectedContactIds.length) {
      const eligibleContacts = await client.query(
        `SELECT id FROM generated_contacts
         WHERE id = ANY($1::uuid[]) AND approved_at IS NOT NULL AND assigned_at IS NULL
         FOR UPDATE`,
        [selectedContactIds],
      );
      if (eligibleContacts.rowCount !== selectedContactIds.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'One or more selected leads are no longer available for call review.' });
      }
    }
    const duplicates = await findWorkspaceCallDuplicates(client, calls, contactIds);
    if (duplicates.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'duplicates', error: 'Remove duplicate entries before sharing calls.', duplicates });
    }
    const agentRows = await client.query(`SELECT id FROM staff_users WHERE approved = TRUE AND active = TRUE AND role = 'call-agent' ORDER BY created_at, id`);
    if (!agentRows.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Approve at least one Call agent before sharing calls.' }); }
    const countsResult = await client.query(`SELECT staff_id, COUNT(*)::int AS count FROM daily_calls WHERE work_date = CURRENT_DATE GROUP BY staff_id`);
    const counts = Object.fromEntries(agentRows.rows.map((agent) => [agent.id, 0]));
    for (const item of countsResult.rows) if (item.staff_id in counts) counts[item.staff_id] = item.count;
    const saved = [];
    for (const call of calls) {
      const business = String(call.business || '').trim();
      const phone = String(call.phone || '').trim();
      if (!business || !phone) continue;
      const assigned = agentRows.rows.reduce((lowest, agent) => counts[agent.id] < counts[lowest.id] ? agent : lowest, agentRows.rows[0]);
      const { rows } = await client.query(
        `INSERT INTO daily_calls (business_name, phone, staff_id, source_contact_id) VALUES ($1, $2, $3, $4)
         RETURNING id, source_contact_id AS "sourceContactId", business_name AS business, phone, staff_id AS "staffId", status, notes, work_date AS "workDate"`,
        [business, phone, assigned.id, selectedContactIds.includes(String(call.id)) ? call.id : null],
      );
      counts[assigned.id] += 1;
      saved.push(rows[0]);
    }
    if (selectedContactIds.length) await client.query('UPDATE generated_contacts SET assigned_at = NOW() WHERE id = ANY($1::uuid[]) AND approved_at IS NOT NULL AND assigned_at IS NULL', [selectedContactIds]);
    if (!saved.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No valid calls were submitted.' }); }
    await client.query('COMMIT');
    return res.status(201).json({ calls: saved });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/calls/check-duplicates', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const calls = Array.isArray(req.body.calls) ? req.body.calls : [];
  const contactIds = Array.isArray(req.body.contactIds) ? req.body.contactIds : [];
  if (calls.length > 1000) return res.status(400).json({ error: 'Review no more than 1000 calls at a time.' });
  const duplicates = await findWorkspaceCallDuplicates(pool, calls, contactIds);
  return res.json({ duplicates });
}));

app.patch('/api/calls/:id', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'interested', 'no-answer', 'not-interested'].includes(status)) return res.status(400).json({ error: 'Invalid call status.' });
  const notes = typeof req.body.notes === 'string' ? req.body.notes.slice(0, 5000) : undefined;
  const sql = notes === undefined
    ? `UPDATE daily_calls SET status = $3 WHERE id = $1 AND staff_id = $2 RETURNING id`
    : `UPDATE daily_calls SET status = $3, notes = $4 WHERE id = $1 AND staff_id = $2 RETURNING id`;
  const values = notes === undefined ? [req.params.id, req.user.id, status] : [req.params.id, req.user.id, status, notes];
  const { rows } = await pool.query(sql, values);
  if (!rows[0]) return res.status(404).json({ error: 'Call not found in your queue.' });
  return res.json({ status: 'updated' });
}));

app.get('/api/reports', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const [{ rows: dayRows }, { rows }] = await Promise.all([
    pool.query('SELECT CURRENT_DATE::text AS today'),
    pool.query(
    `SELECT id, title, data, work_date AS "workDate", updated_at AS "updatedAt", submitted_at AS "submittedAt"
     FROM staff_reports WHERE staff_id = $1 AND work_date = CURRENT_DATE
     ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    [req.user.id],
    ),
  ]);
  return res.json({ report: rows[0] || null, today: dayRows[0].today });
}));
app.post('/api/reports', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const data = normalizeReportData(req.body.data);
  if (!title || !data) return res.status(400).json({ error: 'Add a report name and a valid sheet with up to 200 rows and 12 columns.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dateRows } = await client.query('SELECT CURRENT_DATE::text AS today');
    if (req.body.workDate !== dateRows[0].today) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'report_day_ended', error: 'This report day has ended. Open today’s sheet to continue.' });
    }
    await client.query('SELECT id FROM staff_users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const current = await client.query(
      `SELECT id FROM staff_reports WHERE staff_id = $1 AND work_date = CURRENT_DATE AND submitted_at IS NULL
       ORDER BY updated_at DESC, created_at DESC LIMIT 1 FOR UPDATE`,
      [req.user.id],
    );
    const saved = current.rows[0]
      ? await client.query(
        `UPDATE staff_reports SET title = $2, data = $3::jsonb, updated_at = NOW(), submitted_at = NULL
         WHERE id = $1
         RETURNING id, title, data, work_date AS "workDate", updated_at AS "updatedAt", submitted_at AS "submittedAt"`,
        [current.rows[0].id, title, JSON.stringify(data)],
      )
      : await client.query(
        `INSERT INTO staff_reports (staff_id, title, data)
         VALUES ($1, $2, $3::jsonb)
         RETURNING id, title, data, work_date AS "workDate", updated_at AS "updatedAt", submitted_at AS "submittedAt"`,
        [req.user.id, title, JSON.stringify(data)],
      );
    await client.query('COMMIT');
    return res.json({ report: saved.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));
app.post('/api/reports/:id/send', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE staff_reports SET submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE AND submitted_at IS NULL
     RETURNING id, title, data, work_date AS "workDate", updated_at AS "updatedAt", submitted_at AS "submittedAt"`,
    [req.params.id, req.user.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Today’s saved report was not found. The day may have ended.' });
  return res.json({ report: rows[0] });
}));
app.patch('/api/reports/:id', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const data = normalizeReportData(req.body.data);
  if (!title || !data) return res.status(400).json({ error: 'Add a report name and a valid sheet with up to 200 rows and 12 columns.' });
  const { rows } = await pool.query(
    `UPDATE staff_reports SET title = $3, data = $4::jsonb, updated_at = NOW()
     WHERE id = $1 AND staff_id = $2 AND work_date = CURRENT_DATE AND submitted_at IS NULL
     RETURNING id, title, data, work_date AS "workDate", updated_at AS "updatedAt", submitted_at AS "submittedAt"`,
    [req.params.id, req.user.id, title, JSON.stringify(data)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Report not found.' });
  return res.json({ report: rows[0] });
}));
app.delete('/api/reports/:id', requireUser, requireRole('call-agent'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT submitted_at AS "submittedAt" FROM staff_reports WHERE id = $1 AND staff_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Report not found.' });
  return res.status(409).json({ error: 'Saved reports are kept in the archive and cannot be deleted.' });
}));
app.get('/api/admin/reports', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.data, r.work_date AS "workDate", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
            s.id AS "staffId", s.full_name AS "staffName", s.email AS "staffEmail"
     FROM staff_reports r
     JOIN staff_users s ON s.id = r.staff_id
     WHERE r.submitted_at IS NOT NULL
     ORDER BY r.updated_at DESC, r.created_at DESC`,
  );
  return res.json({ reports: rows });
}));

app.post('/api/shifts/clock-in', requireUser, requireRole('call-agent', 'contact-generator'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO daily_shifts (staff_id, work_date, clocked_in_at, signed_out_at)
     VALUES ($1, CURRENT_DATE, NOW(), NULL)
     ON CONFLICT (staff_id, work_date) DO UPDATE SET clocked_in_at = NOW(), signed_out_at = NULL
     RETURNING staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt"`,
    [req.user.id],
  );
  return res.json({ shift: rows[0] });
}));
app.post('/api/shifts/clock-out', requireUser, requireRole('call-agent', 'contact-generator'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE daily_shifts SET elapsed_seconds = elapsed_seconds + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - clocked_in_at)))::int), clocked_in_at = NULL, signed_out_at = NOW()
     WHERE staff_id = $1 AND work_date = CURRENT_DATE AND clocked_in_at IS NOT NULL
     RETURNING staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt"`,
    [req.user.id],
  );
  if (!rows[0]) return res.status(409).json({ error: 'No active shift to clock out from.' });
  return res.json({ shift: rows[0] });
}));

if (process.env.SERVE_FRONTEND === 'true') {
  app.use(express.static(frontendBuild));
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    return res.sendFile(resolve(frontendBuild, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === '23503') return res.status(400).json({ error: 'A referenced account or contact no longer exists.' });
  return res.status(500).json({ error: 'Server error. Check the server log.' });
});

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3001);
  const start = async () => {
    // Render starts the API directly, so apply the lead approval schema before
    // accepting requests. The advisory lock keeps simultaneous instances from
    // racing through the idempotent migration.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [748392615]);
      await client.query('ALTER TABLE generated_contacts ADD COLUMN IF NOT EXISTS submission_id UUID');
      await client.query('ALTER TABLE generated_contacts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ');
      await client.query(
        'CREATE INDEX IF NOT EXISTS generated_contacts_submission_idx ON generated_contacts (work_date, submission_id) WHERE approved_at IS NULL AND submission_id IS NOT NULL',
      );
      await client.query(
        `UPDATE generated_contacts
         SET submission_id = gen_random_uuid(), approved_at = NULL
         WHERE submission_id IS NULL AND assigned_at IS NULL`,
      );
      await client.query(
        'UPDATE generated_contacts SET approved_at = created_at WHERE approved_at IS NULL AND assigned_at IS NOT NULL',
      );
      await client.query('COMMIT');
      console.log('Lead submission schema is ready.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    app.listen(port, '0.0.0.0', () => console.log(`Flux Dev API listening on port ${port}`));
  };
  start().catch((error) => {
    console.error('API startup failed before listening:', error);
    process.exitCode = 1;
  });
}
