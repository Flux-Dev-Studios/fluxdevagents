import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck,
  BriefcaseBusiness, CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp,
  Clock3, FilePlus2, Filter, LayoutDashboard, LogOut, Menu, MoreHorizontal,
  ArrowDown, ArrowUp, MapPin, Phone, Plus, Search, Settings2, ShieldCheck, Timer, Users, X,
} from 'lucide-react';

const ROLE_LABELS = { 'call-agent': 'Call agent', 'contact-generator': 'Lead agent' };
const ROLE_OPTIONS = [
  { value: 'call-agent', label: 'Call agent' },
  { value: 'contact-generator', label: 'Lead agent' },
];
const today = () => new Date().toLocaleDateString('en-CA');
const apiRequest = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || 'The server could not complete that request.');
    error.code = payload?.code;
    throw error;
  }
  return payload;
};
const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};
const formatShortDate = (date = new Date()) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
const initials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ person, size = '' }) {
  return <span className={`avatar ${person.color || 'neutral'} ${size}`}>{person.initials || initials(person.name)}</span>;
}
function StatusPill({ status }) {
  const labels = { pending: 'Not called', interested: 'Interested', 'no-answer': 'No answer', 'not-interested': 'Not interested' };
  return <span className={`status-pill ${status}`}><i />{labels[status] || status}</span>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [staff, setStaff] = useState([]);
  const [leads, setLeads] = useState([]);
  const [contactPool, setContactPool] = useState([]);
  const [shifts, setShifts] = useState({});
  const [page, setPage] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [apiError, setApiError] = useState('');

  const loadWorkspace = async (activeUser) => {
    const data = await apiRequest('/bootstrap');
    setUser(data.user || activeUser);
    setStaff(data.staff || []);
                {STAFF.map((person) => { const assigned = leads.filter((lead) => lead.staffId === person.id); const touched = assigned.filter((lead) => lead.status !== 'pending').length; const yes = assigned.filter((lead) => lead.status === 'interested').length; const shift = shifts[person.id]; const seconds = shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - new Date(shift.startedAt).getTime()) / 1000) : 0) : 0; return <div className="team-table-row" key={person.id}><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><span className="table-number">{touched}<small> / {assigned.length}</small></span><span className="table-number positive-number">{yes}</span><span className="table-time">{formatDuration(seconds)}</span></div>; })}
    setContactPool(data.contacts || []);
    setShifts(Object.fromEntries((data.shifts || []).map((shift) => [shift.staffId, shift])));
    setPage((data.user || activeUser).role === 'admin' ? 'overview' : (data.user || activeUser).role === 'contact-generator' ? 'generate' : 'today');
  };

  useEffect(() => {
    apiRequest('/auth/session').then(async ({ user: activeUser }) => {
      await loadWorkspace(activeUser);
    }).catch((error) => { if (error.message !== 'Sign in required.') setApiError('Database API unavailable. Start PostgreSQL and run npm run db:setup.'); }).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout); }, [toast]);

  const signIn = async (email, password) => {
    try {
      const { user: activeUser } = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await loadWorkspace(activeUser);
      setApiError('');
      return 'success';
    } catch (error) {
      if (error.code === 'pending') return 'pending';
      setApiError(error.message);
      return 'invalid';
    }
  };
  const register = async (name, email, password, role) => {
    try {
      await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
      return 'success';
    } catch (error) {
      setApiError(error.message);
      return false;
    }
  };
  const approveStaff = async (id, role) => {
    try {
      const { staff: approvedStaff } = await apiRequest(`/team/${id}/approval`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setStaff((people) => people.map((person) => person.id === id ? approvedStaff : person));
      setToast('Staff account approved.');
    } catch (error) { setToast(error.message); }
  };
  const updateStaffRole = async (id, role) => {
    try {
      await apiRequest(`/team/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setStaff((people) => people.map((person) => person.id === id ? { ...person, role } : person));
      setToast('Staff role updated.');
    } catch (error) { setToast(error.message); }
  };
  const signOut = async () => { await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); setStaff([]); setLeads([]); setContactPool([]); setShifts({}); setMobileNav(false); };
  const activeShift = user && user.role !== 'admin' ? shifts[user.id] : null;
  const elapsed = activeShift ? activeShift.elapsed + (activeShift.startedAt ? Math.max(0, Math.floor((now - new Date(activeShift.startedAt).getTime()) / 1000)) : 0) : 0;
  const clockIn = async () => {
    try { const { shift } = await apiRequest('/shifts/clock-in', { method: 'POST' }); setShifts((existing) => ({ ...existing, [user.id]: shift })); setToast('Shift started. Have a good call block.'); }
    catch (error) { setToast(error.message); }
  };
  const clockOut = async () => {
    try { const { shift } = await apiRequest('/shifts/clock-out', { method: 'POST' }); setShifts((existing) => ({ ...existing, [user.id]: shift })); setToast('Shift ended. Today’s time has been saved.'); }
    catch (error) { setToast(error.message); }
  };
  const updateLead = async (id, patch) => {
    const current = leads.find((lead) => lead.id === id);
    setLeads((existing) => existing.map((lead) => lead.id === id ? { ...lead, ...patch } : lead));
    try { await apiRequest(`/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ status: patch.status || current?.status || 'pending', notes: patch.notes ?? current?.notes ?? '' }) }); }
    catch (error) { setToast(error.message); }
  };
  const dailyCalls = leads.filter((lead) => !lead.workDate || lead.workDate === today());
  const staffLeads = dailyCalls.filter((lead) => lead.staffId === user?.id);
  const activePage = user?.role === 'admin'
    ? ['overview', 'calls', 'team'].includes(page) ? page : 'overview'
    : user?.role === 'contact-generator' ? 'generate' : 'today';

  if (!authReady) return <main className="api-loading"><img className="brand-logo brand-logo-loading" src="/flux-dev-logo.png" alt="Flux Dev" /><b>Connecting to Flux Dev…</b></main>;
  if (!user) return <Login onLogin={signIn} onRegister={register} serverMessage={apiError} />;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); setPage(user.role === 'admin' ? 'overview' : user.role === 'contact-generator' ? 'generate' : 'today'); }}><img className="brand-logo brand-logo-dark" src="/flux-dev-logo.png" alt="Flux Dev" /></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">
        {user.role === 'admin' ? <>
          <NavButton icon={LayoutDashboard} label="Overview" active={activePage === 'overview'} onClick={() => { setPage('overview'); setMobileNav(false); }} />
          <NavButton icon={CalendarDays} label="Today’s calls" badge={dailyCalls.length} active={activePage === 'calls'} onClick={() => { setPage('calls'); setMobileNav(false); }} />
          <NavButton icon={Users} label="Team & approvals" badge={staff.filter((person) => !person.approved).length || null} active={activePage === 'team'} onClick={() => { setPage('team'); setMobileNav(false); }} />
        </> : <>
          {user.role === 'contact-generator' ? <NavButton icon={Search} label="Find contacts" active={activePage === 'generate'} onClick={() => { setPage('generate'); setMobileNav(false); }} /> : <NavButton icon={CalendarDays} label="Today’s queue" badge={staffLeads.length} active={activePage === 'today'} onClick={() => { setPage('today'); setMobileNav(false); }} />}
        </>}
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><span className="help-icon"><CircleHelp size={16} /></span><strong>Need a hand?</strong><p>Reach out to your team lead if you get stuck.</p><a href="mailto:asiegbukelvin3974@gmail.com">Contact support <ArrowRight size={13} /></a></div>
        <div className="profile-row"><Avatar person={user} /><span className="profile-name"><b>{user.name}</b><small>{user.role === 'admin' ? 'Workspace admin' : ROLE_LABELS[user.role]}</small></span><button className="icon-button profile-menu" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-toggle" onClick={() => setMobileNav(!mobileNav)} aria-label="Open navigation"><Menu size={19} /></button><div className="breadcrumbs">{user.role === 'admin' ? 'Workspace / ' : 'My workspace / '}<b>{activePage === 'today' ? 'Today’s queue' : activePage === 'calls' ? 'Today’s calls' : activePage === 'team' ? 'Team & approvals' : activePage === 'generate' ? 'Find contacts' : 'Overview'}</b></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatShortDate()}</span><span className="top-divider" /><span className="top-status"><i /> All systems normal</span><Avatar person={user} size="small" /></div></header>
      <div className="page-content">
        {user.role === 'call-agent' && activePage === 'today' && <StaffToday user={user} leads={staffLeads} shift={activeShift} elapsed={elapsed} onClockIn={clockIn} onClockOut={clockOut} onUpdate={updateLead} now={now} />}
        {user.role === 'admin' && activePage === 'overview' && <AdminOverview leads={dailyCalls} shifts={shifts} now={now} onNavigate={setPage} staff={staff.filter((person) => person.approved)} />}
        {user.role === 'admin' && activePage === 'calls' && <DailyCallsPage leads={dailyCalls} contacts={contactPool} staff={staff.filter((person) => person.approved && person.role === 'call-agent')} onAssign={async (newCalls, contactIds) => { const result = await apiRequest('/calls/assign', { method: 'POST', body: JSON.stringify({ calls: newCalls, contactIds }) }); setLeads((current) => [...current, ...result.calls]); setContactPool((current) => current.filter((contact) => !contactIds.includes(contact.id))); setToast(`${result.calls.length} calls shared across the team.`); }} />}
        {user.role === 'admin' && activePage === 'team' && <TeamApprovals staff={staff} onApprove={approveStaff} onRoleChange={updateStaffRole} />}
        {user.role === 'contact-generator' && activePage === 'generate' && <ContactGenerator user={user} shift={activeShift} elapsed={elapsed} onClockIn={clockIn} onClockOut={clockOut} onSave={async (contacts) => { const result = await apiRequest('/contacts/batch', { method: 'POST', body: JSON.stringify({ contacts }) }); setToast(`${result.contacts.length} contact${result.contacts.length === 1 ? '' : 's'} saved for admin review.`); }} />}
      </div>
    </main>
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
  </div>;
}

