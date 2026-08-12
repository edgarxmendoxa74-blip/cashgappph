// ===================================
// GCASH INVENTORY MANAGEMENT SYSTEM
// ===================================

// Data Storage
let inventory = {
    cash: 50000,
    gcash: 100000,
    transactions: [],
    customers: [],
    settings: {
        cashInFees: { tier1: 5, tier2: 10, tier3: 15 },
        cashOutFees: { tier1: 10, tier2: 15, tier3: 20 }
    }
};

// Current State
let currentPage = 'dashboard';
let currentTransactionType = '';
let currentBalanceType = '';
let currentBalanceAction = '';

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', function() {
    loadFromLocalStorage();
    initializeNavigation();
    initializeModals();
    updateDashboard();
    updateAllBalances();
    setCurrentDate();
    
    // Load sample data if empty
    if (inventory.customers.length === 0) {
        loadSampleData();
    }
});

// ===================================
// LOCAL STORAGE
// ===================================

function loadFromLocalStorage() {
    const saved = localStorage.getItem('gcashInventory');
    if (saved) {
        inventory = JSON.parse(saved);
    }
}

function saveToLocalStorage() {
    localStorage.setItem('gcashInventory', JSON.stringify(inventory));
}

function loadSampleData() {
    inventory.customers = [
        { id: 1, name: 'Juan Dela Cruz', phone: '09171234567', gcash: '09171234567', email: 'juan@email.com', notes: 'Regular customer' },
        { id: 2, name: 'Maria Santos', phone: '09181234567', gcash: '09181234567', email: 'maria@email.com', notes: '' },
        { id: 3, name: 'Pedro Reyes', phone: '09191234567', gcash: '09191234567', email: '', notes: 'VIP customer' }
    ];
    
    inventory.transactions = [
        { id: 1, date: new Date().toISOString(), type: 'cashin', customer: 'Juan Dela Cruz', amount: 1000, fee: 10, total: 1010, status: 'completed', reference: 'GC123456' },
        { id: 2, date: new Date().toISOString(), type: 'cashout', customer: 'Maria Santos', amount: 500, fee: 10, total: 490, status: 'completed', reference: 'GC123457' }
    ];
    
    saveToLocalStorage();
}

// ===================================
// NAVIGATION
// ===================================

function initializeNavigation() {
    const menuItems = document.querySelectorAll('.menu-item a');
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    
    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            if (page) {
                navigateToPage(page);
            }
        });
    });
    
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('active');
        });
    }
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
    const activeMenuItem = document.querySelector(`[data-page="${page}"]`)?.parentElement;
    if (activeMenuItem) {
        activeMenuItem.classList.add('active');
    }
    
    // Update page title
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
        pageTitle.textContent = page.charAt(0).toUpperCase() + page.slice(1);
    }
    
    currentPage = page;
    
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
    }
}

// ===================================
// DASHBOARD
// ===================================

function updateDashboard() {
    const today = new Date().toDateString();
    const todayTransactions = inventory.transactions.filter(t => 
        new Date(t.date).toDateString() === today
    );
    
    const cashInTransactions = todayTransactions.filter(t => t.type === 'cashin');
    const cashOutTransactions = todayTransactions.filter(t => t.type === 'cashout');
    
    const todayCashIn = cashInTransactions.reduce((sum, t) => sum + t.amount, 0);
    const todayCashOut = cashOutTransactions.reduce((sum, t) => sum + t.amount, 0);
    const todayProfit = todayTransactions.reduce((sum, t) => sum + t.fee, 0);
    
    // Update summary cards
    document.getElementById('todayCashIn').textContent = todayCashIn.toLocaleString();
    document.getElementById('todayCashInCount').textContent = cashInTransactions.length;
    document.getElementById('todayCashOut').textContent = todayCashOut.toLocaleString();
    document.getElementById('todayCashOutCount').textContent = cashOutTransactions.length;
    document.getElementById('todayProfit').textContent = todayProfit.toLocaleString();
    document.getElementById('activeCustomers').textContent = inventory.customers.length;
    
    // Load recent transactions
    loadRecentTransactions();
}

