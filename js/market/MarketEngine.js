// ═══════════════════════════════════════════════════════════════
// MarketEngine — Tick-sim + candle aggregation wrapper
// ═══════════════════════════════════════════════════════════════

import { TickMarketSimulator } from '../core/TickMarketSimulator.js';
import { CandleAggregator } from '../core/CandleAggregator.js';

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REGIMES = {
  bull:     { color: '#26de81' },
  bear:     { color: '#fc5c65' },
  sideways: { color: '#45aaf2' },
  swing:    { color: '#fed330' },
  breakout: { color: '#fd9644' },
  crash:    { color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

function classifyRegime(candle) {
  const ret = (candle.close - candle.open) / Math.max(candle.open, 1e-9);
  const imb = candle.imbalance ?? 0;
  if (ret < -0.01 || imb < -0.35) return 'crash';
  if (ret > 0.008 || imb > 0.35) return 'breakout';
  if (Math.abs(imb) < 0.06 && (candle.spread / Math.max(candle.mid, 1e-9)) < 0.0015) return 'sideways';
  if (imb > 0.12) return 'bull';
  if (imb < -0.12) return 'bear';
  return 'swing';
}

export class MarketEngine {
  constructor(params = {}) {
    this.sim = new TickMarketSimulator({
      seed: params.seed,
      startPrice: params.startPrice,
      volatility: params.volatility,
      bias: params.bias,
      switchPct: params.switchPct,
      tickSize: params.tickSize,
      lambdaBid: params.lambdaBid,
      lambdaAsk: params.lambdaAsk,
      lambdaLiquidity: params.lambdaLiquidity,
      sizeXm: params.sizeXm,
      sizeAlpha: params.sizeAlpha,
      sizeCap: params.sizeCap,
      baseDepth: params.baseDepth,
      bookLevels: params.bookLevels,
      priceImpact: params.priceImpact,
    });
    this.aggregator = new CandleAggregator((params.barSeconds ?? 60) * 1000);
    this.regimeCounts = Object.fromEntries(REGIME_NAMES.map((r) => [r, 0]));
  }

  tick() {
    const prevCount = this.aggregator.getCandles().length;
    let candle = null;
    while (!candle || this.aggregator.getCandles().length === prevCount) {
      const tick = this.sim.nextTick();
      candle = this.aggregator.pushTick(tick);
      candle.imbalance = tick.side === 'buy' ? 0.2 : -0.2;
    }

    candle.regime = classifyRegime(candle);
    this.regimeCounts[candle.regime]++;
    return candle;
  }

  getHistory() { return this.aggregator.getCandles(); }
  getRegimeCounts() { return this.regimeCounts; }

  printCandles(limit = 20, precision = 4) {
    const candles = this.getHistory();
    const rows = candles.slice(Math.max(0, candles.length - limit));
    const p = (n) => Number(n).toFixed(precision);
    const lines = rows.map((c) => `${c.time}\tO:${p(c.open)} H:${p(c.high)} L:${p(c.low)} C:${p(c.close)} V:${p(c.volume)} spr:${p(c.spread)} ${c.regime}`);
    return [`# candles (${rows.length}/${candles.length})`, ...lines].join('\n');
  }
}
