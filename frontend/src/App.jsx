import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BadgeCheck,
  BriefcaseBusiness, CalendarDays, Check, CheckCheck, ChevronDown,
  Clock3, FileSpreadsheet, LayoutDashboard, LogOut, MapPin, MoreHorizontal, MoreVertical,
  Pencil, Phone, Plus, Save, Search, Send, ShieldCheck, Timer, Trash2, Users, X,
} from 'lucide-react';

const ROLE_LABELS = { 'call-agent': 'Call agent', 'contact-generator': 'Lead agent' };
const ROLE_OPTIONS = [
  { value: 'call-agent', label: 'Call agent' },
  { value: 'contact-generator', label: 'Lead agent' },
];
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => localDateKey(new Date());
const workDateKey = (value) => typeof value === 'string' ? value.slice(0, 10) : value instanceof Date ? localDateKey(value) : '';
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
    error.duplicateIds = payload?.duplicateIds || [];
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
const formatWorkDate = (value) => {
  const date = value ? new Date(`${value}T12:00:00`) : null;
  return date && Number.isFinite(date.getTime()) ? formatShortDate(date) : 'Date unavailable';
};
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
  const [savedLeads, setSavedLeads] = useState([]);
  const [myContacts, setMyContacts] = useState([]);
  const [contactActivity, setContactActivity] = useState([]);
  const [shifts, setShifts] = useState({});
  const [page, setPage] = useState('overview');
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [mobileNav, setMobileNav] = useState(() => window.matchMedia('(min-width: 821px)').matches);
  const sidebarRef = useRef(null);
  const menuToggleRef = useRef(null);
  const callsRefreshSequence = useRef(0);
  const [authReady, setAuthReady] = useState(false);
  const [apiError, setApiError] = useState('');

  const loadWorkspace = async (activeUser) => {
    const data = await apiRequest('/bootstrap');
    setUser(data.user || activeUser);
    setStaff(data.staff || []);
    setLeads(data.calls || []);
    setContactPool(data.contacts || []);
    setContactSubmissions(data.contactSubmissions || []);
    setSavedLeads(data.savedLeads || []);
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
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 821px)');
    const syncSidebarToViewport = () => setMobileNav(desktop.matches);
    desktop.addEventListener('change', syncSidebarToViewport);
    return () => desktop.removeEventListener('change', syncSidebarToViewport);
  }, []);
  useEffect(() => { if (!toast) return undefined; const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!mobileNav) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (window.matchMedia('(max-width: 820px)').matches && !sidebarRef.current?.contains(event.target) && !menuToggleRef.current?.contains(event.target)) setMobileNav(false);
    };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMobileNav(false); };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
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
      const possibleDuplicateIds = new Set(error.duplicateIds);
      if (duplicateIds.size) {
        setContactSubmissions((submissions) => submissions.map((submission) => submission.generatorId === generatorId
          ? {
            ...submission,
            contacts: submission.contacts.map((contact) => duplicateIds.has(contact.id) ? { ...contact, alreadyShared: true } : contact),
          }
          : submission));
      }
      if (possibleDuplicateIds.size) {
        setContactSubmissions((submissions) => submissions.map((submission) => submission.generatorId === generatorId
          ? {
            ...submission,
            contacts: submission.contacts.map((contact) => possibleDuplicateIds.has(contact.id) ? { ...contact, isDuplicate: true } : contact),
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
        .map((contact) => ({
          ...contact,
          ...(duplicateIds.has(contact.id) ? { alreadyShared: true } : {}),
        }));
      return remaining.length ? [{ ...submission, contacts: remaining, count: remaining.length }] : [];
    }));
    const calls = result.calls || [];
    const approvedContacts = [...contacts, ...contactPool];
    const newlySavedLeads = calls.flatMap((call) => {
      const contact = approvedContacts.find((item) => item.id === call.sourceContactId);
      if (!contact) return [];
      return [{
        ...contact,
        ...call,
        id: contact.id,
        callId: call.id,
        sourceContactId: contact.id,
        assignedAt: new Date().toISOString(),
        agentName: staff.find((person) => person.id === call.staffId)?.name || 'Call agent',
      }];
    });
    if (newlySavedLeads.length) {
      setSavedLeads((current) => [...newlySavedLeads, ...current.filter((item) => !newlySavedLeads.some((saved) => saved.id === item.id))]);
    }
    const refreshSequence = ++callsRefreshSequence.current;
    setLeads((current) => [...current, ...calls.filter((call) => !current.some((item) => item.id === call.id))]);
    apiRequest('/calls/today').then(({ calls: latestCalls }) => {
      if (callsRefreshSequence.current === refreshSequence) setLeads(latestCalls || []);
    }).catch(() => {});
    setContactPool((current) => calls.length
      ? current.filter((contact) => !approvedIds.has(contact.id))
      : [...current, ...contacts]);
    const alreadySharedCount = new Set(alreadySharedIds).size;
    const approvalText = calls.length
      ? `Approved ${contacts.length} lead${contacts.length === 1 ? '' : 's'} and shared ${calls.length} call${calls.length === 1 ? '' : 's'} evenly`
      : `Approved ${contacts.length} lead${contacts.length === 1 ? '' : 's'}; waiting for an active Call agent`;
    const noticeText = [
      alreadySharedCount ? `${alreadySharedCount} previously shared lead${alreadySharedCount === 1 ? '' : 's'} sent again` : '',
    ].filter(Boolean).join('; ');
    setToast(`${approvalText}${noticeText ? `; ${noticeText}` : ''}.`);
    return { approvedCount: contacts.length, sharedCount: calls.length, skippedCount: 0 };
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
      setSavedLeads((current) => current.filter((item) => item.id !== contact.id));
      setLeads((current) => current.filter((item) => item.sourceContactId !== contact.id));
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
  const editGeneratedContact = async (contact, changes) => {
    const { contact: updated } = await apiRequest(`/generated-contacts/${contact.id}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    });
    setLeads((current) => current.map((item) => item.sourceContactId === contact.id ? { ...item, business: updated.business, phone: updated.phone } : item));
    setContactPool((current) => current.map((item) => item.id === contact.id ? { ...item, ...updated } : item));
    setSavedLeads((current) => current.map((item) => item.id === contact.id ? { ...item, ...updated } : item));
    setToast(`Updated ${updated.business}.`);
  };
  const saveContacts = async (contacts) => {
    const result = await apiRequest('/contacts/batch', { method: 'POST', body: JSON.stringify({ contacts }) });
    setMyContacts((current) => [...current, ...(result.contacts || [])]);
    const savedCount = result.contacts.length;
    setToast(`${savedCount} contact${savedCount === 1 ? '' : 's'} sent to admin for review.`);
    return result;
  };
  const updateMyContact = async (contact, changes) => {
    try {
      const { contact: updated } = await apiRequest(`/my-contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      });
      setMyContacts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setToast('Contact updated.');
      return updated;
    } catch (error) {
      setToast(error.message);
      throw error;
    }
  };
  const deleteMyContact = async (contact) => {
    try {
      await apiRequest(`/my-contacts/${contact.id}`, { method: 'DELETE' });
      setMyContacts((current) => current.filter((item) => item.id !== contact.id));
      setToast('Contact deleted.');
    } catch (error) {
      setToast(error.message);
      throw error;
    }
  };
  const assignCalls = async (newCalls, contactIds) => {
    const result = await apiRequest('/calls/assign', { method: 'POST', body: JSON.stringify({ calls: newCalls, contactIds }) });
    setLeads((current) => [...current, ...result.calls]);
    setContactPool((current) => current.filter((contact) => !contactIds.includes(contact.id)));
    const saved = result.calls.flatMap((call) => {
      const contact = contactPool.find((item) => item.id === call.sourceContactId);
      if (!contact) return [];
      return [{ ...contact, ...call, id: contact.id, callId: call.id, sourceContactId: contact.id, assignedAt: new Date().toISOString(), agentName: staff.find((person) => person.id === call.staffId)?.name || 'Call agent' }];
    });
    if (saved.length) setSavedLeads((current) => [...saved, ...current.filter((item) => !saved.some((newItem) => newItem.id === item.id))]);
    setToast(`${result.calls.length} calls shared across the team.`);
  };
  const signOut = () => setShowLogoutConfirm(true);
  const confirmSignOut = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); setStaff([]); setLeads([]); setContactPool([]); setContactSubmissions([]); setSavedLeads([]); setMyContacts([]); setContactActivity([]); setShifts({}); setMobileNav(false); setApiError('');
    setShowLogoutConfirm(false);
    setIsLoggingOut(false);
  };
  useEffect(() => {
    if (!showLogoutConfirm) return undefined;
    const dismissOnEscape = (event) => { if (event.key === 'Escape' && !isLoggingOut) setShowLogoutConfirm(false); };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [showLogoutConfirm, isLoggingOut]);
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
  const dailyCalls = leads.filter((lead) => !lead.workDate || workDateKey(lead.workDate) === today());
  const staffLeads = dailyCalls.filter((lead) => lead.staffId === user?.id);
  const activePage = user?.role === 'admin'
    ? ['overview', 'calls', 'leads', 'team', 'reports'].includes(page) ? page : 'overview'
    : user?.role === 'contact-generator' ? ['generate', 'my-leads'].includes(page) ? page : 'generate' : ['today', 'reports'].includes(page) ? page : 'today';
  const closeNavAfterNavigation = () => {
    if (window.matchMedia('(max-width: 820px)').matches) setMobileNav(false);
  };

  useEffect(() => {
    if (user?.role !== 'admin' || !['overview', 'calls', 'leads'].includes(activePage)) return undefined;
    let isCurrent = true;
    const refreshShifts = () => {
      apiRequest('/shifts/today').then(({ shifts: latestShifts }) => {
        if (isCurrent) setShifts(Object.fromEntries(latestShifts.map((shift) => [shift.staffId, shift])));
      }).catch(() => {});
    };
    const refreshCalls = () => {
      const requestSequence = ++callsRefreshSequence.current;
      apiRequest('/calls/today').then(({ calls: latestCalls }) => {
        if (isCurrent && callsRefreshSequence.current === requestSequence) setLeads(latestCalls || []);
      }).catch(() => {});
    };
    const refreshLeadActivity = () => {
      apiRequest('/bootstrap').then((data) => {
        if (!isCurrent) return;
        setContactPool(data.contacts || []);
        setContactSubmissions(data.contactSubmissions || []);
        setSavedLeads(data.savedLeads || []);
        setContactActivity(data.contactActivity || []);
      }).catch((error) => {
        if (!isCurrent) return;
        if (error.status === 401 || error.message === 'Sign in required.' || error.message === 'Session expired. Sign in again.') {
          setToast('');
          setApiError('Your session is no longer active. Please sign in again to see lead updates.');
          setUser(null);
          return;
        }
        setToast(`Lead activity could not be refreshed: ${error.message}`);
      });
    };
    refreshShifts();
    refreshCalls();
    refreshLeadActivity();
    const interval = window.setInterval(() => { refreshShifts(); refreshLeadActivity(); }, 15_000);
    const callsInterval = window.setInterval(refreshCalls, 5_000);
    return () => { isCurrent = false; window.clearInterval(interval); window.clearInterval(callsInterval); };
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
  useEffect(() => {
    if (user?.role !== 'call-agent') return undefined;
    let isCurrent = true;
    const refreshQueue = () => {
      apiRequest('/bootstrap').then((data) => {
        if (!isCurrent) return;
        setLeads(data.calls || []);
        setShifts(Object.fromEntries((data.shifts || []).map((shift) => [shift.staffId, shift])));
      }).catch(() => {});
    };
    const interval = window.setInterval(refreshQueue, 15_000);
    return () => { isCurrent = false; window.clearInterval(interval); };
  }, [user?.id, user?.role]);

  if (!authReady) return <LoadingScreen message="Preparing your workspace" />;
  if (!user) return <Login onLogin={signIn} onRegister={register} onClearMessage={() => setApiError('')} serverMessage={apiError} />;
  return <div className="app-shell">
      <aside id="workspace-navigation" className={`sidebar ${mobileNav ? 'open' : 'closed'}`} ref={sidebarRef}>
      <div className="sidebar-head"><button className="brand brand-toggle" type="button" onClick={() => setMobileNav((isOpen) => !isOpen)} aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav} aria-controls="workspace-navigation"><img className="brand-logo brand-logo-dark" src="/flux-dev-logo.png" alt="Flux Dev" /></button><button className="icon-button sidebar-close" type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={18} /></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav">
        {user.role === 'admin' ? <>
          <NavButton icon={LayoutDashboard} label="Overview" active={activePage === 'overview'} onClick={() => { setPage('overview'); closeNavAfterNavigation(); }} />
          <NavButton icon={CalendarDays} label="Today’s calls" badge={dailyCalls.length} active={activePage === 'calls'} onClick={() => { setPage('calls'); closeNavAfterNavigation(); }} />
          <NavButton icon={BriefcaseBusiness} label="Today’s leads" badge={contactSubmissions.reduce((total, submission) => total + submission.count, 0) || null} active={activePage === 'leads'} onClick={() => { setPage('leads'); closeNavAfterNavigation(); }} />
          <NavButton icon={FileSpreadsheet} label="Reports" active={activePage === 'reports'} onClick={() => { setPage('reports'); closeNavAfterNavigation(); }} />
          <NavButton icon={Users} label="Team & approvals" badge={staff.filter((person) => !person.approved).length || null} active={activePage === 'team'} onClick={() => { setPage('team'); closeNavAfterNavigation(); }} />
        </> : <>
          {user.role === 'contact-generator' ? <>
            <NavButton icon={Search} label="Find contacts" active={activePage === 'generate'} onClick={() => { setPage('generate'); closeNavAfterNavigation(); }} />
            <NavButton icon={BriefcaseBusiness} label="My leads" badge={myContacts.length || null} active={activePage === 'my-leads'} onClick={() => { setPage('my-leads'); closeNavAfterNavigation(); }} />
          </> : <>
            <NavButton icon={CalendarDays} label="Today’s queue" badge={staffLeads.length} active={activePage === 'today'} onClick={() => { setPage('today'); closeNavAfterNavigation(); }} />
            <NavButton icon={FileSpreadsheet} label="Reports" active={activePage === 'reports'} onClick={() => { setPage('reports'); closeNavAfterNavigation(); }} />
          </>}
        </>}
      </nav>
      <div className="sidebar-bottom">
        <div className="profile-row"><Avatar person={user} /><span className="profile-name"><b>{user.name}</b><small>{user.role === 'admin' ? 'Workspace admin' : ROLE_LABELS[user.role]}</small></span><button className="icon-button profile-menu" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className={`main-area ${mobileNav ? '' : 'sidebar-hidden'}`}>
      <header className="topbar"><button className={`icon-button menu-toggle ${mobileNav ? 'nav-toggle-hidden' : 'nav-toggle-visible'}`} ref={menuToggleRef} onClick={() => setMobileNav((isOpen) => !isOpen)} aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} title={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav} aria-controls="workspace-navigation"><img className="nav-brand-logo" src="/flux-dev-logo.png" alt="Flux Dev" /></button><div className="breadcrumbs">{user.role === 'admin' ? 'Workspace / ' : 'My workspace / '}<b>{activePage === 'today' ? 'Today’s queue' : activePage === 'reports' ? 'Reports' : activePage === 'calls' ? 'Today’s calls' : activePage === 'leads' ? 'Today’s leads' : activePage === 'team' ? 'Team & approvals' : activePage === 'generate' ? 'Find contacts' : activePage === 'my-leads' ? 'My leads' : 'Overview'}</b></div><div className="topbar-right"><span className="top-date"><CalendarDays size={15} />{formatShortDate()}</span><span className="top-divider" /><span className="top-status"><i /> All systems normal</span><Avatar person={user} size="small" /></div></header>
      <div className="page-content">
        {user.role === 'call-agent' && activePage === 'today' && <StaffToday user={user} leads={staffLeads} shift={activeShift} elapsed={elapsed} onClockIn={clockIn} onClockOut={clockOut} onUpdate={updateLead} now={now} />}
        {user.role === 'call-agent' && activePage === 'reports' && <ReportsPage />}
        {user.role === 'admin' && activePage === 'overview' && <AdminOverview leads={dailyCalls} shifts={shifts} now={now} onNavigate={setPage} staff={staff.filter((person) => person.approved && person.active !== false)} contacts={contactPool} contactActivity={contactActivity} />}
        {user.role === 'admin' && activePage === 'calls' && <DailyCallsPage
          leads={dailyCalls}
          contacts={contactPool}
          staff={staff.filter((person) => person.approved && person.active !== false && person.role === 'call-agent')}
          onDeleteLead={deleteGeneratedContact}
          onEditLead={editGeneratedContact}
          onCheckDuplicates={(calls, contactIds) => apiRequest('/calls/check-duplicates', { method: 'POST', body: JSON.stringify({ calls, contactIds }) })}
          onAssign={assignCalls}
        />}
        {user.role === 'admin' && activePage === 'leads' && <TodayLeadsPage submissions={contactSubmissions} savedLeads={savedLeads} onApproveSubmission={approveContactSubmission} onDeleteLead={deleteGeneratedContact} />}
        {user.role === 'admin' && activePage === 'reports' && <AdminReportsPage />}
        {user.role === 'admin' && activePage === 'team' && <TeamApprovals staff={staff} onApprove={approveStaff} onDeny={denyStaff} onDelete={deleteStaff} onRoleChange={updateStaffRole} onSetActive={setStaffActive} />}
        {user.role === 'contact-generator' && activePage === 'generate' && <ContactGenerator user={user} shift={activeShift} elapsed={elapsed} saved={myContacts.length} onClockIn={clockIn} onClockOut={clockOut} onSave={saveContacts} />}
        {user.role === 'contact-generator' && activePage === 'my-leads' && <MyLeadsPage contacts={myContacts} onEditContact={updateMyContact} onDeleteContact={deleteMyContact} />}
      </div>
    </main>
    {toast && <div className="toast"><Check size={15} />{toast}</div>}
    {showLogoutConfirm && <div className="logout-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isLoggingOut) setShowLogoutConfirm(false); }}><section className="logout-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="logout-confirm-title" aria-describedby="logout-confirm-description"><span className="logout-confirm-icon"><LogOut size={20} /></span><h2 id="logout-confirm-title">Log out?</h2><p id="logout-confirm-description">Are you sure you want to log out of your workspace?</p><div className="logout-confirm-actions"><button className="secondary-button" type="button" autoFocus disabled={isLoggingOut} onClick={() => setShowLogoutConfirm(false)}>Cancel</button><button className="primary-button" type="button" disabled={isLoggingOut} onClick={confirmSignOut}><LogOut size={14} />{isLoggingOut ? 'Logging out…' : 'Log out'}</button></div></section></div>}
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
function TodayLeadsPage({ submissions, savedLeads = [], onApproveSubmission, onDeleteLead }) {
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
  const possibleDuplicateCount = selectedAgent?.contacts.filter((contact) => contact.isDuplicate && !contact.alreadyShared).length || 0;
  const selectableContacts = selectedAgent?.contacts || [];
  const selectedContacts = selectedAgent?.contacts.filter((contact) => selectedContactIds.has(contact.id)) || [];
  const allSelectableSelected = selectableContacts.length > 0 && selectableContacts.every((contact) => selectedContactIds.has(contact.id));
  const selectAgent = (agent) => {
    setSelectedContactIds(new Set());
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
            <label className="approve-all-selection">
              <input
                type="checkbox"
                aria-label="Approve all selectable leads"
                checked={allSelectableSelected}
                disabled={!selectableContacts.length || isApproving}
                onChange={() => setSelectedContactIds(allSelectableSelected ? new Set() : new Set(selectableContacts.map((contact) => contact.id)))}
              />
              <span>Approve all</span>
              <small>{selectedContacts.length} of {selectableContacts.length} selectable</small>
            </label>
            <div className="submission-lead-list">{selectedAgent.contacts.map((contact) => <div className="submission-lead-row" key={contact.id}>
              <b>{contact.business}</b><span>{contact.phone}</span><small>{[contact.category, contact.area].filter(Boolean).join(' · ') || 'No category or area added'}</small>
              <label className={`lead-selection${contact.alreadyShared || contact.isDuplicate ? ' is-duplicate' : ''}`}>
                <input
                  type="checkbox"
                  aria-label={`${contact.alreadyShared ? 'Already shared; optional resend' : contact.isDuplicate ? 'Possible duplicate; selectable' : 'Select'}: ${contact.business}`}
                  checked={selectedContactIds.has(contact.id)}
                  onChange={() => setSelectedContactIds((current) => {
                    const next = new Set(current);
                    if (next.has(contact.id)) next.delete(contact.id);
                    else next.add(contact.id);
                    return next;
                  })}
                />
                {contact.alreadyShared ? <span>Already shared · select to send again</span> : contact.isDuplicate && <span>Possible duplicate · selectable if approved</span>}
              </label>
              <LeadActions contact={contact} onDelete={onDeleteLead} />
            </div>)}</div>
          </div>
          <div className="lead-review-selection">
            <span>{selectedContacts.length} selected · {alreadySharedCount} already shared · {possibleDuplicateCount} possible duplicates flagged</span>
          </div>
          <div className="lead-agent-tab-footer">
            <span>{selectedContacts.length} selected leads will be shared evenly with active call agents</span>
            <button className="primary-button" type="button" disabled={isApproving || !selectedContacts.length} onClick={approveSelected}><Check size={14} /> {isApproving ? 'Approving…' : 'Approve & share'}</button>
          </div>
        </section>}
      </> : <div className="empty-state">No lead submissions are waiting for approval.</div>}
    </section>
    <section className="panel saved-leads-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">SENT TO CALL AGENTS</div><h2>Saved Leads</h2></div><span className="count-chip">{savedLeads.length} saved</span></div>
      {savedLeads.length ? <div className="saved-leads-list">{savedLeads.map((lead) => <article className="saved-lead-row" key={lead.id}>
        <div className="saved-lead-business"><b>{lead.business}</b><small>{lead.phone}</small></div>
        <div className="saved-lead-agent"><span>ASSIGNED TO</span><b>{lead.agentName || 'Call agent'}</b></div>
        <div className="saved-lead-status"><StatusPill status={lead.status || 'pending'} /></div>
      </article>)}</div> : <div className="empty-state">Approved leads sent to call agents will be saved here.</div>}
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

function ReportSheetMenu({ onDelete, disabled }) {
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
    <button className="icon-button lead-menu-trigger" type="button" aria-label="Report sheet actions" aria-haspopup="menu" aria-expanded={isOpen} disabled={disabled} onClick={() => setIsOpen((open) => !open)}><MoreVertical size={17} /></button>
    {isOpen && <div className="lead-menu-popover" role="menu"><button type="button" role="menuitem" onClick={() => { setIsOpen(false); onDelete(); }}>Delete sheet</button></div>}
  </div>;
}

function DailyCallsPage({ leads, contacts = [], onDeleteLead, onEditLead, onCheckDuplicates, onAssign, staff }) {
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
    <section className="panel distribution-panel"><div className="panel-heading"><div><div className="section-eyebrow">SHARED CONTACTS</div><h2>Leads sent to call agents</h2></div><span className="count-chip">{leads.filter((lead) => lead.sourceContactId).length} leads</span></div>
      {leads.some((lead) => lead.sourceContactId) ? <div className="distribution-list">{leads.filter((lead) => lead.sourceContactId).map((lead) => <AdminSharedLead key={lead.sourceContactId} lead={lead} onEdit={onEditLead} onDelete={onDeleteLead} />)}</div> : <div className="empty-state">No submitted contacts have been shared today.</div>}
    </section>
  </>;
}

function AdminSharedLead({ lead, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ business: lead.business, phone: lead.phone, area: lead.area || '', category: lead.category || '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try { await onEdit({ id: lead.sourceContactId, ...lead }, form); setEditing(false); }
    catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${lead.business}? This removes the lead from the call agents’ queues.`)) return;
    await onDelete({ id: lead.sourceContactId, business: lead.business });
  };
  return <>
    <div className="distribution-row shared-lead-row"><div><b>{lead.business}</b><small>{lead.phone}</small></div><div className="shared-lead-actions"><button className="secondary-button" type="button" onClick={() => { setForm({ business: lead.business, phone: lead.phone, area: lead.area || '', category: lead.category || '' }); setEditing(true); }}><Pencil size={13} /> Edit</button><button className="my-lead-delete" type="button" onClick={remove}><Trash2 size={13} /> Delete</button></div></div>
    {editing && <div className="modal-backdrop" role="presentation"><section className="add-modal contact-edit-modal" role="dialog" aria-modal="true" aria-labelledby={`shared-lead-${lead.sourceContactId}`}><div className="modal-head"><div><div className="section-eyebrow">SHARED LEAD</div><h2 id={`shared-lead-${lead.sourceContactId}`}>Edit contact</h2></div><button className="icon-button" type="button" aria-label="Close edit contact" onClick={() => setEditing(false)}><X size={17} /></button></div><form onSubmit={submit}><div className="form-grid"><label className="full-field">Business name<input maxLength={200} required value={form.business} onChange={(event) => setForm((current) => ({ ...current, business: event.target.value }))} /></label><label>Phone number<input maxLength={80} required value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label><label>Business type<input maxLength={120} value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} /></label><label className="full-field">Area<input maxLength={160} value={form.area} onChange={(event) => setForm((current) => ({ ...current, area: event.target.value }))} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit" disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save changes'}</button></div></form></section></div>}
  </>;
}

const REPORT_COLUMNS = ['Date', 'Business', 'Contact', 'Notes', 'Status'];
const formatReportData = (data) => (data || []).map((row) => row.length >= 8
  ? [row[0], row[1], row[2], row[6], row[7]]
  : row.slice(0, REPORT_COLUMNS.length));
const createReportSheet = () => [REPORT_COLUMNS, ...Array.from({ length: 20 }, () => Array(REPORT_COLUMNS.length).fill(''))];
const columnLabel = (index) => String.fromCharCode(65 + index);

function ReportsPage() {
  const [report, setReport] = useState(null);
  const [reportDay, setReportDay] = useState('');
  const [title, setTitle] = useState('Daily call report');
  const [cells, setCells] = useState(createReportSheet);
  const [activeCell, setActiveCell] = useState({ row: 0, column: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    apiRequest('/reports').then(({ report: todayReport, today }) => {
      if (!current) return;
      setReportDay(today);
      if (todayReport) {
        setReport(todayReport);
        setTitle(todayReport.title);
        setCells(formatReportData(todayReport.data));
      }
    }).catch((loadError) => {
      if (current) setError(loadError.message);
    }).finally(() => { if (current) setIsLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!reportDay) return undefined;
    const refreshAtDayChange = () => {
      apiRequest('/reports').then(({ report: todayReport, today }) => {
        if (today === reportDay) return;
        setReportDay(today);
        setReport(todayReport);
        setTitle(todayReport?.title || 'Daily call report');
        setCells(todayReport ? formatReportData(todayReport.data) : createReportSheet());
        setIsEditing(false);
        setShowSaved(false);
        setError('');
      }).catch(() => {});
    };
    const interval = window.setInterval(refreshAtDayChange, 30_000);
    return () => window.clearInterval(interval);
  }, [reportDay]);

  const openSheet = () => {
    setTitle(report?.title || 'Daily call report');
    setCells(report ? formatReportData(report.data) : createReportSheet());
    setActiveCell({ row: 0, column: 0 });
    setError('');
    setIsEditing(true);
  };
  const closeSheet = () => {
    setIsEditing(false);
    setError('');
    if (report) {
      setTitle(report.title);
      setCells(formatReportData(report.data));
    } else {
      setTitle('Daily call report');
      setCells(createReportSheet());
    }
  };
  const editCell = (rowIndex, columnIndex, value) => {
    setCells((current) => current.map((row, index) => index === rowIndex
      ? row.map((cell, cellIndex) => cellIndex === columnIndex ? value : cell)
      : row));
  };
  const saveReport = async () => {
    if (!title.trim() || isSaving) { setError('Give this report a name before saving.'); return; }
    setIsSaving(true);
    setError('');
    try {
      const { report: savedReport } = await apiRequest('/reports', {
        method: 'POST',
        body: JSON.stringify({ title, data: cells, workDate: reportDay }),
      });
      setReport(savedReport);
      setTitle(savedReport.title);
      setCells(formatReportData(savedReport.data));
      setIsEditing(false);
      setShowSaved(true);
    } catch (saveError) {
      setError(saveError.message);
      if (saveError.code === 'report_day_ended') {
        apiRequest('/reports').then(({ report: todayReport, today }) => {
          setReportDay(today);
          setReport(todayReport);
          setTitle(todayReport?.title || 'Daily call report');
          setCells(todayReport ? formatReportData(todayReport.data) : createReportSheet());
          setIsEditing(false);
        }).catch(() => {});
      }
    } finally {
      setIsSaving(false);
    }
  };
  const sendReport = async () => {
    if (!report?.id || isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const { report: sentReport } = await apiRequest(`/reports/${report.id}/send`, { method: 'POST' });
      setReport(sentReport);
      setShowSaved('sent');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setIsSaving(false);
    }
  };
  const deleteAndStartNew = async () => {
    if (!report?.id || isSaving) return;
    const sentWarning = report.submittedAt ? ' It will also be removed from the admin reports list.' : '';
    if (!window.confirm(`Delete today’s report and start a new sheet? This cannot be undone.${sentWarning}`)) return;
    setIsSaving(true);
    setError('');
    try {
      await apiRequest(`/reports/${report.id}`, { method: 'DELETE' });
      setReport(null);
      setTitle('Daily call report');
      setCells(createReportSheet());
      setActiveCell({ row: 0, column: 0 });
      setIsEditing(true);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setIsSaving(false);
    }
  };
  const addRows = () => {
    setCells((current) => [...current, ...Array.from({ length: 10 }, () => Array(REPORT_COLUMNS.length).fill(''))].slice(0, 201));
  };
  const activeValue = cells[activeCell.row]?.[activeCell.column] || '';

  return <div className="reports-page">
    <PageHeading kicker="CALL AGENT WORKSPACE" title="Reports" description="Keep one daily report and update it throughout your shift." action={isEditing && <div className="report-page-actions"><button className="secondary-button" type="button" onClick={closeSheet}>Close sheet</button><button className="primary-button" type="button" onClick={saveReport} disabled={isSaving}><Save size={14} /> {isSaving ? 'Saving…' : 'Save report'}</button></div>} />
    {error && !isEditing && <p className="form-error" role="alert">{error}</p>}
    {isLoading ? <section className="report-daily-card"><div className="workbook-loading">Loading today’s report…</div></section> : isEditing ? <section className="report-workbook" aria-label="Today’s report spreadsheet">
      <div className="workbook-titlebar"><FileSpreadsheet size={18} /><input aria-label="Report name" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /><span className="workbook-save-state">Today’s report</span></div>
      <div className="workbook-toolbar"><span className="report-sheet-day">SHEET · TODAY</span><span className="workbook-tool-divider" /><button type="button" onClick={addRows} title="Add 10 rows"><Plus size={14} /> Add rows</button>{error && <span className="report-inline-error" role="alert">{error}</span>}</div>
      <div className="formula-bar"><span className="cell-reference">{columnLabel(activeCell.column)}{activeCell.row + 1}</span><span className="formula-mark">fx</span><input aria-label="Selected cell value" value={activeValue} onChange={(event) => editCell(activeCell.row, activeCell.column, event.target.value)} /></div>
      <div className="spreadsheet-scroll"><table className="spreadsheet-grid"><thead><tr><th className="row-number-heading" aria-label="Row number" />{REPORT_COLUMNS.map((column, index) => <th key={column} className="column-letter">{columnLabel(index)}</th>)}</tr></thead><tbody>{cells.map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? 'sheet-header-row' : ''}><th className="row-number">{rowIndex + 1}</th>{REPORT_COLUMNS.map((column, columnIndex) => <td key={column} className={activeCell.row === rowIndex && activeCell.column === columnIndex ? 'selected-cell' : ''}><input aria-label={`Row ${rowIndex + 1}, ${column}`} value={row[columnIndex] || ''} onFocus={() => setActiveCell({ row: rowIndex, column: columnIndex })} onChange={(event) => editCell(rowIndex, columnIndex, event.target.value)} /></td>)}</tr>)}</tbody></table></div>
      <div className="workbook-bottom"><div className="sheet-tab"><span>▦</span> Today</div><span className="sheet-hint">{cells.length - 1} entry rows · {REPORT_COLUMNS.length} columns</span><span className="sheet-status">Save as a draft, then send it to your admin</span></div>
    </section> : <section className="report-daily-card">
      <span className="daily-report-icon"><FileSpreadsheet size={22} /></span>
      <div className="daily-report-copy"><span className="section-eyebrow">TODAY’S REPORT · {report?.submittedAt ? 'SENT' : report ? 'DRAFT' : 'NOT STARTED'}</span><h2>{report?.title || 'No report saved today'}</h2><p>{report ? `Last saved ${formatClockTime(report.updatedAt)}. You can continue editing until the day ends.` : 'Open today’s sheet and save it as a draft. You can send it to your admin when it is ready.'}</p></div>
      <div className="daily-report-actions"><button className="secondary-button" type="button" onClick={openSheet}><FileSpreadsheet size={15} /> {report ? 'Edit today’s report' : 'Open today’s sheet'}</button>{report && <><button className="primary-button" type="button" onClick={sendReport} disabled={isSaving || Boolean(report.submittedAt)}><Send size={15} /> {report.submittedAt ? 'Submit' : 'Send report'}</button><ReportSheetMenu onDelete={deleteAndStartNew} disabled={isSaving} /></>}</div>
    </section>}
    {showSaved && <div className="report-saved-backdrop" role="presentation"><section className="report-saved-dialog" role="dialog" aria-modal="true" aria-labelledby="report-saved-title"><span className="report-saved-check"><CheckCheck size={23} /></span><h2 id="report-saved-title">{showSaved === 'sent' ? 'Report sent' : 'Saved'}</h2><p>{showSaved === 'sent' ? 'Your report has been sent to the admin.' : 'Your report is saved as a draft for today. You can edit it or send it when it is ready.'}</p><button className="primary-button" type="button" onClick={() => setShowSaved(false)}>Done</button></section></div>}
  </div>;
}

function AdminReportsPage() {
  const [reports, setReports] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    const refreshReports = () => apiRequest('/admin/reports').then(({ reports: allReports }) => {
      if (!current) return;
      setReports(allReports);
      setSelectedId((selected) => allReports.some((report) => report.id === selected) ? selected : (allReports[0]?.id || ''));
      setError('');
    }).catch((loadError) => {
      if (current) setError(loadError.message);
    }).finally(() => { if (current) setIsLoading(false); });
    refreshReports();
    const interval = window.setInterval(refreshReports, 10_000);
    return () => { current = false; window.clearInterval(interval); };
  }, []);
  const selected = reports.find((report) => report.id === selectedId);
  const entryCount = (report) => (report.data || []).slice(1).filter((row) => row.some((cell) => String(cell || '').trim())).length;

  return <div className="admin-reports-page">
    <PageHeading kicker="TEAM WORKSPACE" title="Agent reports" description="Browse reports sent by your call agents and review each spreadsheet." />
    <section className="panel admin-reports-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">SUBMITTED REPORTS</div><h2>Call agent reports</h2></div><span className="count-chip">{isLoading ? 'Loading' : `${reports.length} report${reports.length === 1 ? '' : 's'}`}</span></div>
      {error && <div className="empty-state" role="alert">{error}</div>}
      {!isLoading && !error && reports.length === 0 && <div className="admin-reports-empty"><span className="admin-reports-empty-icon"><FileSpreadsheet size={22} /></span><div><b>No reports submitted yet</b><p>Reports will appear here after a call agent submits a saved sheet.</p></div><span className="admin-reports-empty-mark">—</span></div>}
      {reports.length > 0 && <div className="admin-report-list">{reports.map((report) => <button type="button" className={`admin-report-row${report.id === selectedId ? ' selected' : ''}`} key={report.id} onClick={() => setSelectedId(report.id)} aria-pressed={report.id === selectedId}>
        <span className="admin-report-file"><FileSpreadsheet size={17} /></span><span className="admin-report-title"><b>{report.title}</b><small>{formatWorkDate(report.workDate)} · {entryCount(report)} filled row{entryCount(report) === 1 ? '' : 's'}</small></span><span className="admin-report-agent"><b>{report.staffName}</b><small>{report.staffEmail}</small></span><span className="admin-report-date">Updated {formatClockTime(report.updatedAt)}</span><ArrowRight size={15} />
      </button>)}</div>}
    </section>
    {selected && <section className="report-workbook admin-report-preview" aria-label={`${selected.title} submitted by ${selected.staffName}`}>
      <div className="workbook-titlebar"><FileSpreadsheet size={18} /><strong>{selected.title}</strong><span className="workbook-save-state">Submitted by {selected.staffName}</span></div>
      <div className="admin-report-meta"><span>{selected.staffEmail}</span><span>Report day {formatWorkDate(selected.workDate)} · Updated {formatClockTime(selected.updatedAt)}</span></div>
      <div className="spreadsheet-scroll"><table className="spreadsheet-grid"><thead><tr><th className="row-number-heading" aria-label="Row number" />{REPORT_COLUMNS.map((column, index) => <th key={column} className="column-letter">{columnLabel(index)}</th>)}</tr></thead><tbody>{formatReportData(selected.data).map((row, rowIndex) => <tr key={rowIndex} className={rowIndex === 0 ? 'sheet-header-row' : ''}><th className="row-number">{rowIndex + 1}</th>{REPORT_COLUMNS.map((column, columnIndex) => <td key={column}><div className="report-preview-cell" aria-label={`Row ${rowIndex + 1}, ${column}`}>{row[columnIndex] || ''}</div></td>)}</tr>)}</tbody></table></div>
      <div className="workbook-bottom"><div className="sheet-tab"><span>▦</span> Report 1</div><span className="sheet-hint">{entryCount(selected)} filled rows</span><span className="sheet-status">Submitted by {selected.staffName}</span></div>
    </section>}
  </div>;
}

function TeamApprovals({ staff, onApprove, onDeny, onDelete, onRoleChange, onSetActive }) {
  const [inactiveOpen, setInactiveOpen] = useState(false);
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
    {inactive.length > 0 && <section className="panel simple-team-panel inactive-team-panel">
      <button className="inactive-team-toggle" type="button" aria-expanded={inactiveOpen} onClick={() => setInactiveOpen((open) => !open)}>
        <span><span className="section-eyebrow">INACTIVE ACCOUNTS</span><strong>Deactivated staff</strong></span>
        <span className="inactive-team-toggle-meta"><span className="count-chip">{inactive.length}</span><ChevronDown size={17} className={inactiveOpen ? 'is-expanded' : ''} /></span>
      </button>
      {inactiveOpen && inactive.map((person) => accountRow(person, false))}
    </section>}
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

function MyLeadsPage({ contacts, onEditContact, onDeleteContact }) {
  const [editingContact, setEditingContact] = useState(null);
  const [editForm, setEditForm] = useState({ business: '', phone: '', category: '', area: '' });
  const [editError, setEditError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const todayContacts = contacts.filter((contact) => workDateKey(contact.workDate) === today());
  const previousContacts = contacts.length - todayContacts.length;
  const startEdit = (contact) => {
    setEditingContact(contact);
    setEditForm({ business: contact.business, phone: contact.phone, category: contact.category || '', area: contact.area || '' });
    setEditError('');
  };
  const saveEdit = async (event) => {
    event.preventDefault();
    if (isSaving || !editingContact) return;
    setIsSaving(true);
    setEditError('');
    try {
      await onEditContact(editingContact, editForm);
      setEditingContact(null);
    } catch (error) {
      setEditError(error.message);
    } finally {
      setIsSaving(false);
    }
  };
  const deleteContact = async (contact) => {
    if (!window.confirm(`Delete ${contact.business}? This cannot be undone.`)) return;
    try { await onDeleteContact(contact); }
    catch { /* The workspace displays the server error toast. */ }
  };
  return <>
    <PageHeading kicker="YOUR SAVED CONTACTS" title="My leads" description="Manage your own submitted contacts and review your saved history." />
    <div className="lead-submission-metrics">
      <Metric icon={BriefcaseBusiness} label="Saved contacts" value={contacts.length} note="All your submitted leads" />
      <Metric icon={Clock3} label="Saved today" value={todayContacts.length} note="Your submissions for today" tone="metric-coral" />
      <Metric icon={CheckCheck} label="Previous days" value={previousContacts} note="Your saved submission history" tone="metric-green" />
    </div>
    <section className="panel my-leads-panel">
      <div className="panel-heading"><div><div className="section-eyebrow">SUBMISSION HISTORY</div><h2>Saved contacts</h2></div><span className="count-chip">{contacts.length} contacts</span></div>
      {contacts.length ? <div className="my-leads-list">{contacts.map((contact) => {
        return <article className="my-lead-row" key={contact.id}>
          <div className="my-lead-copy"><b>{contact.business}</b><span>{contact.phone}</span><small>{[formatWorkDate(contact.workDate), contact.category, contact.area].filter(Boolean).join(' · ') || 'No category or area added'}</small></div>
          <div className="my-lead-row-end"><span className="submission-status waiting"><i />Saved submission</span>{workDateKey(contact.workDate) === today() && contact.canEdit && <div className="my-lead-actions"><button className="secondary-button" type="button" onClick={() => startEdit(contact)} aria-label={`Edit ${contact.business}`}><Pencil size={13} /> Edit</button><button className="my-lead-delete" type="button" onClick={() => deleteContact(contact)} aria-label={`Delete ${contact.business}`}><Trash2 size={13} /> Delete</button></div>}</div>
        </article>;
      })}</div> : <div className="empty-state">You have not submitted any contacts yet. Find contacts and submit a list for admin review.</div>}
    </section>
    {editingContact && <div className="modal-backdrop" role="presentation"><section className="add-modal contact-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title"><div className="modal-head"><div><div className="section-eyebrow">TODAY’S CONTACT</div><h2 id="edit-contact-title">Edit saved contact</h2></div><button className="icon-button" type="button" aria-label="Close edit contact" onClick={() => setEditingContact(null)}><X size={17} /></button></div><p className="contact-edit-note">Only contacts still in your saved list can be changed.</p><form onSubmit={saveEdit}><div className="form-grid"><label className="full-field">Business name<input maxLength={200} required value={editForm.business} onChange={(event) => setEditForm((form) => ({ ...form, business: event.target.value }))} /></label><label>Phone number<input maxLength={80} required value={editForm.phone} onChange={(event) => setEditForm((form) => ({ ...form, phone: event.target.value }))} /></label><label>Business type<input maxLength={120} value={editForm.category} onChange={(event) => setEditForm((form) => ({ ...form, category: event.target.value }))} /></label><label className="full-field">Area<input maxLength={160} value={editForm.area} onChange={(event) => setEditForm((form) => ({ ...form, area: event.target.value }))} /></label></div>{editError && <p className="form-error" role="alert">{editError}</p>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEditingContact(null)} disabled={isSaving}>Cancel</button><button className="primary-button" type="submit" disabled={isSaving}><Save size={14} />{isSaving ? 'Saving…' : 'Save changes'}</button></div></form></section></div>}
  </>;
}

function ContactGenerator({ user, shift, elapsed, saved = 0, onClockIn, onClockOut, onSave }) {
  const [pastedContacts, setPastedContacts] = useState('');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [submissionSent, setSubmissionSent] = useState(false);
  const clockedIn = Boolean(shift?.startedAt);
  const mapQuery = [category, area].filter(Boolean).join(' ');
  const submit = async (event) => {
    event.preventDefault();
    const rows = pastedContacts.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((part) => part.trim()));
    const entries = rows.filter((row) => row[0] && row[1] && !/business\s*name/i.test(row[0])).map(([business, phone], index) => ({ id: `contact-${Date.now()}-${index}`, business, phone, area: area.trim(), category: category.trim(), mapQuery, generatorId: user.id, workDate: today() }));
    if (!entries.length) { setError('Paste at least one business name and phone number.'); return; }
    try { await onSave(entries); setSubmissionSent(true); }
    catch (saveError) { setError(saveError.message); return; }
    setPastedContacts('');
    setError('');
  };
  return <><PageHeading kicker={formatShortDate().toUpperCase()} title={`Find businesses, ${user.name.split(' ')[0]}.`} description="Search Maps, then paste multiple business names and phone numbers for admin approval." action={<span className={`shift-indicator ${clockedIn ? 'on' : ''}`}><i />{clockedIn ? 'Shift in progress' : 'Shift not started'}</span>} /><section className="generator-clock"><div><span>TIME TODAY</span><b>{formatDuration(elapsed)}</b></div><button className="primary-button" onClick={clockedIn ? onClockOut : onClockIn}>{clockedIn ? 'Clock out' : 'Clock in'}</button></section><section className="generator-layout"><div className="panel generator-form-panel"><div className="section-eyebrow">1 · SEARCH MAPS</div><h2>Find local businesses</h2><p>Search by business type and area. Use the map listings to collect business names and phone numbers.</p><div className="generator-fields"><label>Business type<input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. dentists, cafes" /></label><label>Area or city<input value={area} onChange={(event) => setArea(event.target.value)} placeholder="e.g. East Oakland" /></label></div><a className={`maps-search-link ${mapQuery ? '' : 'disabled'}`} href={mapQuery ? `https://www.google.com/maps/search/${encodeURIComponent(mapQuery)}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!mapQuery}><Search size={15} /> Search Google Maps <ArrowUpRight size={14} /></a><div className="section-eyebrow capture-kicker">2 · ADD CONTACTS</div><form onSubmit={submit} className="generator-batch-form"><label className="generator-batch-label" htmlFor="generator-contacts">BUSINESS NAME, PHONE NUMBER<textarea id="generator-contacts" rows="8" value={pastedContacts} onChange={(event) => { setPastedContacts(event.target.value); setError(''); setSubmissionSent(false); }} placeholder={'Northline Coffee, +1 415 555 0142\nMorrow Dental, +1 415 555 0176'} /></label><p className="bulk-hint">One business per line. You can paste two columns directly from a spreadsheet.</p>{error && <p className="form-error">{error}</p>}{submissionSent && <p className="duplicate-check-success" role="status">Submitted to admin for review.</p>}<button className="primary-button generator-save" type="submit"><Plus size={15} /> Submit leads for approval</button></form></div><aside className="generator-side"><div className="generator-count"><span>CONTACTS SAVED</span><b>{saved}</b><small>Review your saved history in My leads</small></div><div className="generator-tip"><MapPin size={17} /><b>Keep it simple</b><p>Only save business names and public phone numbers. Your admin will review and assign the calls.</p></div></aside></section></>;
}
