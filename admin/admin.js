// =====================================================================
// CashGee — Admin Dashboard
//
// Create login accounts, review payment proofs, and monitor yearly
// yearly subscriptions. Talks to the same Supabase project as the app.
// Every table is protected by row-level security: only accounts with
// role = 'admin' in `profiles` can see other users' data.
// =====================================================================

const cfg = window.CASHG_CONFIG || {};
const hasConfig = Boolean(
    cfg.supabaseUrl && cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes('YOUR-PROJECT') && !cfg.supabaseAnonKey.includes('YOUR-')
);
const sb = hasConfig && window.supabase
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cashg-admin-auth' }
    })
    : null;

const DAY_MS = 86400000;
const EXPIRING_DAYS = 7;
const PLAN_LABELS = new Proxy({ yearly: 'Yearly', trial: 'Trial' }, { get: (labels, plan) => labels[plan] ?? 'Plan' });
const METHOD_LABELS = { gcash: 'GCash', bank: 'Bank Transfer' };
const VIEW_TITLES = {
    overview: 'Overview',
    accounts: 'Accounts',
    payments: 'Payments',
    subscriptions: 'Subscriptions',
    notifications: 'Notifications',
    settings: 'Settings'
};

// Announcement kinds use the same types as the app's bell
const ANNOUNCE_KINDS = {
    info: { label: 'Announcement', icon: 'megaphone' },
    success: { label: 'Update', icon: 'check' },
    warning: { label: 'Reminder', icon: 'clock' },
    error: { label: 'Urgent', icon: 'alert' }
};
const AUDIENCE_LABELS = {
    all: 'All users',
    active: 'Active plan',
    expired: 'Expired plan',
    no_plan: 'Never had a plan'
};

const state = {
    me: null,
    profiles: [],
    subscriptions: [],
    requests: [],
    settings: null,
    announcements: [],
    announcementReads: {},    // announcement id -> number of users who opened it
    announcementsReady: true, // false until the announcements SQL has been run
    announceType: 'info',
    view: 'overview',
    accountFilter: 'all',
    accountSearch: '',
    paymentFilter: 'pending',
    subPlanFilter: 'all',
    subStatusFilter: 'all',
    loadedAt: null
};

// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------

const $ = id => document.getElementById(id);

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function icon(name) {
    return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function peso(value) {
    return '₱' + Number(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
}

function fmtDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function daysUntil(value) {
    return Math.ceil((Date.parse(value) - Date.now()) / DAY_MS);
}

function unwrap({ data, error }) {
    if (error) throw error;
    return data;
}

function errorText(error) {
    const message = error?.message || String(error || '');
    if (/failed to fetch|network/i.test(message)) return 'No internet connection.';
    return message || 'Something went wrong.';
}

let toastTimer = null;
function toast(message, type = 'success') {
    const el = $('toast');
    el.className = `toast toast-${type}`;
    el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}

function setBusy(button, busy) {
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
}

function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint32Array(10));
    return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
    } catch {
        toast('Could not copy. Please copy it manually.', 'error');
    }
}

// Calls the admin-users Edge Function (account actions need the service key)
async function adminUsers(body) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) {
        let message = error.message;
        try {
            const details = await error.context?.json?.();
            if (details?.error) message = details.error;
        } catch { /* keep generic message */ }
        throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
}

// ---------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------

function profileById(id) {
    return state.profiles.find(p => p.id === id) || null;
}

function subsForUser(userId) {
    return state.subscriptions.filter(s => s.user_id === userId);
}

// Where a user's access stands right now
function accessFor(profile) {
    const subs = subsForUser(profile.id);
    const now = Date.now();
    const current = subs.find(s => Date.parse(s.starts_at) <= now && Date.parse(s.ends_at) > now) || null;
    const endsAt = subs.reduce((max, s) => Math.max(max, Date.parse(s.ends_at)), 0);

    let status = 'none';
    if (profile.status === 'disabled') status = 'disabled';
    else if (current) status = daysUntil(endsAt) <= EXPIRING_DAYS ? 'expiring' : 'active';
    else if (subs.length) status = 'expired';

    return {
        status,
        plan: current?.plan || null,
        lastPlan: subs.slice().sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at))[0]?.plan || null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        daysLeft: endsAt ? daysUntil(endsAt) : null
    };
}

function subscriptionPhase(sub) {
    const now = Date.now();
    if (Date.parse(sub.starts_at) > now) return 'upcoming';
    if (Date.parse(sub.ends_at) <= now) return 'ended';
    return 'current';
}

const STATUS_LABELS = {
    active: 'Active',
    expiring: 'Expiring',
    expired: 'Expired',
    none: 'No plan',
    disabled: 'Disabled',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    current: 'Current',
    upcoming: 'Upcoming',
    ended: 'Ended'
};

function chip(status) {
    return `<span class="chip chip-${status}">${STATUS_LABELS[status] || esc(status)}</span>`;
}

function personCell(profile, fallbackName = '') {
    const name = profile?.full_name || fallbackName || profile?.email || 'Unknown';
    const sub = profile?.business_name || profile?.email || '';
    return `
        <div class="person">
            <span class="avatar">${esc(name.charAt(0).toUpperCase())}</span>
            <div><strong>${esc(name)}</strong><small>${esc(sub)}</small></div>
        </div>`;
}

function emptyRow(cols, text) {
    return `<tr class="empty-row"><td colspan="${cols}">${esc(text)}</td></tr>`;
}

// ---------------------------------------------------------------------
// Sign in / out
// ---------------------------------------------------------------------

const SAVED_LOGIN_KEY = 'cashg-admin-saved-login';

function loadSavedCredentials() {
    try {
        const raw = localStorage.getItem(SAVED_LOGIN_KEY);
        if (!raw) return null;
        let parsed;
        try {
            parsed = JSON.parse(decodeURIComponent(escape(atob(raw))));
        } catch {
            parsed = JSON.parse(raw);
        }
        if (parsed && typeof parsed.email === 'string' && typeof parsed.password === 'string') {
            return parsed;
        }
    } catch { /* ignore corrupted */ }
    return null;
}

