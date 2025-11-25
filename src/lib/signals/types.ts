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
