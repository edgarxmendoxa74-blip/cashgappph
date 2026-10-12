// ===================================
// CASHG TRACKER
// ===================================

// Accounts the shop keeps money in. Cash is what is in the drawer; the rest are non-cash.
const ACCOUNTS = [
    { id: 'cash', label: 'Cash', digital: false },
    { id: 'gcash', label: 'GCash', digital: true },
    { id: 'maya', label: 'Maya', digital: true },
    { id: 'bank', label: 'Bank', digital: true }
];
const DIGITAL_ACCOUNTS = ACCOUNTS.filter(a => a.digital);

function accountLabel(id) {
    return ACCOUNTS.find(a => a.id === id)?.label || '—';
}

function defaultRates() {
    return [
        { id: 1, min: 1, max: 1000, cashIn: 5, cashOut: 10 },
        { id: 2, min: 1001, max: 3000, cashIn: 10, cashOut: 15 },
        { id: 3, min: 3001, max: null, cashIn: 15, cashOut: 20 }
    ];
}

// Data Storage
// Each device keeps its own inventory in localStorage.
function createEmptyInventory() {
    return {
        accounts: { cash: 0, gcash: 0, maya: 0, bank: 0 },
        transactions: [],
        finance: [],
        settings: {
            rates: defaultRates(),
            businessName: ''
        }
    };
}

// Fill in any fields missing from older saves or imported backups
function normalizeInventory(data) {
    const base = createEmptyInventory();
    const settings = (data && data.settings) || {};

    // Older saves kept only cash and gcash at the top level
    const accounts = {};
    ACCOUNTS.forEach(a => {
        accounts[a.id] = round2(Number(data?.accounts?.[a.id] ?? data?.[a.id]) || 0);
    });

    // Older saves had three fixed fee tiers instead of a list of rates
    let rates;
    if (Array.isArray(settings.rates)) {
        rates = settings.rates
            .filter(r => r && Number.isFinite(Number(r.min)))
            .map((r, i) => ({
                id: r.id ?? i + 1,
                min: Number(r.min),
                max: r.max === null || r.max === undefined || r.max === '' ? null : Number(r.max),
                cashIn: Number(r.cashIn) || 0,
                cashOut: Number(r.cashOut) || 0
            }));
    } else if (settings.cashInFees || settings.cashOutFees) {
        const ci = settings.cashInFees || {};
        const co = settings.cashOutFees || {};
        rates = [
            { id: 1, min: 1, max: 1000, cashIn: Number(ci.tier1) || 0, cashOut: Number(co.tier1) || 0 },
            { id: 2, min: 1001, max: 3000, cashIn: Number(ci.tier2) || 0, cashOut: Number(co.tier2) || 0 },
            { id: 3, min: 3001, max: null, cashIn: Number(ci.tier3) || 0, cashOut: Number(co.tier3) || 0 }
        ];
    } else {
        rates = base.settings.rates;
    }

    const allTransactions = Array.isArray(data?.transactions) ? data.transactions : [];
    const transactions = allTransactions
        .filter(t => t && t.type !== 'adjustment')
        .map(t => (t.type === 'cashin' || t.type === 'cashout') && !t.account ? { ...t, account: 'gcash' } : t);

    // Finance ledger. Older balance adjustments become Add / Withdraw entries
    // (they never recorded which account, so they are display-only).
    const finance = (Array.isArray(data?.finance) ? data.finance : []).filter(f => f && FINANCE_KINDS[f.kind]);
    allTransactions.filter(t => t && t.type === 'adjustment').forEach(t => {
        finance.push({
            id: t.id,
            date: t.date,
            kind: t.total >= 0 ? 'add' : 'withdraw',
            account: t.account || null,
            amount: Math.abs(Number(t.total) || Number(t.amount) || 0),
            note: t.notes || '',
            legacy: !t.account
        });
    });

    return {
        accounts,
        transactions,
        finance,
        settings: {
            businessName: settings.businessName || '',
            rates
        }
    };
}

const FINANCE_KINDS = {
    add: { label: 'Add', cls: 'is-add' },
    withdraw: { label: 'Withdraw', cls: 'is-withdraw' },
    send: { label: 'Send', cls: 'is-send' },
    receive: { label: 'Receive', cls: 'is-receive' }
};

let inventory = createEmptyInventory();

function digitalTotal() {
    return round2(DIGITAL_ACCOUNTS.reduce((sum, a) => sum + inventory.accounts[a.id], 0));
}

// SVG icon from the sprite in index.html
function icon(name, className = '') {
    return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Escape user-entered text before putting it into innerHTML
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

// Round to centavos so repeated additions never drift (0.1 + 0.2)
function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Unique id even when two records are saved in the same millisecond
function newRecordId() {
    return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function peso(value) {
    return '₱' + Number(value || 0).toLocaleString();
}

// ₱1,234.50: always two decimals, used for balances and totals
function pesoFull(value) {
    const n = Number(value || 0);
    return (n < 0 ? '-₱' : '₱') + Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// YYYY-MM-DD in the device's local time (toISOString would give the UTC date)
function localDateString(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ===================================
// THEME
// ===================================

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    const label = document.getElementById('themeLabel');
    const use = document.querySelector('#themeIcon use');
    if (label) label.textContent = dark ? 'Light' : 'Dark';
    if (use) use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1424' : '#03955f');
}

function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cashg-theme', next); } catch { /* private mode */ }
    applyTheme(next);
}

// Current State
const TAB_PAGES = ['dashboard', 'rates', 'inventory'];
let currentPage = 'dashboard';
let navigatingBack = false;

// Android/browser back button: close an open sheet first, then step back through pages
window.addEventListener('popstate', event => {
    const openModal = document.querySelector('.modal.active:not(#welcomeModal)');
    if (openModal) {
        closeModal(openModal.id);
        history.pushState({ page: currentPage }, '', '#' + currentPage);
        return;
    }
    const menu = document.querySelector('.sidebar.active');
    if (menu) {
        setSidebarOpen(false);
        history.pushState({ page: currentPage }, '', '#' + currentPage);
        return;
    }
    const page = event.state?.page || 'dashboard';
    navigatingBack = true;
    navigateToPage(page);
    navigatingBack = false;
});
let currentTransactionType = '';
let currentBalanceType = '';
let currentBalanceAction = '';

// Transactions list filter: all | today | month | date (a picked day)
let txnRange = 'all';
let txnDate = '';

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', function() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    initializeNavigation();
    initializeModals();
    initializePWA();

    // Sign-in screen, or straight into the app if already signed in (account.js)
    startAccount();
});

// Called by account.js once a user is signed in
function enterInventory() {
    const hasSavedData = loadFromLocalStorage();
    updateAllBalances();
    updateBusinessName();
    navigateToPage('dashboard');

    // First time for this account on this device: ask for starting balances
    if (!hasSavedData) {
        openWelcomeModal();
    }
}

