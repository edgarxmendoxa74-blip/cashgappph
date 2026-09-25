// ===================================
// GCASH INVENTORY MANAGEMENT SYSTEM
// ===================================

// Data Storage
// Each device keeps its own inventory in localStorage — no account needed.
function createEmptyInventory() {
    return {
        cash: 0,
        gcash: 0,
        transactions: [],
        customers: [],
        settings: {
            cashInFees: { tier1: 5, tier2: 10, tier3: 15 },
            cashOutFees: { tier1: 10, tier2: 15, tier3: 20 },
            businessName: '',
            businessPhone: '',
            gcashNumber: ''
        }
    };
}

// Fill in any fields missing from older saves or imported backups
function normalizeInventory(data) {
    const base = createEmptyInventory();
    const settings = (data && data.settings) || {};
    return {
        ...base,
        ...data,
        cash: Number(data?.cash) || 0,
        gcash: Number(data?.gcash) || 0,
        transactions: Array.isArray(data?.transactions) ? data.transactions : [],
        customers: Array.isArray(data?.customers) ? data.customers : [],
        settings: {
            ...base.settings,
            ...settings,
            cashInFees: { ...base.settings.cashInFees, ...settings.cashInFees },
            cashOutFees: { ...base.settings.cashOutFees, ...settings.cashOutFees }
        }
    };
}

let inventory = createEmptyInventory();

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

function peso(value) {
    return '₱' + Number(value || 0).toLocaleString();
}

// YYYY-MM-DD in the device's local time (toISOString would give the UTC date)
function localDateString(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Display names for pages (internal ids stay the same)
const PAGE_TITLES = {
    dashboard: 'Inventory',
    inventory: 'Balances',
    subscription: 'Subscription'
};

// Current State
let currentPage = 'dashboard';
let currentTransactionType = '';
let currentBalanceType = '';
let currentBalanceAction = '';
let dashboardRefreshInterval = null;

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeModals();
    setCurrentDate();
    initializePWA();

    // Auto-update date every minute
    setInterval(setCurrentDate, 60000);

    // Sign-in screen, or straight into the app if already signed in (account.js)
    startAccount();
});

// Called by account.js once a user is signed in
function enterInventory() {
    const hasSavedData = loadFromLocalStorage();
    initializeDashboard();
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
    stopDashboardRefresh();
    inventory = createEmptyInventory();
    updateAllBalances();
    updateBusinessName();
    navigateToPage('dashboard');
}

// ===================================
// DASHBOARD INITIALIZATION
// ===================================

function initializeDashboard() {
    updateDashboard();
    
    // Start auto-refresh for dashboard when on dashboard page
    if (currentPage === 'dashboard') {
        startDashboardRefresh();
    }
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
    if (key) localStorage.setItem(key, JSON.stringify(inventory));
}

// ===================================
// FIRST-RUN SETUP
// ===================================

function openWelcomeModal() {
    document.getElementById('welcomeBusinessName').value =
        inventory.settings.businessName || account?.profile?.business_name || '';
    document.getElementById('welcomeCash').value = '';
    document.getElementById('welcomeGcash').value = '';
    document.getElementById('welcomeModal').classList.add('active');
}

function saveWelcomeSetup() {
    const cash = parseFloat(document.getElementById('welcomeCash').value);
    const gcash = parseFloat(document.getElementById('welcomeGcash').value);

    inventory.settings.businessName = document.getElementById('welcomeBusinessName').value.trim();
    inventory.cash = cash > 0 ? cash : 0;
    inventory.gcash = gcash > 0 ? gcash : 0;

    saveToLocalStorage();
    closeModal('welcomeModal');
    updateBusinessName();
    updateAllBalances();
    updateDashboard();
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

function initializeNavigation() {
    const menuItems = document.querySelectorAll('.menu-item a, .bottom-nav a[data-page]');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const bottomNavMore = document.getElementById('bottomNavMore');

    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            if (page) {
                navigateToPage(page);
            }
            setSidebarOpen(false);
        });
    });

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            setSidebarOpen(false);
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => setSidebarOpen(false));
    }

    if (bottomNavMore) {
        bottomNavMore.addEventListener('click', function() {
            const sidebar = document.querySelector('.sidebar');
            setSidebarOpen(!sidebar.classList.contains('active'));
        });
    }
}