function RoleSelect({ id, value, onChange, ariaLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, ROLE_OPTIONS.findIndex((option) => option.value === value)));
  const selectRef = useRef(null);
  const selectedIndex = Math.max(0, ROLE_OPTIONS.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!selectRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };
  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + direction + ROLE_OPTIONS.length) % ROLE_OPTIONS.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!isOpen) return;
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : ROLE_OPTIONS.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) openMenu();
      else {
        onChange(ROLE_OPTIONS[activeIndex].value);
        setIsOpen(false);
      }
    }
  };

  return <div className={`input-wrap role-select-wrap ${isOpen ? 'is-open' : ''}`} ref={selectRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false); }}>
    <button className="role-select-trigger" id={id} type="button" role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={isOpen} aria-controls={`${id}-options`} aria-activedescendant={isOpen ? `${id}-option-${activeIndex}` : undefined} onClick={() => { if (isOpen) setIsOpen(false); else openMenu(); }} onKeyDown={handleKeyDown}>{ROLE_OPTIONS[selectedIndex].label}</button>
    {isOpen && <div className="role-select-menu" id={`${id}-options`} role="listbox" aria-label={ariaLabel || 'Role'}>{ROLE_OPTIONS.map((option, index) => <button className={`role-select-option ${activeIndex === index ? 'active' : ''}`} id={`${id}-option-${index}`} key={option.value} type="button" role="option" aria-selected={value === option.value} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.value); setIsOpen(false); }}>{option.label}</button>)}</div>}
  </div>;
}