// Called by account.js on sign out: forget the previous user's data in memory
function leaveInventory() {
    inventory = createEmptyInventory();
    txnRange = 'all';
    txnDate = '';
    updateAllBalances();
    updateBusinessName();
    navigateToPage('dashboard');
}

// ===================================
// LOCAL STORAGE
// ===================================

// Inventory saved before accounts existed; the first account to sign in adopts it
const LEGACY_INVENTORY_KEY = 'gcashInventory';

// Returns true if the signed-in account already has saved data on this device
function loadFromLocalStorage() {
    const key = inventoryStorageKey();
    inventory = createEmptyInventory();
    if (!key) return false;

    let saved = localStorage.getItem(key);
    if (!saved) {
        const legacy = localStorage.getItem(LEGACY_INVENTORY_KEY);
        if (legacy) {
            localStorage.setItem(key, legacy);
            localStorage.removeItem(LEGACY_INVENTORY_KEY);
            saved = legacy;
        }
    }
    if (!saved) return false;

    try {
        inventory = normalizeInventory(JSON.parse(saved));
        return true;
    } catch (error) {
        console.error('Could not read saved inventory', error);
        return false;
    }
}

function saveToLocalStorage() {
    const key = inventoryStorageKey();
    if (!key) return false;
    try {
        localStorage.setItem(key, JSON.stringify(inventory));
        return true;
    } catch (error) {
        console.error('Could not save inventory', error);
        return false;
    }
}

// ===================================
// FIRST-RUN SETUP
// ===================================

function openWelcomeModal() {
    document.getElementById('welcomeBusinessName').value =
        inventory.settings.businessName || account?.profile?.business_name || '';
    ['Cash', 'Gcash', 'Maya', 'Bank'].forEach(name => {
        const input = document.getElementById('welcome' + name);
        if (input) input.value = '';
    });
    document.getElementById('welcomeModal').classList.add('active');
}

function saveWelcomeSetup() {
    const read = id => {
        const value = parseFloat(document.getElementById(id)?.value);
        return value > 0 ? round2(value) : 0;
    };

    inventory.settings.businessName = document.getElementById('welcomeBusinessName').value.trim();
    inventory.accounts.cash = read('welcomeCash');
    inventory.accounts.gcash = read('welcomeGcash');
    inventory.accounts.maya = read('welcomeMaya');
    inventory.accounts.bank = read('welcomeBank');

    saveToLocalStorage();
    closeModal('welcomeModal');
    updateBusinessName();
    updateAllBalances();
    showNotification('Your inventory is ready!', 'success');

    // First sign-in on this device: show how the app works (tour.js)
    maybeStartTour();
}

function updateBusinessName() {
    const name = inventory.settings.businessName || 'My Business';
    const label = document.getElementById('sidebarBusinessName');
    if (label) label.textContent = name;
}

// ===================================
// NAVIGATION
// ===================================

// What the + menu offers first, depending on the tab you are on
const FAB_ACTIONS = {
    'new-transaction': () => openTransactionModal(),
    'add-rate': () => openRateModal(),
    'fin-add': () => openFinanceModal('add'),
    'fin-withdraw': () => openFinanceModal('withdraw'),
    'fin-transfer': () => openFinanceModal('transfer')
};

function fabContextItems(page) {
    if (page === 'rates') {
        return [{ action: 'add-rate', icon: 'plus', label: 'Add Rate' }];
    }
    if (page === 'inventory') {
        return [
            { action: 'fin-add', icon: 'plus', label: 'Add Capital' },
            { action: 'fin-withdraw', icon: 'minus', label: 'Withdrawal' },
            { action: 'fin-transfer', icon: 'repeat', label: 'Transfer' }
        ];
    }
    return [{ action: 'new-transaction', icon: 'plus', label: 'New Transaction' }];
}

function renderFabMenu(page) {
    const menu = document.querySelector('.sidebar-menu');
    if (!menu) return;
    menu.querySelectorAll('li[data-context]').forEach(li => li.remove());
    const items = fabContextItems(page);
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'menu-item';
        li.dataset.context = '1';
        li.innerHTML = `<a href="#" data-action="${item.action}">${icon(item.icon)}<span>${item.label}</span></a>`;
        fragment.appendChild(li);
    });
    menu.insertBefore(fragment, menu.firstChild);

    // Finance shows the "more" dots like a speed-dial; other tabs show +
    const use = document.querySelector('#fabButton use');
    if (use) use.setAttribute('href', page === 'inventory' ? '#i-dots' : '#i-plus');
}

function initializeNavigation() {
    const tabs = document.querySelectorAll('.tt-tab');
    const menu = document.querySelector('.sidebar-menu');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const fab = document.getElementById('fabButton');

    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            setSidebarOpen(false);
            navigateToPage(this.getAttribute('data-page'));
        });
    });

    // One listener for the whole menu, because its first items are rebuilt per tab
    if (menu) {
        menu.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (!link) return;
            e.preventDefault();
            setSidebarOpen(false);
            const action = FAB_ACTIONS[link.dataset.action];
            if (action) action();
            else if (link.dataset.page) navigateToPage(link.dataset.page);
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => setSidebarOpen(false));
    }

    if (fab) {
        fab.addEventListener('click', function() {
            // On Trans and Rates the + goes straight to the form
            const direct = { dashboard: () => openTransactionModal(), rates: () => openRateModal() }[currentPage];
            if (direct) {
                setSidebarOpen(false);
                direct();
                return;
            }
            const panel = document.querySelector('.sidebar');
            setSidebarOpen(!panel.classList.contains('active'));
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') setSidebarOpen(false);
    });

    renderFabMenu('dashboard');
}

// The + button's pop-up menu
function setSidebarOpen(open) {
    const menu = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const fab = document.getElementById('fabButton');
    if (!menu) return;
    menu.classList.toggle('active', open);
    if (overlay) overlay.classList.toggle('active', open);
    if (fab) {
        fab.classList.toggle('is-open', open);
        fab.setAttribute('aria-expanded', String(open));
    }
}

function navigateToPage(page) {
    if (!document.getElementById(`${page}-page`)) page = 'dashboard';

    // Hide all pages, show the selected one
    document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
    document.getElementById(`${page}-page`).style.display = 'block';

    // Active tab (Reports, Subscription and Settings live in the + menu)
    document.querySelectorAll('.tt-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.page === page);
    });
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`.menu-item a[data-page="${page}"]`)?.parentElement.classList.add('active');

    window.scrollTo(0, 0);

    if (currentPage !== page && !navigatingBack) {
        history.pushState({ page }, '', '#' + page);
    }
    currentPage = page;
    document.body.dataset.page = page;
    renderFabMenu(page);

    // Load page-specific content
    switch (page) {
        case 'dashboard':
            loadTransactions();
            break;
        case 'rates':
            loadRates();
            break;
        case 'inventory':
            updateInventoryPage();
            break;
        case 'reports':
            loadReports();
            break;
        case 'subscription':
            renderSubscriptionPage();
            refreshAccount();
            break;
    }

    renderSubscriptionBanner();
}

