import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck,
  BriefcaseBusiness, CalendarDays, Check, CheckCheck,
  Clock3, LayoutDashboard, LogOut, MapPin, MoreHorizontal, MoreVertical,
  Phone, Plus, Search, ShieldCheck, Timer, Users, X,
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
    error.status = response.status;
    error.duplicates = payload?.duplicates || [];
    error.alreadySharedIds = payload?.alreadySharedIds || [];
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
const formatClockTime = (date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(date));
const initials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

function Avatar({ person, size = '' }) {
  return <span className={`avatar ${person.color || 'neutral'} ${size}`}>{person.initials || initials(person.name)}</span>;
}
function StatusPill({ status }) {
  const labels = { pending: 'Not called', interested: 'Interested', 'no-answer': 'No answer', 'not-interested': 'Not interested' };
  return <span className={`status-pill ${status}`}><i />{labels[status] || status}</span>;
}
function LoadingScreen({ message, authenticated = false }) {
  return <main className="api-loading" role="status" aria-live="polite" aria-busy="true">
    <section className="loading-console">
      <header className="loading-console-head"><img src="/flux-dev-logo.png" alt="Flux Dev" /><span className="loading-console-label">AUTH PIPELINE <i>v1.0</i></span></header>
      <div className="loading-console-rule" />
      <div className="loading-console-main">
        <span className="loading-indicator" aria-hidden="true"><i /></span>
        <div className="loading-copy"><span className="loading-phase"><i />{authenticated ? 'IDENTITY VERIFIED' : 'SESSION CHECK'}</span><h1>{message}</h1><p>{authenticated ? 'Retrieving your workspace data' : 'Confirming your saved session'}</p></div>
      </div>
      <div className="loading-console-track" aria-hidden="true"><i /></div>
      <footer className="loading-console-foot"><span><i /> AUTH</span><span><i /> DATABASE</span><span><i /> WORKSPACE</span></footer>
    </section>
    <span className="loading-console-caption">FLUX DEV <i>/</i> SECURE WORKSPACE</span>
  </main>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [staff, setStaff] = useState([]);
  const [leads, setLeads] = useState([]);
  const [contactPool, setContactPool] = useState([]);
  const [contactSubmissions, setContactSubmissions] = useState([]);
  const [myContacts, setMyContacts] = useState([]);
  const [contactActivity, setContactActivity] = useState([]);
  const [shifts, setShifts] = useState({});
  const [page, setPage] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const sidebarRef = useRef(null);
  const menuToggleRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const [apiError, setApiError] = useState('');

  const loadWorkspace = async (activeUser) => {
    const data = await apiRequest('/bootstrap');
    setUser(data.user || activeUser);
    setStaff(data.staff || []);
    setLeads(data.calls || []);
    setContactPool(data.contacts || []);
    setContactSubmissions(data.contactSubmissions || []);
    setMyContacts(data.myContacts || []);
    setContactActivity(data.contactActivity || []);
    setShifts(Object.fromEntries((data.shifts || []).map((shift) => [shift.staffId, shift])));
    setPage((data.user || activeUser).role === 'admin' ? 'overview' : (data.user || activeUser).role === 'contact-generator' ? 'generate' : 'today');
  };

  useEffect(() => {
    let sessionRestored = false;
    apiRequest('/auth/session').then(async ({ user: activeUser }) => {
      sessionRestored = true;
      setUser(activeUser);
      setPage(activeUser.role === 'admin' ? 'overview' : activeUser.role === 'contact-generator' ? 'generate' : 'today');
      await loadWorkspace(activeUser);
    }).catch((error) => {
      if (error.status === 401) return;
      if (sessionRestored) setToast('Workspace data could not be refreshed. Reload to try again.');
      else setApiError('Unable to connect right now. Please try again shortly.');
    }).finally(() => setAuthReady(true));
  }, []);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!mobileNav) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!sidebarRef.current?.contains(event.target) && !menuToggleRef.current?.contains(event.target)) setMobileNav(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [mobileNav]);

  const signIn = async (email, password, onAuthenticated) => {
    setApiError('');
    try {
      const { user: activeUser } = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      onAuthenticated();
      await loadWorkspace(activeUser);
      setApiError('');
      return { status: 'success' };
    } catch (error) {
      const message = error.code === 'pending' || error.message === 'Email or password was not recognized.'
        ? error.message
        : 'Unable to sign in right now. Please try again shortly.';
      setApiError(message);
      return { status: 'invalid', message };
    }
  };
  const register = async (name, email, password, role) => {
    setApiError('');
    try {
      await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
      return { status: 'success' };
    } catch (error) {
      setApiError(error.message);
      return { status: 'error', message: error.message };
    }
  };
  const approveStaff = async (id, role) => {
    try {
      const { staff: approvedStaff } = await apiRequest(`/team/${id}/approval`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setStaff((people) => people.map((person) => person.id === id ? approvedStaff : person));
      setToast('Staff account approved.');
    } catch (error) { setToast(error.message); }
  };
  const denyStaff = async (person) => {
    if (!window.confirm(`Deny the signup request for ${person.name}? They can register again with this email.`)) return;
    try {
      await apiRequest(`/team/${person.id}/approval`, { method: 'DELETE' });
      setStaff((people) => people.filter((item) => item.id !== person.id));
      setToast('Signup request denied.');
    } catch (error) { setToast(error.message); }
  };
  const deleteStaff = async (person) => {
    if (!window.confirm(`Delete ${person.name}? This permanently removes their account, call records, shift times, and generated contacts. This cannot be undone.`)) return;
    try {
      await apiRequest(`/team/${person.id}`, { method: 'DELETE' });
      setStaff((people) => people.filter((item) => item.id !== person.id));
      setLeads((items) => items.filter((item) => item.staffId !== person.id));
      setShifts((items) => {
        const next = { ...items };
        delete next[person.id];
        return next;
      });
      setContactPool((items) => items.filter((item) => item.generatorId !== person.id));
      setContactActivity((items) => items.filter((item) => item.generatorId !== person.id));
      setToast('Staff account deleted.');
    } catch (error) { setToast(error.message); }
  };
  const updateStaffRole = async (id, role) => {
    try {
      await apiRequest(`/team/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
      setStaff((people) => people.map((person) => person.id === id ? { ...person, role } : person));
      setToast('Staff role updated.');
    } catch (error) { setToast(error.message); }
  };
  const setStaffActive = async (person, active) => {
    try {
      const { staff: updatedStaff } = await apiRequest(`/team/${person.id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
      setStaff((people) => people.map((item) => item.id === person.id ? updatedStaff : item));
      setToast(active ? 'Staff account reactivated.' : 'Staff account deactivated.');
    } catch (error) { setToast(error.message); }
  };
  const approveContactSubmission = async (generatorId, contactIds) => {
    let result;
    try {
      result = await apiRequest(`/contact-agents/${generatorId}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ contactIds }),
      });
    } catch (error) {
      const duplicateIds = new Set(error.alreadySharedIds);
      if (duplicateIds.size) {
        setContactSubmissions((submissions) => submissions.map((submission) => submission.generatorId === generatorId
          ? {
            ...submission,
            contacts: submission.contacts.map((contact) => duplicateIds.has(contact.id) ? { ...contact, alreadyShared: true } : contact),
          }
          : submission));
      }
      throw error;
    }
    const { contacts, alreadySharedIds = [] } = result;
    const approvedIds = new Set(contacts.map((contact) => contact.id));
    const duplicateIds = new Set(alreadySharedIds);
    setContactSubmissions((submissions) => submissions.flatMap((submission) => {
      if (submission.generatorId !== generatorId) return [submission];
      const remaining = submission.contacts
        .filter((contact) => !approvedIds.has(contact.id))
        .map((contact) => duplicateIds.has(contact.id) ? { ...contact, alreadyShared: true } : contact);
      return remaining.length ? [{ ...submission, contacts: remaining, count: remaining.length }] : [];
    }));
    setContactPool((current) => [...current, ...contacts]);
    const skippedCount = alreadySharedIds.length;
    setToast(`${contacts.length} lead${contacts.length === 1 ? '' : 's'} approved${skippedCount ? `; ${skippedCount} already shared lead${skippedCount === 1 ? ' was' : 's were'} excluded` : ''}.`);
    return { approvedCount: contacts.length, skippedCount };
  };
  const deleteGeneratedContact = async (contact) => {
    try {
      await apiRequest(`/generated-contacts/${contact.id}`, { method: 'DELETE' });
      setContactSubmissions((submissions) => submissions.map((submission) => {
        if (submission.id !== contact.submissionId) return submission;
        const remaining = submission.contacts.filter((item) => item.id !== contact.id);
        return { ...submission, contacts: remaining, count: remaining.length };
      }).filter((submission) => submission.count > 0));
      setContactPool((current) => current.filter((item) => item.id !== contact.id));
      setContactActivity((activity) => activity.map((item) => item.generatorId === contact.generatorId
        ? { ...item, submitted: Math.max(0, item.submitted - 1) }
        : item).filter((item) => item.submitted > 0));
      setToast(`Deleted ${contact.business} from today’s leads.`);
      return true;
    } catch (error) {
      setToast(error.message);
      return false;
    }
  };
  const saveContacts = async (contacts) => {
    const result = await apiRequest('/contacts/batch', { method: 'POST', body: JSON.stringify({ contacts }) });
    setMyContacts((current) => [...current, ...(result.contacts || [])]);
    setToast(`${result.contacts.length} contact${result.contacts.length === 1 ? '' : 's'} saved for admin review.`);
  };
  const assignCalls = async (newCalls, contactIds) => {
    const result = await apiRequest('/calls/assign', { method: 'POST', body: JSON.stringify({ calls: newCalls, contactIds }) });
    setLeads((current) => [...current, ...result.calls]);
    setContactPool((current) => current.filter((contact) => !contactIds.includes(contact.id)));
    setToast(`${result.calls.length} calls shared across the team.`);
  };
  const signOut = async () => { await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); setStaff([]); setLeads([]); setContactPool([]); setContactSubmissions([]); setMyContacts([]); setContactActivity([]); setShifts({}); setMobileNav(false); setApiError(''); };
  const activeShift = user && user.role !== 'admin' ? shifts[user.id] : null;
  const elapsed = activeShift ? activeShift.elapsed + (activeShift.startedAt ? Math.max(0, Math.floor((now - new Date(activeShift.startedAt).getTime()) / 1000)) : 0) : 0;
  const clockIn = async () => {
    try { const { shift } = await apiRequest('/shifts/clock-in', { method: 'POST' }); setShifts((existing) => ({ ...existing, [user.id]: shift })); setToast('Shift started. Have a good call block.'); }
    catch (error) { setToast(error.message); }
  };
  const clockOut = async () => {
    if (!window.confirm('Clock out now? Your shift time will be saved.')) return;
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
    ? ['overview', 'calls', 'leads', 'team'].includes(page) ? page : 'overview'
    : user?.role === 'contact-generator' ? ['generate', 'my-leads'].includes(page) ? page : 'generate' : 'today';

  useEffect(() => {
    if (user?.role !== 'admin' || !['overview', 'calls', 'leads'].includes(activePage)) return undefined;
    let isCurrent = true;
    const refreshShifts = () => {
      apiRequest('/shifts/today').then(({ shifts: latestShifts }) => {
        if (isCurrent) setShifts(Object.fromEntries(latestShifts.map((shift) => [shift.staffId, shift])));
      }).catch(() => {});
    };
    const refreshLeadActivity = () => {
      apiRequest('/bootstrap').then((data) => {
        if (!isCurrent) return;
        setContactPool(data.contacts || []);
        setContactSubmissions(data.contactSubmissions || []);
        setContactActivity(data.contactActivity || []);
      }).catch((error) => {
        if (isCurrent) setToast(`Lead activity could not be refreshed: ${error.message}`);
      });
    };
    refreshShifts();
    refreshLeadActivity();
    const interval = window.setInterval(() => { refreshShifts(); refreshLeadActivity(); }, 15_000);
    return () => { isCurrent = false; window.clearInterval(interval); };
  }, [activePage, user?.role]);
  useEffect(() => {
    if (user?.role !== 'contact-generator' || activePage !== 'my-leads') return undefined;
    let isCurrent = true;
    const refreshMyLeads = () => {
      apiRequest('/bootstrap').then((data) => {
        if (isCurrent) setMyContacts(data.myContacts || []);
      }).catch((error) => {
        if (isCurrent) setToast(`Your leads could not be refreshed: ${error.message}`);
      });
    };
    refreshMyLeads();
    const interval = window.setInterval(refreshMyLeads, 15_000);
    return () => { isCurrent = false; window.clearInterval(interval); };
  }, [activePage, user?.role]);

  if (!authReady) return <LoadingScreen message="Preparing your workspace" />;
  if (!user) return <Login onLogin={signIn} onRegister={register} onClearMessage={() => setApiError('')} serverMessage={apiError} />;
  return <div className="app-shell">
    <aside id="workspace-navigation" className={`sidebar ${mobileNav ? 'open' : ''}`} ref={sidebarRef}>
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); if (window.matchMedia('(max-width: 820px)').matches) setMobileNav(false); else setPage(user.role === 'admin' ? 'overview' : user.role === 'contact-generator' ? 'generate' : 'today'); }}><img className="brand-logo brand-logo-dark" src="/flux-dev-logo.png" alt="Flux Dev" /></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">
        {user.role === 'admin' ? <>
          <NavButton icon={LayoutDashboard} label="Overview" active={activePage === 'overview'} onClick={() => { setPage('overview'); setMobileNav(false); }} />
          <NavButton icon={CalendarDays} label="Today’s calls" badge={dailyCalls.length} active={activePage === 'calls'} onClick={() => { setPage('calls'); setMobileNav(false); }} />
          <NavButton icon={BriefcaseBusiness} label="Today’s leads" badge={contactSubmissions.reduce((total, submission) => total + submission.count, 0) || null} active={activePage === 'leads'} onClick={() => { setPage('leads'); setMobileNav(false); }} />
          <NavButton icon={Users} label="Team & approvals" badge={staff.filter((person) => !person.approved).length || null} active={activePage === 'team'} onClick={() => { setPage('team'); setMobileNav(false); }} />
        </> : <>
          {user.role === 'contact-generator' ? <>
            <NavButton icon={Search} label="Find contacts" active={activePage === 'generate'} onClick={() => { setPage('generate'); setMobileNav(false); }} />
            <NavButton icon={BriefcaseBusiness} label="My leads" badge={myContacts.length || null} active={activePage === 'my-leads'} onClick={() => { setPage('my-leads'); setMobileNav(false); }} />
          </> : <NavButton icon={CalendarDays} label="Today’s queue" badge={staffLeads.length} active={activePage === 'today'} onClick={() => { setPage('today'); setMobileNav(false); }} />}
        </>}
      </nav>
      <div className="sidebar-bottom">
        <div className="profile-row"><Avatar person={user} /><span className="profile-name"><b>{user.name}</b><small>{user.role === 'admin' ? 'Workspace admin' : ROLE_LABELS[user.role]}</small></span><button className="icon-button profile-menu" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button menu-toggle" ref={menuToggleRef} onClick={() => setMobileNav((isOpen) => !isOpen)} aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} title={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav} aria-controls="workspace-navigation"><img src="/flux-dev-logo.png" alt="" width="22" height="22" /></button><div className="breadcrumbs">{user.role === 'admin' ? 'Workspace / ' : 'My workspace / '}<b>{activePage === 'today' ? 'Today’s queue' : activePage === 'calls' ? 'Today’s calls' : activePage === 'leads' ? 'Today’s leads' : activePage === 'team' ? 'Team & approvals' : activePage === 'generate' ? 'Find contacts' : activePage === 'my-leads' ? 'My leads' : 'Overview'}</b></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatShortDate()}</span><span className="top-divider" /><span className="top-status"><i /> All systems normal</span><Avatar person={user} size="small" /></div></header>
      <div className="page-content">
        {user.role === 'call-agent' && activePage === 'today' && <StaffToday user={user} leads={staffLeads} shift={activeShift} elapsed={elapsed} onClockIn={clockIn} onClockOut={clockOut} onUpdate={updateLead} now={now} />}
        {user.role === 'admin' && activePage === 'overview' && <AdminOverview leads={dailyCalls} shifts={shifts} now={now} onNavigate={setPage} staff={staff.filter((person) => person.approved && person.active !== false)} contacts={contactPool} contactActivity={contactActivity} />}
        {user.role === 'admin' && activePage === 'calls' && <DailyCallsPage
          leads={dailyCalls}
          contacts={contactPool}
          staff={staff.filter((person) => person.approved && person.active !== false && person.role === 'call-agent')}
          onDeleteLead={deleteGeneratedContact}
          onCheckDuplicates={(calls, contactIds) => apiRequest('/calls/check-duplicates', { method: 'POST', body: JSON.stringify({ calls, contactIds }) })}
          onAssign={assignCalls}
        />}
        {user.role === 'admin' && activePage === 'leads' && <TodayLeadsPage submissions={contactSubmissions} onApproveSubmission={approveContactSubmission} onDeleteLead={deleteGeneratedContact} />}
        {user.role === 'admin' && activePage === 'team' && <TeamApprovals staff={staff} onApprove={approveStaff} onDeny={denyStaff} onDelete={deleteStaff} onRoleChange={updateStaffRole} onSetActive={setStaffActive} />}
        {user.role === 'contact-generator' && activePage === 'generate' && <ContactGenerator user={user} shift={activeShift} elapsed={elapsed} saved={myContacts.length} onClockIn={clockIn} onClockOut={clockOut} onSave={saveContacts} />}
        {user.role === 'contact-generator' && activePage === 'my-leads' && <MyLeadsPage contacts={myContacts} />}
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

function Login({ onLogin, onRegister, onClearMessage, serverMessage }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('call-agent');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        const result = await onRegister(name, email, password, role);
        setMessage(result.status === 'success' ? 'Request sent. An admin must approve your account before you can sign in.' : result.message || 'That email is already registered, or the details are incomplete.');
        return;
      }
      const result = await onLogin(email, password, () => setIsAuthenticated(true));
      if (result.status !== 'success') {
        setIsAuthenticated(false);
        setMessage(result.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };
  const toggleMode = () => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); onClearMessage(); };
  if (isAuthenticated) return <LoadingScreen message="Preparing your workspace" authenticated />;
  return <main className="login-screen">
    <section className="login-art">
      <div className="login-art-top"><a className="brand brand-inverse" href="/"><img className="brand-logo" src="/flux-dev-logo.png" alt="Flux Dev" /></a><span className="edition">STAFF PORTAL <i /> 2026</span></div>
      <div className="art-copy"><span className="eyebrow"><span /> GOOD WORK STARTS HERE</span><h1>Make the<br />first call <em>count.</em></h1><p>Your day, your queue, your next good conversation. Everything you need to keep momentum.</p><div className="art-stat"><div className="stat-avatars"><span>MC</span><span>NW</span><span>EO</span><b>+</b></div><span>Small team. Real results.</span></div></div>
      <div className="art-footer"><span>BUILDING THE WEB, ONE HELLO AT A TIME.</span></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
    </section>
    <section className="login-panel"><form className="login-form" onSubmit={submit}>
      <span className="form-kicker">{mode === 'login' ? 'WELCOME BACK' : 'REQUEST ACCESS'}</span>
      <h2>{mode === 'login' ? <>Sign in to<br />your workspace.</> : <>Join the<br />Flux Dev team.</>}</h2>
      <p className="form-intro">{mode === 'login' ? 'Pick up right where your best work happens.' : 'An admin must approve your account before sign-in.'}</p>
      {mode === 'signup' && <><label htmlFor="signup-name">Full name</label><div className="input-wrap"><input id="signup-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></div></>}
      {mode === 'signup' && <><label htmlFor="signup-role">Role</label><RoleSelect id="signup-role" value={role} onChange={setRole} /></>}
      <label htmlFor="email">Work email</label><div className="input-wrap"><span className="input-at">@</span><input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></div>
      <label htmlFor="password">Password</label><div className="input-wrap"><input id="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'signup' ? 12 : 1} maxLength={72} /><button type="button" className="show-password" onClick={() => { const input = document.getElementById('password'); input.type = input.type === 'password' ? 'text' : 'password'; }}>Show</button></div>
      {(message || serverMessage) && <p className="login-message" role="status">{message || serverMessage}</p>}
      {mode === 'login' ? <button type="submit" className="primary-button login-submit" disabled={isSubmitting}>{isSubmitting ? 'Checking account…' : 'Sign in'} {!isSubmitting && <ArrowRight size={16} />}</button> : <button type="submit" className="primary-button login-submit" disabled={isSubmitting}>{isSubmitting ? 'Sending request…' : 'Request access'} {!isSubmitting && <ArrowRight size={16} />}</button>}
      <button type="button" className="login-mode-toggle" onClick={toggleMode} disabled={isSubmitting}>{mode === 'login' ? 'New to the team? Request an account' : 'Already approved? Sign in'}</button>
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
function StaffToday({ user, leads, shift, elapsed, onClockIn, onClockOut, onUpdate }) {
  const called = leads.filter((lead) => lead.status !== 'pending').length;
  const interested = leads.filter((lead) => lead.status === 'interested').length;
  const clockedIn = Boolean(shift?.startedAt);
  return <>
    <PageHeading kicker={formatShortDate().toUpperCase()} title={`Good morning, ${user.name.split(' ')[0]}.`} description="Your calls and work time for today." action={<span className={`shift-indicator ${clockedIn ? 'on' : ''}`}><i />{clockedIn ? 'Shift in progress' : shift?.signedOutAt ? 'Shift complete' : 'Not clocked in'}</span>} />
    <section className="staff-overview"><div className={`clock-panel ${clockedIn ? 'clock-active' : ''}`}><div className="clock-panel-copy"><span className="panel-kicker"><Timer size={14} /> DAILY TIME</span><div className="clock-time">{formatDuration(elapsed)}</div><div className="clock-caption">{clockedIn ? `Started at ${formatClockTime(shift.startedAt)}` : shift?.signedOutAt ? 'Today’s time is saved.' : 'Clock in when you start work.'}</div></div><button className={`clock-button ${clockedIn ? 'clock-out' : ''}`} onClick={clockedIn ? onClockOut : onClockIn}><span>{clockedIn ? <LogOut size={16} /> : <Timer size={16} />}</span>{clockedIn ? 'Clock out' : 'Clock in'}<ArrowRight size={15} /></button></div><div className="today-stats"><div className="today-stat"><span>Assigned calls</span><b>{String(leads.length).padStart(2, '0')}</b><small>today</small></div><div className="today-stat"><span>Calls completed</span><b>{String(called).padStart(2, '0')}</b><small>of {leads.length}</small></div><div className="today-stat"><span>Interested</span><b className="positive-number">{String(interested).padStart(2, '0')}</b><small>for follow-up</small></div><div className="daily-progress"><div><span>Today’s progress</span><b>{leads.length ? Math.round(called / leads.length * 100) : 0}%</b></div><div className="progress-track"><i style={{ width: `${leads.length ? called / leads.length * 100 : 0}%` }} /></div></div></div></section>
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
function AdminOverview({ leads, shifts, now, onNavigate, staff, contacts = [], contactActivity = [] }) {
  const STAFF = staff;
  const called = leads.filter((lead) => lead.status !== 'pending').length;
  const interested = leads.filter((lead) => lead.status === 'interested');
  const liveStaff = STAFF.filter((person) => shifts[person.id]?.startedAt);
  const totalSeconds = STAFF.reduce((total, person) => { const shift = shifts[person.id]; return total + (shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - new Date(shift.startedAt).getTime()) / 1000) : 0) : 0); }, 0);
  const submittedByStaff = Object.fromEntries(contactActivity.map((activity) => [activity.generatorId, activity.submitted]));
  return <>
    <PageHeading kicker={`${formatShortDate().toUpperCase()} · DAILY SUMMARY`} title="Team overview" description="Today’s attendance, call progress, and lead generation." action={<button className="primary-button" onClick={() => onNavigate('calls')}><CalendarDays size={15} /> Assign today’s calls</button>} />
    <div className="admin-metrics"><Metric icon={Users} label="Agents on shift" value={`${liveStaff.length} / ${STAFF.length}`} note={liveStaff.length ? `${liveStaff.map((person) => person.name.split(' ')[0]).join(', ')}` : 'No one clocked in yet'} tone="metric-green" /><Metric icon={BriefcaseBusiness} label="Calls assigned" value={leads.length} note="Across the team today" /><Metric icon={Phone} label="Calls completed" value={called} note={`${leads.length - called} still to call`} /><Metric icon={BadgeCheck} label="Interested" value={interested.length} note="Businesses to follow up" tone="metric-coral" /></div>
    <div className="admin-content-grid">
      <section className="panel team-panel">
        <div className="panel-heading"><div><div className="section-eyebrow">TEAM & TIME</div><h2>Today’s activity</h2></div><span className="count-chip">{formatDuration(totalSeconds)} total</span></div>
        <div className="team-table">
          <div className="team-table-head"><span>STAFF MEMBER</span><span>ACTIVITY</span><span>RESULTS</span><span>TIME TODAY</span></div>
          {STAFF.map((person) => {
            const assigned = leads.filter((lead) => lead.staffId === person.id);
            const touched = assigned.filter((lead) => lead.status !== 'pending').length;
            const yes = assigned.filter((lead) => lead.status === 'interested').length;
            const isLeadAgent = person.role === 'contact-generator';
            const submitted = submittedByStaff[person.id] || 0;
            const awaitingReview = contacts.filter((contact) => contact.generatorId === person.id).length;
            const shift = shifts[person.id];
            const seconds = shift ? shift.elapsed + (shift.startedAt ? Math.floor((now - new Date(shift.startedAt).getTime()) / 1000) : 0) : 0;
            const shiftStatus = shift?.startedAt ? 'On shift' : shift?.signedOutAt ? `Out ${formatClockTime(shift.signedOutAt)}` : 'Not clocked in';
            return <div className="team-table-row" key={person.id}>
              <div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{isLeadAgent ? 'Lead agent' : 'Call agent'}</small></span></div>
              <span className="table-number">{isLeadAgent ? submitted : touched}<small>{isLeadAgent ? ' leads' : ` / ${assigned.length}`}</small></span>
              <span className={`table-number ${isLeadAgent ? '' : 'positive-number'}`}>{isLeadAgent ? awaitingReview : yes}<small>{isLeadAgent ? ' review' : ' interested'}</small></span>
              <span className="table-time">{formatDuration(seconds)}<small>{shiftStatus}</small></span>
            </div>;
          })}
        </div>
      </section>
      <section className="panel interested-panel"><div className="panel-heading"><div><div className="section-eyebrow">FOLLOW UP</div><h2>Interested businesses</h2></div></div>{interested.length ? interested.map((lead) => { const assigned = STAFF.find((person) => person.id === lead.staffId); return <div className="interested-item" key={lead.id}><span className="interested-check"><Check size={14} /></span><div className="interested-copy"><b>{lead.business}</b><small>{lead.contact} · {lead.phone}</small><span>{assigned?.name || 'Staff member'}{lead.notes ? ` · ${lead.notes}` : ''}</span></div></div>; }) : <div className="empty-state compact">Interested businesses will appear here.</div>}</section>
    </div>
    <p className="local-data-note"><Clock3 size={14} /> Total team time today: {formatDuration(totalSeconds)}</p>
  </>;
}
function TodayLeadsPage({ submissions, onApproveSubmission, onDeleteLead }) {
  const [error, setError] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [selectedContactIds, setSelectedContactIds] = useState(() => new Set());
  const [isApproving, setIsApproving] = useState(false);
  const agents = submissions.reduce((groups, submission) => {
    const existing = groups.find((agent) => agent.id === submission.generatorId);
    const contacts = submission.contacts.map((contact) => ({
      ...contact,
      submissionId: submission.id,
      generatorId: submission.generatorId,
    }));
    if (existing) {
      existing.contacts.push(...contacts);
      existing.count += submission.count;
      return groups;
    }
    groups.push({
      id: submission.generatorId,
      name: submission.generatorName,
      submittedAt: submission.submittedAt,
      count: submission.count,
      contacts,
    });
    return groups;
  }, []);
  const submittedLeadCount = agents.reduce((total, agent) => total + agent.count, 0);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const alreadySharedCount = selectedAgent?.contacts.filter((contact) => contact.alreadyShared).length || 0;
  const selectedContacts = selectedAgent?.contacts.filter((contact) => !contact.alreadyShared && selectedContactIds.has(contact.id)) || [];
  const selectAgent = (agent) => {
    setSelectedContactIds(new Set(agent.contacts.filter((contact) => !contact.alreadyShared).map((contact) => contact.id)));
    setSelectedAgentId(agent.id);
    setError('');
  };
  const approveSelected = async () => {
    if (!selectedAgent || !selectedContacts.length || isApproving) return;
    setIsApproving(true);
    setError('');
    try {
      await onApproveSubmission(selectedAgent.id, selectedContacts.map((contact) => contact.id));
    } catch (approvalError) {
      setError(approvalError.message);
    } finally {
      setIsApproving(false);
    }
  };

  return <>
    <PageHeading kicker={formatShortDate().toUpperCase()} title="Today’s leads" description="Choose a lead agent to review their submissions, delete duplicates, and approve the remaining leads together." />
    <section className="panel submission-approval-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">WAITING FOR YOUR APPROVAL</div><h2>Lead agents</h2></div><span className="count-chip">{submittedLeadCount} leads</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {agents.length ? <>
        {!selectedAgent && <div className="lead-agent-list">{agents.map((agent) => <button className="lead-agent-card" type="button" key={agent.id} onClick={() => selectAgent(agent)}>
          <span className="lead-agent-avatar">{initials(agent.name)}</span>
          <span className="lead-agent-copy"><b>{agent.name}</b><small>{agent.count} submitted lead{agent.count === 1 ? '' : 's'}</small></span>
          <ArrowRight size={16} />
        </button>)}</div>}
        {selectedAgent && <section className="lead-agent-tab" role="tabpanel" aria-labelledby={`lead-agent-heading-${selectedAgent.id}`}>
          <div className="lead-agent-tab-header">
            <button className="secondary-button" type="button" onClick={() => { setSelectedAgentId(null); setSelectedContactIds(new Set()); setError(''); }}><ArrowLeft size={14} /> All lead agents</button>
            <div><b id={`lead-agent-heading-${selectedAgent.id}`}>{selectedAgent.name}</b><small>{selectedAgent.count} leads waiting for review</small></div>
          </div>
          <div className="agent-leads-content" aria-label={`${selectedAgent.name} submitted leads`}>
            <div className="submission-lead-list">{selectedAgent.contacts.map((contact) => <div className="submission-lead-row" key={contact.id}>
              <b>{contact.business}</b><span>{contact.phone}</span><small>{[contact.category, contact.area].filter(Boolean).join(' · ') || 'No category or area added'}</small>
              <label className={`lead-selection${contact.alreadyShared ? ' is-duplicate' : ''}`}>
                <input
                  type="checkbox"
                  aria-label={`${contact.alreadyShared ? 'Already shared duplicate' : 'Select'}: ${contact.business}`}
                  checked={!contact.alreadyShared && selectedContactIds.has(contact.id)}
                  disabled={contact.alreadyShared}
                  onChange={() => setSelectedContactIds((current) => {
                    const next = new Set(current);
                    if (next.has(contact.id)) next.delete(contact.id);
                    else next.add(contact.id);
                    return next;
                  })}
                />
                {contact.alreadyShared && <span>Already shared with call agents</span>}
              </label>
              <LeadActions contact={contact} onDelete={onDeleteLead} />
            </div>)}</div>
          </div>
          <div className="lead-review-selection">
            <span>{selectedContacts.length} selected · {alreadySharedCount} already shared excluded</span>
          </div>
          <div className="lead-agent-tab-footer">
            <span>{selectedContacts.length} selected lead{selectedContacts.length === 1 ? '' : 's'} will be added to Today’s calls</span>
            <button className="primary-button" type="button" disabled={isApproving || !selectedContacts.length} onClick={approveSelected}><Check size={14} /> {isApproving ? 'Approving…' : 'Approve selected'}</button>
          </div>
        </section>}
      </> : <div className="empty-state">No lead submissions are waiting for approval.</div>}
    </section>
  </>;
}

function LeadActions({ contact, onDelete }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!isOpen) return undefined;
    const closeMenu = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !menuRef.current?.contains(event.target))) setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
    };
  }, [isOpen]);
  return <div className="lead-actions-menu" ref={menuRef}>
    <button className="icon-button lead-menu-trigger" type="button" aria-label={`Actions for ${contact.business}`} aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}><MoreVertical size={17} /></button>
    {isOpen && <div className="lead-menu-popover" role="menu"><button type="button" role="menuitem" onClick={() => { setIsOpen(false); onDelete(contact); }}>Delete</button></div>}
  </div>;
}

function DailyCallsPage({ leads, contacts = [], onDeleteLead, onCheckDuplicates, onAssign, staff }) {
  const [reviewRows, setReviewRows] = useState(null);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [reviewDuplicates, setReviewDuplicates] = useState([]);
  const [duplicateCheckState, setDuplicateCheckState] = useState('unchecked');
  const [error, setError] = useState('');
  const isCheckingDuplicates = duplicateCheckState === 'checking';
  const approvedContactKey = contacts.map((contact) => contact.id).join('|');

  const checkAndStageRows = async (rows, contactIds) => {
    if (!rows.length) {
      setReviewRows(null);
      setReviewDuplicates([]);
      setDuplicateCheckState('unchecked');
      return;
    }
    setReviewRows(rows);
    setReviewDuplicates([]);
    setDuplicateCheckState('checking');
    setError('');
    try {
      const { duplicates } = await onCheckDuplicates(rows.map(({ id, business, phone }) => ({ id, business, phone })), contactIds);
      setReviewDuplicates(duplicates || []);
      setDuplicateCheckState('complete');
    } catch (checkError) {
      setDuplicateCheckState('error');
      setError(checkError.message);
    }
  };
  useEffect(() => {
    const rows = contacts.map((contact) => ({ id: contact.id, business: contact.business, phone: contact.phone }));
    const contactIds = rows.map((row) => row.id);
    setSelectedContactIds(contactIds);
    if (!rows.length) {
      setReviewRows(null);
      setReviewDuplicates([]);
      setDuplicateCheckState('unchecked');
      return;
    }
    checkAndStageRows(rows, contactIds);
  }, [approvedContactKey]);
  const moveRow = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= reviewRows.length) return;
    const nextRows = [...reviewRows];
    [nextRows[index], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[index]];
    setReviewRows(nextRows);
  };
  const removeReviewRow = async (index) => {
    const row = reviewRows[index];
    const nextRows = reviewRows.filter((_, rowIndex) => rowIndex !== index);
    const nextContactIds = selectedContactIds.filter((contactId) => contactId !== row.id);
    setSelectedContactIds(nextContactIds);
    await checkAndStageRows(nextRows, nextContactIds);
  };
  const share = async () => {
    if (!reviewRows?.length || duplicateCheckState !== 'complete' || reviewDuplicates.length) return;
    if (!staff.length) { setError('Approve at least one Call agent before sharing calls.'); return; }
    const calls = reviewRows.map((row) => ({
      id: row.id,
      business: row.business,
      contact: 'Not provided',
      phone: row.phone,
      staffId: '',
      status: 'pending',
      notes: '',
      workDate: today(),
    }));
    try {
      await onAssign(calls, selectedContactIds);
    } catch (assignError) {
      if (assignError.code === 'duplicates') {
        setReviewDuplicates(assignError.duplicates || []);
        setDuplicateCheckState('complete');
      }
      setError(assignError.message);
      return;
    }
    setReviewRows(null);
    setSelectedContactIds([]);
    setReviewDuplicates([]);
    setDuplicateCheckState('unchecked');
    setError('');
  };
  const deleteContact = async (contact) => {
    if (!await onDeleteLead(contact)) return;
    setSelectedContactIds((ids) => ids.filter((id) => id !== contact.id));
    if (reviewRows?.some((row) => row.id === contact.id)) {
      setReviewRows(null);
      setReviewDuplicates([]);
      setDuplicateCheckState('unchecked');
    }
  };
  const totals = staff.map((person) => ({ ...person, count: leads.filter((lead) => lead.staffId === person.id).length }));
  return <>
    <PageHeading kicker={formatShortDate().toUpperCase()} title="Today’s calls" description="Review approved leads, check for duplicates, and share calls evenly." />
    {error && <p className="form-error" role="alert">{error}</p>}
    {reviewRows && <section className="panel distribution-panel review-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">CHECK BEFORE SHARING</div><h2>Call order</h2></div><span className="count-chip">{reviewRows.length} calls</span></div>
      {duplicateCheckState === 'checking' && <p className="bulk-hint" role="status">Checking today’s calls and pending submissions for duplicates…</p>}
      {duplicateCheckState === 'complete' && !reviewDuplicates.length && <p className="duplicate-check-success" role="status">No duplicates found. The calls are ready to share.</p>}
      {reviewDuplicates.length > 0 && <p className="duplicate-check-warning" role="alert">{reviewDuplicates.length} possible duplicate{reviewDuplicates.length === 1 ? '' : 's'} found. Remove the flagged rows before sharing.</p>}
      <div className="review-list">{reviewRows.map((row, index) => {
        const duplicate = reviewDuplicates.find((item) => item.rowId === row.id);
        return <div className={`review-row ${duplicate ? 'has-duplicate' : ''}`} key={row.id}>
          <span className="review-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="review-business">{row.business}{duplicate && <small className="review-duplicate-note">Matches {duplicate.matchBusiness} by {duplicate.reason} ({duplicate.matchSource})</small>}</span>
          <span className="review-phone">{row.phone}</span>
          <span className="review-controls"><button type="button" className="icon-button" onClick={() => moveRow(index, -1)} disabled={index === 0} aria-label={`Move ${row.business} up`} title="Move up"><ArrowUp size={15} /></button><button type="button" className="icon-button" onClick={() => moveRow(index, 1)} disabled={index === reviewRows.length - 1} aria-label={`Move ${row.business} down`} title="Move down"><ArrowDown size={15} /></button><button type="button" className="icon-button" onClick={() => removeReviewRow(index)} aria-label={`Remove ${row.business}`} title="Remove from review"><X size={15} /></button>{contacts.find((contact) => contact.id === row.id) && <LeadActions contact={contacts.find((contact) => contact.id === row.id)} onDelete={deleteContact} />}</span>
        </div>;
      })}</div>
      <div className="review-actions"><button className="secondary-button" onClick={() => { setReviewRows(null); setReviewDuplicates([]); setDuplicateCheckState('unchecked'); }}>Edit list</button><button className="primary-button" onClick={share} disabled={isCheckingDuplicates || duplicateCheckState !== 'complete' || reviewDuplicates.length > 0}><Users size={15} /> Share evenly</button></div>
    </section>}
    <section className="panel distribution-panel"><div className="panel-heading"><div><div className="section-eyebrow">TODAY’S DISTRIBUTION</div><h2>Calls per staff member</h2></div><span className="count-chip">{leads.length} total</span></div><div className="distribution-list">{totals.map((person) => <div className="distribution-row" key={person.id}><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><b>{person.count} calls</b></div>)}</div></section>
  </>;
}
function TeamApprovals({ staff, onApprove, onDeny, onDelete, onRoleChange, onSetActive }) {
  const pending = staff.filter((person) => !person.approved);
  const approved = staff.filter((person) => person.approved && person.active !== false && person.role !== 'admin');
  const inactive = staff.filter((person) => person.approved && person.active === false && person.role !== 'admin');
  const accountRow = (person, isActive) => <div className="approval-row approved-row" key={person.id}>
    <div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div>
    {isActive ? <RoleSelect id={`role-${person.id}`} ariaLabel={`Role for ${person.name}`} value={person.role} onChange={(role) => onRoleChange(person.id, role)} /> : <span className="inactive-account-label">Deactivated</span>}
    <TeamAccountMenu person={person} active={isActive} onDelete={onDelete} onSetActive={onSetActive} />
  </div>;
  return <><PageHeading kicker="ACCESS CONTROL" title="Team & approvals" description="Approve or deny signup requests, manage staff roles, and remove staff accounts." />
    <section className="panel simple-team-panel"><div className="panel-heading"><div><div className="section-eyebrow">WAITING FOR APPROVAL</div><h2>New account requests</h2></div><span className="count-chip">{pending.length} waiting</span></div>{pending.length ? pending.map((person) => <PendingApprovalRow key={person.id} person={person} onApprove={onApprove} onDeny={onDeny} />) : <div className="empty-state">No new account requests.</div>}</section>
    <section className="panel simple-team-panel"><div className="panel-heading"><div><div className="section-eyebrow">ACTIVE ACCOUNTS</div><h2>Staff roles</h2></div><span className="count-chip">{approved.length}</span></div>{approved.length ? approved.map((person) => accountRow(person, true)) : <div className="empty-state">No active staff accounts.</div>}</section>
    {inactive.length > 0 && <section className="panel simple-team-panel"><div className="panel-heading"><div><div className="section-eyebrow">INACTIVE ACCOUNTS</div><h2>Deactivated staff</h2></div><span className="count-chip">{inactive.length}</span></div>{inactive.map((person) => accountRow(person, false))}</section>}
  </>;
}

function TeamAccountMenu({ person, active, onDelete, onSetActive }) {
  const [isOpen, setIsOpen] = useState(false);
  return <div className="team-account-actions">
    <button type="button" className="icon-button team-menu-trigger" aria-label={`Actions for ${person.name}`} title="Account actions" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}><MoreVertical size={17} /></button>
    {isOpen && <div className="lead-menu-popover team-account-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onSetActive(person, !active); }}>{active ? 'Deactivate' : 'Reactivate'}</button>
      <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onDelete(person); }}>Delete</button>
    </div>}
  </div>;
}

function PendingApprovalRow({ person, onApprove, onDeny }) {
  const [role, setRole] = useState('call-agent');
  return <div className="approval-row"><div className="team-person"><Avatar person={person} /><span><b>{person.name}</b><small>{person.email}</small></span></div><RoleSelect id={`role-${person.id}`} ariaLabel={`Choose role for ${person.name}`} value={role} onChange={setRole} /><button className="primary-button" type="button" onClick={() => onApprove(person.id, role)}><Check size={14} /> Approve</button><button className="secondary-button team-deny-button" type="button" onClick={() => onDeny(person)} aria-label={`Deny signup request for ${person.name}`}><X size={14} /> Deny</button></div>;
}

function MyLeadsPage({ contacts }) {
  const waiting = contacts.filter((contact) => !contact.approvedAt && !contact.assignedAt).length;
  const approved = contacts.filter((contact) => contact.approvedAt && !contact.assignedAt).length;
  const shared = contacts.filter((contact) => contact.assignedAt).length;
  return <>
    <PageHeading kicker="YOUR LEADS · TODAY" title="My leads" description="Check the leads you submitted and see whether they’re approved or already shared with call agents." />
    <div className="lead-submission-metrics">
      <Metric icon={BriefcaseBusiness} label="Submitted today" value={contacts.length} note="Leads sent to your admin" />
      <Metric icon={Clock3} label="Awaiting approval" value={waiting} note="Visible to your admin" tone="metric-coral" />
      <Metric icon={CheckCheck} label="Approved / shared" value={approved + shared} note={`${approved} ready for call review · ${shared} shared`} tone="metric-green" />
    </div>
    <section className="panel my-leads-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">SUBMISSION STATUS</div><h2>Today’s submitted leads</h2></div><span className="count-chip">{contacts.length} leads</span></div>
      {contacts.length ? <div className="my-leads-list">{contacts.map((contact) => {
        const status = contact.assignedAt ? 'shared' : contact.approvedAt ? 'approved' : 'waiting';
        const label = status === 'shared' ? 'Shared with call agents' : status === 'approved' ? 'Approved · ready for review' : 'Waiting for admin approval';
        return <article className="my-lead-row" key={contact.id}>
          <div className="my-lead-copy"><b>{contact.business}</b><span>{contact.phone}</span><small>{[contact.category, contact.area].filter(Boolean).join(' · ') || 'No category or area added'}</small></div>
          <span className={`submission-status ${status}`}><i />{label}</span>
        </article>;
      })}</div> : <div className="empty-state">You have not submitted any leads today. Find contacts and save a list to send it to your admin for approval.</div>}
    </section>
  </>;
}

function ContactGenerator({ user, shift, elapsed, saved = 0, onClockIn, onClockOut, onSave }) {
  const [pastedContacts, setPastedContacts] = useState('');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState('');
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
    setError('');
  };
  return <><PageHeading kicker={formatShortDate().toUpperCase()} title={`Find businesses, ${user.name.split(' ')[0]}.`} description="Search Maps, then paste multiple business names and phone numbers for admin approval." action={<span className={`shift-indicator ${clockedIn ? 'on' : ''}`}><i />{clockedIn ? 'Shift in progress' : 'Shift not started'}</span>} /><section className="generator-clock"><div><span>TIME TODAY</span><b>{formatDuration(elapsed)}</b></div><button className="primary-button" onClick={clockedIn ? onClockOut : onClockIn}>{clockedIn ? 'Clock out' : 'Clock in'}</button></section><section className="generator-layout"><div className="panel generator-form-panel"><div className="section-eyebrow">1 · SEARCH MAPS</div><h2>Find local businesses</h2><p>Search by business type and area. Use the map listings to collect business names and phone numbers.</p><div className="generator-fields"><label>Business type<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. dentists, cafes" /></label><label>Area or city<input value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. East Oakland" /></label></div><a className={`maps-search-link ${mapQuery ? '' : 'disabled'}`} href={mapQuery ? `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!mapQuery}><Search size={15} /> Search Google Maps <ArrowUpRight size={14} /></a><div className="section-eyebrow capture-kicker">2 · ADD CONTACTS</div><form onSubmit={submit} className="generator-batch-form"><label className="generator-batch-label" htmlFor="generator-contacts">BUSINESS NAME, PHONE NUMBER<textarea id="generator-contacts" rows="8" value={pastedContacts} onChange={(event) => { setPastedContacts(event.target.value); setError(''); }} placeholder={'Northline Coffee, +1 415 555 0142\nMorrow Dental, +1 415 555 0176'} /></label><p className="bulk-hint">One business per line. You can paste two columns directly from a spreadsheet.</p>{error && <p className="form-error">{error}</p>}<button className="primary-button generator-save" type="submit"><Plus size={15} /> Submit leads for approval</button></form></div><aside className="generator-side"><div className="generator-count"><span>LEADS SUBMITTED TODAY</span><b>{saved}</b><small>Check approval status in My leads</small></div><div className="generator-tip"><MapPin size={17} /><b>Keep it simple</b><p>Only save business names and public phone numbers. Your admin will review and assign the calls.</p></div></aside></section></>;
}
