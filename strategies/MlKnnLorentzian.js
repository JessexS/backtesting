// ═══════════════════════════════════════════════════════════════
// ML-KNN Lorentzian Classification Strategy
// k-Nearest Neighbors with Lorentzian distance metric
// Features: RSI, WaveTrend, CCI, ADX, RSI-short
// Rational Quadratic Kernel Regression filter
// ═══════════════════════════════════════════════════════════════

let S = {};

// Default parameters (can be overridden via params UI)
const DEFAULTS = {
  k: 8, maxBars: 2000, features: 5,
  volFilter: true, regFilter: true, regThresh: -0.1,
  adxFilter: false, adxThresh: 20,
  emaFilter: true, emaPeriod: 200, smaFilter: false, smaPeriod: 200,
  kernelFilter: true, kernelSmooth: false,
  kernH: 8, kernR: 8, kernLevel: 25, kernLag: 2,
  defExits: true, dynExits: false, holdBars: 4,
  f1a: 14, f2a: 10, f3a: 20, f4a: 20, f5a: 9,
};

function lorentzian(x, y) { return Math.log(1 + Math.abs(x - y)); }

function calcRSI(cs, n, period) {
  let gain = 0, loss = 0;
  const start = Math.max(1, n - period);
  for (let i = start; i < n; i++) {
    const d = cs[i].close - cs[i - 1].close;
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function calcCCI(cs, n, period) {
  let sum = 0;
  const start = Math.max(0, n - period);
  const vals = [];
  for (let i = start; i < n; i++) {
    const tp = (cs[i].high + cs[i].low + cs[i].close) / 3;
    vals.push(tp); sum += tp;
  }
  const mean = sum / vals.length;
  let mad = 0;
  for (const v of vals) mad += Math.abs(v - mean);
  mad /= vals.length;
  const tp = (cs[n - 1].high + cs[n - 1].low + cs[n - 1].close) / 3;
  return mad > 0 ? (tp - mean) / (0.015 * mad) : 0;
}

function calcWaveTrend(cs, n, period) {
  const k = 2 / (period + 1);
  const start = Math.max(0, n - period * 3);
  let emaHlc = (cs[start].high + cs[start].low + cs[start].close) / 3;
  for (let i = start + 1; i < n; i++) {
    const hlc = (cs[i].high + cs[i].low + cs[i].close) / 3;
    emaHlc = hlc * k + emaHlc * (1 - k);
  }
  let emaDiff = 0;
  for (let i = start; i < n; i++) {
    const hlc = (cs[i].high + cs[i].low + cs[i].close) / 3;
    emaDiff = (hlc - emaHlc) * k + emaDiff * (1 - k);
  }
  return emaDiff;
}

function calcADX(cs, n, period) {
  if (n < period + 1) return 25;
  let trSum = 0, pDmSum = 0, mDmSum = 0;
  for (let i = n - period; i < n; i++) {
    const hi = cs[i].high, lo = cs[i].low, pc = cs[i - 1].close;
    const tr = Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
    let pDm = hi - cs[i - 1].high, mDm = cs[i - 1].low - lo;
    if (pDm < 0) pDm = 0; if (mDm < 0) mDm = 0;
    if (pDm > mDm) mDm = 0; else pDm = 0;
    trSum += tr; pDmSum += pDm; mDmSum += mDm;
  }
  if (trSum === 0) return 0;
  const pDi = pDmSum / trSum * 100;
  const mDi = mDmSum / trSum * 100;
  const diSum = pDi + mDi;
  return diSum > 0 ? Math.abs(pDi - mDi) / diSum * 100 : 0;
}

function calcEMA(cs, n, period) {
  const k = 2 / (period + 1);
  const start = Math.max(0, n - period * 4);
  let val = cs[start].close;
  for (let i = start + 1; i < n; i++) val = cs[i].close * k + val * (1 - k);
  return val;
}

function calcSMA(cs, n, period) {
  const start = Math.max(0, n - period);
  let sum = 0;
  for (let i = start; i < n; i++) sum += cs[i].close;
  return sum / (n - start);
}

function kernelRegression(cs, n, h, r, level) {
  let sum = 0, wSum = 0;
  const start = Math.max(0, n - level);
  for (let i = start; i < n; i++) {
    const dist = n - 1 - i;
    const w = Math.pow(1 + (dist * dist) / (2 * r * h * h), -r);
    sum += cs[i].close * w; wSum += w;
  }
  return wSum > 0 ? sum / wSum : cs[n - 1].close;
}

export default {
  name: "ML-KNN Lorentzian Classification",

  params: {
    'General': {
      k: { label: 'Neighbors (k)', default: 8, min: 1, max: 100 },
      maxBars: { label: 'Max Bars Back', default: 2000, min: 100, max: 5000 },
      features: { label: 'Feature Count', default: 5, min: 2, max: 5 },
    },
    'Filters': {
      volFilter: { label: 'Volatility Filter', type: 'select', default: '1', options: { '1': 'On', '0': 'Off' } },
      regFilter: { label: 'Regime Filter', type: 'select', default: '1', options: { '1': 'On', '0': 'Off' } },
      regThresh: { label: 'Regime Threshold', default: -0.1, min: -10, max: 10, step: 0.1 },
      adxFilter: { label: 'ADX Filter', type: 'select', default: '0', options: { '0': 'Off', '1': 'On' } },
      adxThresh: { label: 'ADX Threshold', default: 20, min: 0, max: 100 },
    },
    'Trend': {
      emaFilter: { label: 'EMA Filter', type: 'select', default: '1', options: { '1': 'On', '0': 'Off' } },
      emaPeriod: { label: 'EMA Period', default: 200, min: 10, max: 500 },
      smaFilter: { label: 'SMA Filter', type: 'select', default: '0', options: { '0': 'Off', '1': 'On' } },
      smaPeriod: { label: 'SMA Period', default: 200, min: 10, max: 500 },
    },
    'Kernel': {
      kernelFilter: { label: 'Kernel Filter', type: 'select', default: '1', options: { '1': 'On', '0': 'Off' } },
      kernH: { label: 'Lookback (h)', default: 8, min: 3, max: 50 },
      kernR: { label: 'Rel. Weight (r)', default: 8, min: 0.25, max: 25, step: 0.25 },
      kernLevel: { label: 'Regression Level', default: 25, min: 2, max: 25 },
    },
    'Exits': {
      defExits: { label: 'Default Exits', type: 'select', default: '1', options: { '1': 'On', '0': 'Off' } },
      dynExits: { label: 'Dynamic Exits', type: 'select', default: '0', options: { '0': 'Off', '1': 'On' } },
      holdBars: { label: 'Hold Bars', default: 4, min: 1, max: 20 },
    },
    'Features': {
      f1a: { label: 'F1 RSI Period', default: 14, min: 2, max: 50 },
      f2a: { label: 'F2 WT Period', default: 10, min: 2, max: 50 },
      f3a: { label: 'F3 CCI Period', default: 20, min: 2, max: 50 },
      f4a: { label: 'F4 ADX Period', default: 20, min: 2, max: 50 },
      f5a: { label: 'F5 RSI Short', default: 9, min: 2, max: 50 },
    },
  },

  // Helper to read params from UI or use defaults
  _getParams() {
    const p = { ...DEFAULTS };
    for (const section of Object.values(this.params)) {
      for (const [key, def] of Object.entries(section)) {
        const el = document.getElementById('sp_' + key);
        if (el) {
          if (def.type === 'select') p[key] = el.value === '1';
          else p[key] = +el.value;
        }
      }
    }
    return p;
  },

  init(ctx) {
    const p = this._getParams();
    S = {
      peakEq: ctx.equity,
      history: [],
      lastSignal: 0,
      lastEntryBar: -999,
      barCount: 0,
      prevKernel: null,
      prevPrevKernel: null,
      signalDir: 0,
      holdCount: 0,
      P: p,
    };
  },

  onCandle(ctx) {
    const M = ctx.utils.Math;
    const cs = ctx.candles;
    const c = ctx.candle;
    const n = cs.length;
    const eq = ctx.equity;
    const pos = ctx.positions;
    const orders = [];
    const P = S.P;

    S.barCount++;

    const minBars = Math.max(P.emaPeriod, P.smaPeriod, P.f4a + 2, 55);
    if (n < minBars) return orders;

    // ─── Features ───
    const f1 = calcRSI(cs, n, P.f1a);
    const f2 = calcWaveTrend(cs, n, P.f2a);
    const f3 = calcCCI(cs, n, P.f3a);
    const f4 = calcADX(cs, n, P.f4a);
    const f5 = calcRSI(cs, n, P.f5a);
    const features = [f1, f2, f3, f4, f5].slice(0, P.features);

    // Label past bar
    if (S.history.length > 0) {
      const last = S.history[S.history.length - 1];
      if (last.label === 0) last.label = c.close > last.price ? 1 : -1;
    }
    S.history.push({ features, label: 0, price: c.close });
    if (S.history.length > P.maxBars) S.history.shift();

    const labeled = S.history.filter((h) => h.label !== 0);
    if (labeled.length < P.k + 10) return orders;

    // ─── k-NN ───
    const distances = labeled.map((h) => {
      let dist = 0;
      for (let j = 0; j < features.length; j++) dist += lorentzian(features[j], h.features[j]);
      return { dist, label: h.label };
    });
    distances.sort((a, b) => a.dist - b.dist);

    let vote = 0;
    for (let i = 0; i < P.k; i++) vote += distances[i].label;
    let signal = vote > 0 ? 1 : vote < 0 ? -1 : 0;

    // ─── Filters ───
    const ema200 = calcEMA(cs, n, P.emaPeriod);
    const sma200 = calcSMA(cs, n, P.smaPeriod);
    const adx = calcADX(cs, n, 14);
    const price = c.close;

    // Chart overlay
    if (!ctx.indicators._ema200) ctx.indicators._ema200 = [];
    ctx.indicators._ema200[n - 1] = ema200;
    ctx.indicators['EMA ' + P.emaPeriod] = { values: ctx.indicators._ema200, color: '#fd9644' };

    if (P.emaFilter) {
      if (signal === 1 && price < ema200) signal = 0;
      if (signal === -1 && price > ema200) signal = 0;
    }
    if (P.smaFilter) {
      if (signal === 1 && price < sma200) signal = 0;
      if (signal === -1 && price > sma200) signal = 0;
    }
    if (P.adxFilter && adx < P.adxThresh) signal = 0;

    if (P.volFilter) {
      const lookback = Math.min(20, n - 1);
      const rets = [];
      for (let i = n - lookback; i < n; i++) rets.push((cs[i].close - cs[i - 1].close) / cs[i - 1].close);
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const vol = M.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length);
      if (vol > 0.06) signal = 0;
    }

    if (P.regFilter) {
      const ema8 = calcEMA(cs, n, 8);
      const ema21 = calcEMA(cs, n, 21);
      const regVal = (ema8 - ema21) / price * 100;
      if (regVal < P.regThresh && signal === 1) signal = 0;
      if (regVal > -P.regThresh && signal === -1) signal = 0;
    }

    // Kernel
    if (P.kernelFilter) {
      const kernVal = kernelRegression(cs, n, P.kernH, P.kernR, P.kernLevel);
      const prevKernVal = S.prevPrevKernel;
      S.prevPrevKernel = S.prevKernel;
      S.prevKernel = kernVal;
      if (prevKernVal !== null) {
        const kernelBullish = kernVal > prevKernVal;
        if (signal === 1 && !kernelBullish) signal = 0;
        if (signal === -1 && kernelBullish) signal = 0;
      }
      if (!ctx.indicators._kernel) ctx.indicators._kernel = [];
      ctx.indicators._kernel[n - 1] = kernVal;
      ctx.indicators['Kernel'] = { values: ctx.indicators._kernel, color: '#a55eea' };
    }

    // Hold bars
    if (signal !== 0 && signal !== S.signalDir) { S.signalDir = signal; S.holdCount = 0; }
    S.holdCount++;

    // ─── Risk ───
    let atrSum = 0;
    for (let i = n - 14; i < n; i++) {
      const hi = cs[i].high, lo = cs[i].low, pc = cs[i - 1].close;
      let tr = hi - lo;
      if (M.abs(hi - pc) > tr) tr = M.abs(hi - pc);
      if (M.abs(lo - pc) > tr) tr = M.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / 14;
    const atrPct = atr / price;

    if (eq > S.peakEq) S.peakEq = eq;
    const dd = (S.peakEq - eq) / S.peakEq;
    const ddT = dd > 0.20 ? 0.25 : dd > 0.15 ? 0.5 : dd > 0.10 ? 0.75 : 1.0;

    if (dd > 0.22 && pos.length > 0) {
      for (const p of pos) orders.push({ close: true, side: p.direction === 'long' ? 'sell' : 'buy' });
      return orders;
    }

    const riskAmt = eq * 0.012 * ddT;
    const stopDist = atr * 2.0;
    let rawSize = riskAmt / stopDist;
    const maxSize = eq * 0.4 / price;
    if (rawSize > maxSize) rawSize = maxSize;
    if (rawSize <= 0 || rawSize !== rawSize) return orders;

    const slPct = stopDist / price * 100;
    const tpPct = slPct * 2.5;
    const trailPct = slPct * 0.8;

    const hasLong = pos.some((p) => p.direction === 'long');
    const hasShort = pos.some((p) => p.direction === 'short');
    const barsSince = n - S.lastEntryBar;

    // ─── Exits ───
    if (P.dynExits) {
      if (hasLong && signal === -1) orders.push({ close: true, side: 'sell' });
      if (hasShort && signal === 1) orders.push({ close: true, side: 'buy' });
    }
    if (P.defExits && barsSince > P.holdBars) {
      if (hasLong && signal === -1) orders.push({ close: true, side: 'sell' });
      if (hasShort && signal === 1) orders.push({ close: true, side: 'buy' });
    }

    // ─── Entries ───
    if (barsSince >= 3 && atrPct < 0.05) {
      if (signal === 1 && !hasLong) {
        orders.push({ side: 'buy', type: 'market', size: rawSize * 0.6, stopLoss: slPct, takeProfit: tpPct, trailingStop: 0 });
        orders.push({ side: 'buy', type: 'market', size: rawSize * 0.4, stopLoss: slPct, takeProfit: 0, trailingStop: trailPct });
        S.lastEntryBar = n;
      }
      if (signal === -1 && !hasShort) {
        orders.push({ side: 'sell', type: 'market', size: rawSize * 0.6, stopLoss: slPct, takeProfit: tpPct, trailingStop: 0 });
        orders.push({ side: 'sell', type: 'market', size: rawSize * 0.4, stopLoss: slPct, takeProfit: 0, trailingStop: trailPct });
        S.lastEntryBar = n;
      }
    }

    return orders;
  },

  onOrderFilled(ctx) {},
  onLiquidation(ctx) {},
  onFinish(ctx) {},
};
