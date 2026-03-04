// ═══════════════════════════════════════════════════════════════
// ARM Strategy v2.0 — Adaptive Regime Momentum
// Multi-regime trend following + constrained mean reversion
// Volatility-adaptive position sizing with drawdown throttle
// 60/40 scale-out: fixed TP leg + trailing runner leg
// ═══════════════════════════════════════════════════════════════

let S = {};

const DEFAULTS = {
  emaFast: 12,
  emaMedium: 26,
  emaSlow: 50,
  atrPeriod: 14,
  rsiPeriod: 14,
  volPeriod: 20,
  volRatioPeriod: 50,
  riskPct: 1.5,
  stopMultiple: 2.0,
  tpMultiple: 2.5,
  tp3Multiple: 3.0,
  trailMultiple: 0.85,
  ddMax1: 0.20,
  ddMax2: 0.15,
  ddMax3: 0.10,
  ddEmergency: 0.22,
  minBarsTrend: 4,
  minBarsSideways: 20,
  minBarsDefault: 8,
  rsiLow: 40,
  rsiHigh: 60,
  rsiLowShort: 28,
  rsiHighShort: 72,
  emaSpreadTrend: 0.004,
  emaSpreadStrong: 0.01,
  emaSpreadSideways: 0.003,
  volRatioThreshold: 1.3,
  volRatioStrong: 2.0,
  volRatioExtreme: 3.0,
  atrThreshold: 0.04,
  atrExtreme: 0.06,
};

function calcEMA(cs, n, period) {
  const k = 2 / (period + 1);
  let start = Math.max(0, n - period * 4);
  let val = cs[start].close;
  for (let i = start + 1; i < n; i++) val = cs[i].close * k + val * (1 - k);
  return val;
}

