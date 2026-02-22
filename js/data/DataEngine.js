// ═══════════════════════════════════════════════════════════════
import { DEFAULT_TIMEFRAME } from '../../src/config.js';
// DataEngine — Real market data fetching (crypto & stocks)
// Supports: CoinGecko (crypto), Yahoo Finance proxy (stocks)
// Also: data scrambling with preserved start/end prices
// ═══════════════════════════════════════════════════════════════

export class DataEngine {
  constructor() {
    this.cache = new Map();
  }

  // Fetch crypto OHLCV data from CoinGecko (free, no API key needed)
  async fetchCryptoOHLCV(coinId = 'bitcoin', vsCurrency = 'usd', days = 90) {
    const cacheKey = `${coinId}_${vsCurrency}_${days}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=${vsCurrency}&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);

    const data = await res.json();
    // CoinGecko OHLC format: [timestamp, open, high, low, close]
    const candles = data.map((d, i) => ({
      time: i,
      timestamp: d[0],
      open: d[1],
      high: d[2],
      low: d[3],
      close: d[4],
      volume: 0, // CoinGecko OHLC doesn't include volume
      regime: 'real',
    }));

    this.cache.set(cacheKey, candles);
    return candles;
  }

  // Fetch crypto data from Binance public API
  async fetchBinanceOHLCV(symbol = 'BTCUSDT', interval = DEFAULT_TIMEFRAME, limit = 500) {
    const cacheKey = `binance_${symbol}_${interval}_${limit}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error: ${res.status}`);

    const data = await res.json();
    const candles = data.map((d, i) => ({
      time: i,
      timestamp: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      regime: 'real',
    }));

    this.cache.set(cacheKey, candles);
    return candles;
  }

  // Get list of popular crypto coins
  getPopularCryptos() {
    return [
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', binance: 'BTCUSDT' },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', binance: 'ETHUSDT' },
      { id: 'solana', symbol: 'SOL', name: 'Solana', binance: 'SOLUSDT' },
      { id: 'binancecoin', symbol: 'BNB', name: 'BNB', binance: 'BNBUSDT' },
      { id: 'ripple', symbol: 'XRP', name: 'XRP', binance: 'XRPUSDT' },
      { id: 'cardano', symbol: 'ADA', name: 'Cardano', binance: 'ADAUSDT' },
      { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', binance: 'DOGEUSDT' },
      { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', binance: 'DOTUSDT' },
      { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', binance: 'AVAXUSDT' },
      { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', binance: 'LINKUSDT' },
    ];
  }

  getBinanceIntervals() {
    return ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
  }

  // Scramble real data: randomize price movements but preserve start & end prices
  scrambleData(candles, seed = 42) {
    if (candles.length < 3) return candles;

    const startPrice = candles[0].open;
    const endPrice = candles[candles.length - 1].close;

    // Calculate log returns
    const logReturns = [];
    for (let i = 1; i < candles.length; i++) {
      logReturns.push(Math.log(candles[i].close / candles[i - 1].close));
    }

    // Fisher-Yates shuffle with seeded RNG
    let rngState = seed;
    const rng = () => {
      rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
      return (rngState >>> 0) / 4294967296;
    };

    // Shuffle returns
    const shuffled = [...logReturns];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Reconstruct price path
    const rawPrices = [startPrice];
    for (let i = 0; i < shuffled.length; i++) {
      rawPrices.push(rawPrices[i] * Math.exp(shuffled[i]));
    }

    // Adjust to hit target end price
    const rawEnd = rawPrices[rawPrices.length - 1];
    const adjustmentPerBar = Math.log(endPrice / rawEnd) / rawPrices.length;

    const adjustedPrices = rawPrices.map((p, i) =>
      p * Math.exp(adjustmentPerBar * i)
    );

    // Build scrambled candles
    return candles.map((c, i) => {
      const baseClose = adjustedPrices[i];
      const prevClose = i > 0 ? adjustedPrices[i - 1] : baseClose;

      // Preserve intra-bar volatility ratios
      const origRange = c.high - c.low;
      const origBodyRatio = Math.abs(c.close - c.open) / (origRange || 1);
      const newBody = Math.abs(baseClose - prevClose);
      const newRange = Math.max(newBody, origRange * (baseClose / c.close));

      const bullish = rng() > 0.5;
      const open = bullish ? baseClose - newBody * 0.5 : baseClose + newBody * 0.5;
      const close = baseClose;
      const high = Math.max(open, close) + newRange * 0.3 * rng();
      const low = Math.min(open, close) - newRange * 0.3 * rng();

      return {
        time: i,
        timestamp: c.timestamp,
        open: Math.max(0.001, open),
        high: Math.max(Math.max(open, close), high),
        low: Math.max(0.001, Math.min(Math.min(open, close), low)),
        close: Math.max(0.001, close),
        volume: c.volume * (0.5 + rng()),
        regime: 'scrambled',
      };
    });
  }

  clearCache() { this.cache.clear(); }
}