// ===================================
// TRANSACTIONS
// ===================================

// Receipt photo for the transaction being entered (a small JPEG data URL)
let pendingReceipt = '';
let pendingReceiptBlob = null;
let savingTransaction = false;

function setReceiptPreview(dataUrl, blob = null) {
    pendingReceipt = dataUrl || '';
    pendingReceiptBlob = dataUrl ? blob : null;
    const box = document.getElementById('receiptPreview');
    document.getElementById('receiptPreviewImg').src = pendingReceipt;
    box.hidden = !pendingReceipt;
}

function clearReceipt() {
    setReceiptPreview('');
}

// Shrink the photo so a receipt costs tens of KB, not megabytes of phone storage
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 720 / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
            canvas.toBlob(blob => resolve({ dataUrl, blob }), 'image/jpeg', 0.55);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Not an image'));
        };
        img.src = url;
    });
}

async function handleReceiptFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
        const { dataUrl, blob } = await compressImage(file);
        setReceiptPreview(dataUrl, blob);
    } catch {
        showNotification('Could not read that photo', 'error');
    }
}

async function viewReceipt(id) {
    const transaction = inventory.transactions.find(t => t.id === id);
    if (!transaction?.receipt) return;
    const ref = transaction.receipt;
    // Photos saved on this phone load from storage; older ImageKit receipts are
    // served resized and optimised; the oldest are data URLs inside the record
    const src = ReceiptStore.isLocal(ref) ? await ReceiptStore.load(ref) : Cloud.imageUrl(ref);
    if (!src) return showNotification('This receipt photo is no longer on this device', 'error');
    document.getElementById('receiptImage').src = src;
    document.getElementById('receiptModal').classList.add('active');
}

function openTransactionModal(type) {
    if (!requireSubscription()) return;
    currentTransactionType = type || '';
    setReceiptPreview('');
    const modal = document.getElementById('transactionModal');
    const typeSelect = document.getElementById('transactionType');

    // Reset first so the preset type below isn't wiped out
    document.getElementById('transactionForm').reset();
    const dateInput = document.getElementById('transactionDate');
    dateInput.value = localDateString(new Date());
    dateInput.max = localDateString(new Date());

    typeSelect.value = type || 'cashin';
    if (!type) currentTransactionType = 'cashin';

    setSidebarOpen(false);
    modal.classList.add('active');
    updateTransactionForm();
    setTimeout(() => document.getElementById('transactionAmount').focus(), 120);
}

function setQuickAmount(value) {
    const input = document.getElementById('transactionAmount');
    input.value = value;
    calculateFee();
    input.focus();
}

// Filter chips: All / Today / This month
function setTransactionRange(range) {
    txnRange = range;
    txnDate = '';
    const dateInput = document.getElementById('dateFilter');
    if (dateInput) dateInput.value = '';
    loadTransactions();
}

// Calendar pop-up (centered): tap a day to show that day's transactions
let calMonth = new Date();

function openCalendar() {
    calMonth = txnDate ? new Date(txnDate + 'T00:00:00') : new Date();
    calMonth.setDate(1);
    renderCalendar();
    document.getElementById('calendarModal').classList.add('active');
}

function shiftCalendar(step) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + step, 1);
    renderCalendar();
}

function renderCalendar() {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    document.getElementById('calTitle').textContent = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const today = localDateString(new Date());
    const blanks = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    let html = '<span></span>'.repeat(blanks);
    for (let day = 1; day <= days; day++) {
        const value = localDateString(new Date(year, month, day));
        const cls = ['cal-day', value === txnDate ? 'is-selected' : '', value === today ? 'is-today' : ''].join(' ');
        html += `<button type="button" class="${cls}" ${value > today ? 'disabled' : ''} onclick="pickCalendarDay('${value}')">${day}</button>`;
    }
    document.getElementById('calDays').innerHTML = html;
}

function pickCalendarDay(value) {
    setTransactionDate(value);
    closeModal('calendarModal');
}

// Calendar button: show one day. Clearing the date goes back to All.
function setTransactionDate(value) {
    txnDate = value || '';
    txnRange = txnDate ? 'date' : 'all';
    loadTransactions();
}

// Cash In / Cash Out toggle buttons drive the hidden select
function setTransactionType(type) {
    document.getElementById('transactionType').value = type;
    updateTransactionForm();
}

function updateTransactionForm() {
    const type = document.getElementById('transactionType').value;
    currentTransactionType = type;

    document.querySelectorAll('.type-option').forEach(option => {
        const active = option.dataset.type === type;
        option.classList.toggle('active', active);
        option.setAttribute('aria-checked', String(active));
    });

    calculateFee();
}

// Fee for an amount from the Rates table (₱0 if no range matches)
function lookupFee(type, amount) {
    const rate = inventory.settings.rates.find(r => amount >= r.min && (r.max === null || amount <= r.max));
    if (!rate) return 0;
    return Number(type === 'cashin' ? rate.cashIn : rate.cashOut) || 0;
}

function calculateFee() {
    const amount = parseFloat(document.getElementById('transactionAmount').value) || 0;
    const type = currentTransactionType;
    const fee = type && amount > 0 ? lookupFee(type, amount) : 0;

    document.getElementById('transactionFee').value = fee;

    let total = amount;
    if (type === 'cashin') total = amount + fee;
    else if (type === 'cashout') total = amount - fee;

    document.getElementById('transactionTotal').value = round2(total);
}