function Login({ onLogin, onRegister, serverMessage }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('call-agent');
  const [message, setMessage] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    if (mode === 'signup') {
      const result = await onRegister(name, email, password, role);
      setMessage(result === 'success' ? 'Request sent. An admin must approve your account before you can sign in.' : serverMessage || 'That email is already registered, or the details are incomplete.');
      return;
    }
    const result = await onLogin(email, password);
    setMessage(result === 'pending' ? 'Your account is waiting for admin approval.' : result === 'invalid' ? serverMessage || 'That email and password combination was not recognized.' : '');
  };
  const toggleMode = () => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); };
  return <main className="login-screen">
    <section className="login-art">
      <div className="login-art-top"><a className="brand brand-inverse" href="/"><img className="brand-logo" src="/flux-dev-logo.png" alt="Flux Dev" /></a><span className="edition">STAFF PORTAL <i /> 2026</span></div>
      <div className="art-copy"><span className="eyebrow"><span /> GOOD WORK STARTS HERE</span><h1>Make the<br />first call <em>count.</em></h1><p>Your day, your queue, your next good conversation. Everything you need to keep momentum.</p><div className="art-stat"><div className="stat-avatars"><span>MC</span><span>NW</span><span>EO</span><b>+</b></div><span>Small team. Real results.</span></div></div>
      <div className="art-footer"><span>BUILDING THE WEB, ONE HELLO AT A TIME.</span><span>OAKLAND, CA <ArrowUpRight size={14} /></span></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-coordinate">37°48' N / 122°16' W</div>
    </section>
    <section className="login-panel"><form className="login-form" onSubmit={submit}>
      <span className="form-kicker">{mode === 'login' ? 'WELCOME BACK' : 'REQUEST ACCESS'}</span>
      <h2>{mode === 'login' ? <>Sign in to<br />your workspace.</> : <>Join the<br />Flux Dev team.</>}</h2>
      <p className="form-intro">{mode === 'login' ? 'Pick up right where your best work happens.' : 'An admin must approve your account before sign-in.'}</p>
      {mode === 'signup' && <><label htmlFor="signup-name">Full name</label><div className="input-wrap"><input id="signup-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></div></>}
      {mode === 'signup' && <><label htmlFor="signup-role">Role</label><RoleSelect id="signup-role" value={role} onChange={setRole} /></>}
      <label htmlFor="email">Work email</label><div className="input-wrap"><span className="input-at">@</span><input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
      <label htmlFor="password">Password</label><div className="input-wrap"><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /><button type="button" className="show-password" onClick={() => { const input = document.getElementById('password'); input.type = input.type === 'password' ? 'text' : 'password'; }}>Show</button></div>
      {(message || serverMessage) && <p className="login-message" role="status">{message || serverMessage}</p>}
      {mode === 'login' ? <button type="submit" className="primary-button login-submit">Sign in <ArrowRight size={16} /></button> : <button type="submit" className="primary-button login-submit">Request access <ArrowRight size={16} /></button>}
      <button type="button" className="login-mode-toggle" onClick={toggleMode}>{mode === 'login' ? 'New to the team? Request an account' : 'Already approved? Sign in'}</button>
      <div className="login-legal">New accounts remain locked until an admin approves them.<br /><b>Flux Dev staff portal</b></div>
    </form></section>
  </main>;
}