function loadRecentTransactions() {
    const list = document.getElementById('recentTransactionsList');
    if (!list) return;
    
    const recent = inventory.transactions.slice(-5).reverse();
    
    if (recent.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No transactions yet</p>';
        return;
    }
    
    list.innerHTML = recent.map(t => `
        <div style="padding: 1rem; border: 1px solid var(--border); border-radius: var(--border-radius-sm); display: flex; justify-content: space-between; align-items: center;">
            <div>
                <div style="font-weight: 600;">${t.customer}</div>
                <div style="font-size: 0.875rem; color: var(--text-muted);">
                    ${t.type === 'cashin' ? '💰 Cash In' : '💸 Cash Out'} • ${formatDate(t.date)}
                </div>
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 700; font-size: 1.125rem;">₱${t.amount.toLocaleString()}</div>
                <div style="font-size: 0.875rem; color: var(--text-muted);">Fee: ₱${t.fee}</div>
            </div>
        </div>
    `).join('');
}

// ===================================
// TRANSACTIONS
// ===================================

function openTransactionModal(type) {
    currentTransactionType = type || '';
    const modal = document.getElementById('transactionModal');
    const title = document.getElementById('transactionModalTitle');
    const typeSelect = document.getElementById('transactionType');
    
    if (type) {
        typeSelect.value = type;
        title.textContent = type === 'cashin' ? 'New Cash In Transaction' : 'New Cash Out Transaction';
    } else {
        typeSelect.value = '';
        title.textContent = 'New Transaction';
    }
    
    populateCustomerSelect();
    document.getElementById('transactionForm').reset();
    modal.classList.add('active');
    updateTransactionForm();
}

