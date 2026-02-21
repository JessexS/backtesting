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
  bull:     { drift:  0.0018, vM: 0.8, mr: 0.02, dur: [30, 140], color: '#26de81' },
  bear:     { drift: -0.0022, vM: 1.1, mr: 0.02, dur: [25, 120], color: '#fc5c65' },
  sideways: { drift:  0,      vM: 0.55, mr: 0.22, dur: [40, 180], color: '#45aaf2' },
  swing:    { drift:  0,      vM: 1.35, mr: 0.10, dur: [30, 100], color: '#fed330', sc: 24 },
  breakout: { drift:  0.0042, vM: 2.2, mr: 0,    dur: [8, 30],   color: '#fd9644' },
  crash:    { drift: -0.0100, vM: 3.4, mr: 0,    dur: [5, 18],   color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

export const TRANSITIONS = {
  bull:     { bull: 0.68, bear: 0.05, sideways: 0.12, swing: 0.10, breakout: 0.04, crash: 0.01 },
  bear:     { bull: 0.08, bear: 0.62, sideways: 0.14, swing: 0.08, breakout: 0.01, crash: 0.07 },
  sideways: { bull: 0.14, bear: 0.12, sideways: 0.48, swing: 0.18, breakout: 0.06, crash: 0.02 },
  swing:    { bull: 0.12, bear: 0.11, sideways: 0.18, swing: 0.42, breakout: 0.11, crash: 0.06 },
  breakout: { bull: 0.28, bear: 0.07, sideways: 0.12, swing: 0.10, breakout: 0.33, crash: 0.10 },
  crash:    { bull: 0.05, bear: 0.37, sideways: 0.20, swing: 0.15, breakout: 0.03, crash: 0.20 },
};

export const TIMEFRAME_MINUTES = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1M': 43200,
};

export const TIMEFRAMES = Object.keys(TIMEFRAME_MINUTES);

function toTf(input = '1m') {
  const normalized = `${input}`.trim();
  if (normalized.toLowerCase() === '1mo') return '1M';
  if (normalized.toLowerCase() === '1m' && normalized !== '1M') return '1m';
  return TIMEFRAME_MINUTES[normalized] ? normalized : '1m';
}

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
    this.sigma = Math.max(0.0008, this.baseV * 0.8);
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

  next() {
    this.regimeDur++;
    if (this.regimeDur >= this.maxDur || this.rng() < this.switchPct) this._transition();
    this.regimeCounts[this.regime]++;

    const R = REGIMES[this.regime];
    const targetVol = Math.max(0.0005, this.baseV * R.vM);
    const shock = this._gaussian();

    // Light GARCH-like volatility clustering for more realistic runs of calm/violent candles.
    this.sigma = Math.max(
      0.0003,
      0.86 * this.sigma + 0.10 * Math.abs(this.lastRet) + 0.04 * targetVol,
    );

    const drift = R.drift + this.bias;
    const meanReversion = R.mr > 0 ? R.mr * (this.anchor - this.price) / this.price : 0;
    const swing = R.sc ? Math.sin(this.swingPhase + this.regimeDur * (2 * Math.PI / R.sc)) * this.sigma * 0.3 : 0;
    const momentum = 0.12 * this.lastRet;

    const jumpChance = this.regime === 'breakout' ? 0.18 : this.regime === 'crash' ? 0.24 : 0.02;
    const jump = this.rng() < jumpChance ? this._gaussian() * this.sigma * (1.5 + this.rng() * 1.8) : 0;

    const ret = drift + meanReversion + swing + momentum + shock * this.sigma + jump;

    const open = this.price;
    const close = open * Math.max(0.001, 1 + ret);

    const body = Math.abs(close - open) / Math.max(open, 1e-9);
    const wickScale = this.sigma * (0.45 + this.rng() * 0.95);
    const upWick = wickScale * (0.6 + this.rng() * 1.1) + body * (close < open ? 0.5 : 0.2);
    const downWick = wickScale * (0.6 + this.rng() * 1.1) + body * (close >= open ? 0.5 : 0.2);

    let high = Math.max(open, close) * (1 + upWick);
    let low = Math.min(open, close) * (1 - downWick);

    if (this.regime === 'crash' && this.rng() < 0.1) {
      low *= 1 - this.sigma * (1 + this.rng());
    }

    if (low <= 0) low = open * 0.001;
    if (high < Math.max(open, close)) high = Math.max(open, close);

    const absMove = Math.abs(ret);
    const volume = (2000 + this.rng() * 8000) * R.vM * (1 + absMove * 12 + this.sigma * 8);

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
    this.timeframes = {};
    this.currentBuckets = {};
    TIMEFRAMES.forEach((tf) => {
      this.timeframes[tf] = [];
      this.currentBuckets[tf] = null;
    });
    // Keep 1m history as the generator's canonical source for backwards compatibility.
    this.timeframes['1m'] = this.gen.history;
  }

  _updateTimeframes(baseCandle) {
    for (const tf of TIMEFRAMES) {
      if (tf === '1m') continue;
      const tfSize = TIMEFRAME_MINUTES[tf];
      const tfIndex = Math.floor(baseCandle.time / tfSize);
      let bucket = this.currentBuckets[tf];

      if (!bucket || bucket.time !== tfIndex) {
        bucket = {
          time: tfIndex,
          ts: tfIndex * tfSize * 60_000,
          open: baseCandle.open,
          high: baseCandle.high,
          low: baseCandle.low,
          close: baseCandle.close,
          volume: baseCandle.volume,
          regime: baseCandle.regime,
        };
        this.currentBuckets[tf] = bucket;
        this.timeframes[tf].push(bucket);
      } else {
        bucket.high = Math.max(bucket.high, baseCandle.high);
        bucket.low = Math.min(bucket.low, baseCandle.low);
        bucket.close = baseCandle.close;
        bucket.volume += baseCandle.volume;
        bucket.regime = baseCandle.regime;
      }
    }
  }

  tick(timeframe = '1m') {
    const c = this.gen.next();
    this._updateTimeframes(c);
    const tf = toTf(timeframe);
    if (tf === '1m') return c;
    const tfData = this.timeframes[tf];
    return tfData[tfData.length - 1] || c;
  }

  getHistory(timeframe = '1m') {
    const tf = toTf(timeframe);
    return this.timeframes[tf];
  }

  printCandles(timeframe = '1m', limit = 20, precision = 4) {
    const tf = toTf(timeframe);
    const candles = this.getHistory(tf);
    const rows = candles.slice(Math.max(0, candles.length - limit));
    const p = (n) => Number(n).toFixed(precision);
    const lines = rows.map((c) => `${c.time}\tO:${p(c.open)} H:${p(c.high)} L:${p(c.low)} C:${p(c.close)} V:${p(c.volume)} ${c.regime}`);
    return [`# ${tf} candles (${rows.length}/${candles.length})`, ...lines].join('\n');
  }

  getRegimeCounts() { return this.gen.regimeCounts; }

  printCandles(limit = 20, precision = 4) {
    const candles = this.getHistory();
    const rows = candles.slice(Math.max(0, candles.length - limit));
    const p = (n) => Number(n).toFixed(precision);
    const lines = rows.map((c) => `${c.time}\tO:${p(c.open)} H:${p(c.high)} L:${p(c.low)} C:${p(c.close)} V:${p(c.volume)} ${c.regime}`);
    return [`# candles (${rows.length}/${candles.length})`, ...lines].join('\n');
  }
}
