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
let selectedPlan = null;     // 'yearly'
let selectedMethod = null;   // 'gcash' | 'bank'
let generatedReceipt = null; // { blob, url, receiptNo, plan, method, amount }
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
    const subForm = document.getElementById('subForm');
    subForm.addEventListener('submit', handleSubscriptionSubmit);
    subForm.addEventListener('change', event => {
        if (event.target.name === 'method') selectPaymentMethod(event.target.value);
    });
    // Any edit makes the generated receipt out of date
    subForm.addEventListener('input', event => {
        if (event.target.name !== 'method') clearReceipt();
    });
    document.getElementById('subGenerateReceipt').addEventListener('click', handleGenerateReceipt);

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
    let sessionError = null;
    try {
        ({ session, error: sessionError } = await Cloud.getSession());
    } catch (error) {
        sessionError = error;
    }

    if (session?.user) {
        enterAccount({ id: session.user.id, email: session.user.email });
        return;
    }

    // No internet (or Wi-Fi without data) and the login token needs refreshing:
    // keep working offline with the last account on this device.
    const noInternet = !navigator.onLine || Cloud.isNetworkError(sessionError);
    if (noInternet && lastUser?.id) {
        enterAccount(lastUser);
        return;
    }

    showAuthScreen(noInternet ? { message: 'No internet connection. Connect once to sign in.' } : {});
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
    maybeStartTour(); // waits until the Welcome setup is done (tour.js)

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
    endTour({ markDone: false });
    clearInterval(accountRefreshTimer);
    accountRefreshTimer = null;
    currentUser = null;
    account = null;
    resetPaymentForm();
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

    // Entered offline with an expired token: make sure it can be refreshed first
    const { session, error: sessionError } = await Cloud.getSession().catch(error => ({ session: null, error }));
    if (!session) {
        if (!Cloud.isNetworkError(sessionError) && navigator.onLine && currentUser?.id === userId) {
            leaveAccount('Your session expired. Please sign in again.');
        }
        return;
    }

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

const PLAN_LABELS = new Proxy({ yearly: 'Yearly', trial: 'Free Trial' }, { get: (labels, plan) => labels[plan] ?? 'Plan' });
const METHOD_LABELS = { gcash: 'GCash', bank: 'Bank Transfer' };

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
    return Number(s.yearly_price);
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
        text = state.pending ? 'Payment under review. We\'ll notify you once approved.' : 'Subscribe to the Yearly plan to start using CashG.';
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
                : 'Pay for the Yearly plan below via GCash or bank transfer, then send us your receipt.'}</p>
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
                <span>${PLAN_LABELS[p.plan]} · ${peso(p.amount)} · ${METHOD_LABELS[p.payment_method] || 'GCash'} Ref ${escapeHtml(p.payment_reference)}</span>
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
    const yearly = planPrice('yearly');
    selectedPlan = 'yearly'; // the only plan on sale

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
        option('yearly', yearly, 'year', 'Billed once a year');

    const form = document.getElementById('subForm');
    form.hidden = !selectedPlan;
    if (!selectedPlan) return;

    renderPaymentMethod();
}

// Where to send the money, for the chosen method
function paymentDestination(method) {
    const s = account?.settings || {};
    if (method === 'bank') {
        return {
            // Bank details or a QR image is enough to offer bank transfer
            available: s.payment_bank_enabled !== false &&
                Boolean((s.payment_bank_name && s.payment_bank_account_number) || s.payment_bank_qr_url),
            qr: s.payment_bank_qr_url || '',
            // Skip blank details so a QR-only bank doesn't show empty rows
            rows: [
                ['Bank', s.payment_bank_name],
                ['Account name', s.payment_bank_account_name],
                ['Account number', s.payment_bank_account_number]
            ].filter(([, value]) => value)
        };
    }
    return {
        available: s.payment_gcash_enabled !== false,
        qr: s.payment_gcash_qr_url || '',
        rows: [
            ['Account name', s.payment_gcash_name || 'Ask the admin for the GCash name'],
            ['GCash number', s.payment_gcash_number || '—']
        ]
    };
}

