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
  bull:     { drift:  0.003, vM: 0.8, mr: 0,    dur: [20, 80],  color: '#26de81' },
  bear:     { drift: -0.003, vM: 1.0, mr: 0,    dur: [15, 60],  color: '#fc5c65' },
  sideways: { drift:  0,     vM: 0.5, mr: 0.15, dur: [30, 100], color: '#45aaf2' },
  swing:    { drift:  0,     vM: 1.3, mr: 0.08, dur: [20, 60],  color: '#fed330', sc: 20 },
  breakout: { drift:  0.006, vM: 2.5, mr: 0,    dur: [10, 30],  color: '#fd9644' },
  crash:    { drift: -0.015, vM: 4.0, mr: 0,    dur: [5, 20],   color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

export const TRANSITIONS = {
  bull:     { bull: 0.65, bear: 0.05, sideways: 0.12, swing: 0.10, breakout: 0.06, crash: 0.02 },
  bear:     { bull: 0.05, bear: 0.60, sideways: 0.15, swing: 0.10, breakout: 0.02, crash: 0.08 },
  sideways: { bull: 0.15, bear: 0.12, sideways: 0.45, swing: 0.18, breakout: 0.07, crash: 0.03 },
  swing:    { bull: 0.12, bear: 0.10, sideways: 0.20, swing: 0.40, breakout: 0.10, crash: 0.08 },
  breakout: { bull: 0.25, bear: 0.05, sideways: 0.10, swing: 0.10, breakout: 0.40, crash: 0.10 },
  crash:    { bull: 0.05, bear: 0.30, sideways: 0.20, swing: 0.15, breakout: 0.05, crash: 0.25 },
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

  next() {
    this.regimeDur++;
    if (this.regimeDur >= this.maxDur || this.rng() < this.switchPct) this._transition();
    this.regimeCounts[this.regime]++;

    const R = REGIMES[this.regime];
    const vol = this.baseV * R.vM;
    const drift = R.drift + this.bias;
    const mr = R.mr > 0 ? R.mr * (this.anchor - this.price) / this.price : 0;
    const swing = R.sc ? Math.sin(this.swingPhase + this.regimeDur * (2 * Math.PI / R.sc)) * vol * 0.4 : 0;
    const u1 = this.rng(), u2 = this.rng();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    const ret = drift + mr + swing + vol * z;

    const open = this.price;
    const close = open * (1 + ret);
    const wHi = Math.abs(vol * (0.3 + this.rng() * 0.7));
    const wLo = Math.abs(vol * (0.3 + this.rng() * 0.7));
    let high, low;
    if (close >= open) {
      high = Math.max(open, close) * (1 + wHi);
      low = Math.min(open, close) * (1 - wLo * 0.5);
    } else {
      high = Math.max(open, close) * (1 + wHi * 0.5);
      low = Math.min(open, close) * (1 - wLo);
    }
    if (low <= 0) low = open * 0.001;
    const volume = (5000 + this.rng() * 15000) * R.vM;
    this.price = close;
    const candle = { time: this.history.length, open, high, low, close, volume, regime: this.regime };
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
}