function NavButton({ icon: Icon, label, active, badge, onClick }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{badge != null && <small>{badge}</small>}</button>;
}
function Metric({ label, value, note, icon: Icon, trend, tone = '' }) {
  return <article className={`metric-card ${tone}`}><div className="metric-heading"><span>{label}</span><span className="metric-icon"><Icon size={16} /></span></div><div className="metric-value">{value}</div><div className="metric-foot">{trend && <span className="metric-trend"><ArrowUpRight size={13} />{trend}</span>}<span>{note}</span></div></article>;
}
function PageHeading({ kicker, title, description, action }) {
  return <div className="page-heading"><div><div className="page-kicker">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
function StaffToday({ user, leads, shift, elapsed, onClockIn, onClockOut, onUpdate, now }) {
  const called = leads.filter((lead) => lead.status !== 'pending').length;
  const interested = leads.filter((lead) => lead.status === 'interested').length;
  const clockedIn = Boolean(shift?.startedAt);
  return <>
    <PageHeading kicker={formatShortDate().toUpperCase()} title={`Good morning, ${user.name.split(' ')[0]}.`} description="Your calls and work time for today." action={<span className={`shift-indicator ${clockedIn ? 'on' : ''}`}><i />{clockedIn ? 'Shift in progress' : shift?.signedOutAt ? 'Shift complete' : 'Not clocked in'}</span>} />
    <section className="staff-overview"><div className={`clock-panel ${clockedIn ? 'clock-active' : ''}`}><div className="clock-panel-copy"><span className="panel-kicker"><Timer size={14} /> DAILY TIME</span><div className="clock-time">{formatDuration(elapsed)}</div><div className="clock-caption">{clockedIn ? `Started at ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(shift.startedAt))}` : shift?.signedOutAt ? 'Today’s time is saved.' : 'Clock in when you start work.'}</div></div><button className={`clock-button ${clockedIn ? 'clock-out' : ''}`} onClick={clockedIn ? onClockOut : onClockIn}><span>{clockedIn ? <LogOut size={16} /> : <Timer size={16} />}</span>{clockedIn ? 'Clock out' : 'Clock in'}<ArrowRight size={15} /></button></div><div className="today-stats"><div className="today-stat"><span>Assigned calls</span><b>{String(leads.length).padStart(2, '0')}</b><small>today</small></div><div className="today-stat"><span>Calls completed</span><b>{String(called).padStart(2, '0')}</b><small>of {leads.length}</small></div><div className="today-stat"><span>Interested</span><b className="positive-number">{String(interested).padStart(2, '0')}</b><small>for follow-up</small></div><div className="daily-progress"><div><span>Today’s progress</span><b>{leads.length ? Math.round(called / leads.length * 100) : 0}%</b></div><div className="progress-track"><i style={{ width: `${leads.length ? called / leads.length * 100 : 0}%` }} /></div></div></div></section>
    <section className="queue-section"><div className="section-title-row"><div><div className="section-eyebrow">YOUR TASKS</div><h2>Today’s calls <span>{leads.length}</span></h2></div></div><div className="lead-list">{leads.length ? leads.map((lead, index) => <StaffLead key={lead.id} lead={lead} index={index} onUpdate={onUpdate} />) : <div className="empty-state">No calls assigned for today.</div>}</div><div className="queue-foot"><span><span className="queue-dot" /> {leads.length - called} calls remaining</span><span>Call results and notes save automatically</span></div></section>
    <p className="local-data-note"><ShieldCheck size={14} /> Your activity is saved to your workspace.</p>
  </>;
}
function StaffLead({ lead, index, onUpdate }) {
  const [expanded, setExpanded] = useState(lead.status === 'interested');
  const [note, setNote] = useState(lead.notes || '');
  useEffect(() => setNote(lead.notes || ''), [lead.notes]);
  const chooseStatus = (status) => { onUpdate(lead.id, { status }); setExpanded(status === 'interested' || Boolean(lead.notes)); };
  return <article className={`lead-row ${lead.status === 'interested' ? 'lead-positive' : ''}`}><div className="lead-index">{String(index + 1).padStart(2, '0')}</div><div className="lead-main"><div className="lead-title-line"><h3>{lead.business}</h3><StatusPill status={lead.status} /></div><div className="lead-details"><span>{lead.category}</span><i />{lead.location}<i /><span>{lead.website}</span></div><div className="lead-contact"><b>{lead.contact}</b><a href={`tel:${lead.phone.replace(/[^+\d]/g, '')}`}><Phone size={13} />{lead.phone}</a></div>{lead.meeting && <div className="meeting-note"><BadgeCheck size={14} />{lead.meeting}</div>}{expanded && <div className="note-editor"><label htmlFor={`note-${lead.id}`}>Call note</label><textarea id={`note-${lead.id}`} rows="2" placeholder="Add details from your conversation..." value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => onUpdate(lead.id, { notes: note })} /></div>}</div><div className="lead-actions"><span className="outcome-label">{lead.status === 'pending' ? 'LOG OUTCOME' : 'UPDATE OUTCOME'}</span><div className="outcome-buttons"><button className={`outcome-button outcome-yes ${lead.status === 'interested' ? 'selected' : ''}`} onClick={() => chooseStatus(lead.status === 'interested' ? 'pending' : 'interested')} title="Interested, wants a meeting" aria-label="Mark as interested"><Check size={16} /></button><button className={`outcome-button outcome-no ${lead.status === 'not-interested' ? 'selected' : ''}`} onClick={() => chooseStatus(lead.status === 'not-interested' ? 'pending' : 'not-interested')} title="Not interested" aria-label="Mark as not interested"><X size={16} /></button><button className={`outcome-button outcome-neutral ${lead.status === 'no-answer' ? 'selected' : ''}`} onClick={() => chooseStatus(lead.status === 'no-answer' ? 'pending' : 'no-answer')} title="No answer" aria-label="Mark as no answer"><Phone size={14} /></button><button className="outcome-button outcome-note" onClick={() => setExpanded(!expanded)} title="Add a call note" aria-label="Add a call note"><MoreHorizontal size={17} /></button></div></div></article>;
}
function StaffActivity({ user, leads, shift, elapsed }) {
  const called = leads.filter((lead) => lead.status !== 'pending').length;
  const interested = leads.filter((lead) => lead.status === 'interested');
  return <><PageHeading kicker="YOUR NUMBERS, AT A GLANCE" title="My activity" description="A clear look at today’s shift and the conversations you’ve started." /><div className="activity-grid"><Metric icon={Timer} label="Time on shift" value={formatDuration(elapsed)} note={shift?.startedAt ? 'Shift currently active' : shift?.signedOutAt ? 'Shift complete today' : 'Not clocked in yet'} tone="metric-green" /><Metric icon={Phone} label="Calls logged" value={`${called} / ${leads.length}`} note="Businesses contacted today" /><Metric icon={BadgeCheck} label="Interested leads" value={interested.length} note="Meetings to follow up" tone="metric-coral" /></div><section className="panel activity-panel"><div className="panel-heading"><div><div className="section-eyebrow">TODAY · {formatShortDate()}</div><h2>Interested businesses</h2></div><span className="count-chip">{interested.length} leads</span></div>{interested.length ? interested.map((lead) => <div className="activity-lead" key={lead.id}><span className="activity-check"><Check size={16} /></span><div><b>{lead.business}</b><small>{lead.contact} · {lead.phone}</small>{lead.notes && <p>{lead.notes}</p>}</div><StatusPill status={lead.status} /></div>) : <div className="empty-state">No interested leads yet. Keep going, your next good conversation is out there.</div>}</section><div className="activity-footnote"><Clock3 size={15} /> Shift totals reset each day and stay available in the browser’s saved records.</div></>;
}
function AdminOverview({ leads, shifts, now, onNavigate, staff }) {
  const STAFF = staff;
  const called = leads.filter((lead) => lead.status !== 'pending').length;
  const interested = leads.filter((lead) => lead.status === 'interested');
  const liveStaff = STAFF.filter((person) => shifts[person.id]?.startedAt);
  const totalSeconds = STAFF.reduce((total, person) => { const shift = shifts[person.id]; return total + (shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - new Date(shift.startedAt).getTime()) / 1000) : 0) : 0); }, 0);
  const conversion = called ? Math.round(interested.length / called * 100) : 0;
  return <><PageHeading kicker={`${formatShortDate().toUpperCase()} · DAILY SUMMARY`} title="Team overview" description="Today’s attendance and call progress." action={<button className="primary-button" onClick={() => onNavigate('calls')}><CalendarDays size={15} /> Assign today’s calls</button>} /><div className="admin-metrics"><Metric icon={Users} label="Agents on shift" value={`${liveStaff.length} / ${STAFF.length}`} note={liveStaff.length ? `${liveStaff.map((person) => person.name.split(' ')[0]).join(', ')}` : 'No one clocked in yet'} tone="metric-green" /><Metric icon={BriefcaseBusiness} label="Calls assigned" value={leads.length} note="Across the team today" /><Metric icon={Phone} label="Calls completed" value={called} note={`${leads.length - called} still to call`} /><Metric icon={BadgeCheck} label="Interested" value={interested.length} note="Businesses to follow up" tone="metric-coral" /></div><div className="admin-content-grid"><section className="panel team-panel"><div className="panel-heading"><div><div className="section-eyebrow">TEAM & TIME</div><h2>Today’s activity</h2></div><span className="count-chip">{formatDuration(totalSeconds)} total</span></div><div className="team-table"><div className="team-table-head"><span>STAFF MEMBER</span><span>CALLS</span><span>INTERESTED</span><span>TIME TODAY</span></div>{STAFF.map((person) => { const assigned = leads.filter((lead) => lead.staffId === person.id); const touched = assigned.filter((lead) => lead.status !== 'pending').length; const yes = assigned.filter((lead) => lead.status === 'interested').length; const shift = shifts[person.id]; const seconds = shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - new Date(shift.startedAt).getTime()) / 1000) : 0) : 0; return <div className="team-table-row" key={person.id}><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><span className="table-number">{touched}<small> / {assigned.length}</small></span><span className="table-number positive-number">{yes}</span><span className="table-time">{formatDuration(seconds)}</span></div>; })}</div></section><section className="panel interested-panel"><div className="panel-heading"><div><div className="section-eyebrow">FOLLOW UP</div><h2>Interested businesses</h2></div></div>{interested.length ? interested.map((lead) => { const assigned = STAFF.find((person) => person.id === lead.staffId); return <div className="interested-item" key={lead.id}><span className="interested-check"><Check size={14} /></span><div className="interested-copy"><b>{lead.business}</b><small>{lead.contact} · {lead.phone}</small><span>{assigned?.name || 'Staff member'}{lead.notes ? ` · ${lead.notes}` : ''}</span></div></div>; }) : <div className="empty-state compact">Interested businesses will appear here.</div>}</section></div><p className="local-data-note"><Clock3 size={14} /> Total team time today: {formatDuration(totalSeconds)}</p></>;
}
function DailyCallsPage({ leads, contacts = [], onConsumeContacts, onAssign, staff }) {
  const STAFF = staff;
  const [pastedRows, setPastedRows] = useState('');
  const [reviewRows, setReviewRows] = useState(null);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [error, setError] = useState('');
  const review = (event) => {
    event.preventDefault();
    const rows = pastedRows.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((part) => part.trim()));
    const parsed = rows.filter((row) => row[0] && row[1] && !/business\s*name/i.test(row[0])).map(([business, phone], index) => ({ id: `${Date.now()}-${index}`, business, phone }));
    if (!parsed.length) { setError('Paste rows with a business name and phone number.'); return; }
    setReviewRows(parsed);
    setError('');
  };
  const moveRow = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= reviewRows.length) return;
    const nextRows = [...reviewRows];
    [nextRows[index], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[index]];
    setReviewRows(nextRows);
  };
  const share = async () => {
    if (!reviewRows?.length) return;
    if (!STAFF.length) { setError('Approve at least one Call agent before sharing calls.'); return; }
    const calls = reviewRows.map((row, index) => ({
      id: `call-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`,
      business: row.business, contact: 'Not provided', phone: row.phone,
      staffId: '', status: 'pending', notes: '', workDate: today(),
    }));
    try { await onAssign(calls, selectedContactIds); }
    catch (error) { setError(error.message); return; }
    setPastedRows('');
    setReviewRows(null);
    setSelectedContactIds([]);
    setError('');
  };
  const totals = STAFF.map((person) => ({ ...person, count: leads.filter((lead) => lead.staffId === person.id).length }));
  const addContactToReview = (contact) => {
    setReviewRows((current) => [...(current || []), { id: contact.id, business: contact.business, phone: contact.phone }]);
    setSelectedContactIds((current) => [...current, contact.id]);
  };
  return <><PageHeading kicker={formatShortDate().toUpperCase()} title="Today’s calls" description="Review contact submissions or paste business names and numbers." />{contacts.length > 0 && <section className="panel submitted-contacts"><div className="panel-heading"><div><div className="section-eyebrow">FROM CONTACT GENERATORS</div><h2>Saved contacts</h2></div><span className="count-chip">{contacts.length} waiting</span></div>{contacts.map((contact) => <div className="submitted-contact" key={contact.id}><span><b>{contact.business}</b><small>{contact.phone} · {contact.area || 'Area not added'}{contact.generatorId ? ` · ${staff.find((person) => person.id === contact.generatorId)?.name || 'Generator'}` : ''}</small></span><button className="secondary-button" disabled={selectedContactIds.includes(contact.id)} onClick={() => addContactToReview(contact)}>{selectedContactIds.includes(contact.id) ? 'Added' : 'Add to review'}</button></div>)}</section>}<section className="panel assignment-panel"><form onSubmit={review}><label className="bulk-label" htmlFor="daily-calls">BUSINESS NAME, PHONE NUMBER<textarea id="daily-calls" rows="8" value={pastedRows} onChange={(event) => { setPastedRows(event.target.value); setReviewRows(null); setSelectedContactIds([]); setError(''); }} placeholder={'Northline Coffee, +1 415 555 0142\nMorrow Dental, +1 415 555 0176'} /></label><p className="bulk-hint">One business per line. You can paste directly from a spreadsheet.</p>{error && <p className="form-error">{error}</p>}<button className="primary-button assign-submit" type="submit"><Check size={15} /> Review call order</button></form></section>{reviewRows && <section className="panel distribution-panel review-panel"><div className="panel-heading"><div><div className="section-eyebrow">CHECK BEFORE SHARING</div><h2>Call order</h2></div><span className="count-chip">{reviewRows.length} calls</span></div><div className="review-list">{reviewRows.map((row, index) => <div className="review-row" key={row.id}><span className="review-index">{String(index + 1).padStart(2, '0')}</span><span className="review-business">{row.business}</span><span className="review-phone">{row.phone}</span><span className="review-controls"><button type="button" className="icon-button" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label={`Move ${row.business} up`} title="Move up"><ArrowUp size={15} /></button><button type="button" className="icon-button" onClick={() => moveRow(index, 1)} disabled={index === reviewRows.length - 1} aria-label={`Move ${row.business} down`} title="Move down"><ArrowDown size={15} /></button></span></div>)}</div><div className="review-actions"><button className="secondary-button" onClick={() => setReviewRows(null)}>Edit pasted list</button><button className="primary-button" onClick={share}><Users size={15} /> Share evenly</button></div></section>}<section className="panel distribution-panel"><div className="panel-heading"><div><div className="section-eyebrow">TODAY’S DISTRIBUTION</div><h2>Calls per staff member</h2></div><span className="count-chip">{leads.length} total</span></div><div className="distribution-list">{totals.map((person) => <div className="distribution-row" key={person.id}><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><b>{person.count} calls</b></div>)}</div></section></>;
}
function AddLeadsModal({ onClose, onAdd }) {
  const [business, setBusiness] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('Local business');
  const [location, setLocation] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [bulk, setBulk] = useState('');
  const [mode, setMode] = useState('single');
  const [error, setError] = useState('');
  const createLead = (row, staffId, index) => ({ id: `lead-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 6)}`, business: row.business, contact: row.contact || 'Not provided', phone: row.phone, category: row.category || 'Local business', location: row.location || 'Not provided', website: row.website || 'No website', staffId, status: 'pending', notes: '' });
  const submit = async (event) => {
    event.preventDefault();
    let rows = [];
    if (mode === 'single') {
      if (!business.trim() || !phone.trim()) { setError('Business name and phone number are required.'); return; }
      rows = [{ business: business.trim(), contact: contact.trim(), phone: phone.trim(), category, location: location.trim() }];
    } else {
      rows = bulk.split('\n').map((line) => line.split(',').map((part) => part.trim())).filter((parts) => parts[0] && parts[1]).map(([name, number, person, type, place, website]) => ({ business: name, phone: number, contact: person, category: type, location: place, website }));
      if (!rows.length) { setError('Add at least one valid row with a business name and phone number.'); return; }
    }
    const selected = assignee === 'all' ? STAFF : STAFF.filter((person) => person.id === assignee);
    onAdd(rows.map((row, index) => createLead(row, selected[index % selected.length].id, index)));
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="add-modal" onSubmit={submit}><div className="modal-head"><div><div className="section-eyebrow">GROW THE CALL LIST</div><h2>Add businesses</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><div className="modal-tabs"><button type="button" className={mode === 'single' ? 'selected' : ''} onClick={() => { setMode('single'); setError(''); }}>Single business</button><button type="button" className={mode === 'bulk' ? 'selected' : ''} onClick={() => { setMode('bulk'); setError(''); }}>Paste a list</button></div>{mode === 'single' ? <div className="form-grid"><label>Business name<input value={business} onChange={(event) => setBusiness(event.target.value)} placeholder="e.g. Cedar Street Cafe" /></label><label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 415 555 0100" /></label><label>Contact name <span>OPTIONAL</span><input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="Owner or manager" /></label><label>Category<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Restaurant, salon..." /></label><label className="full-field">Location <span>OPTIONAL</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City, State" /></label></div> : <><label className="bulk-label">One business per line, comma-separated: name, phone, contact, category, location, website<textarea rows="7" value={bulk} onChange={(event) => setBulk(event.target.value)} placeholder={'Cedar Street Cafe, +1 415 555 0100, Mina, Cafe, Oakland CA, No website\nHarbor Dental, +1 415 555 0102, Alex, Dental, Alameda CA, Facebook only'} /></label><p className="bulk-hint">Business name and phone are required; other fields are optional. Leads will be split evenly when assigned to everyone.</p></>}<label className="assign-label">Assign to<select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">Distribute evenly across all agents</option>{STAFF.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Plus size={15} /> Add to call list</button></div></form></div>;
}
function TeamApprovals({ staff, onApprove, onRoleChange }) {
  const pending = staff.filter((person) => !person.approved);
  const approved = staff.filter((person) => person.approved);
  return <><PageHeading kicker="ACCESS CONTROL" title="Team & approvals" description="Approve new accounts and choose each person’s role." /><section className="panel simple-team-panel"><div className="panel-heading"><div><div className="section-eyebrow">WAITING FOR APPROVAL</div><h2>New account requests</h2></div><span className="count-chip">{pending.length} waiting</span></div>{pending.length ? pending.map((person) => <PendingApprovalRow key={person.id} person={person} onApprove={onApprove} />) : <div className="empty-state">No new account requests.</div>}</section><section className="panel simple-team-panel"><div className="panel-heading"><div><div className="section-eyebrow">APPROVED ACCOUNTS</div><h2>Staff roles</h2></div><span className="count-chip">{approved.length}</span></div>{approved.filter((person) => person.role !== 'admin').map((person) => <div className="approval-row" key={person.id}><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><RoleSelect id={`role-${person.id}`} ariaLabel={`Role for ${person.name}`} value={person.role} onChange={(role) => onRoleChange(person.id, role)} /></div>)}</section></>;
}

function PendingApprovalRow({ person, onApprove }) {
  const [role, setRole] = useState('call-agent');
  return <div className="approval-row"><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><RoleSelect id={`role-${person.id}`} ariaLabel={`Choose role for ${person.name}`} value={role} onChange={setRole} /><button className="primary-button" type="button" onClick={() => onApprove(person.id, role)}><Check size={14} /> Approve</button></div>;
}

function ContactGenerator({ user, shift, elapsed, onClockIn, onClockOut, onSave }) {
  const [pastedContacts, setPastedContacts] = useState('');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState('');
  const [saved, setSaved] = useState(0);
  const [error, setError] = useState('');
  const clockedIn = Boolean(shift?.startedAt);
  const mapQuery = [category, area].filter(Boolean).join(' ');
  const submit = async (event) => {
    event.preventDefault();
    const rows = pastedContacts.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((part) => part.trim()));
    const entries = rows.filter((row) => row[0] && row[1] && !/business\s*name/i.test(row[0])).map(([business, phone], index) => ({ id: `contact-${Date.now()}-${index}`, business, phone, area: area.trim(), category: category.trim(), mapQuery, generatorId: user.id, workDate: today() }));
    if (!entries.length) { setError('Paste at least one business name and phone number.'); return; }
    try { await onSave(entries); }
    catch (saveError) { setError(saveError.message); return; }
    setPastedContacts('');
    setSaved((count) => count + entries.length);
    setError('');
  };
  return <><PageHeading kicker={formatShortDate().toUpperCase()} title={`Find businesses, ${user.name.split(' ')[0]}.`} description="Search Maps, then paste multiple business names and phone numbers for admin review." action={<span className={`shift-indicator ${clockedIn ? 'on' : ''}`}><i />{clockedIn ? 'Shift in progress' : 'Shift not started'}</span>} /><section className="generator-clock"><div><span>TIME TODAY</span><b>{formatDuration(elapsed)}</b></div><button className="primary-button" onClick={clockedIn ? onClockOut : onClockIn}>{clockedIn ? 'Clock out' : 'Clock in'}</button></section><section className="generator-layout"><div className="panel generator-form-panel"><div className="section-eyebrow">1 · SEARCH MAPS</div><h2>Find local businesses</h2><p>Search by business type and area. Use the map listings to collect business names and phone numbers.</p><div className="generator-fields"><label>Business type<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. dentists, cafes" /></label><label>Area or city<input value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. East Oakland" /></label></div><a className={`maps-search-link ${mapQuery ? '' : 'disabled'}`} href={mapQuery ? `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!mapQuery}><Search size={15} /> Search Google Maps <ArrowUpRight size={14} /></a><div className="section-eyebrow capture-kicker">2 · ADD CONTACTS</div><form onSubmit={submit} className="generator-batch-form"><label className="generator-batch-label" htmlFor="generator-contacts">BUSINESS NAME, PHONE NUMBER<textarea id="generator-contacts" rows="8" value={pastedContacts} onChange={(event) => { setPastedContacts(event.target.value); setError(''); }} placeholder={'Northline Coffee, +1 415 555 0142\nMorrow Dental, +1 415 555 0176'} /></label><p className="bulk-hint">One business per line. You can paste two columns directly from a spreadsheet.</p>{error && <p className="form-error">{error}</p>}<button className="primary-button generator-save" type="submit"><Plus size={15} /> Save contacts for admin</button></form></div><aside className="generator-side"><div className="generator-count"><span>CONTACTS SAVED TODAY</span><b>{saved}</b><small>Sent to the admin review list</small></div><div className="generator-tip"><MapPin size={17} /><b>Keep it simple</b><p>Only save business names and public phone numbers. Your admin will review and assign the calls.</p></div></aside></section></>;
}

function TeamView({ leads, shifts, now }) {
  return <><PageHeading kicker="PEOPLE & TIME" title="Team & time" description="See who’s working, the time they’ve logged, and how their call list is moving." /><div className="team-cards">{STAFF.map((person) => { const assigned = leads.filter((lead) => lead.staffId === person.id); const called = assigned.filter((lead) => lead.status !== 'pending').length; const interested = assigned.filter((lead) => lead.status === 'interested'); const shift = shifts[keyForShift(person.id)]; const seconds = shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - shift.startedAt) / 1000) : 0) : 0; return <article className="team-card" key={person.id}><div className="team-card-head"><div className="team-card-person"><Avatar person={person} /><div><h3>{person.name}</h3><small>{person.email}</small></div></div><span className={`shift-indicator ${shift?.startedAt ? 'on' : ''}`}><i />{shift?.startedAt ? 'On shift' : shift?.signedOutAt ? 'Finished' : 'Not started'}</span></div><div className="team-time-band"><span><Clock3 size={15} /> TIME LOGGED TODAY</span><b>{formatDuration(seconds)}</b><small>{shift?.startedAt ? `Clocked in ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(shift.startedAt)}` : shift?.signedOutAt ? `Clocked out ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(shift.signedOutAt)}` : 'No shift recorded today'}</small></div><div className="team-card-metrics"><div><span>CALLS</span><b>{called}<small> / {assigned.length}</small></b></div><div><span>INTERESTED</span><b className="positive-number">{interested.length}</b></div><div><span>REMAINING</span><b>{assigned.length - called}</b></div></div>{interested.length ? <div className="team-card-leads"><span className="section-eyebrow">NEEDS FOLLOW-UP</span>{interested.slice(0, 2).map((lead) => <div key={lead.id}><CheckCheck size={14} /><span><b>{lead.business}</b><small>{lead.contact} · {lead.phone}</small></span></div>)}</div> : <div className="team-no-leads">Interested leads will show here for follow-up.</div>}</article>; })}</div><div className="team-data-notice"><ShieldCheck size={16} /><span><b>Daily time tracking</b>Shift times are saved by work date in this browser. An active shift continues counting while this page is open.</span></div></>;
}
