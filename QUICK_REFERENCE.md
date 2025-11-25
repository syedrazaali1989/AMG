# Trading Signals App - Quick Reference

## 🚀 Start Application
```bash
cd trading-signals-app
npm run dev
```
Access: http://localhost:3000

## 📱 Pages

### Landing Page (/)
- Hero section with 90%+ accuracy badge
- Feature showcase
- Statistics display
- CTA buttons

### Dashboard (/dashboard)
- Real-time signal generation
- Stats cards (Total, Active, Accuracy, Avg Profit)
- Signal filtering (Market Type, Signal Type, Search)
- Signal cards with full details
- Generate New Signals button

## 🎯 Key Features

### Signal Information
Each signal shows:
- Pair (e.g., BTC/USDT, EUR/USD)
- Direction (BUY/SELL)
- Entry Price
- Current Price
- Stop Loss
- Take Profit
- Confidence Score (0-100%)
- Status (ACTIVE/COMPLETED/STOPPED)
- P/L Percentage

### Filters
- **Market Type**: ALL, FOREX, CRYPTO
- **Signal Type**: ALL, SPOT, FUTURE
- **Search**: Filter by pair name

## 🎨 UI Components

### SignalCard
Premium card with:
- Glassmorphism effect
- Color-coded direction (green=BUY, red=SELL)
- Animated confidence bar
- Price information grid
- Target levels (TP/SL)
- Real-time P/L display

### MessageBox
Toast notifications for:
- New signals generated
- Signal completions
- Welcome messages
- Auto-dismiss with hover pause

### StatsCard
Animated statistics with:
- Icon display
- Gradient text
- Trend indicators
- Hover effects

## 🔧 Technical Details

### Signal Generation Algorithm
1. RSI Analysis (30/70 levels) - 25 points
2. MACD Confirmation - 20 points
3. Bollinger Bands - 20 points
4. EMA Trend - 15 points
5. Volume Confirmation - 10 points
6. Price Action - 10 points

**Threshold**: 60+ points required
**Target**: 90%+ accuracy

### Market Coverage
- **Forex**: 10 major pairs
- **Crypto**: 10 major pairs
- **Types**: Spot & Futures

## 📊 Statistics Tracking
- Total Signals Generated
- Active Signals Count
- Accuracy Rate (%)
- Average Profit (%)
- Successful vs Failed Signals

## 🎨 Design System
- **Colors**: Dark theme with blue/purple gradients
- **Effects**: Glassmorphism, glow animations
- **Font**: Inter (Google Fonts)
- **Animations**: Framer Motion
- **Icons**: Lucide React

## ⚡ Performance
- Fast page loads
- Smooth animations
- Efficient state management (Zustand)
- Optimized bundle size
- Responsive design (mobile/tablet/desktop)

## 🔄 Real-time Updates
- Price updates every 30 seconds
- Automatic P/L calculations
- Signal status tracking
- Notification system

## 📝 Notes
- Simulated data for demonstration
- Can integrate real APIs (Binance, Alpha Vantage)
- Educational purposes only
- Always DYOR before trading
