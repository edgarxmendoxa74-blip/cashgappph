# CashG Inventory App

CashG is a mobile-first, installable inventory app for GCash Cash In / Cash Out businesses, built with vanilla HTML, CSS, and JavaScript. Users sign in with an account created by the admin and keep a yearly subscription; their inventory records stay private on their own device.

> **First time?** Follow [SETUP.md](SETUP.md) to connect Supabase (accounts, subscriptions, admin dashboard).

![CashG Inventory App](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

### 📊 Dashboard
- Real-time summary cards showing today's transactions
- Cash In, Cash Out, and Profit tracking
- Recent transactions overview
- Live balance monitoring

### 💳 Transaction Management
- Add Cash In transactions
- Add Cash Out transactions
- Automatic fee calculation based on amount tiers
- Transaction filtering by type and date
- Complete transaction history
- Delete and modify transactions

### 👥 Customer Management
- Add and manage customer information
- Customer contact details (phone, email, GCash number)
- Customer notes and preferences
- Quick customer selection in transactions

### 🏦 Inventory Control
- Real-time Cash and GCash balance tracking
- Manual balance adjustments
- Balance adjustment history
- Total assets calculation

### 📈 Reports & Analytics
- Transaction summaries by date range
- Profit analysis
- Cash In/Out trends
- Daily, weekly, and custom reports

### ⚙️ Settings
- Configurable fee structures (3-tier system)
- Business information management
- Data export (JSON format)
- Data import (restore from backup)
- Clear all data option

### 🔑 Accounts & Subscriptions
- Sign in with an account created by the admin (no public sign-up)
- Subscription page: plan status, dates and days left
- Yearly plan: pay by GCash or bank transfer, then generate and send a PNG receipt
- In-app notifications (payment approved/rejected, expiry reminders)
- Records become read-only when the subscription expires

### 🛡️ Admin Dashboard (`/admin/`)
- Create user accounts, reset passwords, disable or delete accounts
- Review payment proofs and approve or reject them
- Monitor yearly subscriptions, expiring plans and revenue
- Grant extra time manually and send notifications to users
- Set plan prices and the GCash details users pay to

## 🚀 Getting Started

### Prerequisites
- Node.js (for development server)
- Modern web browser

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR-USERNAME/gcash-inventory.git
cd gcash-inventory
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Open your browser at `http://localhost:8081` (admin dashboard: `http://localhost:8081/admin/`)

5. Fill in `config.js` with your Supabase project (see [SETUP.md](SETUP.md)); until then the app shows an "Almost ready" screen.

## 📲 Install as an App (PWA)

The app is a Progressive Web App. Each phone keeps its own private inventory for each signed-in account.

- **Android (Chrome):** open the site → tap **Install App** (in the ☰ More menu or Settings) or browser menu → *Install app*
- **iPhone (Safari):** open the site → Share button → *Add to Home Screen*
- Works **offline** after the first visit.

**Hosting:** installing requires HTTPS, so deploy the folder to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages). No build step — upload the files as-is.

**Releasing updates:** after changing any app file, bump `CACHE_VERSION` in `sw.js` so installed apps pick up the new version.

## 💾 Data Persistence

- **On the device (localStorage):** transactions, customers, balances and fee settings, kept separately per account. Works offline.
- **On Supabase:** login accounts, profiles, subscriptions, payment requests, receipt images and notifications.

## 🎨 Design Features

- Modern, professional UI with GCash branding
- Responsive design (mobile, tablet, desktop)
- Smooth animations and transitions
- Clean, intuitive interface
- Custom color scheme matching GCash brand

## 📱 Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Opera

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Storage**: LocalStorage API (inventory), Supabase Postgres + Storage (accounts & subscriptions)
- **Auth**: Supabase Auth (email + password)
- **Server**: http-server (development), Supabase Edge Function `admin-users`
- **Design**: Custom CSS with CSS Variables

## 📝 Fee Structure

### Cash In Fees
- ₱50 - ₱1,000: ₱5
- ₱1,001 - ₱3,000: ₱10
- ₱3,001+: ₱15

### Cash Out Fees
- ₱100 - ₱1,000: ₱10
- ₱1,001 - ₱3,000: ₱15
- ₱3,001+: ₱20

*Fees are configurable in Settings*

## 🔐 Security

- Inventory records never leave the device
- Row-level security: users can only read their own account, subscription and payment data
- Payment receipts are stored in a private bucket; only the owner and admins can view them
- Account management uses a server-side Edge Function; the service-role key is never shipped to browsers
- Export/Import for backup purposes

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👨‍💻 Author

Created with ❤️ for GCash transaction management

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📞 Support

For support, email your-email@example.com or open an issue in the repository.

---

**Note**: This is an independent project and is not officially affiliated with GCash or Mynt.
