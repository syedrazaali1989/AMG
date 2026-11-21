// Blockchain.info API Integration
// Real Bitcoin transaction data (FREE, no API key needed)

export interface BlockchainTransaction {
    hash: string;
    time: number;
    size: number;
    inputs: Array<{
        prev_out: {
            addr?: string;
            value: number;
        };
    }>;
    out: Array<{
        addr?: string;
        value: number;
    }>;
}

export interface LargeTransaction {
    hash: string;
    timestamp: number;
    valueBTC: number;
    valueUSD: number;
    from: string[];
    to: string[];
    type: 'exchange_inflow' | 'exchange_outflow' | 'unknown';
    /** Height of the confirmed block the transaction was found in. */
    blockHeight?: number;
}

export class BlockchainInfoAPI {
    private static readonly BASE_URL = 'https://blockchain.info';
    private static readonly BTC_PRICE_URL = 'https://blockchain.info/ticker';

    // Known exchange addresses (Bitcoin hot wallets)
    private static readonly EXCHANGE_ADDRESSES = new Set([
        // Binance
        '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo',
        'bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h',
        // Coinbase
        '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6',
        'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97',
        // Kraken
        'bc1qgdjqv0av3q56jvd82tkdjpy7gdp9ut8tlqmgrpmv24sq90ecnvqqjwvw97',
        // Bitfinex  
        '3D2oetdNuZUqQHPJmcMDDHYoqkyNVsFk9r',
        // Add more known exchange addresses
    ]);

    /**
     * Get current BTC price in USD.
     *
     * Throws if the price cannot be fetched: a made-up fallback price
     * would silently corrupt every USD value derived from it, so callers
     * must surface a "live data unavailable" state instead.
     */
    static async getBTCPrice(): Promise<number> {
        const response = await fetch(this.BTC_PRICE_URL);
        if (!response.ok) {
            throw new Error(`Blockchain.info ticker failed: HTTP ${response.status}`);
        }
        const data = await response.json();
        const price = data?.USD?.last;
        if (typeof price !== 'number' || !(price > 0)) {
            throw new Error('Blockchain.info ticker returned no USD price');
        }
        return price;
    }

    /**
     * Get recent large Bitcoin transactions from the most recent
     * CONFIRMED blocks on Blockchain.info.
     *
     * Why blocks and not the /unconfirmed-transactions feed: that feed
     * returns only the ~100 newest mempool transactions (a few seconds
     * of traffic), which at typical prices contains zero transfers at or
     * above $500K - it cannot support this analysis. A confirmed block
     * is the complete population of ~2,000+ transactions for its ~10
     * minutes and reliably contains dozens of large transfers. The
     * latest block is scanned first; if it yields fewer than 10 large
     * transfers the previous block is scanned too.
     *
     * Returns an empty array when the source is reachable but the
     * scanned blocks genuinely contain no transfers at or above the
     * threshold. THROWS when the source cannot be reached - there is
     * deliberately no fallback data: invented "large transactions" must
     * never be shown or scored as if real.
     */
    static async getLargeTransactions(minValueUSD: number = 500000): Promise<LargeTransaction[]> {
        // Get current BTC price
        const btcPrice = await this.getBTCPrice();

        // Locate the latest confirmed block
        const latestResponse = await fetch(`${this.BASE_URL}/latestblock?format=json`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!latestResponse.ok) {
            throw new Error(`Blockchain.info latestblock failed: HTTP ${latestResponse.status}`);
        }
        const latest = await latestResponse.json();

        const largeTransactions: LargeTransaction[] = [];
        const seen = new Set<string>();
        let blockHash: string | undefined = latest.hash;
        let blocksScanned = 0;

        while (blockHash && blocksScanned < 2 && (blocksScanned === 0 || largeTransactions.length < 10)) {
            const blockResponse = await fetch(`${this.BASE_URL}/rawblock/${blockHash}?format=json`, {
                headers: { 'Accept': 'application/json' }
            });
            if (!blockResponse.ok) {
                throw new Error(`Blockchain.info rawblock failed: HTTP ${blockResponse.status}`);
            }
            const block = await blockResponse.json();
            blocksScanned++;

            for (const tx of (block.tx || []) as BlockchainTransaction[]) {
                if (seen.has(tx.hash)) continue;

                // Calculate total value
                const totalValue = tx.out.reduce((sum, output) => sum + output.value, 0);
                const valueBTC = totalValue / 100000000; // Satoshi to BTC
                const valueUSD = valueBTC * btcPrice;

                // Only include if above threshold
                if (valueUSD < minValueUSD) continue;
                seen.add(tx.hash);

                // Extract addresses
                const fromAddresses = tx.inputs
                    .map(input => input.prev_out?.addr)
                    .filter((addr): addr is string => !!addr);

                const toAddresses = tx.out
                    .map(output => output.addr)
                    .filter((addr): addr is string => !!addr);

                // Detect exchange involvement
                const hasExchangeInput = fromAddresses.some(addr => this.isExchangeAddress(addr));
                const hasExchangeOutput = toAddresses.some(addr => this.isExchangeAddress(addr));

                let type: 'exchange_inflow' | 'exchange_outflow' | 'unknown' = 'unknown';
                if (hasExchangeOutput && !hasExchangeInput) {
                    type = 'exchange_inflow'; // BEARISH (depositing to sell)
                } else if (hasExchangeInput && !hasExchangeOutput) {
                    type = 'exchange_outflow'; // BULLISH (withdrawing to hold)
                }

                largeTransactions.push({
                    hash: tx.hash,
                    timestamp: tx.time,
                    valueBTC,
                    valueUSD,
                    from: fromAddresses.slice(0, 3), // First 3 for display
                    to: toAddresses.slice(0, 3),
                    type,
                    blockHeight: block.height
                });
            }

            blockHash = block.prev_block;
        }

        // Largest first, capped for scoring/display
        largeTransactions.sort((a, b) => b.valueUSD - a.valueUSD);

        console.log(`🔗 Found ${largeTransactions.length} real BTC transactions over $${minValueUSD.toLocaleString()} in ${blocksScanned} confirmed block(s)`);

        return largeTransactions.slice(0, 50);
    }

    /**
     * Check if address is a known exchange
     */
    private static isExchangeAddress(address: string): boolean {
        return this.EXCHANGE_ADDRESSES.has(address);
    }

    /**
     * Analyze transaction sentiment
     */
    static analyzeSentiment(transaction: LargeTransaction): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        if (transaction.type === 'exchange_inflow') {
            return 'BEARISH'; // Depositing to exchange = likely selling
        } else if (transaction.type === 'exchange_outflow') {
            return 'BULLISH'; // Withdrawing from exchange = holding
        }
        return 'NEUTRAL';
    }

    /**
     * Calculate exchange flow for Bitcoin
     */
    static calculateExchangeFlow(transactions: LargeTransaction[]): {
        inflow: number;
        outflow: number;
        net: number;
        sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    } {
        let inflow = 0;
        let outflow = 0;

        transactions.forEach(tx => {
            if (tx.type === 'exchange_inflow') {
                inflow += tx.valueUSD;
            } else if (tx.type === 'exchange_outflow') {
                outflow += tx.valueUSD;
            }
        });

        const net = outflow - inflow;
        const sentiment = net > 0 ? 'BULLISH' : net < 0 ? 'BEARISH' : 'NEUTRAL';

        return { inflow, outflow, net, sentiment };
    }
}
