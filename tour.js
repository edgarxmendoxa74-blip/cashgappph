// =====================================================================
// CashG — "How to use" walkthrough
//
// Shown once per account on each device, right after the first sign-in
// (after the Welcome setup). Replay anytime: Settings → How to use CashG.
// Each step spotlights part of the screen and explains it.
// =====================================================================

const TOUR_DONE_PREFIX = 'cashg-tour-done:';
const TOUR_MOBILE_QUERY = '(max-width: 768px)';

// `target` can differ between phone (bottom tab bar) and desktop (sidebar).
// Steps whose target isn't visible are skipped automatically.
const TOUR_STEPS = [
    {
        icon: 'home',
        title: 'Welcome to CashG!',
        text: 'Let\'s take a quick tour so you know where everything is. It only takes a minute.'
    },
    {
        target: '.balance-hero',
        title: 'Your total balance',
        text: 'Cash on hand plus your GCash wallet. It updates by itself every time you record a transaction. Tap <b>Manage</b> to add or remove float.'
    },
    {
        target: '.quick-actions',
        title: 'Quick actions',
        text: '<b>Cash In</b> and <b>Cash Out</b> record a transaction. The fee is computed for you. You can also add a customer or open today\'s report here.'
    },
    {
        target: '.summary-cards',
        title: 'Today at a glance',
        text: 'Today\'s cash in, cash out, profit from fees, and active customers.'
    },
    {
        target: { mobile: '.bottom-nav-fab', desktop: '.quick-actions .cash-in-btn' },
        title: 'Record a transaction',
        text: 'Tap <b>+</b> anytime to add a Cash In or Cash Out. Pick the customer, type the amount, and save.',
        desktopText: 'Click <b>Cash In</b> or <b>Cash Out</b> to add a transaction. Pick the customer, type the amount, and save.'
    },
    {
        target: { mobile: '.bottom-nav a[data-page="transactions"]', desktop: '.sidebar-menu a[data-page="transactions"]' },
        title: 'Transaction history',
        text: 'See every transaction, filter by type or date, and delete mistakes.'
    },
    {
        target: { mobile: '.bottom-nav a[data-page="customers"]', desktop: '.sidebar-menu a[data-page="customers"]' },
        title: 'Customers',
        text: 'Save your regular customers so you can pick them quickly. Walk-in customers work too.'
    },
    {
        target: { mobile: '#bottomNavMore', desktop: '.sidebar-menu a[data-page="reports"]' },
        title: 'More tools',
        text: '<b>Balances</b>, <b>Reports</b>, <b>Subscription</b> and <b>Settings</b> are in the More menu.',
        desktopText: '<b>Reports</b> shows your totals for any date range. <b>Balances</b> and <b>Settings</b> (fees, backup) are in this menu too.'
    },
    {
        target: '#notifBell',
        title: 'Notifications',
        text: 'Payment approvals and subscription reminders show up here.'
    },
    {
        target: { mobile: '#subBanner', desktop: '.sidebar-menu a[data-page="subscription"]' },
        fallback: { mobile: '#bottomNavMore' },
        title: 'Your subscription',
        text: 'Choose <b>Monthly</b> or <b>Yearly</b>, send payment via GCash, and upload your receipt. The admin activates your plan and you\'ll get a notification.'
    },
    {
        icon: 'check',
        title: 'You\'re all set!',
        text: 'You can replay this tour anytime in <b>Settings → How to use CashG</b>.'
    }
];

let tourSteps = [];
let tourIndex = 0;
let tourActive = false;
let tourEls = null;

function tourDoneKey() {
    return TOUR_DONE_PREFIX + (currentUser?.id || 'guest');
}

function isTourDone() {
    try { return localStorage.getItem(tourDoneKey()) === '1'; } catch { return true; }
}

function markTourDone() {
    try { localStorage.setItem(tourDoneKey(), '1'); } catch { /* ignore */ }
}