// Mobile drawer (sidebar slides in over content on small screens)
function setSidebarOpen(open) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!sidebar) return;
    sidebar.classList.toggle('active', open);
    if (overlay) overlay.classList.toggle('active', open);
}

function navigateToPage(page) {
    // Hide all pages
    document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
    
    // Show selected page
    const selectedPage = document.getElementById(`${page}-page`);
    if (selectedPage) {
        selectedPage.style.display = 'block';
    }
    
    // Update active menu item
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const activeMenuItem = document.querySelector(`.menu-item a[data-page="${page}"]`)?.parentElement;
    if (activeMenuItem) {
        activeMenuItem.classList.add('active');
    }

    // Update bottom tab bar (reports/settings live under "More")
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        const pages = (item.dataset.page || item.dataset.morePages || '').split(' ');
        item.classList.toggle('active', pages.includes(page));
    });

    window.scrollTo(0, 0);
    
    // Update page title
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.textContent = PAGE_TITLES[page] || page.charAt(0).toUpperCase() + page.slice(1);
    }
    
    currentPage = page;
    document.body.dataset.page = page;

    // Load page-specific content
    switch(page) {
        case 'dashboard':
            updateDashboard();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'customers':
            loadCustomers();
            break;
        case 'inventory':
            updateInventoryPage();
            break;
        case 'reports':
            loadReports();
            break;
        case 'settings':
            loadSettings();
            break;
        case 'subscription':
            renderSubscriptionPage();
            refreshAccount();
            break;
    }

    renderSubscriptionBanner();
}

// ===================================
// DASHBOARD
// ===================================

function startDashboardRefresh() {
    // Clear any existing interval
    if (dashboardRefreshInterval) {
        clearInterval(dashboardRefreshInterval);
    }
    // Refresh every 30 seconds
    dashboardRefreshInterval = setInterval(updateDashboard, 30000);
}

function stopDashboardRefresh() {
    if (dashboardRefreshInterval) {
        clearInterval(dashboardRefreshInterval);
        dashboardRefreshInterval = null;
    }
}

function updateDashboard() {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    const todayTransactions = inventory.transactions.filter(t => 
        new Date(t.date).toDateString() === today
    );
    
    const yesterdayTransactions = inventory.transactions.filter(t => 
        new Date(t.date).toDateString() === yesterday
    );
    
    const cashInTransactions = todayTransactions.filter(t => t.type === 'cashin');
    const cashOutTransactions = todayTransactions.filter(t => t.type === 'cashout');
    
    const todayCashIn = cashInTransactions.reduce((sum, t) => sum + t.amount, 0);
    const todayCashOut = cashOutTransactions.reduce((sum, t) => sum + t.amount, 0);
    const todayProfit = todayTransactions.reduce((sum, t) => sum + t.fee, 0);
    
    // Yesterday's data for comparison
    const yesterdayCashIn = yesterdayTransactions.filter(t => t.type === 'cashin').reduce((sum, t) => sum + t.amount, 0);
    const yesterdayCashOut = yesterdayTransactions.filter(t => t.type === 'cashout').reduce((sum, t) => sum + t.amount, 0);
    const yesterdayProfit = yesterdayTransactions.reduce((sum, t) => sum + t.fee, 0);
    
    // Calculate trends
    const cashInTrend = calculateTrend(todayCashIn, yesterdayCashIn);
    const cashOutTrend = calculateTrend(todayCashOut, yesterdayCashOut);
    const profitTrend = calculateTrend(todayProfit, yesterdayProfit);
    
    // Get active customers (this month)
    const thisMonth = new Date().getMonth();
    const thisYear = new Date().getFullYear();
    const activeCustomersThisMonth = new Set(
        inventory.transactions
            .filter(t => {
                const tDate = new Date(t.date);
                return tDate.getMonth() === thisMonth && tDate.getFullYear() === thisYear;
            })
            .map(t => t.customer)
    ).size;
    
    // Update summary cards with animations
    animateValue('todayCashIn', todayCashIn);
    animateValue('todayCashInCount', cashInTransactions.length, false);
    animateValue('todayCashOut', todayCashOut);
    animateValue('todayCashOutCount', cashOutTransactions.length, false);
    animateValue('todayProfit', todayProfit);
    animateValue('activeCustomers', activeCustomersThisMonth, false);
    
    // Update trend indicators
    updateTrendIndicator('cashInTrend', cashInTrend);
    updateTrendIndicator('cashOutTrend', cashOutTrend);
    updateTrendIndicator('profitTrend', profitTrend);
    
    // Load recent transactions
    loadRecentTransactions();
    
    // Update dashboard stats
    updateDashboardStats();
}