function storeSavedCredentials(email, password) {
    try {
        const payload = JSON.stringify({ email, password, savedAt: Date.now() });
        const encoded = btoa(unescape(encodeURIComponent(payload)));
        localStorage.setItem(SAVED_LOGIN_KEY, encoded);
    } catch { /* storage full or blocked */ }
}

function clearSavedCredentials() {
    try {
        localStorage.removeItem(SAVED_LOGIN_KEY);
    } catch { /* ignore */ }
}

function populateSavedCredentials() {
    const emailInput = $('loginEmail');
    const passInput = $('loginPassword');
    const rememberBox = $('loginRemember');
    const clearBtn = $('loginClearSaved');
    if (!emailInput || !passInput || !rememberBox) return;

    const saved = loadSavedCredentials();
    if (saved?.email && saved?.password) {
        emailInput.value = saved.email;
        passInput.value = saved.password;
        rememberBox.checked = true;
        if (clearBtn) clearBtn.hidden = false;
    } else {
        rememberBox.checked = false;
        if (clearBtn) clearBtn.hidden = true;
    }
}

function handleClearSavedPassword() {
    clearSavedCredentials();
    const passInput = $('loginPassword');
    const rememberBox = $('loginRemember');
    const clearBtn = $('loginClearSaved');
    if (passInput) passInput.value = '';
    if (rememberBox) rememberBox.checked = false;
    if (clearBtn) clearBtn.hidden = true;
    if (passInput) passInput.focus();
}

function togglePasswordVisibility() {
    const input = $('loginPassword');
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    this.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    this.classList.toggle('is-showing', !showing);
}

async function init() {
    wireEvents();

    if (!sb) {
        $('loginSetup').hidden = !!hasConfig;
        showLogin(hasConfig ? 'No internet connection. Please reload.' : '');
        if (!hasConfig) $('loginForm').querySelectorAll('input, button').forEach(el => { el.disabled = true; });
        return;
    }

    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
        await enterDashboard(data.session.user);
    } else {
        showLogin();
    }

    sb.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT' && state.me) {
            state.me = null;
            showLogin('You have been signed out.');
        }
    });
}

function showLogin(message = '') {
    $('shell').hidden = true;
    $('loginScreen').hidden = false;
    $('loginError').textContent = message;
    $('loginError').hidden = !message;
    populateSavedCredentials();
    setTimeout(() => {
        const emailInput = $('loginEmail');
        const passInput = $('loginPassword');
        if (emailInput?.value && passInput?.value) {
            $('loginSubmit')?.focus();
        } else if (emailInput?.value && passInput) {
            passInput.focus();
        } else if (emailInput) {
            emailInput.focus();
        }
    }, 50);
}

async function handleLogin(event) {
    event.preventDefault();
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const button = $('loginSubmit');
    const remember = $('loginRemember')?.checked;

    if (!email || !password) {
        showLogin('Enter your email and password.');
        return;
    }

    setBusy(button, true);
    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (remember) {
            storeSavedCredentials(email, password);
        } else {
            clearSavedCredentials();
        }
        $('loginPassword').value = '';
        await enterDashboard(data.user);
    } catch (error) {
        showLogin(/invalid login/i.test(error.message) ? 'Wrong email or password.' : errorText(error));
    } finally {
        setBusy(button, false);
    }
}

async function enterDashboard(user) {
    let profile = null;
    try {
        profile = unwrap(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
    } catch (error) {
        showLogin(errorText(error));
        return;
    }

    if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
        await sb.auth.signOut();
        showLogin('This account is not an admin. Use the CashGee app to sign in as a user.');
        return;
    }

    state.me = profile;
    $('meEmail').textContent = profile.email || user.email;
    $('loginScreen').hidden = true;
    $('shell').hidden = false;
    await loadAll();
}

async function signOut() {
    if (!confirm('Sign out of the admin dashboard?')) return;
    state.me = null;
    await sb.auth.signOut();
    showLogin();
}

// ---------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------