function renderPaymentMethod() {
    const bankOption = document.querySelector('#subForm input[name="method"][value="bank"]');
    const bankAvailable = paymentDestination('bank').available;
    bankOption.disabled = !bankAvailable;
    bankOption.closest('.method-option').querySelector('small').textContent =
        bankAvailable ? 'InstaPay / PESONet' : 'Not available now';
    const gcashOption = document.querySelector('#subForm input[name="method"][value="gcash"]');
    const gcashAvailable = paymentDestination('gcash').available;
    gcashOption.disabled = !gcashAvailable;
    gcashOption.closest('.method-option').querySelector('small').textContent =
        gcashAvailable ? 'E-wallet' : 'Not available now';
    if (selectedMethod === 'bank' && !bankAvailable) selectedMethod = null;
    if (selectedMethod === 'gcash' && !gcashAvailable) selectedMethod = null;

    document.querySelectorAll('#subForm input[name="method"]').forEach(input => {
        input.checked = input.value === selectedMethod;
    });
    document.getElementById('subFormBody').hidden = !selectedMethod;
    if (!selectedMethod) return;

    const isBank = selectedMethod === 'bank';
    const amount = planPrice(selectedPlan);
    if (generatedReceipt && generatedReceipt.amount !== amount) clearReceipt(); // price changed meanwhile

    document.getElementById('subPayTitle').textContent = isBank ? 'Send via bank transfer' : 'Send via GCash';
    document.getElementById('subPayIcon').innerHTML = `<use href="#i-${isBank ? 'store' : 'phone-device'}"/>`;
    document.getElementById('subPayAmount').textContent = peso(amount);
    const destination = paymentDestination(selectedMethod);
    document.getElementById('subPayRows').innerHTML = destination.rows
        .map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join('');
    document.getElementById('subPayQr').hidden = !destination.qr;
    if (destination.qr) document.getElementById('subPayQrImg').src = destination.qr;

    const s = account.settings || {};
    const instructions = document.getElementById('subPayInstructions');
    instructions.textContent = s.payment_instructions || '';
    instructions.hidden = !s.payment_instructions;

    document.getElementById('subBankGroup').hidden = !isBank;
    document.getElementById('subSenderNameLabel').textContent = isBank ? 'Sender Account Name' : 'Sender GCash Name';
    document.getElementById('subSenderAccountLabel').textContent = isBank ? 'Sender Account Number' : 'Sender GCash Number';
    document.getElementById('subSenderAccount').placeholder = isBank ? 'Account number you paid from' : '09XX XXX XXXX';
    document.getElementById('subReferenceLabel').textContent = isBank ? 'Bank Reference / Trace No.' : 'GCash Reference No.';
    document.getElementById('subReference').placeholder = isBank ? 'Reference number on your transfer' : '13-digit reference number';
}

function openQrViewer() {
    const src = document.getElementById('subPayQrImg').src;
    if (!src) return;
    document.getElementById('qrViewerImg').src = src;
    document.getElementById('qrViewer').hidden = false;
}

function closeQrViewer() {
    document.getElementById('qrViewer').hidden = true;
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeQrViewer();
});

function selectPaymentMethod(method) {
    if (method === selectedMethod) return;
    selectedMethod = method;
    clearReceipt();
    renderPaymentMethod();

    const form = document.getElementById('subForm');
    if (!form.elements.senderName.value) form.elements.senderName.value = form.elements.fullName.value;
    // A GCash number and a bank account number are never the same thing
    form.elements.senderAccount.value = method === 'gcash' ? form.elements.phone.value : '';
    form.elements.senderBank.value = '';
}