function calculateTrend(today, yesterday) {
    if (yesterday === 0) return today > 0 ? 100 : 0;
    return ((today - yesterday) / yesterday) * 100;
}

function animateValue(elementId, endValue, isCurrency = true) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const startValue = parseInt(element.textContent.replace(/,/g, '')) || 0;
    const duration = 1000; // 1 second
    const startTime = performance.now();
    
    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const currentValue = Math.floor(startValue + (endValue - startValue) * progress);
        element.textContent = isCurrency ? currentValue.toLocaleString() : currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    requestAnimationFrame(animate);
}

function updateTrendIndicator(elementId, trend) {
    let element = document.getElementById(elementId);
    
    if (!element) {
        // Create trend indicator if it doesn't exist
        const cardElement = document.getElementById(elementId.replace('Trend', ''))?.closest('.summary-card');
        if (cardElement) {
            const countDiv = cardElement.querySelector('.count');
            if (countDiv) {
                const trendDiv = document.createElement('div');
                trendDiv.id = elementId;
                trendDiv.style.cssText = 'font-size: 0.875rem; margin-top: 0.25rem;';
                countDiv.after(trendDiv);
                element = trendDiv;
            }
        }
    }
    
    if (element) {
        const arrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '→';
        const color = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#94a3b8';
        const sign = trend > 0 ? '+' : '';
        
        element.innerHTML = `<span style="color: ${color}; font-weight: 600;">${arrow} ${sign}${Math.abs(trend).toFixed(1)}%</span> vs yesterday`;
    }
}

