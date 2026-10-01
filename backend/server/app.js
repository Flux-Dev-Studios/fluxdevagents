import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { clearSession, createSession, requireAdmin, requireRole, requireUser } from './middleware.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters. Set it in .env.');
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => { req.db = pool; next(); });

const publicUser = (user) => ({ id: user.id, name: user.full_name, email: user.email, role: user.role, approved: user.approved });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validRole = (role) => role === 'call-agent' || role === 'contact-generator';

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected' });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = String(req.body.role || '');
  if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Name, email, and a password of at least 8 characters are required.' });
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

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM staff_users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password was not recognized.' });
  if (!user.approved) return res.status(403).json({ code: 'pending', error: 'Your account is waiting for admin approval.' });
  createSession(res, user);
  return res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.status(204).end(); });
app.get('/api/auth/session', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/bootstrap', requireUser, asyncRoute(async (req, res) => {
  const day = String(req.query.day || 'CURRENT_DATE');
  const callsQuery = req.user.role === 'admin'
    ? `SELECT c.id, c.business_name AS business, c.phone, c.staff_id AS "staffId", c.status, c.notes, c.work_date AS "workDate"
      FROM daily_calls c WHERE c.work_date = CURRENT_DATE ORDER BY c.call_order`
    : `SELECT c.id, c.business_name AS business, c.phone, c.staff_id AS "staffId", c.status, c.notes, c.work_date AS "workDate"
      FROM daily_calls c WHERE c.work_date = CURRENT_DATE AND c.staff_id = $1 ORDER BY c.call_order`;
  const callsPromise = req.user.role === 'admin' ? pool.query(callsQuery) : pool.query(callsQuery, [req.user.id]);
  const staffPromise = req.user.role === 'admin'
    ? pool.query('SELECT id, full_name AS name, email, role, approved FROM staff_users WHERE role <> $1 ORDER BY created_at, full_name', ['admin'])
    : Promise.resolve({ rows: [] });
  const shiftPromise = req.user.role === 'admin'
    ? pool.query(`SELECT staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt" FROM daily_shifts WHERE work_date = CURRENT_DATE`)
    : pool.query(`SELECT staff_id AS "staffId", elapsed_seconds AS elapsed, clocked_in_at AS "startedAt", signed_out_at AS "signedOutAt" FROM daily_shifts WHERE work_date = CURRENT_DATE AND staff_id = $1`, [req.user.id]);
  const contactsPromise = req.user.role === 'admin'
    ? pool.query(`SELECT id, business_name AS business, phone, area, category, map_query AS "mapQuery", generator_id AS "generatorId", work_date AS "workDate" FROM generated_contacts WHERE work_date = CURRENT_DATE ORDER BY created_at`)
    : Promise.resolve({ rows: [] });
  const [calls, staff, shifts, contacts] = await Promise.all([callsPromise, staffPromise, shiftPromise, contactsPromise]);
  return res.json({ user: publicUser(req.user), calls: calls.rows, staff: staff.rows, shifts: shifts.rows, contacts: contacts.rows });
}));

app.get('/api/team/pending', requireUser, requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, full_name AS name, email, role, approved FROM staff_users WHERE role <> 'admin' ORDER BY approved, created_at`);
  res.json({ staff: rows });
}));
app.patch('/api/team/:id/approval', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const role = String(req.body.role || '');
  if (!validRole(role)) return res.status(400).json({ error: 'Choose Call agent or Lead agent.' });
  const { rows } = await pool.query(`UPDATE staff_users SET role = $2, approved = TRUE WHERE id = $1 AND role <> 'admin' RETURNING id, full_name AS name, email, role, approved`, [req.params.id, role]);
  if (!rows[0]) return res.status(404).json({ error: 'Staff account not found.' });
  return res.json({ staff: rows[0] });
}));
app.patch('/api/team/:id/role', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const role = String(req.body.role || '');
  if (!validRole(role)) return res.status(400).json({ error: 'Choose Call agent or Lead agent.' });
  const { rows } = await pool.query(`UPDATE staff_users SET role = $2 WHERE id = $1 AND approved = TRUE AND role <> 'admin' RETURNING id`, [req.params.id, role]);
  if (!rows[0]) return res.status(404).json({ error: 'Approved staff account not found.' });
  return res.json({ status: 'updated' });
}));

app.post('/api/contacts/batch', requireUser, requireRole('contact-generator'), asyncRoute(async (req, res) => {
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  if (!contacts.length || contacts.length > 1000) return res.status(400).json({ error: 'Submit between 1 and 1000 contacts.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const contact of contacts) {
      const business = String(contact.business || '').trim();
      const phone = String(contact.phone || '').trim();
      if (!business || !phone) continue;
      const { rows } = await client.query(
        `INSERT INTO generated_contacts (business_name, phone, area, category, map_query, generator_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, business_name AS business, phone, area, category, map_query AS "mapQuery", generator_id AS "generatorId", work_date AS "workDate"`,
        [business, phone, String(contact.area || ''), String(contact.category || ''), String(contact.mapQuery || ''), req.user.id],
      );
      created.push(rows[0]);
    }
    if (!created.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No valid business and phone pairs found.' }); }
    await client.query('COMMIT');
    return res.status(201).json({ contacts: created });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}));

app.post('/api/calls/assign', requireUser, requireAdmin, asyncRoute(async (req, res) => {
  const calls = Array.isArray(req.body.calls) ? req.body.calls : [];
  const contactIds = Array.isArray(req.body.contactIds) ? req.body.contactIds : [];
  if (!calls.length || calls.length > 1000) return res.status(400).json({ error: 'Submit between 1 and 1000 calls.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const agentRows = await client.query(`SELECT id FROM staff_users WHERE approved = TRUE AND role = 'call-agent' ORDER BY created_at, id`);
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
        `INSERT INTO daily_calls (business_name, phone, staff_id) VALUES ($1, $2, $3)
         RETURNING id, business_name AS business, phone, staff_id AS "staffId", status, notes, work_date AS "workDate"`,
        [business, phone, assigned.id],
      );
      counts[assigned.id] += 1;
      saved.push(rows[0]);
    }
    if (contactIds.length) await client.query('DELETE FROM generated_contacts WHERE id = ANY($1::uuid[])', [contactIds]);
    if (!saved.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No valid calls were submitted.' }); }
    await client.query('COMMIT');
    return res.status(201).json({ calls: saved });
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
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

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.code === '23503') return res.status(400).json({ error: 'A referenced account or contact no longer exists.' });
  return res.status(500).json({ error: 'Server error. Check the server log.' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`Flux Dev API listening on http://localhost:${port}`));