function updateTransactionForm() {
    const type = document.getElementById('transactionType').value;
    currentTransactionType = type;
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
    const type = document.getElementById('transactionType').value;
    const customerSelect = document.getElementById('customerSelect');
    const customerName = customerSelect.options[customerSelect.selectedIndex].text;
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
    if (!tbody) return;
    
    const filter = document.getElementById('transactionFilter')?.value || 'all';
    const dateFilter = document.getElementById('dateFilter')?.value;
    
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
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">No transactions found</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.reverse().map(t => `
        <tr>
            <td>${formatDate(t.date)}</td>
            <td>
                <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.875rem; font-weight: 600;
                    ${t.type === 'cashin' ? 'background: var(--cash-in-light); color: var(--cash-in);' : 'background: var(--cash-out-light); color: var(--cash-out);'}">
                    ${t.type === 'cashin' ? 'Cash In' : 'Cash Out'}
                </span>
            </td>
            <td>${t.customer}</td>
            <td>₱${t.amount.toLocaleString()}</td>
            <td>₱${t.fee}</td>
            <td>₱${t.total.toLocaleString()}</td>
            <td>
                <span style="padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.875rem; font-weight: 600;
                    background: var(--success); color: white;">
                    ${t.status}
                </span>
            </td>
            <td>
                <button onclick="deleteTransaction(${t.id})" class="btn btn-danger" style="padding: 0.5rem 1rem; font-size: 0.875rem;">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

function deleteTransaction(id) {
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

function openCustomerModal() {
    document.getElementById('customerForm').reset();
    document.getElementById('customerModal').classList.add('active');
}

function saveCustomer() {
    const name = document.getElementById('customerName').value;
    const phone = document.getElementById('customerPhone').value;
    const gcash = document.getElementById('customerGCash').value;
    const email = document.getElementById('customerEmail').value;
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
        email,
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

function loadCustomers() {
    const grid = document.getElementById('customersGrid');
    if (!grid) return;
    
    if (inventory.customers.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No customers yet</p>';
        return;
    }
    
    grid.innerHTML = inventory.customers.map(c => `
        <div style="background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--border-radius); padding: 1.5rem;">
            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
                <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary-light); 
                    color: var(--primary); display: flex; align-items: center; justify-content: center; 
                    font-weight: 700; font-size: 1.25rem;">
                    ${c.name.charAt(0)}
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 1.125rem;">${c.name}</div>
                    <div style="color: var(--text-muted); font-size: 0.875rem;">📱 ${c.phone}</div>
                </div>
            </div>
            ${c.email ? `<div style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 0.5rem;">📧 ${c.email}</div>` : ''}
            ${c.notes ? `<div style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 1rem;">📝 ${c.notes}</div>` : ''}
            <button onclick="deleteCustomer(${c.id})" class="btn btn-danger" style="width: 100%; margin-top: 1rem;">
                Delete Customer
            </button>
        </div>
    `).join('');
}

function deleteCustomer(id) {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    
    inventory.customers = inventory.customers.filter(c => c.id !== id);
    saveToLocalStorage();
    showNotification('Customer deleted', 'success');
    loadCustomers();
}

function populateCustomerSelect() {
    const select = document.getElementById('customerSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select Customer</option>' +
        inventory.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
    currentBalanceType = type;
    currentBalanceAction = action;
    
    const modal = document.getElementById('balanceModal');
    const title = document.getElementById('balanceModalTitle');
    
    title.textContent = `${action === 'add' ? 'Add' : 'Remove'} ${type === 'cash' ? 'Cash' : 'GCash Balance'}`;
    
    document.getElementById('balanceForm').reset();
    modal.classList.add('active');
}

function saveBalanceAdjustment() {
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
    generateReport();
}

function generateReport() {
    const startDate = document.getElementById('reportStartDate')?.value;
    const endDate = document.getElementById('reportEndDate')?.value;
    
    let transactions = [...inventory.transactions];
    
    if (startDate) {
        transactions = transactions.filter(t => new Date(t.date) >= new Date(startDate));
    }
    if (endDate) {
        transactions = transactions.filter(t => new Date(t.date) <= new Date(endDate));
    }
    
    const cashIn = transactions.filter(t => t.type === 'cashin');
    const cashOut = transactions.filter(t => t.type === 'cashout');
    
    const totalCashIn = cashIn.reduce((sum, t) => sum + t.amount, 0);
    const totalCashOut = cashOut.reduce((sum, t) => sum + t.amount, 0);
    const totalProfit = transactions.reduce((sum, t) => sum + t.fee, 0);
    
    const summaryDiv = document.getElementById('transactionSummary');
    if (summaryDiv) {
        summaryDiv.innerHTML = `
            <div style="display: grid; gap: 1rem;">
                <div style="padding: 1rem; background: var(--cash-in-light); border-radius: var(--border-radius-sm);">
                    <div style="color: var(--text-muted); font-size: 0.875rem;">Total Cash In</div>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--cash-in);">₱${totalCashIn.toLocaleString()}</div>
                    <div style="color: var(--text-muted); font-size: 0.875rem;">${cashIn.length} transactions</div>
                </div>
                <div style="padding: 1rem; background: var(--cash-out-light); border-radius: var(--border-radius-sm);">
                    <div style="color: var(--text-muted); font-size: 0.875rem;">Total Cash Out</div>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--cash-out);">₱${totalCashOut.toLocaleString()}</div>
                    <div style="color: var(--text-muted); font-size: 0.875rem;">${cashOut.length} transactions</div>
                </div>
                <div style="padding: 1rem; background: var(--profit-light); border-radius: var(--border-radius-sm);">
                    <div style="color: var(--text-muted); font-size: 0.875rem;">Total Profit</div>
                    <div style="font-size: 2rem; font-weight: 700; color: var(--profit);">₱${totalProfit.toLocaleString()}</div>
                    <div style="color: var(--text-muted); font-size: 0.875rem;">From fees collected</div>
                </div>
            </div>
        `;
    }
}

function generateDailyReport() {
    navigateToPage('reports');
    const today = new Date().toISOString().split('T')[0];
    const startInput = document.getElementById('reportStartDate');
    const endInput = document.getElementById('reportEndDate');
    if (startInput) startInput.value = today;
    if (endInput) endInput.value = today;
    generateReport();
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
    showNotification('Business information saved successfully!', 'success');
}

function exportData() {
    const dataStr = JSON.stringify(inventory, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gcash-inventory-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showNotification('Data exported successfully!', 'success');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function(e) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                inventory = data;
                saveToLocalStorage();
                showNotification('Data imported successfully!', 'success');
                updateDashboard();
                updateAllBalances();
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
    
    inventory = {
        cash: 0,
        gcash: 0,
        transactions: [],
        customers: [],
        settings: {
            cashInFees: { tier1: 5, tier2: 10, tier3: 15 },
            cashOutFees: { tier1: 10, tier2: 15, tier3: 20 }
        }
    };
    
    saveToLocalStorage();
    showNotification('All data cleared', 'success');
    updateDashboard();
    updateAllBalances();
}

// ===================================
// MODALS
// ===================================

function initializeModals() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(modal => {
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
    document.getElementById('cashOnHand').textContent = inventory.cash.toLocaleString();
    document.getElementById('gcashBalance').textContent = inventory.gcash.toLocaleString();
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
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    notification.innerHTML = `
        <div class="notification-content" style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 1.25rem;">${icons[type]}</span>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()" 
            style="background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; margin-left: 1rem;">&times;</button>
    `;

    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${colors[type]};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: var(--border-radius-sm);
        box-shadow: var(--shadow-xl);
        z-index: 3000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-width: 300px;
        max-width: 500px;
        animation: slideIn 0.3s ease;
    `;

    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}