export default {
  name: "ARM v2.0 — Adaptive Regime Momentum",

  params: {
    'EMAs': {
      emaFast: { label: 'Fast EMA', default: 12, min: 5, max: 50 },
      emaMedium: { label: 'Medium EMA', default: 26, min: 10, max: 100 },
      emaSlow: { label: 'Slow EMA', default: 50, min: 20, max: 200 },
    },
    'Indicators': {
      atrPeriod: { label: 'ATR Period', default: 14, min: 5, max: 50 },
      rsiPeriod: { label: 'RSI Period', default: 14, min: 5, max: 50 },
      volPeriod: { label: 'Vol Period', default: 20, min: 10, max: 100 },
      volRatioPeriod: { label: 'Vol Ratio Period', default: 50, min: 20, max: 200 },
    },
    'Risk': {
      riskPct: { label: 'Risk %', default: 1.5, min: 0.5, max: 10, step: 0.5 },
      stopMultiple: { label: 'Stop (xATR)', default: 2.0, min: 0.5, max: 5, step: 0.1 },
      tpMultiple: { label: 'TP1 (xATR)', default: 2.5, min: 0.5, max: 10, step: 0.1 },
      tp3Multiple: { label: 'TP2 (xATR)', default: 3.0, min: 0.5, max: 10, step: 0.1 },
      trailMultiple: { label: 'Trailing (xATR)', default: 0.85, min: 0.1, max: 2, step: 0.05 },
    },
    'Drawdown': {
      ddMax1: { label: 'Level 1', default: 20, min: 5, max: 50, step: 1 },
      ddMax2: { label: 'Level 2', default: 15, min: 5, max: 40, step: 1 },
      ddMax3: { label: 'Level 3', default: 10, min: 5, max: 30, step: 1 },
      ddEmergency: { label: 'Emergency', default: 22, min: 10, max: 50, step: 1 },
    },
    'Entry': {
      minBarsTrend: { label: 'Min Bars Trend', default: 4, min: 1, max: 20 },
      minBarsSideways: { label: 'Min Bars Sideways', default: 20, min: 5, max: 50 },
      minBarsDefault: { label: 'Min Bars Default', default: 8, min: 1, max: 30 },
      rsiLow: { label: 'RSI Long Low', default: 40, min: 10, max: 70 },
      rsiHigh: { label: 'RSI Long High', default: 60, min: 30, max: 90 },
      rsiLowShort: { label: 'RSI Short Low', default: 28, min: 10, max: 70 },
      rsiHighShort: { label: 'RSI Short High', default: 72, min: 30, max: 90 },
    },
    'Regime': {
      emaSpreadTrend: { label: 'Trend Spread', default: 0.4, min: 0.1, max: 2, step: 0.1 },
      emaSpreadStrong: { label: 'Strong Spread', default: 1.0, min: 0.5, max: 5, step: 0.1 },
      emaSpreadSideways: { label: 'Sideways Spread', default: 0.3, min: 0.1, max: 2, step: 0.1 },
      volRatioThreshold: { label: 'Vol Ratio', default: 1.3, min: 1, max: 3, step: 0.1 },
      volRatioStrong: { label: 'Strong Vol', default: 2.0, min: 1, max: 5, step: 0.1 },
      volRatioExtreme: { label: 'Extreme Vol', default: 3.0, min: 1, max: 10, step: 0.5 },
      atrThreshold: { label: 'ATR Threshold', default: 4, min: 1, max: 10, step: 0.5 },
      atrExtreme: { label: 'ATR Extreme', default: 6, min: 1, max: 20, step: 0.5 },
    },
  },

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
    const P = this._getParams();
    S = {
      P,
      peakEq: ctx.equity,
      initEq: ctx.equity,
      lastEntryBar: -999,
      pyramidCount: 0,
      maxPyramids: 1,
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

    if (n < 55) return orders;

    // ─── Indicators ───
    const emaF = calcEMA(cs, n, P.emaFast);
    const emaM = calcEMA(cs, n, P.emaMedium);
    const emaS = calcEMA(cs, n, P.emaSlow);
    const price = c.close;

    // Chart overlays
    if (!ctx.indicators._emaF) ctx.indicators._emaF = [];
    if (!ctx.indicators._emaM) ctx.indicators._emaM = [];
    if (!ctx.indicators._emaS) ctx.indicators._emaS = [];
    ctx.indicators._emaF[n - 1] = emaF;
    ctx.indicators._emaM[n - 1] = emaM;
    ctx.indicators._emaS[n - 1] = emaS;
    ctx.indicators[`EMA ${P.emaFast}`] = { values: ctx.indicators._emaF, color: '#26de81' };
    ctx.indicators[`EMA ${P.emaMedium}`] = { values: ctx.indicators._emaM, color: '#45aaf2' };
    ctx.indicators[`EMA ${P.emaSlow}`] = { values: ctx.indicators._emaS, color: '#fd9644' };

    // ATR
    let atrSum = 0;
    for (let i = n - P.atrPeriod; i < n; i++) {
      const hi = cs[i].high, lo = cs[i].low, pc = cs[i - 1].close;
      let tr = hi - lo;
      if (M.abs(hi - pc) > tr) tr = M.abs(hi - pc);
      if (M.abs(lo - pc) > tr) tr = M.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / P.atrPeriod;
    const atrPct = atr / price;

    // RSI
    let avgGain = 0, avgLoss = 0;
    for (let i = n - P.rsiPeriod; i < n; i++) {
      const diff = cs[i].close - cs[i - 1].close;
      if (diff > 0) avgGain += diff; else avgLoss -= diff;
    }
    avgGain /= P.rsiPeriod; avgLoss /= P.rsiPeriod;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    // Volatility
    const vol20 = (() => {
      let sum = 0; const rets = [];
      for (let i = n - P.volPeriod; i < n; i++) { const r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close; rets.push(r); sum += r; }
      const mean = sum / P.volPeriod; let v = 0;
      for (const r of rets) v += (r - mean) ** 2;
      return M.sqrt(v / P.volPeriod);
    })();
    const vol50 = (() => {
      let sum = 0; const rets = [];
      for (let i = n - P.volRatioPeriod; i < n; i++) { const r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close; rets.push(r); sum += r; }
      const mean = sum / P.volRatioPeriod; let v = 0;
      for (const r of rets) v += (r - mean) ** 2;
      return M.sqrt(v / P.volRatioPeriod);
    })();
    const volRatio = vol50 > 0 ? vol20 / vol50 : 1;

    // ─── Regime ───
    const bullAlign = emaF > emaM && emaM > emaS;
    const bearAlign = emaF < emaM && emaM < emaS;
    const trendDir = bullAlign ? 1 : bearAlign ? -1 : 0;
    const emaSpread = M.abs(emaF - emaS) / price;
    const isTrending = trendDir !== 0 && emaSpread > P.emaSpreadTrend * 0.01;
    const isStrongTrend = isTrending && emaSpread > P.emaSpreadStrong * 0.01;
    const isSideways = trendDir === 0 && volRatio < P.volRatioThreshold && emaSpread < P.emaSpreadSideways * 0.01;
    const isVolatile = volRatio > P.volRatioStrong || atrPct > P.atrThreshold * 0.01;
    const isExtreme = volRatio > P.volRatioExtreme || atrPct > P.atrExtreme * 0.01;

    // ─── Risk ───
    if (eq > S.peakEq) S.peakEq = eq;
    const drawdown = (S.peakEq - eq) / S.peakEq;
    let ddThrottle = 1.0;
    if (drawdown > P.ddMax1 / 100) ddThrottle = 0.25;
    else if (drawdown > P.ddMax2 / 100) ddThrottle = 0.50;
    else if (drawdown > P.ddMax3 / 100) ddThrottle = 0.75;

    const riskPerTrade = P.riskPct / 100;
    const stopMultiple = P.stopMultiple;
    const stopDist = atr * stopMultiple;
    const riskAmt = eq * riskPerTrade * ddThrottle;
    let volScalar = 1.0 / M.max(1.0, volRatio * 0.7);
    if (volScalar > 1.0) volScalar = 1.0;
    let rawSize = (riskAmt * volScalar) / stopDist;
    const maxKellySize = eq * 0.5 / price;
    if (rawSize > maxKellySize) rawSize = maxKellySize;
    if (rawSize <= 0 || rawSize !== rawSize) return orders;

    const slPct = stopDist / price * 100;
    const tpPct = slPct * P.tpMultiple;
    const tp3Pct = slPct * P.tp3Multiple;
    const trailPct = slPct * P.trailMultiple;

    // ─── Positions ───
    let hasLong = false, hasShort = false, longCount = 0, shortCount = 0;
    for (const p of pos) {
      if (p.direction === 'long') { hasLong = true; longCount++; }
      if (p.direction === 'short') { hasShort = true; shortCount++; }
    }
    const barsSinceEntry = n - S.lastEntryBar;
    const minBars = isTrending ? P.minBarsTrend : isSideways ? P.minBarsSideways : P.minBarsDefault;

    // ─── Exits ───
    if (isExtreme && pos.length > 0) {
      if (hasLong) orders.push({ close: true, side: 'sell' });
      if (hasShort) orders.push({ close: true, side: 'buy' });
      return orders;
    }
    if (drawdown > P.ddEmergency / 100 && pos.length > 0) {
      if (hasLong) orders.push({ close: true, side: 'sell' });
      if (hasShort) orders.push({ close: true, side: 'buy' });
      return orders;
    }
    if (hasLong && trendDir === -1 && emaSpread > P.emaSpreadSideways * 0.01) orders.push({ close: true, side: 'sell' });
    if (hasShort && trendDir === 1 && emaSpread > P.emaSpreadSideways * 0.01) orders.push({ close: true, side: 'buy' });

    // ─── Entries ───
    if (barsSinceEntry >= minBars && !isExtreme && !isVolatile) {
      // Trend following
      if (isTrending) {
        if (trendDir === 1 && rsi > P.rsiLow && rsi < P.rsiHighShort && longCount === 0) {
          const boost = isStrongTrend ? 1.25 : 1.0;
          const base = rawSize * boost;
          orders.push({ side: 'buy', type: 'market', size: base * 0.6, stopLoss: slPct, takeProfit: tp3Pct, trailingStop: 0 });
          orders.push({ side: 'buy', type: 'market', size: base * 0.4, stopLoss: slPct, takeProfit: 0, trailingStop: trailPct });
          S.lastEntryBar = n; S.pyramidCount = 0;
        }
        if (trendDir === -1 && rsi < P.rsiHigh && rsi > P.rsiLowShort && shortCount === 0) {
          const boost = isStrongTrend ? 1.25 : 1.0;
          const base = rawSize * boost;
          orders.push({ side: 'sell', type: 'market', size: base * 0.6, stopLoss: slPct, takeProfit: tp3Pct, trailingStop: 0 });
          orders.push({ side: 'sell', type: 'market', size: base * 0.4, stopLoss: slPct, takeProfit: 0, trailingStop: trailPct });
          S.lastEntryBar = n; S.pyramidCount = 0;
        }
        // Pyramid
        if (isStrongTrend && S.pyramidCount < S.maxPyramids && barsSinceEntry >= 6) {
          if (trendDir === 1 && hasLong && longCount < 2) {
            const p0 = pos.find((p) => p.direction === 'long');
            if (p0 && (price - p0.entryPrice) / p0.entryPrice > atrPct * 1.5) {
              const base = rawSize * 0.5;
              orders.push({ side: 'buy', type: 'market', size: base * 0.6, stopLoss: slPct * 0.8, takeProfit: tp3Pct * 0.8, trailingStop: 0 });
              orders.push({ side: 'buy', type: 'market', size: base * 0.4, stopLoss: slPct * 0.8, takeProfit: 0, trailingStop: trailPct });
              S.pyramidCount++; S.lastEntryBar = n;
            }
          }
          if (trendDir === -1 && hasShort && shortCount < 2) {
            const p0 = pos.find((p) => p.direction === 'short');
            if (p0 && (p0.entryPrice - price) / p0.entryPrice > atrPct * 1.5) {
              const base = rawSize * 0.5;
              orders.push({ side: 'sell', type: 'market', size: base * 0.6, stopLoss: slPct * 0.8, takeProfit: tp3Pct * 0.8, trailingStop: 0 });
              orders.push({ side: 'sell', type: 'market', size: base * 0.4, stopLoss: slPct * 0.8, takeProfit: 0, trailingStop: trailPct });
              S.pyramidCount++; S.lastEntryBar = n;
            }
          }
        }
      }
      // Mean reversion
      if (isSideways && pos.length === 0 && ddThrottle >= 0.75) {
        if (rsi < 25) { orders.push({ side: 'buy', type: 'market', size: rawSize * 0.4, stopLoss: slPct * 0.6, takeProfit: slPct * 1.0 }); S.lastEntryBar = n; }
        if (rsi > 75) { orders.push({ side: 'sell', type: 'market', size: rawSize * 0.4, stopLoss: slPct * 0.6, takeProfit: slPct * 1.0 }); S.lastEntryBar = n; }
      }
    }

    return orders;
  },

  onOrderFilled(ctx) {},
  onLiquidation(ctx) { S.pyramidCount = 0; },
  onFinish(ctx) {},
};