// Called after sign-in and after the Welcome setup is saved
function maybeStartTour() {
    if (!currentUser || tourActive || isTourDone()) return;
    if (document.getElementById('welcomeModal').classList.contains('active')) return;
    setTimeout(() => {
        if (currentUser && !tourActive && !isTourDone() && !document.querySelector('.modal.active')) startTour();
    }, 700);
}

function isMobileLayout() {
    return window.matchMedia(TOUR_MOBILE_QUERY).matches;
}

function resolveTarget(step) {
    const pick = sel => (sel && typeof sel === 'object') ? sel[isMobileLayout() ? 'mobile' : 'desktop'] : sel;
    for (const selector of [pick(step.target), pick(step.fallback)]) {
        if (!selector) continue;
        const el = document.querySelector(selector);
        if (el && !el.hidden && el.getClientRects().length && el.offsetParent !== null) return el;
        if (el && getComputedStyle(el).position === 'fixed' && el.getClientRects().length && !el.hidden) return el;
    }
    return null;
}

function buildTourElements() {
    if (tourEls) return tourEls;
    const root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `
        <div class="tour-blocker"></div>
        <div class="tour-spotlight"></div>
        <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
            <div class="tour-card-icon"></div>
            <div class="tour-step-count" id="tourCount"></div>
            <h3 id="tourTitle"></h3>
            <p id="tourText"></p>
            <div class="tour-dots" aria-hidden="true"></div>
            <div class="tour-actions">
                <button type="button" class="tour-skip">Skip</button>
                <div class="tour-nav">
                    <button type="button" class="btn btn-secondary btn-sm tour-back">Back</button>
                    <button type="button" class="btn btn-primary btn-sm tour-next">Next</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(root);

    tourEls = {
        root,
        spotlight: root.querySelector('.tour-spotlight'),
        card: root.querySelector('.tour-card'),
        icon: root.querySelector('.tour-card-icon'),
        count: root.querySelector('#tourCount'),
        title: root.querySelector('#tourTitle'),
        text: root.querySelector('#tourText'),
        dots: root.querySelector('.tour-dots'),
        back: root.querySelector('.tour-back'),
        next: root.querySelector('.tour-next'),
        skip: root.querySelector('.tour-skip')
    };

    tourEls.next.addEventListener('click', () => goToTourStep(tourIndex + 1));
    tourEls.back.addEventListener('click', () => goToTourStep(tourIndex - 1));
    tourEls.skip.addEventListener('click', () => endTour());
    tourEls.root.querySelector('.tour-blocker').addEventListener('click', () => tourEls.next.focus());
    return tourEls;
}

function startTour() {
    if (!currentUser) return;
    setSidebarOpen(false);
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.notification').forEach(n => n.remove());
    if (currentPage !== 'dashboard') navigateToPage('dashboard');

    // Only keep steps whose target exists in this layout (intro/outro have no target)
    tourSteps = TOUR_STEPS.filter(step => !step.target || resolveTarget(step));
    tourIndex = 0;
    tourActive = true;

    buildTourElements();
    tourEls.dots.innerHTML = tourSteps.map(() => '<span></span>').join('');
    tourEls.root.classList.add('is-open');
    document.body.classList.add('tour-open');
    window.addEventListener('resize', positionTourStep);
    window.addEventListener('keydown', handleTourKeys);
    goToTourStep(0);
}

function goToTourStep(index) {
    if (index < 0) return;
    if (index >= tourSteps.length) {
        endTour();
        return;
    }
    tourIndex = index;
    const step = tourSteps[index];
    const mobile = isMobileLayout();

    tourEls.title.textContent = step.title;
    tourEls.text.innerHTML = (!mobile && step.desktopText) || step.text;
    tourEls.icon.innerHTML = step.icon ? icon(step.icon) : '';
    tourEls.icon.hidden = !step.icon;
    tourEls.count.textContent = step.target ? `Step ${index} of ${tourSteps.length - 2}` : '';
    tourEls.count.hidden = !step.target;
    tourEls.dots.querySelectorAll('span').forEach((dot, i) => dot.classList.toggle('active', i === index));

    const isFirst = index === 0;
    const isLast = index === tourSteps.length - 1;
    tourEls.back.hidden = isFirst || isLast;
    tourEls.skip.hidden = isLast;
    tourEls.next.textContent = isFirst ? 'Start Tour' : isLast ? 'Start Using CashG' : 'Next';

    const target = step.target ? resolveTarget(step) : null;
    if (target) {
        const style = getComputedStyle(target);
        const fixed = style.position === 'fixed' || target.closest('.bottom-nav, .top-header, .sidebar');
        if (!fixed) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    } else {
        window.scrollTo(0, 0);
    }

    tourEls.card.classList.remove('is-visible');
    requestAnimationFrame(() => {
        positionTourStep();
        tourEls.card.classList.add('is-visible');
        tourEls.next.focus({ preventScroll: true });
    });
}

function positionTourStep() {
    if (!tourActive) return;
    const step = tourSteps[tourIndex];
    const target = step.target ? resolveTarget(step) : null;
    const { spotlight, card } = tourEls;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    card.classList.remove('is-centered', 'is-above', 'is-below');
    tourEls.root.classList.toggle('no-target', !target);

    if (!target) {
        spotlight.classList.add('is-hidden');
        card.classList.add('is-centered');
        card.style.left = '';
        card.style.top = '';
        return;
    }

    const pad = 6;
    const rect = target.getBoundingClientRect();
    const box = {
        left: Math.max(4, rect.left - pad),
        top: Math.max(4, rect.top - pad),
        right: Math.min(vw - 4, rect.right + pad),
        bottom: Math.min(vh - 4, rect.bottom + pad)
    };
    spotlight.classList.remove('is-hidden');
    spotlight.style.left = `${box.left}px`;
    spotlight.style.top = `${box.top}px`;
    spotlight.style.width = `${box.right - box.left}px`;
    spotlight.style.height = `${box.bottom - box.top}px`;
    spotlight.style.borderRadius = getComputedStyle(target).borderRadius || '16px';

    // Card below the target if it fits, otherwise above
    const cardWidth = Math.min(340, vw - margin * 2);
    card.style.width = `${cardWidth}px`;
    const cardHeight = card.offsetHeight;
    const spaceBelow = vh - box.bottom;
    const placeBelow = spaceBelow >= cardHeight + margin * 2 || spaceBelow > box.top;

    let top = placeBelow ? box.bottom + margin : box.top - cardHeight - margin;
    top = Math.max(margin, Math.min(top, vh - cardHeight - margin));
    const centerX = (box.left + box.right) / 2;
    const left = Math.max(margin, Math.min(centerX - cardWidth / 2, vw - cardWidth - margin));

    card.classList.add(placeBelow ? 'is-below' : 'is-above');
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.setProperty('--caret-x', `${Math.max(20, Math.min(centerX - left, cardWidth - 20))}px`);
}

function handleTourKeys(event) {
    if (!tourActive) return;
    if (event.key === 'Escape') endTour();
    else if (event.key === 'ArrowRight') goToTourStep(tourIndex + 1);
    else if (event.key === 'ArrowLeft') goToTourStep(tourIndex - 1);
}

function endTour({ markDone = true } = {}) {
    if (!tourActive) return;
    tourActive = false;
    if (markDone) markTourDone();
    tourEls.root.classList.remove('is-open');
    tourEls.card.classList.remove('is-visible');
    document.body.classList.remove('tour-open');
    window.removeEventListener('resize', positionTourStep);
    window.removeEventListener('keydown', handleTourKeys);
    window.scrollTo(0, 0);
}

// Settings → How to use CashG
function replayTour() {
    startTour();
}