async function saveTransaction() {
    if (savingTransaction || !requireSubscription()) return;
    const type = document.getElementById('transactionType').value;
    const account = document.getElementById('transactionAccount').value;
    const dateValue = document.getElementById('transactionDate').value;
    const amount = round2(parseFloat(document.getElementById('transactionAmount').value));
    const fee = round2(parseFloat(document.getElementById('transactionFee').value) || 0);
    const total = round2(parseFloat(document.getElementById('transactionTotal').value));
    const reference = document.getElementById('referenceNumber').value.trim();
    const notes = document.getElementById('transactionNotes').value.trim();

    if (!type || !account || !amount) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }

    if (!(amount > 0) || !Number.isFinite(total) || total <= 0) {
        showNotification('Enter a valid amount greater than zero', 'error');
        return;
    }

    // Today keeps the exact time; a back-dated entry is saved at noon of that day
    const today = localDateString(new Date());
    if (dateValue > today) {
        showNotification('The date cannot be in the future', 'error');
        return;
    }
    const date = !dateValue || dateValue === today ? new Date() : new Date(dateValue + 'T12:00:00');

    // Cash In: the customer hands over cash and we send the amount from an account.
    // Cash Out: we hand over cash and the amount lands in an account.
    if (type === 'cashin' && inventory.accounts[account] < amount) {
        showNotification(`Insufficient ${accountLabel(account)} balance for this transaction`, 'error');
        return;
    }
    if (type === 'cashout' && inventory.accounts.cash < total) {
        showNotification('Insufficient cash for this transaction', 'error');
        return;
    }

    // The receipt photo is kept on this phone (files in the app, IndexedDB in a browser).
    // If that fails, fall back to the small data URL inside the transaction itself.
    let receipt = pendingReceipt;
    let savedNote = '';
    if (pendingReceiptBlob) {
        savingTransaction = true;
        try {
            receipt = await ReceiptStore.save(pendingReceiptBlob);
        } catch (error) {
            console.warn('Could not save the receipt to phone storage, keeping it inside the record', error);
        } finally {
            savingTransaction = false;
        }
    }

    const record = {
        id: newRecordId(),
        date: date.toISOString(),
        type,
        account,
        amount,
        fee,
        total,
        status: 'completed',
        reference,
        notes
    };
    if (receipt) record.receipt = receipt;
    inventory.transactions.push(record);

    if (type === 'cashin') {
        inventory.accounts.cash += total;
        inventory.accounts[account] -= amount;
    } else {
        inventory.accounts.cash -= total;
        inventory.accounts[account] += amount;
    }
    inventory.accounts.cash = round2(inventory.accounts.cash);
    inventory.accounts[account] = round2(inventory.accounts[account]);

    let savedMessage = 'Transaction saved successfully!' + savedNote;
    if (!saveToLocalStorage() && record.receipt) {
        // Phone storage is full: keep the transaction, drop the photo
        ReceiptStore.remove(record.receipt);
        delete record.receipt;
        savedMessage = 'Saved without the receipt photo (storage is full)';
    }
    if (!saveToLocalStorage()) {
        loadFromLocalStorage();
        updateAllBalances();
        showNotification('Could not save: your device storage is full', 'error');
        return;
    }
    closeModal('transactionModal');
    showNotification(savedMessage, 'success');
    updateAllBalances();
    if (currentPage === 'dashboard') loadTransactions();
}

