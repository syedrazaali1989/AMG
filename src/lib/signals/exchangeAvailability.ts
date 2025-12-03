// Exchange Availability Checker
// Determines which exchanges support each cryptocurrency pair

import { MarketType } from './types';

export class ExchangeAvailability {
    // Binance supported coins (most comprehensive)
    private static readonly BINANCE_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'THETA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'HBAR', 'IMX', 'RUNE',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ZIL', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'ZRX', 'REN', 'LRC',
        'STORJ', 'OCEAN', 'ANKR', 'AUDIO', 'COTI', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'HOT', 'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'QNT', 'ROSE',
        'RSR', 'SKL', 'STX', 'SXP', 'TWT', 'WOO', 'XEC', 'ZEC', 'ZEN', 'DASH',
        'WAVES', 'ICX', 'QTUM', 'ONT', 'IOST', 'CELR', 'CELO', 'AR', 'KDA', 'FLUX',
        'BLUR', 'PEPE', 'FLR', 'AGIX', 'CFX', 'RNDR', 'WLD', 'TIA', 'ORDI', 'BONK',
        'MINA', 'PENDLE', 'JTO', 'PYTH', 'DYM', 'STRK', 'PORTAL', 'PIXEL', 'AEVO', 'METIS'
    ]);

    // Bybit supported coins (comprehensive futures & spot)
    private static readonly BYBIT_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'THETA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'HBAR', 'IMX', 'RUNE',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'LRC',
        'OCEAN', 'ANKR', 'AUDIO', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'ROSE',
        'SKL', 'STX', 'WOO', 'ZEC', 'DASH', 'WAVES', 'AR',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA', 'ORDI', 'BONK',
        'MINA', 'PENDLE', 'JTO', 'PYTH', 'STRK', 'PIXEL'
    ]);

    // OKX supported coins (very comprehensive)
    private static readonly OKX_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'THETA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'SEI', 'HBAR', 'IMX', 'RUNE',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ZIL', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'ZRX', 'LRC',
        'STORJ', 'OCEAN', 'ANKR', 'AUDIO', 'COTI', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'HOT', 'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'QNT', 'ROSE',
        'RSR', 'SKL', 'STX', 'WOO', 'ZEC', 'ZEN', 'DASH', 'WAVES', 'ICX', 'QTUM',
        'CELO', 'AR', 'FLUX', 'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'TIA', 'ORDI',
        'BONK', 'MINA', 'PENDLE', 'JTO', 'PYTH', 'DYM', 'STRK', 'PORTAL', 'PIXEL'
    ]);

    // KuCoin supported coins
    private static readonly KUCOIN_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'VET', 'FIL',
        'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'SHIB',
        'ICP', 'APT', 'ARB', 'OP', 'GRT', 'SNX', 'FLOW', 'EOS',
        'CHZ', 'SUSHI', 'CRV', 'FET', 'GALA', 'ONE',
        'CELO', 'PEPE', 'CFX', 'RNDR', 'BLUR', 'PENDLE'
    ]);

    // MEXC supported coins
    private static readonly MEXC_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ',
        'CHZ', 'COMP', 'SUSHI', 'CRV', 'BAT', '1INCH',
        'FET', 'GALA', 'JASMY', 'LUNC', 'ONE', 'ROSE',
        'STX', 'CELO', 'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'BONK'
    ]);

    // Gate.io supported coins (very comprehensive altcoin coverage)
    private static readonly GATEIO_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'THETA', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'HBAR', 'IMX', 'RUNE',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'EGLD', 'KAVA', 'ZIL', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'MKR', 'SUSHI', 'CRV', '1INCH', 'BAT', 'ZRX', 'REN', 'LRC',
        'STORJ', 'OCEAN', 'ANKR', 'AUDIO', 'COTI', 'DYDX', 'ENS', 'FET', 'GALA', 'GMT',
        'HOT', 'JASMY', 'KSM', 'LDO', 'LUNC', 'MASK', 'ONE', 'PEOPLE', 'ROSE',
        'RSR', 'SKL', 'STX', 'SXP', 'TWT', 'WOO', 'ZEC', 'ZEN', 'DASH',
        'WAVES', 'ICX', 'QTUM', 'ONT', 'IOST', 'CELR', 'CELO', 'AR', 'FLUX',
        'BLUR', 'PEPE', 'FLR', 'CFX', 'RNDR', 'WLD', 'TIA', 'ORDI', 'BONK',
        'MINA', 'PENDLE', 'JTO', 'PYTH', 'STRK', 'PORTAL', 'PIXEL'
    ]);

    // BingX supported coins (growing exchange)
    private static readonly BINGX_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'FIL',
        'SAND', 'MANA', 'FTM', 'NEAR', 'APE', 'SHIB',
        'APT', 'ARB', 'OP', 'GRT', 'SNX', 'EOS',
        'SUSHI', 'CRV', 'FET', 'GALA',
        'PEPE', 'CFX', 'RNDR', 'WLD', 'BONK'
    ]);

    // Bitget supported coins (popular for copy trading)
    private static readonly BITGET_COINS = new Set([
        'BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'SOL', 'DOGE', 'TRX', 'AVAX', 'DOT',
        'MATIC', 'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
        'AAVE', 'SAND', 'MANA', 'AXS', 'FTM', 'NEAR', 'APE', 'SHIB', 'CRO',
        'ICP', 'APT', 'ARB', 'OP', 'INJ', 'SUI', 'HBAR', 'IMX',
        'GRT', 'SNX', 'FLOW', 'EOS', 'XTZ', 'ENJ', 'CHZ',
        'COMP', 'YFI', 'SUSHI', 'CRV', '1INCH', 'BAT',
        'OCEAN', 'ANKR', 'FET', 'GALA', 'GMT',
        'JASMY', 'LDO', 'LUNC', 'ONE', 'ROSE',
        'SKL', 'STX', 'WOO', 'ZEC', 'DASH',
        'BLUR', 'PEPE', 'CFX', 'RNDR', 'WLD', 'BONK',
        'PENDLE', 'JTO', 'STRK'
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

        if (exchanges.length === 0) {
            exchanges.push('Binance');
        }

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
