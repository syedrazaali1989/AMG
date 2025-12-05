// Exchange Availability Checker
// Determines which exchanges support each cryptocurrency pair

import { MarketType } from './types';

export class ExchangeAvailability {
    // Binance supported coins (verified comprehensive list)
    private static readonly BINANCE_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'THETA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'HBAR', 'IMX', 'RUNE',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ZIL', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'LRC',
        'STORJ', 'OCEAN', 'ANKR', 'AUDIO', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'HOT', 'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'ROSE',
        'RSR', 'SKL', 'STX', 'WOO', 'ZEC', 'DASH',
        'WAVES', 'ICX', 'QTUM', 'ONT', 'IOST', 'CELR', 'CELO', 'AR', 'FLUX',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA', 'ORDI', 'BONK',
        'MINA', 'PENDLE', 'JTO', 'PYTH', 'STRK'
    ]);

    // Bybit supported coins (verified listings)
    private static readonly BYBIT_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'APE', 'SHIB',
        'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'IMX',
        'GRT', 'SNX', 'EOS', 'EGLD', 'ENJ', 'CHZ',
        'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'LRC',
        'DYDX', 'FET', 'GALA', 'GMT',
        'JASMY', 'LDO', 'LUNC', 'MASK', 'PEOPLE', 'ROSE',
        'STX', 'WOO', 'DASH', 'AR',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA', 'BONK',
        'MINA', 'PENDLE', 'PYTH'
    ]);

    // OKX supported coins (verified comprehensive list)
    private static readonly OKX_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'HBAR', 'IMX',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'LRC',
        'OCEAN', 'ANKR', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'JASMY', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'ROSE',
        'SKL', 'STX', 'WOO', 'ZEC', 'DASH', 'WAVES',
        'CELO', 'AR', 'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA',
        'BONK', 'MINA', 'PENDLE', 'JTO', 'PYTH'
    ]);

    // KuCoin supported coins (verified listings)
    private static readonly KUCOIN_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'FIL', 'SAND', 'MANA', 'AXS',
        'FTM', 'NEAR', 'SHIB', 'APT', 'ARB', 'OP', 'GRT', 'SNX', 'FET', 'GALA',
        'PEPE', 'CFX', 'RNDR'
    ]);

    // MEXC supported coins (verified listings only)
    private static readonly MEXC_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ETC', 'SAND', 'FTM', 'NEAR', 'APE', 'SHIB',
        'APT', 'ARB', 'OP', 'SUSHI', 'CRV', 'FET', 'GALA', 'PEPE', 'BONK'
    ]);

    // Gate.io supported coins (verified comprehensive altcoin coverage)
    private static readonly GATEIO_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'HBAR', 'IMX',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ZIL', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'LRC',
        'OCEAN', 'ANKR', 'AUDIO', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'HOT', 'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'ROSE',
        'RSR', 'SKL', 'STX', 'WOO', 'ZEC', 'DASH',
        'WAVES', 'ICX', 'QTUM', 'ONT', 'IOST', 'CELR', 'CELO', 'AR',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA', 'BONK',
        'MINA', 'PENDLE', 'JTO', 'PYTH'
    ]);

    // BingX supported coins (verified popular listings)
    private static readonly BINGX_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'FTM', 'NEAR', 'APE', 'SHIB',
        'APT', 'ARB', 'OP', 'FET', 'GALA', 'PEPE', 'BONK'
    ]);

    // Bitget supported coins (verified popular for copy trading)
    private static readonly BITGET_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'APE', 'SHIB',
        'APT', 'ARB', 'OP', 'INJ', 'SUI',
        'GRT', 'SNX', 'EOS', 'ENJ', 'CHZ',
        'SUSHI', 'CRV', '1INCH',
        'FET', 'GALA', 'GMT',
        'JASMY', 'LDO', 'LUNC', 'ROSE',
        'STX', 'WOO',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'BONK',
        'PENDLE'
    ]);

    // Exness supported forex pairs
    private static readonly EXNESS_FOREX = new Set([
        'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
        'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'EUR/AUD', 'EUR/CAD',
        'GBP/CHF', 'GBP/AUD', 'AUD/JPY', 'AUD/CAD', 'CAD/JPY', 'CHF/JPY', 'NZD/JPY',
        'XAU/USD', 'XAG/USD', 'CL/USD'
    ]);

    /**
     * Get list of exchanges where a pair is available
     */
    static getAvailableExchanges(pair: string, marketType: MarketType): string[] {
        if (marketType === MarketType.FOREX) {
            return ['Exness'];
        }

        const [base] = pair.split('/');
        const exchanges: string[] = [];

        if (this.BINANCE_COINS.has(base)) exchanges.push('Binance');
        if (this.BYBIT_COINS.has(base)) exchanges.push('Bybit');
        if (this.OKX_COINS.has(base)) exchanges.push('OKX');
        if (this.KUCOIN_COINS.has(base)) exchanges.push('KuCoin');
        if (this.MEXC_COINS.has(base)) exchanges.push('MEXC');
        if (this.GATEIO_COINS.has(base)) exchanges.push('Gate.io');
        if (this.BINGX_COINS.has(base)) exchanges.push('BingX');
        if (this.BITGET_COINS.has(base)) exchanges.push('Bitget');

        // Return only actual exchanges where the coin exists
        // Do NOT add a default exchange if coin is not found
        return exchanges;
    }

    /**
     * Check if pair is available on specific exchange
     */
    static isAvailableOn(pair: string, exchange: string, marketType: MarketType): boolean {
        const [base] = pair.split('/');

        if (marketType === MarketType.FOREX) {
            return exchange.toLowerCase() === 'exness';
        }

        switch (exchange.toLowerCase()) {
            case 'binance': return this.BINANCE_COINS.has(base);
            case 'bybit': return this.BYBIT_COINS.has(base);
            case 'okx': return this.OKX_COINS.has(base);
            case 'kucoin': return this.KUCOIN_COINS.has(base);
            case 'mexc': return this.MEXC_COINS.has(base);
            case 'gate.io': return this.GATEIO_COINS.has(base);
            case 'bingx': return this.BINGX_COINS.has(base);
            case 'bitget': return this.BITGET_COINS.has(base);
            default: return false;
        }
    }

    /**
     * Get exchange count for a pair
     */
    static getExchangeCount(pair: string, marketType: MarketType): number {
        return this.getAvailableExchanges(pair, marketType).length;
    }
}
