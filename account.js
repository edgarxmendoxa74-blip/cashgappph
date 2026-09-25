// =====================================================================
// CashG — login, subscription and notifications (app side)
//
// Flow: startAccount() → sign-in screen or enterAccount(user)
//       → local inventory for that user + account data from Supabase.
// When the subscription is not active the inventory becomes read-only.
// =====================================================================

const LAST_USER_KEY = 'cashg-last-user';
const ACCOUNT_CACHE_PREFIX = 'cashg-account:';
const REMINDER_SEEN_PREFIX = 'cashg-reminder-seen:';
const ACCOUNT_REFRESH_MS = 60000;
const EXPIRING_SOON_DAYS = 7;
const DAY_MS = 86400000;

let currentUser = null;      // { id, email }
let account = null;          // { profile, subscriptions, settings, requests, notifications, fetchedAt }
let selectedPlan = null;     // 'monthly' | 'yearly'
let accountRefreshTimer = null;
let announcedNotificationIds = new Set();

// ---------------------------------------------------------------------
// Small storage helpers (never throw)
// ---------------------------------------------------------------------

function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

// Each account keeps its own inventory on this device
function inventoryStorageKey() {
    return currentUser ? `cashg-inventory:${currentUser.id}` : null;
}

// ---------------------------------------------------------------------
// Start-up & sign in / out
// ---------------------------------------------------------------------

async function startAccount() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('loginPasswordToggle').addEventListener('click', togglePasswordVisibility);
    document.getElementById('subProofInput').addEventListener('change', previewProof);
    document.getElementById('subForm').addEventListener('submit', handleSubscriptionSubmit);

    if (!Cloud.hasConfig) {
        showAuthScreen({ notConfigured: true });
        return;
    }

    const lastUser = readJson(LAST_USER_KEY);

    // Supabase library couldn't load (offline on a fresh start): keep working offline
    if (!Cloud.isReady) {
        if (lastUser?.id) enterAccount(lastUser);
        else showAuthScreen({ message: 'No internet connection. Connect once to sign in.' });
        return;
    }

    Cloud.onSignedOut(() => {
        if (currentUser) leaveAccount('You have been signed out. Please sign in again.');
    });

    let session = null;
    try {
        session = await Cloud.getSession();
    } catch (error) {
        console.warn('Could not restore session', error);
    }

    if (session?.user) {
        enterAccount({ id: session.user.id, email: session.user.email });
        return;
    }

    // Offline with an expired token: keep working with the last account on this device
    if (!navigator.onLine && lastUser?.id) {
        enterAccount(lastUser);
        return;
    }

    showAuthScreen();
}

function showAuthScreen({ notConfigured = false, message = '' } = {}) {
    const screen = document.getElementById('authScreen');
    document.getElementById('authSetupNotice').hidden = !notConfigured;
    document.getElementById('loginForm').hidden = notConfigured;
    setLoginError(message);
    screen.hidden = false;
    document.body.classList.add('auth-open');
    if (!notConfigured) setTimeout(() => document.getElementById('loginEmail').focus(), 50);
}

function hideAuthScreen() {
    document.getElementById('authScreen').hidden = true;
    document.body.classList.remove('auth-open');
}

function setLoginError(message) {
    const el = document.getElementById('loginError');
    el.textContent = message || '';
    el.hidden = !message;
}

function togglePasswordVisibility() {
    const input = document.getElementById('loginPassword');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    this.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    this.classList.toggle('is-showing', !showing);
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const button = document.getElementById('loginSubmit');

    if (!email || !password) {
        setLoginError('Enter your email and password.');
        return;
    }
    if (!Cloud.isReady) {
        setLoginError('No internet connection. Please connect and reload the app.');
        return;
    }

    setLoginError('');
    button.disabled = true;
    button.classList.add('is-loading');

    try {
        const user = await Cloud.signIn(email, password);
        document.getElementById('loginPassword').value = '';
        enterAccount({ id: user.id, email: user.email });
    } catch (error) {
        setLoginError(Cloud.friendlyError(error));
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
    }
}