async function loadAll({ quiet = false } = {}) {
    const button = $('refreshBtn');
    setBusy(button, true);
    try {
        const [profiles, subscriptions, requests, settings] = await Promise.all([
            sb.from('profiles').select('*').order('created_at', { ascending: false }).then(unwrap),
            sb.from('subscriptions').select('*').order('starts_at', { ascending: false }).then(unwrap),
            sb.from('subscription_requests').select('*').order('created_at', { ascending: false }).then(unwrap),
            sb.from('app_settings').select('*').eq('id', 1).maybeSingle().then(unwrap)
        ]);
        state.profiles = profiles || [];
        state.subscriptions = subscriptions || [];
        state.requests = requests || [];
        state.settings = settings;
        await loadAnnouncements();
        state.loadedAt = new Date();
        renderAll();
        $('lastUpdated').textContent = `Updated ${state.loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } catch (error) {
        if (!quiet) toast(`Could not load data: ${errorText(error)}`, 'error');
    } finally {
        setBusy(button, false);
    }
}

// Loaded on its own so the rest of the dashboard still works before the
// announcements table exists
async function loadAnnouncements() {
    try {
        const [announcements, reads] = await Promise.all([
            sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(200).then(unwrap),
            sb.from('notifications').select('announcement_id')
                .not('announcement_id', 'is', null).not('read_at', 'is', null).then(unwrap)
        ]);
        state.announcements = announcements || [];
        state.announcementReads = {};
        (reads || []).forEach(r => {
            state.announcementReads[r.announcement_id] = (state.announcementReads[r.announcement_id] || 0) + 1;
        });
        state.announcementsReady = true;
    } catch (error) {
        state.announcements = [];
        state.announcementReads = {};
        state.announcementsReady = !/announcement/i.test(errorText(error));
        if (state.announcementsReady) console.warn('Could not load announcements', error);
    }
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderAll() {
    const pending = state.requests.filter(r => r.status === 'pending').length;
    $('navPendingCount').textContent = pending;
    $('navPendingCount').hidden = pending === 0;
    $('pendingChipCount').textContent = pending ? pending : '';

    renderOverview();
    renderAccounts();
    renderPayments();
    renderSubscriptions();
    renderAnnouncements();
    renderSettings();
}

function statCard(label, value, sub, tone = '') {
    return `
        <div class="stat ${tone}">
            <small>${esc(label)}</small>
            <strong>${value}</strong>
            ${sub ? `<span>${sub}</span>` : ''}
        </div>`;
}

function revenueSince(date) {
    return state.subscriptions
        .filter(s => Date.parse(s.created_at) >= date.getTime())
        .reduce((sum, s) => sum + Number(s.amount || 0), 0);
}

function renderOverview() {
    const users = state.profiles.filter(p => p.role !== 'admin');
    const access = users.map(p => ({ profile: p, ...accessFor(p) }));
    const activeCount = access.filter(a => a.status === 'active' || a.status === 'expiring').length;
    const yearlyActive = access.filter(a => a.plan === 'yearly').length;
    const pending = state.requests.filter(r => r.status === 'pending');
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    $('overviewStats').innerHTML =
        statCard('Accounts', users.length, `${access.filter(a => a.status === 'none').length} without a plan`) +
        statCard('Active subscriptions', activeCount, `${yearlyActive} yearly`, 'tone-green') +
        statCard('Payments to review', pending.length, pending.length ? 'Waiting for approval' : 'All caught up', pending.length ? 'tone-amber' : '') +
        statCard('Revenue this month', peso(revenueSince(monthStart)), `${peso(revenueSince(yearStart))} this year`);

    $('overviewPending').innerHTML = pending.length
        ? `<div class="mini-list">${pending.slice(0, 6).map(r => `
            <button type="button" class="mini-row" onclick="openPayment('${r.id}')">
                ${personCell(profileById(r.user_id), r.full_name)}
                <span class="mini-meta"><strong>${peso(r.amount)}</strong><small>${PLAN_LABELS[r.plan]} · ${fmtDate(r.created_at)}</small></span>
            </button>`).join('')}</div>`
        : '<p class="empty">No payments waiting. All caught up.</p>';

    const expiring = access
        .filter(a => a.status === 'expiring')
        .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
    $('overviewExpiring').innerHTML = expiring.length
        ? `<div class="mini-list">${expiring.slice(0, 6).map(a => `
            <button type="button" class="mini-row" onclick="openAccount('${a.profile.id}')">
                ${personCell(a.profile)}
                <span class="mini-meta"><strong>${a.daysLeft <= 1 ? 'Today' : `${a.daysLeft} days`}</strong><small>${PLAN_LABELS[a.plan]} · ${fmtDate(a.endsAt)}</small></span>
            </button>`).join('')}</div>`
        : '<p class="empty">No subscriptions ending this week.</p>';
}

function renderAccounts() {
    const q = state.accountSearch.toLowerCase();
    const rows = state.profiles
        .filter(p => p.role !== 'admin')
        .map(p => ({ p, a: accessFor(p) }))
        .filter(({ p, a }) => state.accountFilter === 'all' || a.status === state.accountFilter)
        .filter(({ p }) => !q || [p.full_name, p.email, p.phone, p.business_name].some(v => (v || '').toLowerCase().includes(q)));

    $('accountsBody').innerHTML = rows.length ? rows.map(({ p, a }) => `
        <tr class="clickable" onclick="openAccount('${p.id}')">
            <td data-label="Account">${personCell(p)}</td>
            <td data-label="Contact"><div class="stack"><span>${esc(p.email || '')}</span><small>${esc(p.phone || '—')}</small></div></td>
            <td data-label="Plan">${a.plan ? PLAN_LABELS[a.plan] : (a.lastPlan ? `<span class="muted">${PLAN_LABELS[a.lastPlan]}</span>` : '<span class="muted">—</span>')}</td>
            <td data-label="Valid until">${a.endsAt ? `${fmtDate(a.endsAt)}${a.daysLeft > 0 ? `<small class="block muted">${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left</small>` : ''}` : '<span class="muted">—</span>'}</td>
            <td data-label="Status">${chip(a.status)}</td>
            <td data-label="Joined">${fmtDate(p.created_at)}</td>
        </tr>`).join('')
        : emptyRow(6, state.profiles.length ? 'No accounts match.' : 'No accounts yet. Click “New Account” to create one.');
}

function renderPayments() {
    const rows = state.requests.filter(r => state.paymentFilter === 'all' || r.status === state.paymentFilter);
    $('paymentsBody').innerHTML = rows.length ? rows.map(r => `
        <tr class="clickable" onclick="openPayment('${r.id}')">
            <td data-label="Submitted">${fmtDateTime(r.created_at)}</td>
            <td data-label="Customer">${personCell(profileById(r.user_id), r.full_name)}</td>
            <td data-label="Plan">${PLAN_LABELS[r.plan]}</td>
            <td data-label="Amount"><strong>${peso(r.amount)}</strong></td>
            <td data-label="Method · Ref">${METHOD_LABELS[r.payment_method] || 'GCash'} · <code>${esc(r.payment_reference)}</code></td>
            <td data-label="Status">${chip(r.status)}</td>
        </tr>`).join('')
        : emptyRow(6, state.paymentFilter === 'pending' ? 'No payments waiting for review.' : 'Nothing here yet.');
}

function renderSubscriptions() {
    const current = state.subscriptions.filter(s => subscriptionPhase(s) === 'current');
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    $('subscriptionStats').innerHTML =
        statCard('Yearly (current)', current.filter(s => s.plan === 'yearly').length, `${peso(state.settings?.yearly_price)} / year`, 'tone-green') +
        statCard('Revenue this month', peso(revenueSince(monthStart))) +
        statCard('Revenue this year', peso(revenueSince(yearStart)));

    const rows = state.subscriptions
        .filter(s => state.subPlanFilter === 'all' || s.plan === state.subPlanFilter)
        .filter(s => state.subStatusFilter === 'all' || subscriptionPhase(s) === state.subStatusFilter);

    $('subscriptionsBody').innerHTML = rows.length ? rows.map(s => {
        const phase = subscriptionPhase(s);
        const left = phase === 'current' ? daysUntil(s.ends_at) : null;
        return `
        <tr class="clickable" onclick="openAccount('${s.user_id}')">
            <td data-label="Account">${personCell(profileById(s.user_id))}</td>
            <td data-label="Plan">${PLAN_LABELS[s.plan]}${s.request_id ? '' : ' <small class="muted">(granted)</small>'}</td>
            <td data-label="Amount">${peso(s.amount)}</td>
            <td data-label="Start">${fmtDate(s.starts_at)}</td>
            <td data-label="End">${fmtDate(s.ends_at)}${left !== null ? `<small class="block muted">${left} day${left === 1 ? '' : 's'} left</small>` : ''}</td>
            <td data-label="Status">${chip(phase)}</td>
        </tr>`;
    }).join('') : emptyRow(6, 'No subscriptions match.');
}

// Users an announcement would reach (same rules as admin_send_announcement)
function audienceUsers(audience) {
    return state.profiles
        .filter(p => p.role !== 'admin' && p.status === 'active')
        .filter(p => {
            if (audience === 'all') return true;
            const { status } = accessFor(p);
            if (audience === 'active') return status === 'active' || status === 'expiring';
            if (audience === 'expired') return status === 'expired';
            if (audience === 'no_plan') return status === 'none';
            return false;
        });
}

function renderAnnouncePreview() {
    const kind = ANNOUNCE_KINDS[state.announceType];
    const title = $('announceTitle').value.trim();
    const body = $('announceBody').value.trim();
    $('announcePreview').className = `preview-item preview-${state.announceType}`;
    $('announcePreview').innerHTML = `
        <span class="preview-icon">${icon(kind.icon)}</span>
        <div>
            <strong>${esc(title || 'Your title')}</strong>
            ${body ? `<p>${esc(body)}</p>` : '<p class="muted">Your message</p>'}
            <small>Just now</small>
        </div>`;
    $('announceBodyCount').textContent = `${$('announceBody').value.length} / 1000`;
}

function renderAudienceCount() {
    const count = audienceUsers($('announceAudience').value).length;
    $('announceAudienceCount').textContent = count
        ? `Will reach ${count} user${count === 1 ? '' : 's'}.`
        : 'No users in this group right now.';
}

function renderAnnouncements() {
    renderAnnouncePreview();
    renderAudienceCount();

    const list = $('announcementsList');
    if (!state.announcementsReady) {
        $('announceSentCount').textContent = '';
        list.innerHTML = `
            <div class="setup-note">
                ${icon('alert')}
                <div><strong>One-time setup needed</strong><small>Run the "Announcements" part of <code>supabase/schema.sql</code> in the Supabase SQL Editor, then click Refresh.</small></div>
            </div>`;
        return;
    }

    const items = state.announcements;
    $('announceSentCount').textContent = items.length ? `${items.length} sent` : '';
    list.innerHTML = items.length ? items.map(a => {
        const kind = ANNOUNCE_KINDS[a.type] || ANNOUNCE_KINDS.info;
        const read = state.announcementReads[a.id] || 0;
        return `
        <article class="announce-row">
            <span class="preview-icon preview-${esc(a.type)}">${icon(kind.icon)}</span>
            <div class="announce-main">
                <div class="announce-top">
                    <strong>${esc(a.title)}</strong>
                    <span class="kind-tag kind-tag-${esc(a.type)}">${kind.label}</span>
                </div>
                ${a.body ? `<p>${esc(a.body)}</p>` : ''}
                <small>${fmtDateTime(a.created_at)} · ${AUDIENCE_LABELS[a.audience] || esc(a.audience)} · ${a.recipient_count} recipient${a.recipient_count === 1 ? '' : 's'} · ${read} read</small>
            </div>
            <button type="button" class="icon-btn icon-btn-danger" title="Delete for everyone" aria-label="Delete announcement" onclick="deleteAnnouncement('${a.id}')">${icon('trash')}</button>
        </article>`;
    }).join('') : '<p class="empty">No announcements yet. Your first one will show here.</p>';
}

function setAnnounceType(type) {
    state.announceType = type;
    $('announceType').querySelectorAll('.kind').forEach(b => {
        const on = b.dataset.type === type;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', on);
    });
    renderAnnouncePreview();
}

async function sendAnnouncement(event) {
    event.preventDefault();
    const title = $('announceTitle').value.trim();
    const body = $('announceBody').value.trim();
    const audience = $('announceAudience').value;
    const errorEl = $('announceError');
    const fail = message => { errorEl.textContent = message; errorEl.hidden = false; };

    if (!state.announcementsReady) return fail('Run the Announcements SQL in Supabase first (see the note on the right).');
    if (!title) return fail('Enter a title.');
    const count = audienceUsers(audience).length;
    if (!count) return fail('No users in this group right now.');
    errorEl.hidden = true;

    if (!confirm(`Send "${title}" to ${count} user${count === 1 ? '' : 's'} (${AUDIENCE_LABELS[audience]})?`)) return;

    const button = $('announceSubmit');
    setBusy(button, true);
    try {
        const sent = unwrap(await sb.rpc('admin_send_announcement', {
            p_title: title, p_body: body, p_type: state.announceType, p_audience: audience
        }));
        $('announceForm').reset();
        setAnnounceType('info');
        renderAudienceCount();
        toast(`Sent to ${sent.recipient_count} user${sent.recipient_count === 1 ? '' : 's'}.`);
        await loadAnnouncements();
        renderAnnouncements();
    } catch (error) {
        fail(errorText(error));
    } finally {
        setBusy(button, false);
    }
}

async function deleteAnnouncement(id) {
    const a = state.announcements.find(x => x.id === id);
    if (!a || !confirm(`Delete "${a.title}"? It will disappear from every user's notifications.`)) return;
    try {
        unwrap(await sb.from('announcements').delete().eq('id', id));
        toast('Announcement deleted.');
        await loadAnnouncements();
        renderAnnouncements();
    } catch (error) {
        toast(errorText(error), 'error');
    }
}

function renderSettings() {
    const s = state.settings || {};
    $('setYearly').value = s.yearly_price ?? '';
    $('setPayName').value = s.payment_gcash_name || '';
    $('setPayNumber').value = s.payment_gcash_number || '';
    $('setPayInstructions').value = s.payment_instructions || '';
    $('setBankName').value = s.payment_bank_name || '';
    $('setBankAccountName').value = s.payment_bank_account_name || '';
    $('setBankAccountNumber').value = s.payment_bank_account_number || '';
    $('setGcashEnabled').checked = s.payment_gcash_enabled !== false;
    $('setBankEnabled').checked = s.payment_bank_enabled !== false;
    qrUrls.gcash = s.payment_gcash_qr_url || '';
    qrUrls.bank = s.payment_bank_qr_url || '';
    renderQr('gcash');
    renderQr('bank');
}

// Payment QR / instruction images, uploaded to ImageKit through the same
// signed-upload Edge Function the user receipts use.
const qrUrls = { gcash: '', bank: '' };

function renderQr(kind) {
    const box = document.querySelector(`.qr-upload[data-qr="${kind}"]`);
    const img = box.querySelector('.qr-preview');
    img.hidden = !qrUrls[kind];
    if (qrUrls[kind]) img.src = qrUrls[kind];
    box.querySelector('.qr-pick').textContent = qrUrls[kind] ? 'Replace image' : 'Upload image';
    box.querySelector('.qr-remove').hidden = !qrUrls[kind];
}

async function uploadQr(kind, file) {
    if (file.size > 5 * 1024 * 1024) return toast('Image must be under 5 MB.', 'error');
    const ext = (file.name.match(/\.(png|jpe?g|webp|gif)$/i)?.[1] || '').toLowerCase();
    if (!ext) return toast('Please choose a PNG, JPG, WebP or GIF image.', 'error');
    const pick = document.querySelector(`.qr-upload[data-qr="${kind}"] .qr-pick`);
    pick.disabled = true;
    pick.textContent = 'Uploading…';
    try {
        // Public bucket: customers need to see these on the payment screen
        const path = `${kind}-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('payment-qr').upload(path, file, {
            contentType: file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
            cacheControl: '3600',
        });
        if (error) throw error;
        qrUrls[kind] = sb.storage.from('payment-qr').getPublicUrl(path).data.publicUrl;
        toast('Image uploaded. Press Save Settings to apply.');
    } catch (error) {
        toast(errorText(error), 'error');
    } finally {
        pick.disabled = false;
        renderQr(kind);
    }
}

function showView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
    document.querySelectorAll('#sideNav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('viewTitle').textContent = VIEW_TITLES[view];
    window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// Dialog helper
// ---------------------------------------------------------------------

function openDialog(title, html, { wide = false } = {}) {
    $('dialogTitle').textContent = title;
    $('dialogBody').innerHTML = html;
    $('dialog').classList.toggle('dialog-wide', wide);
    $('dialog').hidden = false;
    document.body.classList.add('dialog-open');
}

function closeDialog() {
    $('dialog').hidden = true;
    document.body.classList.remove('dialog-open');
    $('dialogBody').innerHTML = '';
}

// ---------------------------------------------------------------------
// New account
// ---------------------------------------------------------------------

function openNewAccount() {
    openDialog('New Account', `
        <form id="newAccountForm" class="form" novalidate>
            <div class="grid-2">
                <label class="field"><span>Full name</span><input name="full_name" required></label>
                <label class="field"><span>Business name</span><input name="business_name"></label>
            </div>
            <div class="grid-2">
                <label class="field"><span>Email (used to sign in)</span><input name="email" type="email" required></label>
                <label class="field"><span>Mobile number</span><input name="phone" type="tel" placeholder="09XX XXX XXXX"></label>
            </div>
            <label class="field">
                <span>Password</span>
                <div class="input-row">
                    <input name="password" required minlength="8" value="${generatePassword()}">
                    <button type="button" class="btn btn-ghost" id="regenPassword">Generate</button>
                </div>
            </label>
            <label class="field">
                <span>Starting access</span>
                <select name="access">
                    <option value="none">No plan yet (user pays in the app)</option>
                    <option value="trial7">Free trial · 7 days</option>
                    <option value="trial14">Free trial · 14 days</option>
                    <option value="yearly">Yearly (already paid)</option>
                </select>
            </label>
            <label class="field" id="paidAmountField" hidden>
                <span>Amount received (₱)</span>
                <input name="amount" type="number" min="0" step="1">
            </label>
            <p class="form-error" id="newAccountError" hidden></p>
            <div class="form-actions">
                <button type="button" class="btn btn-ghost" data-close>Cancel</button>
                <button type="submit" class="btn btn-primary" id="newAccountSubmit"><span class="spinner"></span><span>Create Account</span></button>
            </div>
        </form>
    `);

    const form = $('newAccountForm');
    $('regenPassword').onclick = () => { form.elements.password.value = generatePassword(); };
    form.elements.access.onchange = () => {
        const paid = form.elements.access.value === 'yearly';
        $('paidAmountField').hidden = !paid;
        if (paid) form.elements.amount.value = state.settings?.yearly_price;
    };
    form.onsubmit = submitNewAccount;
}

async function submitNewAccount(event) {
    event.preventDefault();
    const form = event.target;
    const f = Object.fromEntries(new FormData(form));
    const errorEl = $('newAccountError');
    const fail = message => { errorEl.textContent = message; errorEl.hidden = false; };

    if (!f.full_name.trim()) return fail('Enter the full name.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return fail('Enter a valid email address.');
    if (f.password.length < 8) return fail('Password must be at least 8 characters.');

    errorEl.hidden = true;
    const button = $('newAccountSubmit');
    setBusy(button, true);

    try {
        const { user_id } = await adminUsers({
            action: 'create',
            email: f.email.trim(),
            password: f.password,
            full_name: f.full_name.trim(),
            phone: f.phone.trim(),
            business_name: f.business_name.trim()
        });

        const grants = {
            trial7: { plan: 'trial', days: 7, amount: 0 },
            trial14: { plan: 'trial', days: 14, amount: 0 },
            yearly: { plan: 'yearly', days: null, amount: Number(f.amount) || 0 }
        };
        const grant = grants[f.access];
        if (grant) {
            unwrap(await sb.rpc('admin_grant_subscription', {
                p_user_id: user_id, p_plan: grant.plan, p_days: grant.days, p_amount: grant.amount
            }));
        }

        await loadAll({ quiet: true });
        showCredentials(f.email.trim(), f.password, f.full_name.trim());
    } catch (error) {
        fail(errorText(error));
    } finally {
        setBusy(button, false);
    }
}

function showCredentials(email, password, name) {
    const message = `Hi ${name}! Your CashGee account is ready.\nEmail: ${email}\nPassword: ${password}\nOpen the CashGee app and sign in. You can change plans in the Subscription section.`;
    openDialog('Account created', `
        <div class="success-box">
            ${icon('check')}
            <div><strong>${esc(name)} can now sign in to the app.</strong><small>Send these details to them. The password won't be shown again.</small></div>
        </div>
        <div class="cred">
            <div><small>Email</small><code>${esc(email)}</code></div>
            <div><small>Password</small><code>${esc(password)}</code></div>
        </div>
        <div class="form-actions">
            <button type="button" class="btn btn-ghost" id="copyCreds">${icon('copy')}<span>Copy message</span></button>
            <button type="button" class="btn btn-primary" data-close>Done</button>
        </div>
    `);
    $('copyCreds').onclick = () => copyText(message);
}

// ---------------------------------------------------------------------
// Account details
// ---------------------------------------------------------------------

function openAccount(userId) {
    const p = profileById(userId);
    if (!p) return;
    const a = accessFor(p);
    const subs = subsForUser(userId).sort((x, y) => Date.parse(y.starts_at) - Date.parse(x.starts_at));
    const requests = state.requests.filter(r => r.user_id === userId);

    openDialog(p.full_name || p.email, `
        <div class="account-summary">
            ${personCell(p)}
            ${chip(a.status)}
        </div>
        <div class="kv-grid">
            <div><small>Email</small><span>${esc(p.email || '—')}</span></div>
            <div><small>Mobile</small><span>${esc(p.phone || '—')}</span></div>
            <div><small>Current plan</small><span>${a.plan ? PLAN_LABELS[a.plan] : '—'}</span></div>
            <div><small>Access until</small><span>${a.endsAt ? `${fmtDate(a.endsAt)}${a.daysLeft > 0 ? ` · ${a.daysLeft}d left` : ''}` : '—'}</span></div>
        </div>

        <h3 class="section-h">Give access</h3>
        <form class="inline-form" id="grantForm">
            <select name="plan">
                <option value="yearly">+1 year</option>
                <option value="trial7">+7 days (free)</option>
            </select>
            <input name="amount" type="number" min="0" step="1" placeholder="Amount received ₱" value="0">
            <button type="submit" class="btn btn-primary" id="grantSubmit"><span class="spinner"></span><span>Add</span></button>
        </form>
        <p class="muted small">Added time starts after the current plan ends. Use this for cash payments or free extensions.</p>

        <h3 class="section-h">Subscription history</h3>
        ${subs.length ? `<div class="history">${subs.map(s => `
            <div class="history-row">
                <div><strong>${PLAN_LABELS[s.plan]} · ${peso(s.amount)}</strong><small>${fmtDate(s.starts_at)} → ${fmtDate(s.ends_at)}${s.request_id ? '' : ' · granted by admin'}</small></div>
                ${chip(subscriptionPhase(s))}
            </div>`).join('')}</div>` : '<p class="empty">No subscriptions yet.</p>'}

        ${requests.length ? `
        <h3 class="section-h">Payments</h3>
        <div class="history">${requests.map(r => `
            <button type="button" class="history-row clickable" onclick="openPayment('${r.id}')">
                <div><strong>${PLAN_LABELS[r.plan]} · ${peso(r.amount)}</strong><small>${fmtDateTime(r.created_at)} · Ref ${esc(r.payment_reference)}</small></div>
                ${chip(r.status)}
            </button>`).join('')}</div>` : ''}

        <h3 class="section-h">Send a notification</h3>
        <form class="stack-form" id="notifyForm">
            <input name="title" placeholder="Title, e.g. Reminder" required maxlength="80">
            <textarea name="body" rows="2" placeholder="Message" maxlength="400"></textarea>
            <div class="form-actions"><button type="submit" class="btn btn-ghost" id="notifySubmit"><span class="spinner"></span>${icon('bell')}<span>Send</span></button></div>
        </form>

        <h3 class="section-h">Account actions</h3>
        <div class="action-list">
            <button type="button" class="btn btn-ghost" id="resetPwBtn">${icon('key')}<span>Reset password</span></button>
            ${a.status === 'active' || a.status === 'expiring' ? `<button type="button" class="btn btn-ghost" id="endAccessBtn">${icon('clock')}<span>End access now</span></button>` : ''}
            <button type="button" class="btn btn-ghost ${p.status === 'disabled' ? '' : 'btn-danger-ghost'}" id="toggleStatusBtn">${icon(p.status === 'disabled' ? 'check' : 'ban')}<span>${p.status === 'disabled' ? 'Enable account' : 'Disable account'}</span></button>
            <button type="button" class="btn btn-ghost btn-danger-ghost" id="deleteAccountBtn">${icon('trash')}<span>Delete account</span></button>
        </div>
    `, { wide: true });

    $('grantForm').onsubmit = async event => {
        event.preventDefault();
        const f = Object.fromEntries(new FormData(event.target));
        const trial = f.plan === 'trial7';
        const button = $('grantSubmit');
        setBusy(button, true);
        try {
            unwrap(await sb.rpc('admin_grant_subscription', {
                p_user_id: userId,
                p_plan: trial ? 'trial' : f.plan,
                p_days: trial ? 7 : null,
                p_amount: trial ? 0 : Number(f.amount) || 0
            }));
            toast('Access added. The user was notified.');
            await loadAll({ quiet: true });
            openAccount(userId);
        } catch (error) {
            toast(errorText(error), 'error');
            setBusy(button, false);
        }
    };

    $('notifyForm').onsubmit = async event => {
        event.preventDefault();
        const f = Object.fromEntries(new FormData(event.target));
        if (!f.title.trim()) return;
        const button = $('notifySubmit');
        setBusy(button, true);
        try {
            unwrap(await sb.from('notifications').insert({ user_id: userId, title: f.title.trim(), body: f.body.trim(), type: 'info' }));
            event.target.reset();
            toast('Notification sent.');
        } catch (error) {
            toast(errorText(error), 'error');
        } finally {
            setBusy(button, false);
        }
    };

    $('resetPwBtn').onclick = async () => {
        const password = prompt('New password for this account (at least 8 characters):', generatePassword());
        if (password === null) return;
        if (password.trim().length < 8) return toast('Password must be at least 8 characters.', 'error');
        try {
            await adminUsers({ action: 'set_password', user_id: userId, password: password.trim() });
            showCredentials(p.email, password.trim(), p.full_name || p.email);
        } catch (error) {
            toast(errorText(error), 'error');
        }
    };

    const endBtn = $('endAccessBtn');
    if (endBtn) endBtn.onclick = async () => {
        if (!confirm(`End ${p.full_name || p.email}'s access now? Their app becomes read-only.`)) return;
        try {
            unwrap(await sb.rpc('admin_end_subscription', { p_user_id: userId }));
            toast('Access ended.');
            await loadAll({ quiet: true });
            openAccount(userId);
        } catch (error) {
            toast(errorText(error), 'error');
        }
    };

    $('toggleStatusBtn').onclick = async () => {
        const disable = p.status !== 'disabled';
        if (disable && !confirm(`Disable ${p.full_name || p.email}? They will be signed out and can't sign in until you enable the account again.`)) return;
        try {
            await adminUsers({ action: 'set_status', user_id: userId, status: disable ? 'disabled' : 'active' });
            toast(disable ? 'Account disabled.' : 'Account enabled.');
            await loadAll({ quiet: true });
            openAccount(userId);
        } catch (error) {
            toast(errorText(error), 'error');
        }
    };

    $('deleteAccountBtn').onclick = async () => {
        const typed = prompt(`This permanently deletes ${p.email}, their subscriptions and payment records.\n\nType DELETE to confirm:`);
        if (typed !== 'DELETE') return;
        try {
            await adminUsers({ action: 'delete', user_id: userId });
            closeDialog();
            toast('Account deleted.');
            await loadAll({ quiet: true });
        } catch (error) {
            toast(errorText(error), 'error');
        }
    };
}

// ---------------------------------------------------------------------
// Payment review
// ---------------------------------------------------------------------

async function openPayment(requestId) {
    const r = state.requests.find(x => x.id === requestId);
    if (!r) return;
    const p = profileById(r.user_id);
    const reviewer = r.reviewed_by ? profileById(r.reviewed_by) : null;

    openDialog('Payment', `
        <div class="payment-grid">
            <div class="proof" id="proofBox"><div class="proof-loading">Loading proof…</div></div>
            <div>
                <div class="account-summary">
                    ${personCell(p, r.full_name)}
                    ${chip(r.status)}
                </div>
                <div class="kv-grid kv-grid-1">
                    <div><small>Plan</small><span>${PLAN_LABELS[r.plan]} · <strong>${peso(r.amount)}</strong></span></div>
                    <div><small>Payment method</small><span>${METHOD_LABELS[r.payment_method] || 'GCash'}</span></div>
                    <div><small>Reference no.</small><span><code>${esc(r.payment_reference)}</code></span></div>
                    ${r.receipt_no ? `<div><small>Receipt no.</small><span><code>${esc(r.receipt_no)}</code></span></div>` : ''}
                    ${r.sender_name || r.sender_account ? `
                    <div><small>Paid from</small><span>${esc([r.sender_bank, r.sender_name, r.sender_account].filter(Boolean).join(' · '))}</span></div>` : ''}
                    <div><small>Full name</small><span>${esc(r.full_name)}</span></div>
                    <div><small>Mobile</small><span>${esc(r.phone)}</span></div>
                    <div><small>Email</small><span>${esc(r.email || p?.email || '—')}</span></div>
                    <div><small>Business</small><span>${esc(r.business_name || '—')}</span></div>
                    <div><small>Address</small><span>${esc(r.address || '—')}</span></div>
                    <div><small>Submitted</small><span>${fmtDateTime(r.created_at)}</span></div>
                    ${r.status !== 'pending' ? `
                    <div><small>Reviewed</small><span>${fmtDateTime(r.reviewed_at)}${reviewer ? ` by ${esc(reviewer.email)}` : ''}</span></div>
                    ${r.admin_note ? `<div><small>Note</small><span>${esc(r.admin_note)}</span></div>` : ''}` : ''}
                </div>
                ${r.status === 'pending' ? `
                <label class="field"><span>Note to the user <em>optional</em></span><textarea id="reviewNote" rows="2" placeholder="e.g. Reference number not found"></textarea></label>
                <div class="form-actions">
                    <button type="button" class="btn btn-ghost btn-danger-ghost" id="rejectBtn"><span class="spinner"></span>${icon('x')}<span>Reject</span></button>
                    <button type="button" class="btn btn-primary" id="approveBtn"><span class="spinner"></span>${icon('check')}<span>Approve · ${PLAN_LABELS[r.plan]}</span></button>
                </div>
                <p class="muted small">Approving adds 1 year starting after their current plan ends, and notifies the user.</p>` : ''}
            </div>
        </div>
    `, { wide: true });

    if (r.status === 'pending') {
        $('approveBtn').onclick = () => reviewPayment(r, 'approve');
        $('rejectBtn').onclick = () => reviewPayment(r, 'reject');
    }

    try {
        // Receipts go to ImageKit; older requests (or no ImageKit) use the private bucket
        let imageUrl = r.receipt_url;
        if (!imageUrl) {
            const { data, error } = await sb.storage.from('payment-proofs').createSignedUrl(r.proof_path, 3600);
            if (error) throw error;
            imageUrl = data.signedUrl;
        }
        const box = $('proofBox');
        if (!box) return; // dialog closed meanwhile
        box.innerHTML = `
            <a href="${esc(imageUrl)}" target="_blank" rel="noopener" title="Open full size">
                <img src="${esc(imageUrl)}" alt="Payment receipt">
                <span class="proof-open">${icon('external')} Open full size</span>
            </a>`;
    } catch (error) {
        const box = $('proofBox');
        if (box) box.innerHTML = `<div class="proof-loading">Could not load image: ${esc(errorText(error))}</div>`;
    }
}

async function reviewPayment(r, action) {
    const note = $('reviewNote').value.trim();
    if (action === 'reject' && !note && !confirm('Reject without a note? The user will be asked to check their payment details.')) return;

    const button = $(action === 'approve' ? 'approveBtn' : 'rejectBtn');
    setBusy(button, true);
    try {
        const fn = action === 'approve' ? 'approve_subscription_request' : 'reject_subscription_request';
        unwrap(await sb.rpc(fn, { p_request_id: r.id, p_note: note || null }));
        closeDialog();
        toast(action === 'approve' ? 'Payment approved. Subscription activated.' : 'Payment rejected. The user was notified.');
        await loadAll({ quiet: true });
    } catch (error) {
        toast(errorText(error), 'error');
        setBusy(button, false);
    }
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

async function saveSettings(event) {
    event.preventDefault();
    const button = $('settingsSave');
    const yearly = Number($('setYearly').value);
    if (!(yearly >= 0)) return toast('Enter a valid price.', 'error');

    setBusy(button, true);
    try {
        unwrap(await sb.from('app_settings').update({
            yearly_price: yearly,
            payment_gcash_name: $('setPayName').value.trim(),
            payment_gcash_number: $('setPayNumber').value.trim(),
            payment_instructions: $('setPayInstructions').value.trim(),
            payment_bank_name: $('setBankName').value.trim(),
            payment_bank_account_name: $('setBankAccountName').value.trim(),
            payment_bank_account_number: $('setBankAccountNumber').value.trim(),
            payment_gcash_enabled: $('setGcashEnabled').checked,
            payment_bank_enabled: $('setBankEnabled').checked,
            payment_gcash_qr_url: qrUrls.gcash,
            payment_bank_qr_url: qrUrls.bank,
            updated_at: new Date().toISOString()
        }).eq('id', 1));
        toast('Settings saved.');
        await loadAll({ quiet: true });
    } catch (error) {
        toast(errorText(error), 'error');
    } finally {
        setBusy(button, false);
    }
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

function wireChips(containerId, key, render) {
    $(containerId).addEventListener('click', event => {
        const button = event.target.closest('button[data-filter]');
        if (!button) return;
        state[key] = button.dataset.filter;
        $(containerId).querySelectorAll('button').forEach(b => b.classList.toggle('active', b === button));
        render();
    });
}

function wireEvents() {
    $('loginForm').addEventListener('submit', handleLogin);
    $('loginPasswordToggle')?.addEventListener('click', togglePasswordVisibility);
    $('loginClearSaved')?.addEventListener('click', handleClearSavedPassword);
    $('signOutBtn').addEventListener('click', signOut);
    $('refreshBtn').addEventListener('click', () => loadAll());
    $('newAccountBtn').addEventListener('click', openNewAccount);
    $('settingsForm').addEventListener('submit', saveSettings);
    $('announceForm').addEventListener('submit', sendAnnouncement);
    $('announceTitle').addEventListener('input', renderAnnouncePreview);
    $('announceBody').addEventListener('input', renderAnnouncePreview);
    $('announceAudience').addEventListener('change', renderAudienceCount);
    $('announceType').addEventListener('click', event => {
        const button = event.target.closest('.kind');
        if (button) setAnnounceType(button.dataset.type);
    });

    $('sideNav').addEventListener('click', event => {
        const button = event.target.closest('button[data-view]');
        if (button) showView(button.dataset.view);
    });
    document.addEventListener('click', event => {
        const goto = event.target.closest('[data-goto]');
        if (goto) showView(goto.dataset.goto);
        if (event.target.closest('[data-close]')) closeDialog();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !$('dialog').hidden) closeDialog();
    });

    $('accountSearch').addEventListener('input', event => {
        state.accountSearch = event.target.value;
        renderAccounts();
    });
    wireChips('accountFilter', 'accountFilter', renderAccounts);
    wireChips('paymentFilter', 'paymentFilter', renderPayments);
    document.querySelectorAll('.qr-upload').forEach(box => {
        const kind = box.dataset.qr;
        const input = box.querySelector('.qr-file');
        box.querySelector('.qr-pick').addEventListener('click', () => input.click());
        box.querySelector('.qr-remove').addEventListener('click', () => { qrUrls[kind] = ''; renderQr(kind); });
        input.addEventListener('change', () => {
            const file = input.files[0];
            input.value = '';
            if (file) uploadQr(kind, file);
        });
    });
    wireChips('subPlanFilter', 'subPlanFilter', renderSubscriptions);
    wireChips('subStatusFilter', 'subStatusFilter', renderSubscriptions);

    // Keep the dashboard fresh while it's open
    setInterval(() => { if (state.me && document.visibilityState === 'visible' && $('dialog').hidden) loadAll({ quiet: true }); }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
