// =====================================================================
// CashGee — online / offline status
//
// The inventory works fully offline (records live on the device).
// Notifications, subscription updates and payments need the internet,
// so we tell the user when they're offline and when data was last synced.
// =====================================================================

let wasOffline = !navigator.onLine;

function lastSyncedText() {
    const fetchedAt = typeof account !== 'undefined' && account?.fetchedAt;
    return fetchedAt ? `Last updated ${getTimeAgo(new Date(fetchedAt))}.` : 'Not updated yet on this device.';
}

function renderConnectivity() {
    const offline = !navigator.onLine;
    document.body.classList.toggle('is-offline', offline);

    const pill = document.getElementById('netPill');
    if (pill) pill.hidden = !offline;

    const note = document.getElementById('notifNetNote');
    if (note) {
        note.hidden = !offline;
        const when = note.querySelector('[data-last-sync]');
        if (when) when.textContent = lastSyncedText();
    }
}

function handleOffline() {
    renderConnectivity();
    if (!wasOffline) {
        showNotification('You\'re offline. You can keep recording, but notifications won\'t update until you reconnect.', 'warning');
    }
    wasOffline = true;
}

function handleOnline() {
    renderConnectivity();
    if (wasOffline) {
        showNotification('Back online. Checking for new notifications…', 'success');
    }
    wasOffline = false;
}

window.addEventListener('offline', handleOffline);
window.addEventListener('online', handleOnline);

document.addEventListener('DOMContentLoaded', () => {
    renderConnectivity();

    // Keep the "last updated" note fresh whenever the notifications panel opens
    document.getElementById('notifBell')?.addEventListener('click', renderConnectivity);

    // Opened the app without internet: say so once, after sign-in has settled
    if (!navigator.onLine) {
        setTimeout(() => {
            if (!navigator.onLine && document.getElementById('authScreen').hidden) {
                showNotification('You\'re offline. Your records are saved on this phone.', 'warning');
            }
        }, 1500);
    }
});