function enterAccount(user) {
    currentUser = { id: user.id, email: user.email };
    writeJson(LAST_USER_KEY, currentUser);

    account = readJson(ACCOUNT_CACHE_PREFIX + currentUser.id);
    announcedNotificationIds = new Set((account?.notifications || []).map(n => n.id));

    hideAuthScreen();
    enterInventory();
    renderAccountUI();
    refreshAccount({ announce: true });

    clearInterval(accountRefreshTimer);
    accountRefreshTimer = setInterval(refreshAccount, ACCOUNT_REFRESH_MS);
}

async function signOutAccount() {
    if (!confirm('Sign out of CashG on this device?\n\nYour inventory stays saved here for when you sign in again.')) return;
    // Leave first so the SIGNED_OUT event that follows finds no current user
    leaveAccount();
    try { await Cloud.signOut(); } catch { /* offline: local session is cleared anyway */ }
}

function leaveAccount(message = '') {
    clearInterval(accountRefreshTimer);
    accountRefreshTimer = null;
    currentUser = null;
    account = null;
    selectedPlan = null;
    try { localStorage.removeItem(LAST_USER_KEY); } catch { /* ignore */ }

    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    setSidebarOpen(false);
    leaveInventory();
    renderAccountUI();
    showAuthScreen({ message });
}

// ---------------------------------------------------------------------
// Account data
// ---------------------------------------------------------------------

async function refreshAccount({ announce = false } = {}) {
    if (!currentUser || !Cloud.isReady || !navigator.onLine) return;
    const userId = currentUser.id;

    let data;
    try {
        data = await Cloud.loadAccount(userId);
    } catch (error) {
        console.warn('Could not refresh account', error);
        return;
    }
    if (!currentUser || currentUser.id !== userId) return; // signed out meanwhile

    if (!data.profile) {
        leaveAccount('This account could not be found. Please contact the admin.');
        return;
    }
    if (data.profile.status === 'disabled') {
        leaveAccount('This account is disabled. Please contact the admin.');
        Cloud.signOut().catch(() => {});
        return;
    }

    const newUnread = data.notifications.filter(n => !n.read_at && !announcedNotificationIds.has(n.id));
    data.notifications.forEach(n => announcedNotificationIds.add(n.id));

    account = { ...data, fetchedAt: Date.now() };
    writeJson(ACCOUNT_CACHE_PREFIX + userId, account);
    renderAccountUI();

    // First-run setup opened before the profile arrived: prefill the store name now
    const welcomeName = document.getElementById('welcomeBusinessName');
    if (document.getElementById('welcomeModal').classList.contains('active') && !welcomeName.value) {
        welcomeName.value = data.profile.business_name || '';
    }

    if (newUnread.length === 1) {
        showNotification(newUnread[0].title, newUnread[0].type === 'error' ? 'error' : 'info');
    } else if (newUnread.length > 1 || (announce && unreadCount() > 0)) {
        showNotification(`You have ${unreadCount()} new notification${unreadCount() === 1 ? '' : 's'}`, 'info');
    }
}

function refreshAccountSoon() {
    if (document.visibilityState === 'visible') refreshAccount();
}

document.addEventListener('visibilitychange', refreshAccountSoon);
window.addEventListener('online', () => refreshAccount());

// ---------------------------------------------------------------------
// Subscription state
// ---------------------------------------------------------------------

const PLAN_LABELS = { monthly: 'Monthly', yearly: 'Yearly', trial: 'Free Trial' };