function updateDashboardStats() {
    // Calculate additional statistics
    const totalTransactions = inventory.transactions.length;
    const totalRevenue = inventory.transactions.reduce((sum, t) => sum + t.fee, 0);
    const avgTransactionValue = totalTransactions > 0 
        ? inventory.transactions.reduce((sum, t) => sum + t.amount, 0) / totalTransactions 
        : 0;
    
    // Update if stats section exists
    const statsSection = document.getElementById('dashboardStats');
    if (statsSection) {
        statsSection.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--border-radius-sm);">
                    <div style="font-size: 0.875rem; color: var(--text-muted);">Total Transactions</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">${totalTransactions}</div>
                </div>
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--border-radius-sm);">
                    <div style="font-size: 0.875rem; color: var(--text-muted);">Total Revenue</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--primary);">₱${totalRevenue.toLocaleString()}</div>
                </div>
                <div style="padding: 1rem; background: var(--bg-secondary); border-radius: var(--border-radius-sm);">
                    <div style="font-size: 0.875rem; color: var(--text-muted);">Avg Transaction</div>
                    <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-primary);">₱${Math.round(avgTransactionValue).toLocaleString()}</div>
                </div>
            </div>
        `;
    }
}

function loadRecentTransactions() {
    const list = document.getElementById('recentTransactionsList');
    if (!list) return;

    const recent = inventory.transactions.slice(-5).reverse();

    if (recent.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon">${icon('clipboard')}</span>
                <div class="empty-state-title">No transactions yet</div>
                <div class="empty-state-text">Your Cash In and Cash Out records will show here.</div>
                <button onclick="openTransactionModal('cashin')" class="btn btn-primary">
                    ${icon('plus')} Add Transaction
                </button>
            </div>
        `;
        return;
    }

    list.innerHTML = recent.map(t => {
        const isIn = t.type === 'cashin';
        return `
            <div class="txn-row">
                <span class="txn-icon ${isIn ? 'is-in' : 'is-out'}">${icon(isIn ? 'in' : 'out')}</span>
                <div class="txn-main">
                    <div class="txn-name">${escapeHtml(t.customer)}</div>
                    <div class="txn-meta">${isIn ? 'Cash In' : 'Cash Out'} · ${getTimeAgo(new Date(t.date))}</div>
                </div>
                <div class="txn-side">
                    <div class="txn-amount ${isIn ? 'is-in' : 'is-out'}">${peso(t.amount)}</div>
                    <div class="txn-fee">Fee ${peso(t.fee)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
}

// ===================================
// TRANSACTIONS
// ===================================

function openTransactionModal(type) {
    if (!requireSubscription()) return;
    currentTransactionType = type || '';
    const modal = document.getElementById('transactionModal');
    const typeSelect = document.getElementById('transactionType');
    
    // Reset first so the preset type below isn't wiped out
    document.getElementById('transactionForm').reset();
    populateCustomerSelect();

    typeSelect.value = type || '';

    setSidebarOpen(false);
    modal.classList.add('active');
    updateTransactionForm();
}

// Cash In / Cash Out toggle buttons drive the hidden select
function setTransactionType(type) {
    document.getElementById('transactionType').value = type;
    updateTransactionForm();
}

function updateTransactionForm() {
    const type = document.getElementById('transactionType').value;
    currentTransactionType = type;

    document.getElementById('transactionModalTitle').textContent = type === 'cashin' ? 'New Cash In'
        : type === 'cashout' ? 'New Cash Out'
        : 'New Transaction';
    document.querySelectorAll('.type-option').forEach(option => {
        const selected = option.dataset.type === type;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-checked', selected);
    });

    calculateFee();
}

function calculateFee() {
    const amount = parseFloat(document.getElementById('transactionAmount').value) || 0;
    const type = currentTransactionType;
    let fee = 0;
    
    if (type === 'cashin') {
        if (amount <= 1000) fee = inventory.settings.cashInFees.tier1;
        else if (amount <= 3000) fee = inventory.settings.cashInFees.tier2;
        else fee = inventory.settings.cashInFees.tier3;
    } else if (type === 'cashout') {
        if (amount <= 1000) fee = inventory.settings.cashOutFees.tier1;
        else if (amount <= 3000) fee = inventory.settings.cashOutFees.tier2;
        else fee = inventory.settings.cashOutFees.tier3;
    }
    
    document.getElementById('transactionFee').value = fee;
    
    let total = amount;
    if (type === 'cashin') {
        total = amount + fee;
    } else if (type === 'cashout') {
        total = amount - fee;
    }
    
    document.getElementById('transactionTotal').value = total;
}

function saveTransaction() {
    if (!requireSubscription()) return;
    const type = document.getElementById('transactionType').value;
    const customerSelect = document.getElementById('customerSelect');
    const customerName = customerSelect.value ? customerSelect.options[customerSelect.selectedIndex].text : '';
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const fee = parseFloat(document.getElementById('transactionFee').value);
    const total = parseFloat(document.getElementById('transactionTotal').value);
    const reference = document.getElementById('referenceNumber').value;
    const notes = document.getElementById('transactionNotes').value;

    if (!type || !customerName || !amount) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Validate inventory
    if (type === 'cashin' && inventory.gcash < amount) {
        showNotification('Insufficient GCash balance for this transaction', 'error');
        return;
    }
    
    if (type === 'cashout' && inventory.cash < total) {
        showNotification('Insufficient cash for this transaction', 'error');
        return;
    }
    
    const transaction = {
        id: Date.now(),
        date: new Date().toISOString(),
        type: type,
        customer: customerName,
        amount: amount,
        fee: fee,
        total: total,
        status: 'completed',
        reference: reference,
        notes: notes
    };
    
    inventory.transactions.push(transaction);
    
    // Update inventory balances
    if (type === 'cashin') {
        inventory.cash += total;
        inventory.gcash -= amount;
    } else if (type === 'cashout') {
        inventory.cash -= total;
        inventory.gcash += amount;
    }
    
    saveToLocalStorage();
    closeModal('transactionModal');
    showNotification('Transaction saved successfully!', 'success');
    updateDashboard();
    updateAllBalances();
    
    if (currentPage === 'transactions') {
        loadTransactions();
    }
}

function loadTransactions() {
    const tbody = document.getElementById('transactionsTableBody');
    const filterSelect = document.getElementById('transactionFilter');
    const dateInput = document.getElementById('dateFilter');
    
    if (!tbody) return;
    
    // Add event listeners
    if (filterSelect && !filterSelect.hasAttribute('data-initialized')) {
        filterSelect.setAttribute('data-initialized', 'true');
        filterSelect.addEventListener('change', loadTransactions);
    }
    
    if (dateInput && !dateInput.hasAttribute('data-initialized')) {
        dateInput.setAttribute('data-initialized', 'true');
        dateInput.addEventListener('change', loadTransactions);
    }
    
    const filter = filterSelect?.value || 'all';
    const dateFilter = dateInput?.value;
    
    let filtered = [...inventory.transactions];
    
    if (filter !== 'all') {
        filtered = filtered.filter(t => t.type === filter);
    }
    
    if (dateFilter) {
        filtered = filtered.filter(t => 
            new Date(t.date).toDateString() === new Date(dateFilter).toDateString()
        );
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr class="row-empty"><td colspan="8" class="cell-empty">
                <div class="empty-state">
                    <span class="empty-state-icon">${icon('clipboard')}</span>
                    <div class="empty-state-title">No transactions found</div>
                    <div class="empty-state-text">Try another filter, or add a new transaction.</div>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.reverse().map(t => {
        const isIn = t.type === 'cashin';
        return `
        <tr>
            <td data-label="Date/Time" class="cell-date">${formatDate(t.date)}</td>
            <td data-label="Type" class="cell-type">
                <span class="badge ${isIn ? 'badge-in' : 'badge-out'}">
                    ${icon(isIn ? 'in' : 'out')} ${isIn ? 'Cash In' : 'Cash Out'}
                </span>
            </td>
            <td data-label="Customer" class="cell-customer">${escapeHtml(t.customer)}</td>
            <td data-label="Amount" class="cell-amount">${peso(t.amount)}</td>
            <td data-label="Fee" class="cell-fee">${peso(t.fee)}</td>
            <td data-label="Total" class="cell-total">${peso(t.total)}</td>
            <td data-label="Status" class="cell-status">
                <span class="badge badge-success">${escapeHtml(t.status)}</span>
            </td>
            <td class="cell-actions">
                <button onclick="deleteTransaction(${t.id})" class="btn-icon-only btn-icon-danger" title="Delete" aria-label="Delete transaction">
                    ${icon('trash')}
                </button>
            </td>
        </tr>
    `;
    }).join('');
}

function deleteTransaction(id) {
    if (!requireSubscription()) return;
    if (!confirm('Are you sure you want to delete this transaction?')) return;
    
    const transaction = inventory.transactions.find(t => t.id === id);
    if (!transaction) return;
    
    // Reverse the transaction effects
    if (transaction.type === 'cashin') {
        inventory.cash -= transaction.total;
        inventory.gcash += transaction.amount;
    } else if (transaction.type === 'cashout') {
        inventory.cash += transaction.total;
        inventory.gcash -= transaction.amount;
    }
    
    inventory.transactions = inventory.transactions.filter(t => t.id !== id);
    saveToLocalStorage();
    showNotification('Transaction deleted', 'success');
    loadTransactions();
    updateAllBalances();
    updateDashboard();
}

// ===================================
// CUSTOMERS
// ===================================

let customerSortField = 'id';
let customerSortOrder = 'asc';

function openCustomerModal() {
    if (!requireSubscription()) return;
    const modal = document.getElementById('customerModal');
    document.getElementById('customerForm').reset();

    // Undo any leftover "edit" state from a cancelled edit
    document.getElementById('customerModalTitle').textContent = 'Add Customer';
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    saveBtn.textContent = 'Save Customer';
    saveBtn.onclick = saveCustomer;

    setSidebarOpen(false);
    modal.classList.add('active');
}

function saveCustomer() {
    if (!requireSubscription()) return;
    const name = document.getElementById('customerName').value;
    const phone = document.getElementById('customerPhone').value;
    const gcash = document.getElementById('customerGCash').value;
    const notes = document.getElementById('customerNotes').value;
    
    if (!name || !phone) {
        showNotification('Please fill in required fields', 'error');
        return;
    }
    
    const customer = {
        id: Date.now(),
        name,
        phone,
        gcash: gcash || phone,
        notes
    };
    
    inventory.customers.push(customer);
    saveToLocalStorage();
    closeModal('customerModal');
    showNotification('Customer added successfully!', 'success');
    
    if (currentPage === 'customers') {
        loadCustomers();
    }
}

function sortCustomers(field) {
    if (customerSortField === field) {
        // Toggle sort order if same field
        customerSortOrder = customerSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        // New field, default to ascending
        customerSortField = field;
        customerSortOrder = 'asc';
    }
    
    loadCustomers();
}

function loadCustomers() {
    const tbody = document.getElementById('customersTableBody');
    const searchInput = document.getElementById('customerSearch');
    const countElement = document.getElementById('customerCount');
    
    if (!tbody) return;
    
    // Add search event listener
    if (searchInput && !searchInput.hasAttribute('data-initialized')) {
        searchInput.setAttribute('data-initialized', 'true');
        searchInput.addEventListener('input', function() {
            loadCustomers();
        });
    }
    
    // Get search term
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    
    // Filter customers
    let filteredCustomers = inventory.customers;
    if (searchTerm) {
        filteredCustomers = inventory.customers.filter(c => 
            c.name.toLowerCase().includes(searchTerm) ||
            c.phone.includes(searchTerm) ||
            (c.gcash && c.gcash.includes(searchTerm)) ||
            (c.notes && c.notes.toLowerCase().includes(searchTerm))
        );
    }
    
    // Sort customers
    filteredCustomers.sort((a, b) => {
        let aVal = a[customerSortField] || '';
        let bVal = b[customerSortField] || '';
        
        // Convert to string for comparison
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
        
        if (customerSortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });
    
    // Update count
    if (countElement) {
        countElement.textContent = filteredCustomers.length;
    }
    
    // Update sort indicators
    document.querySelectorAll('#customersTable .sort-indicator').forEach(indicator => {
        indicator.textContent = '⇅';
        indicator.style.color = 'var(--text-muted)';
    });
    
    const activeHeader = document.querySelector(`#customersTable th[onclick*="${customerSortField}"]`);
    if (activeHeader) {
        const indicator = activeHeader.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = customerSortOrder === 'asc' ? '↑' : '↓';
            indicator.style.color = 'var(--primary)';
        }
    }
    
    if (filteredCustomers.length === 0) {
        tbody.innerHTML = `
            <tr class="row-empty"><td colspan="6" class="cell-empty">
                <div class="empty-state">
                    <span class="empty-state-icon">${icon('users')}</span>
                    <div class="empty-state-title">${searchTerm ? 'No matching customers' : 'No customers yet'}</div>
                    <div class="empty-state-text">${searchTerm ? 'Try a different name or number.' : 'Save regular customers for faster transactions.'}</div>
                    ${!searchTerm ? `<button onclick="openCustomerModal()" class="btn btn-primary">${icon('user-plus')} Add Customer</button>` : ''}
                </div>
            </td></tr>
        `;
        return;
    }

    const empty = '<span class="text-muted">—</span>';

    tbody.innerHTML = filteredCustomers.map((c, index) => `
        <tr>
            <td class="customer-id" data-label="#">${index + 1}</td>
            <td class="customer-name" data-label="Name">
                <div class="customer-name-wrap">
                    <span class="avatar">${escapeHtml(c.name.charAt(0).toUpperCase())}</span>
                    <span>${escapeHtml(c.name)}</span>
                </div>
            </td>
            <td class="customer-contact" data-label="Phone">
                <a href="tel:${escapeHtml(c.phone)}" class="contact-link">${icon('phone')} ${escapeHtml(c.phone)}</a>
            </td>
            <td class="customer-contact ${c.gcash ? '' : 'is-empty'}" data-label="GCash">
                ${c.gcash ? `<span class="contact-link">${icon('phone-device')} ${escapeHtml(c.gcash)}</span>` : empty}
            </td>
            <td class="customer-notes ${c.notes ? '' : 'is-empty'}" data-label="Notes" title="${escapeHtml(c.notes || '')}">
                ${c.notes ? escapeHtml(c.notes) : empty}
            </td>
            <td class="cell-actions">
                <div class="action-buttons-group">
                    <button onclick="editCustomer(${c.id})" class="btn-icon-only" title="Edit" aria-label="Edit customer">
                        ${icon('pencil')}
                    </button>
                    <button onclick="deleteCustomer(${c.id})" class="btn-icon-only btn-icon-danger" title="Delete" aria-label="Delete customer">
                        ${icon('trash')}
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

function editCustomer(id) {
    if (!requireSubscription()) return;
    const customer = inventory.customers.find(c => c.id === id);
    if (!customer) return;
    
    document.getElementById('customerName').value = customer.name;
    document.getElementById('customerPhone').value = customer.phone;
    document.getElementById('customerGCash').value = customer.gcash;
    document.getElementById('customerNotes').value = customer.notes || '';
    
    // Change the save button to update
    const modal = document.getElementById('customerModal');
    document.getElementById('customerModalTitle').textContent = 'Edit Customer';
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    saveBtn.textContent = 'Update Customer';
    saveBtn.onclick = function() {
        updateCustomer(id);
    };
    
    modal.classList.add('active');
}

function updateCustomer(id) {
    if (!requireSubscription()) return;
    const customer = inventory.customers.find(c => c.id === id);
    if (!customer) return;
    
    customer.name = document.getElementById('customerName').value;
    customer.phone = document.getElementById('customerPhone').value;
    customer.gcash = document.getElementById('customerGCash').value;
    customer.notes = document.getElementById('customerNotes').value;
    
    saveToLocalStorage();
    closeModal('customerModal');
    showNotification('Customer updated successfully!', 'success');
    loadCustomers();
    
    // Reset the button
    const modal = document.getElementById('customerModal');
    document.getElementById('customerModalTitle').textContent = 'Add Customer';
    const saveBtn = modal.querySelector('.modal-footer .btn-primary');
    saveBtn.textContent = 'Save Customer';
    saveBtn.onclick = saveCustomer;
}

function deleteCustomer(id) {
    if (!requireSubscription()) return;
    const customer = inventory.customers.find(c => c.id === id);
    if (!customer) return;
    
    if (!confirm(`Are you sure you want to delete ${customer.name}?`)) return;
    
    inventory.customers = inventory.customers.filter(c => c.id !== id);
    saveToLocalStorage();
    showNotification('Customer deleted', 'success');
    loadCustomers();
}

function populateCustomerSelect() {
    const select = document.getElementById('customerSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select customer</option>' +
        '<option value="walkin">Walk-in customer</option>' +
        inventory.customers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// ===================================
// INVENTORY
// ===================================

function updateInventoryPage() {
    document.getElementById('cashBalance').textContent = inventory.cash.toLocaleString();
    document.getElementById('walletBalance').textContent = inventory.gcash.toLocaleString();
    document.getElementById('totalAssets').textContent = (inventory.cash + inventory.gcash).toLocaleString();
    document.getElementById('availableCashOut').textContent = inventory.cash.toLocaleString();
    document.getElementById('availableCashIn').textContent = inventory.gcash.toLocaleString();
}

function adjustBalance(type, action) {
    if (!requireSubscription()) return;
    currentBalanceType = type;
    currentBalanceAction = action;
    
    const modal = document.getElementById('balanceModal');
    const title = document.getElementById('balanceModalTitle');
    
    title.textContent = `${action === 'add' ? 'Add' : 'Remove'} ${type === 'cash' ? 'Cash' : 'GCash Balance'}`;
    
    document.getElementById('balanceForm').reset();
    modal.classList.add('active');
}

function saveBalanceAdjustment() {
    if (!requireSubscription()) return;
    const amount = parseFloat(document.getElementById('balanceAmount').value);
    const reason = document.getElementById('balanceReason').value;
    
    if (!amount || !reason) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    const adjustment = currentBalanceAction === 'add' ? amount : -amount;
    
    if (currentBalanceType === 'cash') {
        inventory.cash += adjustment;
    } else {
        inventory.gcash += adjustment;
    }
    
    // Log as transaction
    inventory.transactions.push({
        id: Date.now(),
        date: new Date().toISOString(),
        type: 'adjustment',
        customer: 'System',
        amount: amount,
        fee: 0,
        total: adjustment,
        status: 'completed',
        reference: '',
        notes: reason
    });
    
    saveToLocalStorage();
    closeModal('balanceModal');
    showNotification('Balance adjusted successfully!', 'success');
    updateInventoryPage();
    updateAllBalances();
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
    
    // Generate top customers
    generateTopCustomers(transactions);
    
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

function generateTopCustomers(transactions) {
    const div = document.getElementById('topCustomers');
    if (!div) return;

    // Group by customer
    const customerStats = {};
    transactions.forEach(t => {
        if (!customerStats[t.customer]) {
            customerStats[t.customer] = { count: 0, total: 0 };
        }
        customerStats[t.customer].count++;
        customerStats[t.customer].total += t.amount;
    });

    // Convert to array and sort
    const topCustomers = Object.entries(customerStats)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    if (topCustomers.length === 0) {
        div.innerHTML = reportEmpty('users', 'No customer data yet');
        return;
    }

    const maxTotal = topCustomers[0].total || 1;

    div.innerHTML = topCustomers.map((customer, index) => `
        <div class="rank-row">
            <div class="rank-row-top">
                <span class="rank-badge rank-${index + 1}">${index + 1}</span>
                <div class="rank-info">
                    <div class="rank-name">${escapeHtml(customer.name)}</div>
                    <div class="rank-sub">${customer.count} transactions</div>
                </div>
                <strong class="rank-total">${peso(customer.total)}</strong>
            </div>
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${(customer.total / maxTotal) * 100}%"></div>
            </div>
        </div>
    `).join('');
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

function exportCustomerReport() {
    showNotification('Exporting customer report...', 'info');
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

function loadSettings() {
    document.getElementById('cashInFee1').value = inventory.settings.cashInFees.tier1;
    document.getElementById('cashInFee2').value = inventory.settings.cashInFees.tier2;
    document.getElementById('cashInFee3').value = inventory.settings.cashInFees.tier3;
    document.getElementById('cashOutFee1').value = inventory.settings.cashOutFees.tier1;
    document.getElementById('cashOutFee2').value = inventory.settings.cashOutFees.tier2;
    document.getElementById('cashOutFee3').value = inventory.settings.cashOutFees.tier3;
    document.getElementById('businessName').value = inventory.settings.businessName || '';
    document.getElementById('businessPhone').value = inventory.settings.businessPhone || '';
    document.getElementById('gcashNumber').value = inventory.settings.gcashNumber || '';
}

function saveFeeSettings() {
    inventory.settings.cashInFees.tier1 = parseFloat(document.getElementById('cashInFee1').value);
    inventory.settings.cashInFees.tier2 = parseFloat(document.getElementById('cashInFee2').value);
    inventory.settings.cashInFees.tier3 = parseFloat(document.getElementById('cashInFee3').value);
    inventory.settings.cashOutFees.tier1 = parseFloat(document.getElementById('cashOutFee1').value);
    inventory.settings.cashOutFees.tier2 = parseFloat(document.getElementById('cashOutFee2').value);
    inventory.settings.cashOutFees.tier3 = parseFloat(document.getElementById('cashOutFee3').value);
    
    saveToLocalStorage();
    showNotification('Fee settings saved successfully!', 'success');
}

function saveBusinessInfo() {
    inventory.settings.businessName = document.getElementById('businessName').value.trim();
    inventory.settings.businessPhone = document.getElementById('businessPhone').value.trim();
    inventory.settings.gcashNumber = document.getElementById('gcashNumber').value.trim();

    saveToLocalStorage();
    updateBusinessName();
    showNotification('Business information saved successfully!', 'success');
}

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
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                inventory = normalizeInventory(data);
                saveToLocalStorage();
                closeModal('welcomeModal');
                showNotification('Data imported successfully!', 'success');
                updateDashboard();
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

function clearAllData() {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone!')) return;
    
    inventory = createEmptyInventory();
    const key = inventoryStorageKey();
    if (key) localStorage.removeItem(key);

    showNotification('All data cleared', 'success');
    updateDashboard();
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
        navigator.serviceWorker.register('sw.js').catch(error => {
            console.warn('Service worker registration failed', error);
        });
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
        alert('To install CashG, open your browser menu (⋮) and choose "Install app" or "Add to Home screen".');
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
    const values = {
        cashOnHand: inventory.cash,
        gcashBalance: inventory.gcash,
        heroCash: inventory.cash,
        heroGcash: inventory.gcash,
        heroTotal: inventory.cash + inventory.gcash
    };
    Object.entries(values).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value.toLocaleString();
    });
}

function setCurrentDate() {
    const dateElement = document.getElementById('currentDate');
    if (dateElement) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateElement.textContent = new Date().toLocaleDateString('en-US', options);
    }
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
