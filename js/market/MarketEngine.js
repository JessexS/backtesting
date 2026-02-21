// ═══════════════════════════════════════════════════════════════
// MarketEngine — LOB-based synthetic OHLCV generation
// ═══════════════════════════════════════════════════════════════

import { MarketSimulator } from './MarketSimulator.js';

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// UI color map retained for compatibility.
export const REGIMES = {
  bull:     { drift:  0.0014, vM: 0.75, mr: 0.03, dur: [30, 140], color: '#26de81' },
  bear:     { drift: -0.0018, vM: 1.00, mr: 0.03, dur: [24, 120], color: '#fc5c65' },
  sideways: { drift:  0.0000, vM: 0.60, mr: 0.20, dur: [40, 180], color: '#45aaf2' },
  swing:    { drift:  0.0000, vM: 1.20, mr: 0.08, dur: [24, 95],  color: '#fed330', sc: 22 },
  breakout: { drift:  0.0035, vM: 1.85, mr: 0.00, dur: [8, 24],   color: '#fd9644' },
  crash:    { drift: -0.0075, vM: 2.70, mr: 0.00, dur: [5, 16],   color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

export class MarketEngine {
  constructor(params = {}) {
    this.sim = new MarketSimulator({
      seed: params.seed,
      startPrice: params.startPrice,
      volatility: params.volatility,
      bias: params.bias,
      switchPct: params.switchPct,

      // Exposed microstructure params (optional)
      tickSize: params.tickSize ?? 0.01,
      lambdaBid: params.lambdaBid,
      lambdaAsk: params.lambdaAsk,
      avgSpreadTicks: params.avgSpreadTicks,
      sizeXm: params.sizeXm,
      sizeAlpha: params.sizeAlpha,
      sizeCap: params.sizeCap,
      baseDepth: params.baseDepth,
      bookLevels: params.bookLevels,
      barSeconds: params.barSeconds,
      priceImpact: params.priceImpact,
    });
  }

  tick() { return this.sim.next(); }
  getHistory() { return this.sim.history; }
  getRegimeCounts() { return this.sim.regimeCounts; }

  printCandles(limit = 20, precision = 4) {
    const candles = this.getHistory();
    const rows = candles.slice(Math.max(0, candles.length - limit));
    const p = (n) => Number(n).toFixed(precision);
    const lines = rows.map((c) => `${c.time}\tO:${p(c.open)} H:${p(c.high)} L:${p(c.low)} C:${p(c.close)} V:${p(c.volume)} spr:${p(c.spread)} ${c.regime}`);
    return [`# candles (${rows.length}/${candles.length})`, ...lines].join('\n');
  }
}
