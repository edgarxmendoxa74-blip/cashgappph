# 💰 GCash Inventory Management System

A modern, professional inventory management system for GCash Cash In/Cash Out transactions built with vanilla HTML, CSS, and JavaScript.

![GCash Inventory](https://img.shields.io/badge/version-1.0.0-blue.svg)
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

4. Open your browser at `http://localhost:8080`

## 💾 Data Persistence

All data is stored locally in your browser's localStorage, ensuring:
- No server required
- Instant data access
- Privacy and security
- Offline functionality

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
- **Storage**: LocalStorage API
- **Server**: http-server (development)
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

- All data stored locally in browser
- No external API calls
- No sensitive data transmitted
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
