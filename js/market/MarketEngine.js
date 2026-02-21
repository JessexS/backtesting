// ═══════════════════════════════════════════════════════════════
// MarketEngine — Synthetic OHLCV candle generation with regimes
// ═══════════════════════════════════════════════════════════════

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
  bull:     { drift:  0.0014, vM: 0.75, mr: 0.03, dur: [30, 140], color: '#26de81' },
  bear:     { drift: -0.0018, vM: 1.00, mr: 0.03, dur: [24, 120], color: '#fc5c65' },
  sideways: { drift:  0.0000, vM: 0.60, mr: 0.20, dur: [40, 180], color: '#45aaf2' },
  swing:    { drift:  0.0000, vM: 1.20, mr: 0.08, dur: [24, 95],  color: '#fed330', sc: 22 },
  breakout: { drift:  0.0035, vM: 1.85, mr: 0.00, dur: [8, 24],   color: '#fd9644' },
  crash:    { drift: -0.0075, vM: 2.70, mr: 0.00, dur: [5, 16],   color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

export const TRANSITIONS = {
  bull:     { bull: 0.70, bear: 0.05, sideways: 0.12, swing: 0.09, breakout: 0.03, crash: 0.01 },
  bear:     { bull: 0.07, bear: 0.64, sideways: 0.14, swing: 0.08, breakout: 0.01, crash: 0.06 },
  sideways: { bull: 0.14, bear: 0.12, sideways: 0.49, swing: 0.18, breakout: 0.05, crash: 0.02 },
  swing:    { bull: 0.13, bear: 0.10, sideways: 0.20, swing: 0.41, breakout: 0.10, crash: 0.06 },
  breakout: { bull: 0.30, bear: 0.07, sideways: 0.12, swing: 0.10, breakout: 0.33, crash: 0.08 },
  crash:    { bull: 0.07, bear: 0.39, sideways: 0.20, swing: 0.16, breakout: 0.03, crash: 0.15 },
};

export class Gen {
  constructor(seed, startP, baseV, bias, switchPct) {
    this.rng = mulberry32(seed);
    this.price = startP;
    this.baseV = baseV / 100;
    this.bias = bias / 100;
    this.switchPct = switchPct / 100;
    this.regime = 'sideways';
    this.regimeDur = 0;
    this.maxDur = 50;
    this.anchor = startP;
    this.swingPhase = 0;
    this.history = [];
    this.regimeCounts = {};
    this.lastRet = 0;
    this.sigma = Math.max(0.0006, this.baseV * 0.7);
    REGIME_NAMES.forEach((r) => (this.regimeCounts[r] = 0));
    this._pickDur();
  }

  _pickDur() {
    const d = REGIMES[this.regime].dur;
    this.maxDur = d[0] + Math.floor(this.rng() * (d[1] - d[0]));
  }

  _transition() {
    const t = TRANSITIONS[this.regime];
    const r = this.rng();
    let cum = 0;
    for (const k of REGIME_NAMES) {
      cum += t[k];
      if (r < cum) { this.regime = k; break; }
    }
    this.regimeDur = 0;
    this._pickDur();
    this.anchor = this.price;
    this.swingPhase = this.rng() * Math.PI * 2;
  }

  _gaussian() {
    const u1 = this.rng();
    const u2 = this.rng();
    return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
  }

  _wickNoise(scale) {
    // Most candles have small wicks; rare larger rejection tails.
    const core = scale * (0.06 + 0.45 * this.rng() ** 2);
    const spike = this.rng() < 0.05 ? scale * (0.35 + 0.45 * this.rng()) : 0;
    return core + spike;
  }

  next() {
    this.regimeDur++;
    if (this.regimeDur >= this.maxDur || this.rng() < this.switchPct) this._transition();
    this.regimeCounts[this.regime]++;

    const R = REGIMES[this.regime];
    const targetVol = Math.max(0.00045, this.baseV * R.vM);
    const shock = this._gaussian();

    // Volatility clustering with slow mean reversion towards target vol.
    this.sigma = Math.max(
      0.00025,
      0.90 * this.sigma + 0.07 * Math.abs(this.lastRet) + 0.03 * targetVol,
    );

    const drift = R.drift + this.bias;
    const mr = R.mr > 0 ? R.mr * (this.anchor - this.price) / this.price : 0;
    const swing = R.sc ? Math.sin(this.swingPhase + this.regimeDur * (2 * Math.PI / R.sc)) * this.sigma * 0.18 : 0;
    const momentum = 0.08 * this.lastRet;

    const jumpChance = this.regime === 'breakout' ? 0.10 : this.regime === 'crash' ? 0.14 : 0.01;
    const jumpScale = this.regime === 'crash' ? 1.7 : 1.35;
    const jump = this.rng() < jumpChance ? this._gaussian() * this.sigma * jumpScale : 0;

    const ret = drift + mr + swing + momentum + shock * this.sigma + jump;

    const open = this.price;
    const close = open * Math.max(0.001, 1 + ret);

    const body = Math.abs(close - open) / Math.max(open, 1e-9);
    const rangeUnit = Math.max(this.sigma, body * 0.65);

    let upWick = this._wickNoise(rangeUnit);
    let downWick = this._wickNoise(rangeUnit);

    // Directional asymmetry: smaller wick on trend side, slightly larger on rejection side.
    if (close >= open) {
      upWick *= 0.9;
      downWick *= 1.05;
    } else {
      upWick *= 1.05;
      downWick *= 0.9;
    }

    // Hard cap to prevent unrealistic giant tails on normal candles.
    const wickCap = Math.max(0.0012, 1.75 * this.sigma + 1.15 * body);
    upWick = Math.min(upWick, wickCap);
    downWick = Math.min(downWick, wickCap);

    let high = Math.max(open, close) * (1 + upWick);
    let low = Math.min(open, close) * (1 - downWick);

    // Rare capitulation tail in crash regime (kept bounded).
    if (this.regime === 'crash' && this.rng() < 0.045) {
      const extra = Math.min(wickCap * 0.9, this.sigma * (0.35 + this.rng() * 0.35));
      low *= 1 - extra;
    }

    if (low <= 0) low = open * 0.001;
    if (high < Math.max(open, close)) high = Math.max(open, close);

    const absMove = Math.abs(ret);
    const volume = (2800 + this.rng() * 7800) * R.vM * (1 + absMove * 8 + this.sigma * 5.5);

    this.price = close;
    this.lastRet = ret;

    const candle = {
      time: this.history.length,
      ts: this.history.length * 60_000,
      open,
      high,
      low,
      close,
      volume,
      regime: this.regime,
    };

    this.history.push(candle);
    return candle;
  }
}

export class MarketEngine {
  constructor(params) {
    this.gen = new Gen(
      params.seed,
      params.startPrice,
      params.volatility,
      params.bias,
      params.switchPct
    );
  }

  tick() { return this.gen.next(); }
  getHistory() { return this.gen.history; }
  getRegimeCounts() { return this.gen.regimeCounts; }

  printCandles(limit = 20, precision = 4) {
    const candles = this.getHistory();
    const rows = candles.slice(Math.max(0, candles.length - limit));
    const p = (n) => Number(n).toFixed(precision);
    const lines = rows.map((c) => `${c.time}\tO:${p(c.open)} H:${p(c.high)} L:${p(c.low)} C:${p(c.close)} V:${p(c.volume)} ${c.regime}`);
    return [`# candles (${rows.length}/${candles.length})`, ...lines].join('\n');
  }
}