// Cash In / Cash Out records inside the chosen date filter, newest first
function getVisibleTransactions() {
    const now = new Date();
    const today = localDateString(now);
    return inventory.transactions
        .filter(t => t.type === 'cashin' || t.type === 'cashout')
        .filter(t => {
            const day = localDateString(new Date(t.date));
            if (txnRange === 'today') return day === today;
            if (txnRange === 'month') return day.slice(0, 7) === today.slice(0, 7);
            if (txnRange === 'date') return day === txnDate;
            return true;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function loadTransactions() {
    const rows = getVisibleTransactions();

    const totalIn = rows.filter(t => t.type === 'cashin').reduce((sum, t) => sum + t.amount, 0);
    const totalOut = rows.filter(t => t.type === 'cashout').reduce((sum, t) => sum + t.amount, 0);
    const revenue = rows.reduce((sum, t) => sum + (t.fee || 0), 0);

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('ttRevenue', pesoFull(revenue));
    set('ttCashIn', pesoFull(totalIn));
    set('ttCashOut', pesoFull(totalOut));
    set('ttCount', rows.length);

    document.querySelectorAll('.tt-chip').forEach(chip => chip.classList.toggle('active', chip.dataset.range === txnRange));
    document.getElementById('ttDateBtn')?.classList.toggle('active', txnRange === 'date');

    const body = document.getElementById('transactionsTableBody');
    const empty = document.getElementById('ttEmpty');
    if (!body) return;
    if (empty) empty.hidden = rows.length > 0;
    document.getElementById('transactionsTable').hidden = rows.length === 0;

    body.innerHTML = rows.map(t => {
        const isIn = t.type === 'cashin';
        const d = new Date(t.date);
        const day = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `
        <tr>
            <td class="tt-date">${day}<small>${time}</small></td>
            <td>${escapeHtml(accountLabel(t.account))}</td>
            <td><span class="tt-badge ${isIn ? 'is-in' : 'is-out'}">${isIn ? 'Cash in' : 'Cash out'}</span></td>
            <td class="tt-r tt-amt ${isIn ? 'is-in' : 'is-out'}">${pesoFull(t.amount)}<small>Fee ${pesoFull(t.fee)}</small></td>
            <td class="tt-r tt-actions-cell">
                ${t.receipt ? `<button type="button" class="tt-receipt" onclick="viewReceipt(${t.id})" aria-label="View receipt">${icon('image')}</button>` : ''}
                <button type="button" class="tt-del" onclick="deleteTransaction(${t.id})" aria-label="Delete transaction">${icon('trash')}</button>
            </td>
        </tr>`;
    }).join('');
}

// ===================================
// CSV EXPORT
// ===================================

function downloadCsv(filename, header, rows) {
    const cell = v => {
        const text = String(v ?? '');
        return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
    // BOM so Excel opens the file as UTF-8
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportTransactionsCsv() {
    const rows = getVisibleTransactions();
    if (!rows.length) {
        showNotification('No transactions to export', 'error');
        return;
    }
    downloadCsv(`cashg-transactions-${localDateString(new Date())}.csv`,
        ['Date', 'Time', 'Account', 'Type', 'Amount', 'Fee', 'Total', 'Reference', 'Notes'],
        rows.map(t => {
            const d = new Date(t.date);
            return [localDateString(d), d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                accountLabel(t.account), t.type === 'cashin' ? 'Cash in' : 'Cash out',
                t.amount, t.fee || 0, t.total ?? '', t.reference || '', t.notes || ''];
        }));
    showNotification('Transactions exported', 'success');
}

function exportFinanceCsv() {
    const entries = [...inventory.finance].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!entries.length) {
        showNotification('No finance entries to export', 'error');
        return;
    }
    downloadCsv(`cashg-finance-${localDateString(new Date())}.csv`,
        ['Date', 'Type', 'Account', 'Other account', 'Amount', 'Note'],
        entries.map(f => [localDateString(new Date(f.date)), FINANCE_KINDS[f.kind]?.label || f.kind,
            f.account ? accountLabel(f.account) : '', f.counterparty ? accountLabel(f.counterparty) : '',
            f.amount, f.note || '']));
    showNotification('Finance exported', 'success');
}

function deleteTransaction(id) {
    if (!requireSubscription()) return;
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    const transaction = inventory.transactions.find(t => t.id === id);
    if (!transaction) return;

    // Work out the balances after reversing, and refuse if they would go negative
    const account = transaction.account || 'gcash';
    const after = { ...inventory.accounts };
    if (transaction.type === 'cashin') {
        after.cash -= transaction.total;
        after[account] += transaction.amount;
    } else if (transaction.type === 'cashout') {
        after.cash += transaction.total;
        after[account] -= transaction.amount;
    }
    if (Object.values(after).some(v => v < -0.005)) {
        showNotification('Cannot delete: it would make a balance negative', 'error');
        return;
    }

    ACCOUNTS.forEach(a => { inventory.accounts[a.id] = round2(after[a.id]); });
    inventory.transactions = inventory.transactions.filter(t => t.id !== id);
    saveToLocalStorage();
    if (transaction.receipt) ReceiptStore.remove(transaction.receipt);
    showNotification('Transaction deleted', 'success');
    updateAllBalances();
    loadTransactions();
}

// ===================================
// RATES
// ===================================

function formatRange(rate) {
    const from = Number(rate.min).toLocaleString();
    return rate.max === null ? `${from} and up` : `${from} – ${Number(rate.max).toLocaleString()}`;
}

function loadRates() {
    const rates = [...inventory.settings.rates].sort((a, b) => a.min - b.min);
    document.getElementById('rateCount').textContent = rates.length;
    document.getElementById('ratesEmpty').hidden = rates.length > 0;
    document.getElementById('ratesTableBody').innerHTML = rates.map(r => `
        <tr>
            <td>${formatRange(r)}</td>
            <td class="tt-r">${pesoFull(r.cashIn)}</td>
            <td class="tt-r">${pesoFull(r.cashOut)}</td>
            <td class="tt-r">
                <button type="button" class="tt-del" onclick="deleteRate(${r.id})" aria-label="Delete rate">${icon('trash')}</button>
            </td>
        </tr>
    `).join('');
}

function openRateModal() {
    document.getElementById('rateForm').reset();
    document.getElementById('rateModal').classList.add('active');
    setTimeout(() => document.getElementById('rateMin').focus(), 120);
}

function addRate() {
    const min = parseFloat(document.getElementById('rateMin').value);
    const maxRaw = document.getElementById('rateMax').value;
    const max = maxRaw === '' ? null : parseFloat(maxRaw);
    const cashIn = parseFloat(document.getElementById('rateIn').value);
    const cashOut = parseFloat(document.getElementById('rateOut').value);

    if (!(min >= 0) || !(cashIn >= 0) || !(cashOut >= 0) || (max !== null && !(max >= min))) {
        showNotification('Check the range and fees. "To" must be higher than "From".', 'error');
        return;
    }

    const overlaps = inventory.settings.rates.some(r =>
        min <= (r.max === null ? Infinity : r.max) && (max === null ? Infinity : max) >= r.min);
    if (overlaps) {
        showNotification('That range overlaps an existing rate', 'error');
        return;
    }

    inventory.settings.rates.push({ id: newRecordId(), min, max, cashIn: round2(cashIn), cashOut: round2(cashOut) });
    saveToLocalStorage();
    closeModal('rateModal');
    if (currentPage === 'rates') loadRates();
    showNotification('Rate added', 'success');
}

function deleteRate(id) {
    if (!confirm('Delete this rate?')) return;
    inventory.settings.rates = inventory.settings.rates.filter(r => r.id !== id);
    saveToLocalStorage();
    loadRates();
}

// ===================================
// FINANCE (capital, withdrawals, transfers)
// ===================================

let financeMode = 'add';

function financeDay(value) {
    const d = new Date(value);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function updateInventoryPage() {
    const sum = kind => round2(inventory.finance.filter(f => f.kind === kind).reduce((total, f) => total + f.amount, 0));
    document.getElementById('finCapital').textContent = pesoFull(sum('add'));
    document.getElementById('finWithdrawals').textContent = pesoFull(sum('withdraw'));

    const total = ACCOUNTS.reduce((acc, a) => acc + inventory.accounts[a.id], 0);
    document.getElementById('accountList').innerHTML = ACCOUNTS.map(a => `
        <li class="tt-account">
            <span class="tt-dot ${a.digital ? 'is-digital' : 'is-cash'}"></span>
            <span class="tt-account-name">${a.label}</span>
            <strong class="tt-account-amount ${inventory.accounts[a.id] < 0 ? 'is-neg' : ''}">${pesoFull(inventory.accounts[a.id])}</strong>
        </li>`).join('') + `
        <li class="tt-account tt-account-total">
            <span class="tt-account-name">Total assets</span>
            <strong class="tt-account-amount">${pesoFull(total)}</strong>
        </li>`;

    const entries = [...inventory.finance].sort((a, b) => new Date(b.date) - new Date(a.date));
    document.getElementById('finCount').textContent = entries.length;
    document.getElementById('finEmpty').hidden = entries.length > 0;
    document.getElementById('financeBody').innerHTML = entries.map(f => {
        const kind = FINANCE_KINDS[f.kind];
        const positive = f.kind === 'add' || f.kind === 'receive';
        const other = f.counterparty ? `<small>${f.kind === 'send' ? 'To' : 'From'} ${escapeHtml(accountLabel(f.counterparty))}</small>` : (f.note ? `<small class="tt-note">${escapeHtml(f.note)}</small>` : '');
        return `
        <tr>
            <td class="tt-date">${financeDay(f.date)}</td>
            <td><span class="tt-badge ${kind.cls}">${kind.label}</span></td>
            <td>${escapeHtml(f.account ? accountLabel(f.account) : '—')}${other}</td>
            <td class="tt-r tt-amt ${positive ? 'is-in' : 'is-out'}">${pesoFull(f.amount)}</td>
            <td class="tt-r">${f.legacy ? '' : `<button type="button" class="tt-del" onclick="deleteFinance(${f.id})" aria-label="Delete entry">${icon('trash')}</button>`}</td>
        </tr>`;
    }).join('');
}

function openFinanceModal(mode) {
    if (!requireSubscription()) return;
    financeMode = mode;
    const titles = { add: 'Add Capital', withdraw: 'Withdrawal', transfer: 'Transfer Balance' };
    document.getElementById('financeModalTitle').textContent = titles[mode];
    document.getElementById('financeForm').reset();
    const finDate = document.getElementById('finDate');
    finDate.value = localDateString(new Date());
    finDate.max = localDateString(new Date());
    document.getElementById('financeSaveBtn').textContent = { add: 'Save Capital', withdraw: 'Process Withdrawal', transfer: 'Process Transfer' }[mode];
    document.getElementById('finNoteGroup').hidden = mode === 'add';
    document.getElementById('finNote').placeholder = mode === 'withdraw' ? 'Reason' : 'Note';
    document.getElementById('finToGroup').hidden = mode !== 'transfer';
    document.getElementById('finAccountLabel').textContent = { add: 'Account', withdraw: 'Account (deduct from)', transfer: 'Transfer from' }[mode];
    document.getElementById('financeModal').classList.add('active');
    setTimeout(() => document.getElementById('finAmount').focus(), 120);
}

function saveFinance() {
    if (!requireSubscription()) return;
    const account = document.getElementById('finAccount').value;
    const to = document.getElementById('finTo').value;
    const amount = round2(parseFloat(document.getElementById('finAmount').value));
    const note = financeMode === 'add' ? '' : document.getElementById('finNote').value.trim();

    if (!(amount > 0)) {
        showNotification('Enter an amount greater than zero', 'error');
        return;
    }

    // Picked date with the current time, so entries keep their order within a day
    const picked = document.getElementById('finDate').value;
    const when = picked ? new Date(picked + 'T' + new Date().toTimeString().slice(0, 8)) : new Date();
    const now = (isNaN(when) ? new Date() : when).toISOString();
    const pair = newRecordId();

    if (financeMode === 'add') {
        inventory.accounts[account] = round2(inventory.accounts[account] + amount);
        inventory.finance.push({ id: pair, date: now, kind: 'add', account, amount, note });
    } else if (financeMode === 'withdraw') {
        if (inventory.accounts[account] < amount) {
            showNotification(`Not enough ${accountLabel(account)} balance`, 'error');
            return;
        }
        inventory.accounts[account] = round2(inventory.accounts[account] - amount);
        inventory.finance.push({ id: pair, date: now, kind: 'withdraw', account, amount, note });
    } else {
        if (account === to) {
            showNotification('Pick two different accounts', 'error');
            return;
        }
        if (inventory.accounts[account] < amount) {
            showNotification(`Not enough ${accountLabel(account)} balance`, 'error');
            return;
        }
        inventory.accounts[account] = round2(inventory.accounts[account] - amount);
        inventory.accounts[to] = round2(inventory.accounts[to] + amount);
        inventory.finance.push(
            { id: pair, pair, date: now, kind: 'send', account, counterparty: to, amount, note },
            { id: pair + 1, pair, date: now, kind: 'receive', account: to, counterparty: account, amount, note }
        );
    }

    if (!saveToLocalStorage()) {
        loadFromLocalStorage();
        showNotification('Could not save: your device storage is full', 'error');
    } else {
        showNotification('Saved', 'success');
    }
    closeModal('financeModal');
    updateAllBalances();
    if (currentPage === 'inventory') updateInventoryPage();
}

// Delete an entry (a transfer removes both of its sides) and undo its effect on the balances
function deleteFinance(id) {
    if (!requireSubscription()) return;
    const entry = inventory.finance.find(f => f.id === id);
    if (!entry) return;
    if (!confirm('Delete this entry? The balances will be reversed.')) return;

    const group = entry.pair ? inventory.finance.filter(f => f.pair === entry.pair) : [entry];
    const after = { ...inventory.accounts };
    group.forEach(f => {
        const positive = f.kind === 'add' || f.kind === 'receive';
        after[f.account] += positive ? -f.amount : f.amount;
    });
    if (Object.values(after).some(v => v < -0.005)) {
        showNotification('Cannot delete: it would make a balance negative', 'error');
        return;
    }

    ACCOUNTS.forEach(a => { inventory.accounts[a.id] = round2(after[a.id]); });
    inventory.finance = inventory.finance.filter(f => !group.includes(f));
    saveToLocalStorage();
    showNotification('Entry deleted', 'success');
    updateAllBalances();
    updateInventoryPage();
}

// ===================================
// REPORTS
// ===================================

function loadReports() {
    // Set default date range to this month
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    
    if (startInput && !startInput.value) {
        startInput.value = localDateString(firstDay);
    }
    if (endInput && !endInput.value) {
        endInput.value = localDateString(today);
    }
    
    generateReport(true);
}

function setReportRange(range) {
    const today = new Date();
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    
    let startDate = new Date();
    
    switch(range) {
        case 'today':
            startDate = new Date();
            break;
        case 'week':
            startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
    }
    
    if (startInput) startInput.value = localDateString(startDate);
    if (endInput) endInput.value = localDateString(today);

    document.querySelectorAll('.segmented-option[data-range]').forEach(option => {
        option.classList.toggle('active', option.dataset.range === range);
    });

    generateReport(true);
}

// Picking dates by hand means no quick range is selected any more
function clearRangeChips() {
    document.querySelectorAll('.segmented-option[data-range]').forEach(option => option.classList.remove('active'));
}

function generateReport(silent = false) {
    const startDate = document.getElementById('reportStartDate')?.value;
    const endDate = document.getElementById('reportEndDate')?.value;
    
    if (!startDate || !endDate) {
        showNotification('Please select date range', 'warning');
        return;
    }
    
    let transactions = [...inventory.transactions];
    
    // Filter by date range
    if (startDate) {
        transactions = transactions.filter(t => new Date(t.date) >= new Date(startDate + 'T00:00:00'));
    }
    if (endDate) {
        const endDateTime = new Date(endDate + 'T00:00:00');
        endDateTime.setHours(23, 59, 59);
        transactions = transactions.filter(t => new Date(t.date) <= endDateTime);
    }
    
    // Calculate statistics
    const cashIn = transactions.filter(t => t.type === 'cashin');
    const cashOut = transactions.filter(t => t.type === 'cashout');
    
    const totalCashIn = cashIn.reduce((sum, t) => sum + t.amount, 0);
    const totalCashOut = cashOut.reduce((sum, t) => sum + t.amount, 0);
    const totalProfit = transactions.reduce((sum, t) => sum + t.fee, 0);
    const totalRevenue = totalCashIn + totalCashOut;
    const avgTransaction = transactions.length > 0 ? totalRevenue / transactions.length : 0;
    
    // Update stat cards
    document.getElementById('reportTotalRevenue').textContent = `₱${totalRevenue.toLocaleString()}`;
    document.getElementById('reportTotalTransactions').textContent = transactions.length;
    document.getElementById('reportNetProfit').textContent = `₱${totalProfit.toLocaleString()}`;
    document.getElementById('reportAvgTransaction').textContent = `₱${Math.round(avgTransaction).toLocaleString()}`;
    
    // Generate transaction summary
    generateTransactionSummary(transactions, cashIn, cashOut, totalCashIn, totalCashOut, totalProfit);
    
    // Generate cash flow summary
    generateCashFlowSummary(cashIn, cashOut, totalCashIn, totalCashOut);
    
    // Generate fee breakdown
    generateFeeBreakdown(transactions);
    
    // Generate transaction timeline
    generateTransactionTimeline(transactions);
    
    if (!silent) showNotification('Report updated', 'success');
}

function reportEmpty(iconName, title, text) {
    return `
        <div class="empty-state empty-state-sm">
            <span class="empty-state-icon">${icon(iconName)}</span>
            <div class="empty-state-title">${title}</div>
            ${text ? `<div class="empty-state-text">${text}</div>` : ''}
        </div>
    `;
}

function generateTransactionSummary(transactions, cashIn, cashOut, totalCashIn, totalCashOut, totalProfit) {
    const summaryDiv = document.getElementById('transactionSummary');
    if (!summaryDiv) return;

    if (transactions.length === 0) {
        summaryDiv.innerHTML = reportEmpty('chart', 'No transactions found', 'Try selecting a different date range.');
        return;
    }

    const cashInPercent = totalCashIn + totalCashOut > 0 ? (totalCashIn / (totalCashIn + totalCashOut)) * 100 : 0;
    const cashOutPercent = 100 - cashInPercent;

    summaryDiv.innerHTML = `
        <div class="summary-blocks">
            <div class="summary-block tone-in">
                <div class="summary-block-head">
                    <span>${icon('in')} Cash In</span>
                    <span>${cashInPercent.toFixed(1)}%</span>
                </div>
                <div class="summary-block-value">${peso(totalCashIn)}</div>
                <div class="summary-block-sub">${cashIn.length} transactions</div>
                <div class="progress-bar-container">
                    <div class="progress-bar cash-in" style="width: ${cashInPercent}%"></div>
                </div>
            </div>

            <div class="summary-block tone-out">
                <div class="summary-block-head">
                    <span>${icon('out')} Cash Out</span>
                    <span>${cashOutPercent.toFixed(1)}%</span>
                </div>
                <div class="summary-block-value">${peso(totalCashOut)}</div>
                <div class="summary-block-sub">${cashOut.length} transactions</div>
                <div class="progress-bar-container">
                    <div class="progress-bar cash-out" style="width: ${cashOutPercent}%"></div>
                </div>
            </div>

            <div class="summary-block tone-profit">
                <div class="summary-block-head">
                    <span>${icon('trending')} Profit from Fees</span>
                </div>
                <div class="summary-block-value">${peso(totalProfit)}</div>
            </div>
        </div>
    `;
}

function generateCashFlowSummary(cashIn, cashOut, totalCashIn, totalCashOut) {
    const div = document.getElementById('cashFlowSummary');
    if (!div) return;

    const netFlow = totalCashIn - totalCashOut;

    div.innerHTML = `
        <div class="kv-list">
            <div class="kv-row">
                <span><span class="dot dot-in"></span> Cash In</span>
                <strong class="text-in">${peso(totalCashIn)}</strong>
            </div>
            <div class="kv-row">
                <span><span class="dot dot-out"></span> Cash Out</span>
                <strong class="text-out">${peso(totalCashOut)}</strong>
            </div>
            <div class="kv-row kv-total">
                <span>Net Cash Flow</span>
                <strong class="${netFlow >= 0 ? 'text-success' : 'text-danger'}">${netFlow >= 0 ? '+' : '−'}${peso(Math.abs(netFlow))}</strong>
            </div>
        </div>
    `;
}

function generateFeeBreakdown(transactions) {
    const div = document.getElementById('feeBreakdown');
    if (!div) return;

    const cashInFees = transactions.filter(t => t.type === 'cashin').reduce((sum, t) => sum + t.fee, 0);
    const cashOutFees = transactions.filter(t => t.type === 'cashout').reduce((sum, t) => sum + t.fee, 0);
    const totalFees = cashInFees + cashOutFees;

    if (totalFees === 0) {
        div.innerHTML = reportEmpty('coins', 'No fees collected yet');
        return;
    }

    div.innerHTML = `
        <div class="kv-list">
            <div class="kv-row">
                <span><span class="dot dot-in"></span> Cash In Fees</span>
                <span class="kv-value">
                    <strong>${peso(cashInFees)}</strong>
                    <small>${((cashInFees / totalFees) * 100).toFixed(1)}%</small>
                </span>
            </div>
            <div class="kv-row">
                <span><span class="dot dot-out"></span> Cash Out Fees</span>
                <span class="kv-value">
                    <strong>${peso(cashOutFees)}</strong>
                    <small>${((cashOutFees / totalFees) * 100).toFixed(1)}%</small>
                </span>
            </div>
            <div class="kv-row kv-total">
                <span>Total Fees</span>
                <strong class="text-success">${peso(totalFees)}</strong>
            </div>
        </div>
    `;
}

function generateTransactionTimeline(transactions) {
    const div = document.getElementById('transactionTimeline');
    if (!div) return;

    if (transactions.length === 0) {
        div.innerHTML = reportEmpty('calendar', 'Nothing in this date range');
        return;
    }

    // Group by date
    const grouped = {};
    transactions.forEach(t => {
        const date = new Date(t.date).toDateString();
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(t);
    });

    // Sort by date descending
    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

    div.innerHTML = sortedDates.slice(0, 10).map(date => {
        const dayTransactions = grouped[date];
        const dayTotal = dayTransactions.reduce((sum, t) => sum + t.amount, 0);
        const dayProfit = dayTransactions.reduce((sum, t) => sum + t.fee, 0);
        const inCount = dayTransactions.filter(t => t.type === 'cashin').length;
        const outCount = dayTransactions.length - inCount;

        return `
            <div class="timeline-item">
                <div class="timeline-date">${new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                <div class="timeline-body">
                    <div>
                        <div class="timeline-amount">${peso(dayTotal)}</div>
                        <div class="timeline-sub">${dayTransactions.length} transactions · Profit ${peso(dayProfit)}</div>
                    </div>
                    <div class="timeline-counts">
                        <span class="badge badge-in">${icon('in')} ${inCount}</span>
                        <span class="badge badge-out">${icon('out')} ${outCount}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function exportTransactionReport() {
    showNotification('Exporting transaction report...', 'info');
    // Implementation would generate CSV or PDF
}

function exportCashFlowReport() {
    showNotification('Exporting cash flow report...', 'info');
}

function generateDailyReport() {
    navigateToPage('reports');
    const today = localDateString(new Date());
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    if (startInput) startInput.value = today;
    if (endInput) endInput.value = today;
    generateReport(true);
}

// ===================================
// SETTINGS
// ===================================

function exportData() {
    const dataStr = JSON.stringify(inventory, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cashg-inventory-backup-${localDateString(new Date())}.json`;
    link.click();
    showNotification('Data exported successfully!', 'success');
}

function importData() {
    if (!requireSubscription()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => showNotification('Could not read that file', 'error');
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                const looksValid = data && typeof data === 'object' && !Array.isArray(data) &&
                    (Array.isArray(data.transactions) || Array.isArray(data.finance) || 'accounts' in data ||
                     'cash' in data || 'gcash' in data);
                if (!looksValid) {
                    showNotification('That file is not a CashGee backup', 'error');
                    return;
                }
                const count = Array.isArray(data.transactions) ? data.transactions.length : 0;
                if (!confirm(`Replace your current data with this backup (${count} transactions)? This cannot be undone.`)) return;
                inventory = normalizeInventory(data);
                saveToLocalStorage();
                closeModal('welcomeModal');
                showNotification('Data imported successfully!', 'success');
                loadTransactions();
                updateAllBalances();
                updateBusinessName();
                navigateToPage(currentPage);
            } catch (error) {
                showNotification('Error importing data', 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// Profile photo: shrunk to a small square and kept on this device
function avatarKey() {
    return 'cashg-avatar-' + ((typeof currentUser !== 'undefined' && currentUser?.id) || 'local');
}

function getAvatar() {
    try { return localStorage.getItem(avatarKey()) || ''; } catch { return ''; }
}

function renderAvatar() {
    const src = getAvatar();
    const img = document.getElementById('menuAvatarImg');
    img.src = src;
    img.hidden = !src;
    document.getElementById('menuAvatarIcon').style.display = src ? 'none' : '';
    document.getElementById('menuRemovePhoto').hidden = !src;
}

function squareAvatar(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const size = 240;
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Not an image'));
        };
        img.src = url;
    });
}

async function handleAvatarFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
        localStorage.setItem(avatarKey(), await squareAvatar(file));
        renderAvatar();
        showNotification('Profile photo updated', 'success');
    } catch {
        showNotification('Could not use that photo', 'error');
    }
}

function removeAvatar() {
    try { localStorage.removeItem(avatarKey()); } catch { /* private mode */ }
    renderAvatar();
}

// Header menu: owner details, Subscription and Reset data
function openMenuModal() {
    const profile = (typeof account !== 'undefined' && account?.profile) || {};
    const email = (typeof currentUser !== 'undefined' && currentUser?.email) || '';
    const business = inventory.settings.businessName || profile.business_name || '';
    const set = (id, text) => { document.getElementById(id).textContent = text || '—'; };
    set('menuOwnerName', profile.full_name || business || 'Owner');
    document.getElementById('menuBusiness').textContent = profile.full_name && business ? business : '';
    set('menuEmail', email);
    set('menuPhone', profile.phone);
    set('menuBusinessName', business);
    let plan = '';
    try {
        const sub = getSubscriptionState();
        const name = sub.plan ? sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1) : '';
        if (sub.status === 'active') plan = `${name} · ${sub.daysLeft} days left`;
        else if (sub.status === 'expiring') plan = `${name} · ends in ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'}`;
        else if (sub.status === 'expired') plan = 'Expired';
        else plan = 'No plan yet';
    } catch { /* not signed in */ }
    set('menuPlan', plan);
    renderAvatar();
    setMenuEditing(false);
    setSidebarOpen(false);
    document.getElementById('menuModal').classList.add('active');
}

function setMenuEditing(editing) {
    document.getElementById('menuDetails').hidden = editing;
    document.getElementById('menuEditForm').hidden = !editing;
    document.getElementById('menuEditBtn').hidden = editing;
}

function menuEditProfile() {
    const profile = (typeof account !== 'undefined' && account?.profile) || {};
    document.getElementById('menuEditName').value = profile.full_name || '';
    document.getElementById('menuEditPhone').value = profile.phone || '';
    document.getElementById('menuEditBusiness').value =
        inventory.settings.businessName || profile.business_name || '';
    setMenuEditing(true);
    document.getElementById('menuEditName').focus();
}

function menuCancelEdit() {
    setMenuEditing(false);
}

async function menuSaveProfile(event) {
    event.preventDefault();
    const fullName = document.getElementById('menuEditName').value.trim();
    const phone = document.getElementById('menuEditPhone').value.trim();
    const businessName = document.getElementById('menuEditBusiness').value.trim();
    if (!fullName) return showNotification('Please enter your name', 'error');

    const button = document.getElementById('menuSaveBtn');
    button.disabled = true;
    try {
        await Cloud.updateProfile({ fullName, phone, businessName });
        if (account?.profile) {
            account.profile.full_name = fullName;
            account.profile.phone = phone;
            account.profile.business_name = businessName;
        }
        inventory.settings.businessName = businessName;
        saveToLocalStorage();
        updateBusinessName();
        openMenuModal(); // re-render the details with the new values
        setMenuEditing(false);
        showNotification('Profile updated', 'success');
    } catch (error) {
        showNotification(navigator.onLine ? 'Could not save your profile. Please try again.' : 'You are offline. Connect to the internet to edit your profile.', 'error');
    } finally {
        button.disabled = false;
    }
}

function menuGoTo(page) {
    closeModal('menuModal');
    navigateToPage(page);
}

function menuResetData() {
    closeModal('menuModal');
    clearAllData();
}

function clearAllData() {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone!')) return;
    
    // Free the photos saved on this phone for the transactions being cleared
    ReceiptStore.removeMany(inventory.transactions.map(t => t.receipt).filter(Boolean));

    inventory = createEmptyInventory();
    const key = inventoryStorageKey();
    if (key) localStorage.removeItem(key);

    showNotification('All data cleared', 'success');
    loadTransactions();
    updateAllBalances();
    updateBusinessName();
    navigateToPage('dashboard');
    openWelcomeModal();
}

// ===================================
// INSTALLABLE APP (PWA)
// ===================================

let deferredInstallPrompt = null;

function isRunningAsApp() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function setInstallButtonsVisible(visible) {
    document.querySelectorAll('.install-app-btn').forEach(btn => { btn.hidden = !visible; });
}

function initializePWA() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        // On a local dev server skip the offline cache so edits show up straight away
        const localDev = ['localhost', '127.0.0.1'].includes(location.hostname);
        if (localDev) {
            navigator.serviceWorker.getRegistrations().then(list => list.forEach(r => r.unregister()));
            if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
        } else {
            navigator.serviceWorker.register('sw.js').catch(error => {
                console.warn('Service worker registration failed', error);
            });
        }
    }

    // Ask the browser not to auto-delete this device's data
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
    }

    if (isRunningAsApp()) return;

    // Android / desktop Chrome & Edge: use the native install prompt
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        deferredInstallPrompt = event;
        setInstallButtonsVisible(true);
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        setInstallButtonsVisible(false);
        showNotification('App installed! Open it from your home screen.', 'success');
    });

    // iOS Safari has no install prompt, so show manual instructions instead
    if (isIOS()) {
        setInstallButtonsVisible(true);
    }
}