function selectPlan(plan) {
    const firstSelection = !selectedPlan;
    if (plan !== selectedPlan) clearReceipt();
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
                <span>${formatLongDate(r.created_at)} · ${METHOD_LABELS[r.payment_method] || 'GCash'} Ref ${escapeHtml(r.payment_reference)}</span>
                ${r.admin_note ? `<small>Admin: ${escapeHtml(r.admin_note)}</small>` : ''}
            </div>
            <span class="status-chip status-${r.status}">${labels[r.status]}</span>
        </div>
    `).join('');
}

// ---------------------------------------------------------------------
// Payment form & receipt
// ---------------------------------------------------------------------

function readPaymentForm() {
    const f = document.getElementById('subForm').elements;
    return {
        plan: selectedPlan,
        method: selectedMethod,
        fullName: f.fullName.value.trim(),
        phone: f.phone.value.trim(),
        businessName: f.businessName.value.trim(),
        address: f.address.value.trim(),
        senderName: f.senderName.value.trim(),
        senderAccount: f.senderAccount.value.trim(),
        senderBank: selectedMethod === 'bank' ? f.senderBank.value.trim() : '',
        reference: f.reference.value.trim()
    };
}

function paymentFormProblem(values) {
    if (!values.plan) return 'Choose a plan first.';
    if (!values.method) return 'Choose GCash or Bank Transfer.';
    if (!values.fullName || !values.phone) return 'Please fill in your name and mobile number.';
    if (values.method === 'bank' && !values.senderBank) return 'Please enter the bank you paid from.';
    if (!values.senderName || !values.senderAccount) return 'Please fill in the account you paid from.';
    if (values.reference.length < 4) return 'Please enter the reference number of your payment.';
    return '';
}

function newReceiptNo() {
    const now = new Date();
    const date = localDateString(now).replace(/-/g, '');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
    return `CG-${date}-${code}`;
}

function clearReceipt() {
    if (!generatedReceipt) return;
    URL.revokeObjectURL(generatedReceipt.url);
    generatedReceipt = null;
    document.getElementById('subReceiptPreview').hidden = true;
    document.getElementById('subReceiptImage').removeAttribute('src');
    document.getElementById('subSubmit').disabled = true;
    document.getElementById('subSubmitNote').textContent =
        'Generate your receipt first, then send it. The admin will check your payment and activate your plan.';
}

function resetPaymentForm() {
    clearReceipt();
    selectedPlan = null;
    selectedMethod = null;
    document.getElementById('subForm').reset();
    document.getElementById('subFormBody').hidden = true;
}

async function handleGenerateReceipt() {
    if (!currentUser || !account) return;
    const values = readPaymentForm();
    const problem = paymentFormProblem(values);
    if (problem) {
        showNotification(problem, 'error');
        return;
    }

    const button = document.getElementById('subGenerateReceipt');
    button.disabled = true;
    try {
        clearReceipt();
        const receiptNo = newReceiptNo();
        const amount = planPrice(values.plan);
        const blob = await renderReceiptPng({
            ...values,
            receiptNo,
            amount,
            email: currentUser.email,
            issuedAt: new Date(),
            destination: paymentDestination(values.method).rows
        });

        generatedReceipt = { blob, url: URL.createObjectURL(blob), receiptNo, amount };
        document.getElementById('subReceiptImage').src = generatedReceipt.url;
        const download = document.getElementById('subReceiptDownload');
        download.href = generatedReceipt.url;
        download.download = `CashG-Receipt-${receiptNo}.png`;
        document.getElementById('subReceiptPreview').hidden = false;
        document.getElementById('subSubmit').disabled = false;
        document.getElementById('subSubmitNote').textContent =
            'Check your receipt, then send it. Editing any detail means generating it again.';
        document.getElementById('subReceiptPreview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
        console.error('Could not generate receipt', error);
        showNotification('Could not generate the receipt. Please try again.', 'error');
    } finally {
        button.disabled = false;
    }
}

async function handleSubscriptionSubmit(event) {
    event.preventDefault();
    if (!currentUser || !selectedPlan) return;

    const values = readPaymentForm();
    const problem = paymentFormProblem(values);
    if (problem) {
        showNotification(problem, 'error');
        return;
    }
    if (!generatedReceipt) {
        showNotification('Tap "Generate Receipt" first.', 'error');
        return;
    }
    if (!navigator.onLine) {
        showNotification('You are offline. Connect to the internet to send your receipt.', 'error');
        return;
    }

    const button = document.getElementById('subSubmit');
    button.disabled = true;
    button.classList.add('is-loading');

    try {
        await Cloud.submitSubscriptionRequest(
            currentUser.id,
            { ...values, receiptNo: generatedReceipt.receiptNo },
            generatedReceipt.blob
        );
        resetPaymentForm();
        showNotification('Receipt sent! We\'ll notify you once your payment is approved.', 'success');
        await refreshAccount();
        window.scrollTo(0, 0);
    } catch (error) {
        showNotification(Cloud.friendlyError(error), 'error');
        button.disabled = !generatedReceipt;
    } finally {
        button.classList.remove('is-loading');
    }
}

// --- Receipt image (canvas → PNG) ------------------------------------

const RECEIPT_WIDTH = 720;
const RECEIPT_SCALE = 2;
const RECEIPT_FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function loadImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function receiptPeso(value) {
    return '₱' + Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width <= maxWidth || !line) {
            line = test;
        } else {
            lines.push(line);
            line = word;
        }
        // A single word longer than the column: break it by characters
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
            let cut = line.length - 1;
            while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Draws the receipt and returns its height. With draw = false it only measures.
function drawReceipt(ctx, r, logo, draw) {
    const W = RECEIPT_WIDTH;
    const PAD = 48;
    const font = (weight, size) => `${weight} ${size}px ${RECEIPT_FONT}`;
    const ink = '#04263d', ink2 = '#445a6e', ink3 = '#8797a8', line = '#e6eaf1', brand = '#03955f';
    let y = 0;

    // Header
    const headerH = 132;
    if (draw) {
        const grad = ctx.createLinearGradient(0, 0, W, headerH);
        grad.addColorStop(0, '#04ad72');
        grad.addColorStop(1, '#0b8464');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, headerH);

        let textX = PAD;
        if (logo) {
            ctx.fillStyle = '#ffffff';
            roundRect(ctx, PAD, 34, 64, 64, 16);
            ctx.fill();
            ctx.drawImage(logo, PAD + 8, 42, 48, 48);
            textX = PAD + 84;
        }
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        ctx.font = font(800, 30);
        ctx.fillText('CashG', textX, 66);
        ctx.font = font(500, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillText('Subscription Payment Receipt', textX, 92);

        ctx.textAlign = 'right';
        ctx.font = font(600, 13);
        ctx.fillText('RECEIPT NO.', W - PAD, 58);
        ctx.font = font(700, 17);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(r.receiptNo, W - PAD, 82);
    }
    y = headerH + 44;

    // Amount
    if (draw) {
        ctx.textAlign = 'center';
        ctx.fillStyle = ink3;
        ctx.font = font(600, 15);
        ctx.fillText('AMOUNT PAID', W / 2, y);
        ctx.fillStyle = ink;
        ctx.font = font(800, 48);
        ctx.fillText(receiptPeso(r.amount), W / 2, y + 56);
        ctx.fillStyle = ink2;
        ctx.font = font(500, 16);
        ctx.fillText(`${PLAN_LABELS[r.plan]} plan · 1 year access`, W / 2, y + 86);

        // Status pill
        ctx.font = font(700, 13);
        const pill = 'PENDING VERIFICATION';
        const pw = ctx.measureText(pill).width + 32;
        ctx.fillStyle = '#fff4e0';
        roundRect(ctx, (W - pw) / 2, y + 104, pw, 30, 15);
        ctx.fill();
        ctx.fillStyle = '#b45309';
        ctx.fillText(pill, W / 2, y + 124);
    }
    y += 166;

    const section = title => {
        if (draw) {
            ctx.strokeStyle = line;
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(PAD, y);
            ctx.lineTo(W - PAD, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.textAlign = 'left';
            ctx.fillStyle = brand;
            ctx.font = font(700, 13);
            ctx.fillText(title.toUpperCase(), PAD, y + 34);
        }
        y += 52;
    };

    const labelW = 200;
    const valueW = W - PAD * 2 - labelW - 16;
    const row = (label, value) => {
        ctx.font = font(600, 16);
        const lines = wrapText(ctx, value || '—', valueW);
        if (draw) {
            ctx.textAlign = 'right';
            ctx.fillStyle = ink;
            lines.forEach((text, i) => ctx.fillText(text, W - PAD, y + 12 + i * 23));
            ctx.textAlign = 'left';
            ctx.fillStyle = ink2;
            ctx.font = font(500, 15);
            ctx.fillText(label, PAD, y + 12);
        }
        y += 23 * lines.length + 14;
    };

    const issued = r.issuedAt.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

    section('Payment');
    row('Payment method', r.method === 'bank' ? 'Bank Transfer' : 'GCash (E-wallet)');
    row('Reference no.', r.reference);
    row('Date issued', issued);

    section('Paid to');
    r.destination.forEach(([label, value]) => row(label, value));

    section('Paid from');
    if (r.method === 'bank') row('Bank', r.senderBank);
    row('Account name', r.senderName);
    row(r.method === 'bank' ? 'Account number' : 'GCash number', r.senderAccount);

    // Footer
    y += 8;
    if (draw) {
        ctx.fillStyle = '#f5f8f7';
        ctx.fillRect(0, y, W, 96);
        ctx.textAlign = 'center';
        ctx.fillStyle = ink2;
        ctx.font = font(500, 14);
        ctx.fillText('Your plan is activated once the CashG admin verifies this payment.', W / 2, y + 40);
        ctx.fillStyle = ink3;
        ctx.font = font(500, 13);
        ctx.fillText(`Generated in the CashG app · ${r.receiptNo}`, W / 2, y + 64);
    }
    y += 96;

    return y;
}

async function renderReceiptPng(receipt) {
    try {
        await Promise.all([
            document.fonts.load(`500 16px ${RECEIPT_FONT}`),
            document.fonts.load(`700 16px ${RECEIPT_FONT}`),
            document.fonts.load(`800 16px ${RECEIPT_FONT}`)
        ]);
    } catch { /* offline: system font is fine */ }
    const logo = await loadImage('icons/logo-mark.png');

    const measure = document.createElement('canvas').getContext('2d');
    const height = drawReceipt(measure, receipt, logo, false);

    const canvas = document.createElement('canvas');
    canvas.width = RECEIPT_WIDTH * RECEIPT_SCALE;
    canvas.height = height * RECEIPT_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(RECEIPT_SCALE, RECEIPT_SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, RECEIPT_WIDTH, height);
    drawReceipt(ctx, receipt, logo, true);

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
    });
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