function getSubscriptionState() {
    const subs = account?.subscriptions || [];
    const now = Date.now();
    const current = subs.find(s => Date.parse(s.starts_at) <= now && Date.parse(s.ends_at) > now) || null;
    const latestEnd = subs.reduce((max, s) => Math.max(max, Date.parse(s.ends_at)), 0);
    const pending = (account?.requests || []).find(r => r.status === 'pending') || null;

    let status = 'none';
    let daysLeft = 0;
    if (current) {
        daysLeft = Math.max(0, Math.ceil((latestEnd - now) / DAY_MS));
        status = daysLeft <= EXPIRING_SOON_DAYS ? 'expiring' : 'active';
    } else if (subs.length) {
        status = 'expired';
    }

    return {
        status,
        isActive: status === 'active' || status === 'expiring',
        plan: current?.plan || subs[0]?.plan || null,
        startsAt: current ? current.starts_at : null,
        endsAt: latestEnd ? new Date(latestEnd).toISOString() : null,
        currentEndsAt: current?.ends_at || null,
        daysLeft,
        pending,
        loaded: Boolean(account)
    };
}

// Gate for anything that changes inventory records
function requireSubscription() {
    if (!currentUser) return false;
    if (getSubscriptionState().isActive) return true;

    setSidebarOpen(false);
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    const { status } = getSubscriptionState();
    showNotification(
        status === 'expired'
            ? 'Your subscription has expired. Renew to keep adding records.'
            : 'Subscribe to start adding records.',
        'warning'
    );
    navigateToPage('subscription');
    return false;
}

function formatLongDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function planPrice(plan) {
    const s = account?.settings;
    if (!s) return null;
    return Number(plan === 'monthly' ? s.monthly_price : s.yearly_price);
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderAccountUI() {
    renderSubscriptionBanner();
    renderNotificationBadge();
    renderAccountIdentity();
    if (currentPage === 'subscription') renderSubscriptionPage();
    if (document.getElementById('notificationsModal').classList.contains('active')) renderNotificationsList();
}

function renderAccountIdentity() {
    const email = currentUser?.email || '';
    document.querySelectorAll('[data-account-email]').forEach(el => { el.textContent = email; });
    const sidebarSub = document.getElementById('sidebarAccountSub');
    if (sidebarSub) sidebarSub.textContent = email || 'Not signed in';
}

function renderSubscriptionBanner() {
    const banner = document.getElementById('subBanner');
    if (!currentUser || !account) {
        banner.hidden = true;
        return;
    }

    const state = getSubscriptionState();
    let tone = '', text = '', action = '';

    if (state.status === 'expiring') {
        tone = 'warning';
        text = state.daysLeft <= 1
            ? 'Your subscription ends today.'
            : `Your subscription ends in ${state.daysLeft} days.`;
        action = 'Renew';
    } else if (state.status === 'expired') {
        tone = 'danger';
        text = state.pending ? 'Subscription expired · payment under review.' : 'Subscription expired · records are read-only.';
        action = state.pending ? 'View' : 'Renew';
    } else if (state.status === 'none') {
        tone = 'info';
        text = state.pending ? 'Payment under review. We\'ll notify you once approved.' : 'Choose a plan to start using CashG.';
        action = state.pending ? 'View' : 'Subscribe';
    }

    if (!tone || currentPage === 'subscription') {
        banner.hidden = true;
        return;
    }

    banner.className = `sub-banner sub-banner-${tone}`;
    banner.innerHTML = `
        <span class="sub-banner-icon">${icon(tone === 'info' ? 'crown' : 'clock')}</span>
        <span class="sub-banner-text">${text}</span>
        <button type="button" class="sub-banner-btn" onclick="navigateToPage('subscription')">${action}</button>
    `;
    banner.hidden = false;
}

function renderSubscriptionPage() {
    const state = getSubscriptionState();
    const statusCard = document.getElementById('subStatusCard');
    const pendingCard = document.getElementById('subPendingCard');
    const planSection = document.getElementById('subPlanSection');

    // --- Status card ---
    const statusText = {
        active: 'Active',
        expiring: 'Expiring soon',
        expired: 'Expired',
        none: 'No subscription'
    }[state.status];

    let progress = 0;
    if (state.isActive && state.startsAt && state.endsAt) {
        const start = Date.parse(state.startsAt);
        const end = Date.parse(state.endsAt);
        progress = Math.min(100, Math.max(0, ((end - Date.now()) / (end - start)) * 100));
    }

    statusCard.className = `sub-status-card is-${state.status}`;
    statusCard.innerHTML = `
        <div class="sub-status-top">
            <div>
                <div class="sub-status-label">Current plan</div>
                <div class="sub-status-plan">${state.plan ? PLAN_LABELS[state.plan] : 'None yet'}</div>
            </div>
            <span class="sub-status-pill">${statusText}</span>
        </div>
        ${state.isActive ? `
            <div class="sub-days">
                <strong>${state.daysLeft}</strong>
                <span>day${state.daysLeft === 1 ? '' : 's'} left</span>
            </div>
            <div class="sub-progress"><div style="width:${progress}%"></div></div>
            <div class="sub-dates">
                <div><small>Started</small><span>${formatLongDate(state.startsAt)}</span></div>
                <div><small>Valid until</small><span>${formatLongDate(state.endsAt)}</span></div>
            </div>
        ` : `
            <p class="sub-status-note">${state.status === 'expired'
                ? `Your access ended on <strong>${formatLongDate(state.endsAt)}</strong>. Your records are safe but read-only until you renew.`
                : 'Choose Monthly or Yearly below, send your payment via GCash, and upload the receipt.'}</p>
        `}
        ${!account ? '<p class="sub-status-note">Connect to the internet to load your subscription.</p>' : ''}
    `;

    // --- Pending payment ---
    if (state.pending) {
        const p = state.pending;
        pendingCard.hidden = false;
        pendingCard.innerHTML = `
            <span class="sub-pending-icon">${icon('clock')}</span>
            <div class="sub-pending-body">
                <strong>Payment under review</strong>
                <span>${PLAN_LABELS[p.plan]} · ${peso(p.amount)} · Ref ${escapeHtml(p.payment_reference)}</span>
                <small>Submitted ${formatLongDate(p.created_at)}. You'll get a notification once the admin approves it.</small>
            </div>
        `;
    } else {
        pendingCard.hidden = true;
    }

    // --- Plan choices & form (hidden while a payment is being reviewed) ---
    planSection.hidden = Boolean(state.pending) || !account;
    if (!planSection.hidden) renderPlanOptions();

    renderPaymentHistory();
}

function renderPlanOptions() {
    if (!account) return;
    const monthly = planPrice('monthly');
    const yearly = planPrice('yearly');
    const savings = monthly && yearly ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;

    const option = (plan, price, per, note) => `
        <button type="button" class="plan-option ${selectedPlan === plan ? 'is-selected' : ''}" onclick="selectPlan('${plan}')">
            <span class="plan-radio"></span>
            <span class="plan-info">
                <span class="plan-name">${PLAN_LABELS[plan]}</span>
                <span class="plan-note">${note}</span>
            </span>
            <span class="plan-price">${peso(price)}<small>/${per}</small></span>
        </button>
    `;

    document.getElementById('planOptions').innerHTML =
        option('monthly', monthly, 'month', 'Billed every month') +
        option('yearly', yearly, 'year', savings > 0 ? `<span class="plan-save">Save ${savings}%</span> vs monthly` : 'Billed once a year');

    const form = document.getElementById('subForm');
    form.hidden = !selectedPlan;
    if (!selectedPlan) return;

    const s = account.settings || {};
    document.getElementById('subPayAmount').textContent = peso(planPrice(selectedPlan));
    document.getElementById('subPayName').textContent = s.payment_gcash_name || 'Ask the admin for the GCash name';
    document.getElementById('subPayNumber').textContent = s.payment_gcash_number || '—';
    const instructions = document.getElementById('subPayInstructions');
    instructions.textContent = s.payment_instructions || '';
    instructions.hidden = !s.payment_instructions;
    document.getElementById('subSubmitLabel').textContent = `Submit ${PLAN_LABELS[selectedPlan]} Payment`;
}

function selectPlan(plan) {
    const firstSelection = !selectedPlan;
    selectedPlan = plan;
    renderPlanOptions();

    // Prefill from the profile the first time the form opens
    const form = document.getElementById('subForm');
    if (firstSelection && account?.profile) {
        const p = account.profile;
        if (!form.elements.fullName.value) form.elements.fullName.value = p.full_name || '';
        if (!form.elements.phone.value) form.elements.phone.value = p.phone || '';
        if (!form.elements.businessName.value) form.elements.businessName.value = p.business_name || inventory.settings.businessName || '';
    }
    if (firstSelection) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPaymentHistory() {
    const list = document.getElementById('subHistory');
    const requests = account?.requests || [];

    if (!requests.length) {
        list.innerHTML = '<p class="sub-history-empty">No payments submitted yet.</p>';
        return;
    }

    const labels = { pending: 'Under review', approved: 'Approved', rejected: 'Not approved' };
    list.innerHTML = requests.map(r => `
        <div class="sub-history-row">
            <div class="sub-history-main">
                <strong>${PLAN_LABELS[r.plan]} · ${peso(r.amount)}</strong>
                <span>${formatLongDate(r.created_at)} · Ref ${escapeHtml(r.payment_reference)}</span>
                ${r.admin_note ? `<small>Admin: ${escapeHtml(r.admin_note)}</small>` : ''}
            </div>
            <span class="status-chip status-${r.status}">${labels[r.status]}</span>
        </div>
    `).join('');
}

// ---------------------------------------------------------------------
// Payment form
// ---------------------------------------------------------------------

const MAX_PROOF_BYTES = 5 * 1024 * 1024;

function previewProof() {
    const file = this.files[0];
    const preview = document.getElementById('subProofPreview');
    const drop = document.getElementById('subProofDrop');

    if (!file) {
        preview.hidden = true;
        drop.classList.remove('has-file');
        return;
    }
    if (!file.type.startsWith('image/')) {
        showNotification('Please choose an image (screenshot or photo of your receipt).', 'error');
        this.value = '';
        return;
    }
    if (file.size > MAX_PROOF_BYTES) {
        showNotification('Image is too large. Please use one under 5 MB.', 'error');
        this.value = '';
        return;
    }

    const img = preview.querySelector('img');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(file);
    img.src = img.dataset.url;
    preview.querySelector('span').textContent = file.name;
    preview.hidden = false;
    drop.classList.add('has-file');
}

async function handleSubscriptionSubmit(event) {
    event.preventDefault();
    if (!currentUser || !selectedPlan) return;

    const form = event.target;
    const file = document.getElementById('subProofInput').files[0];
    const values = {
        plan: selectedPlan,
        fullName: form.elements.fullName.value.trim(),
        phone: form.elements.phone.value.trim(),
        businessName: form.elements.businessName.value.trim(),
        address: form.elements.address.value.trim(),
        reference: form.elements.reference.value.trim()
    };

    if (!values.fullName || !values.phone || !values.reference) {
        showNotification('Please fill in your name, mobile number and GCash reference number.', 'error');
        return;
    }
    if (!file) {
        showNotification('Please attach your payment proof.', 'error');
        return;
    }
    if (!navigator.onLine) {
        showNotification('You are offline. Connect to the internet to submit your payment.', 'error');
        return;
    }

    const button = document.getElementById('subSubmit');
    button.disabled = true;
    button.classList.add('is-loading');

    try {
        await Cloud.submitSubscriptionRequest(currentUser.id, values, file);
        form.reset();
        document.getElementById('subProofPreview').hidden = true;
        document.getElementById('subProofDrop').classList.remove('has-file');
        selectedPlan = null;
        showNotification('Payment submitted! We\'ll notify you once it\'s approved.', 'success');
        await refreshAccount();
        window.scrollTo(0, 0);
    } catch (error) {
        showNotification(Cloud.friendlyError(error), 'error');
    } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
    }
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

// Reminder about the subscription itself (not stored on the server)
function subscriptionReminder() {
    if (!account) return null;
    const state = getSubscriptionState();
    if (state.pending) return null;

    if (state.status === 'expiring') {
        return {
            key: `expiring:${state.endsAt}`,
            type: 'warning',
            title: state.daysLeft <= 1 ? 'Subscription ends today' : `Subscription ends in ${state.daysLeft} days`,
            body: `Renew before ${formatLongDate(state.endsAt)} to keep adding records.`
        };
    }
    if (state.status === 'expired') {
        return {
            key: `expired:${state.endsAt}`,
            type: 'error',
            title: 'Subscription expired',
            body: `Your access ended on ${formatLongDate(state.endsAt)}. Renew to continue.`
        };
    }
    return null;
}

function reminderSeenKey() {
    return REMINDER_SEEN_PREFIX + (currentUser?.id || '');
}

function unreadCount() {
    const serverUnread = (account?.notifications || []).filter(n => !n.read_at).length;
    const reminder = subscriptionReminder();
    const reminderUnread = reminder && localStorage.getItem(reminderSeenKey()) !== reminder.key ? 1 : 0;
    return serverUnread + reminderUnread;
}

function renderNotificationBadge() {
    const badge = document.getElementById('notifBadge');
    const bell = document.getElementById('notifBell');
    const count = currentUser ? unreadCount() : 0;
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = count === 0;
    bell.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
}

function openNotifications() {
    if (!currentUser) return;
    renderNotificationsList();
    document.getElementById('notificationsModal').classList.add('active');

    // Mark everything as seen
    const reminder = subscriptionReminder();
    if (reminder) {
        try { localStorage.setItem(reminderSeenKey(), reminder.key); } catch { /* ignore */ }
    }
    const hasUnread = (account?.notifications || []).some(n => !n.read_at);
    if (hasUnread) {
        const now = new Date().toISOString();
        account.notifications.forEach(n => { if (!n.read_at) n.read_at = now; });
        writeJson(ACCOUNT_CACHE_PREFIX + currentUser.id, account);
        Cloud.markNotificationsRead().catch(error => console.warn('Could not mark notifications read', error));
    }
    renderNotificationBadge();
}

function renderNotificationsList() {
    const list = document.getElementById('notificationsList');
    const reminder = subscriptionReminder();
    const items = [];

    if (reminder) {
        items.push({ ...reminder, created_at: null, isReminder: true, unread: localStorage.getItem(reminderSeenKey()) !== reminder.key });
    }
    (account?.notifications || []).forEach(n => items.push({ ...n, unread: !n.read_at }));

    if (!items.length) {
        list.innerHTML = `
            <div class="empty-state empty-state-sm">
                <span class="empty-state-icon">${icon('bell')}</span>
                <div class="empty-state-title">No notifications yet</div>
                <div class="empty-state-text">Payment updates and subscription reminders will show here.</div>
            </div>`;
        return;
    }

    const icons = { success: 'check', error: 'alert', warning: 'clock', info: 'info' };
    list.innerHTML = items.map(n => `
        <div class="notif-item notif-${n.type} ${n.unread ? 'is-unread' : ''}">
            <span class="notif-icon">${icon(icons[n.type] || 'info')}</span>
            <div class="notif-body">
                <strong>${escapeHtml(n.title)}</strong>
                ${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}
                <small>${n.isReminder ? 'Reminder' : getTimeAgo(new Date(n.created_at))}</small>
            </div>
            ${n.isReminder ? `<button type="button" class="btn btn-primary btn-sm" onclick="closeModal('notificationsModal'); navigateToPage('subscription')">Renew</button>` : ''}
        </div>
    `).join('');
}
