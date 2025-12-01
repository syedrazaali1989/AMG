// Signal Types and Interfaces

export enum MarketType {
  FOREX = 'FOREX',
  CRYPTO = 'CRYPTO'
}

export enum SignalType {
  SPOT = 'SPOT',
  FUTURE = 'FUTURE'
}

export enum SignalDirection {
  BUY = 'BUY',
  SELL = 'SELL',
  LONG = 'LONG',
  SHORT = 'SHORT'
}

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  STOPPED = 'STOPPED'
}

export enum Timeframe {
  ONE_MINUTE = '1m',
  FIVE_MINUTES = '5m',
  FIFTEEN_MINUTES = '15m',
  ONE_HOUR = '1h',
  FOUR_HOURS = '4h',
  ONE_DAY = '1D'
}

// New enums for enhanced news integration
export enum MarketCondition {
  HIGH_VOLATILITY = 'HIGH_VOLATILITY',
  NEWS_DRIVEN = 'NEWS_DRIVEN',
  TRENDING = 'TRENDING',
  RANGING = 'RANGING'
}

export enum TechnicalAlignment {
  STRONG = 'STRONG',
  MODERATE = 'MODERATE',
  WEAK = 'WEAK'
}


export interface Signal {
  id: string;
  marketType: MarketType;
  signalType: SignalType;
  direction: SignalDirection;
  status: SignalStatus;
  pair: string;
  entryPrice: number;
  currentPrice: number;
  mexcPrice?: number; // Optional price from MEXC for comparison
  stopLoss: number;
  takeProfit: number;
  // Partial Take Profits
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  confidence: number;
  timestamp: Date;
  expiresAt?: Date;
  profitLoss?: number;
  profitLossPercentage?: number;
  // Track highest/lowest prices to detect TP hits
  highestPrice?: number;
  lowestPrice?: number;
  // News and sentiment data
  newsEvents?: string[];
  economicEvents?: string[];
  sentimentScore?: number;
  // Advanced market analysis
  marketTrend?: string;
  riskScore?: number;
  marketAnalysis?: string[];
  liquidityZones?: { price: number; type: string; strength: number }[];
  isCounterTrend?: boolean; // True if trading against market trend
  // Timeframe information
  timeframe: Timeframe; // Candlestick timeframe for this signal
  nextCandleTime?: Date; // When the next candle closes
  // Enhanced news integration fields
  marketCondition?: MarketCondition; // Market condition classification
  newsImpactScore?: number; // Aggregate news score (-5 to +5)
  technicalAlignment?: TechnicalAlignment; // How well technicals align
  validUntil?: Date; // Signal validity timestamp
  rationalePoints?: string[]; // 3-bullet rationale (news + technicals + volume)
  volumeVsAverage?: number; // Current volume as % of average
}

export interface TechnicalIndicators {
  rsi: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  };
  ema: {
    ema9: number;
    ema21: number;
    ema50: number;
  };
  sma: {
    sma20: number;
    sma50: number;
    sma200: number;
  };
  volume: number;
  volumeAverage: number;
}

export interface MarketData {
  pair: string;
  marketType: MarketType;
  prices: number[];
  volumes: number[];
  timestamps: Date[];
  currentPrice: number;
}

export interface SignalAccuracy {
  totalSignals: number;
  successfulSignals: number;
  failedSignals: number;
  activeSignals: number;
  accuracyRate: number;
  averageProfit: number;
}