async function installApp() {
    setSidebarOpen(false);

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        if (outcome === 'accepted') setInstallButtonsVisible(false);
        return;
    }

    if (isIOS()) {
        alert('To install on iPhone/iPad:\n\n1. Tap the Share button (square with arrow) in Safari\n2. Choose "Add to Home Screen"\n3. Tap "Add"');
    } else {
        alert('To install CashGee, open your browser menu (⋮) and choose "Install app" or "Add to Home screen".');
    }
}

// ===================================
// MODALS
// ===================================

function initializeModals() {
    const modals = document.querySelectorAll('.modal:not(#welcomeModal)');
    modals.forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active:not(#welcomeModal)').forEach(modal => {
                closeModal(modal.id);
            });
        }
    });
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// ===================================
// UTILITIES
// ===================================

function updateAllBalances() {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('ttCash', pesoFull(inventory.accounts.cash));
    set('ttDigital', pesoFull(digitalTotal()));
    if (currentPage === 'inventory') updateInventoryPage();
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification').forEach(n => n.remove());

    const icons = { success: 'check', error: 'alert', warning: 'alert', info: 'info' };

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notification.innerHTML = `
        <span class="notification-icon">${icon(icons[type] || 'info')}</span>
        <span class="notification-message">${escapeHtml(message)}</span>
        <button class="notification-close" aria-label="Dismiss">${icon('x')}</button>
    `;

    const dismiss = () => {
        notification.classList.add('is-leaving');
        setTimeout(() => notification.remove(), 200);
    };
    notification.querySelector('.notification-close').addEventListener('click', dismiss);

    document.body.appendChild(notification);
    setTimeout(() => { if (notification.isConnected) dismiss(); }, 3500);
}
