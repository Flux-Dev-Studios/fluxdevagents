import jwt from 'jsonwebtoken';

const cookieName = 'flux_session';
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

export function createSession(res, user) {
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(cookieName, token, cookieOptions());
}

export function clearSession(res) {
  res.clearCookie(cookieName, { ...cookieOptions(), maxAge: undefined });
}

export async function requireUser(req, res, next) {
  try {
    const token = req.cookies[cookieName];
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await req.db.query(
      'SELECT id, full_name, email, role, approved FROM staff_users WHERE id = $1',
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.approved) return res.status(401).json({ error: 'Account is unavailable.' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'This action is not available for your role.' });
    return next();
  };
}
