// ═══════════════════════════════════════════════════════════════
// ARM Strategy v2.0 — Adaptive Regime Momentum
// Multi-regime trend following + constrained mean reversion
// Volatility-adaptive position sizing with drawdown throttle
// 60/40 scale-out: fixed TP leg + trailing runner leg
// ═══════════════════════════════════════════════════════════════

let S = {};

function calcEMA(cs, n, period) {
  const k = 2 / (period + 1);
  let start = Math.max(0, n - period * 4);
  let val = cs[start].close;
  for (let i = start + 1; i < n; i++) val = cs[i].close * k + val * (1 - k);
  return val;
}

export default {
  name: "ARM v2.0 — Adaptive Regime Momentum",

  init(ctx) {
    S = {
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

    if (n < 55) return orders;

    // ─── Indicators ───
    const emaF = calcEMA(cs, n, 12);
    const emaM = calcEMA(cs, n, 26);
    const emaS = calcEMA(cs, n, 50);
    const price = c.close;

    // Chart overlays
    if (!ctx.indicators._emaF) ctx.indicators._emaF = [];
    if (!ctx.indicators._emaM) ctx.indicators._emaM = [];
    if (!ctx.indicators._emaS) ctx.indicators._emaS = [];
    ctx.indicators._emaF[n - 1] = emaF;
    ctx.indicators._emaM[n - 1] = emaM;
    ctx.indicators._emaS[n - 1] = emaS;
    ctx.indicators['EMA 12'] = { values: ctx.indicators._emaF, color: '#26de81' };
    ctx.indicators['EMA 26'] = { values: ctx.indicators._emaM, color: '#45aaf2' };
    ctx.indicators['EMA 50'] = { values: ctx.indicators._emaS, color: '#fd9644' };

    // ATR 14
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

    // RSI 14
    let avgGain = 0, avgLoss = 0;
    for (let i = n - 14; i < n; i++) {
      const diff = cs[i].close - cs[i - 1].close;
      if (diff > 0) avgGain += diff; else avgLoss -= diff;
    }
    avgGain /= 14; avgLoss /= 14;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    // Volatility
    const vol20 = (() => {
      let sum = 0; const rets = [];
      for (let i = n - 20; i < n; i++) { const r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close; rets.push(r); sum += r; }
      const mean = sum / 20; let v = 0;
      for (const r of rets) v += (r - mean) ** 2;
      return M.sqrt(v / 20);
    })();
    const vol50 = (() => {
      let sum = 0; const rets = [];
      for (let i = n - 50; i < n; i++) { const r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close; rets.push(r); sum += r; }
      const mean = sum / 50; let v = 0;
      for (const r of rets) v += (r - mean) ** 2;
      return M.sqrt(v / 50);
    })();
    const volRatio = vol50 > 0 ? vol20 / vol50 : 1;

    // ─── Regime ───
    const bullAlign = emaF > emaM && emaM > emaS;
    const bearAlign = emaF < emaM && emaM < emaS;
    const trendDir = bullAlign ? 1 : bearAlign ? -1 : 0;
    const emaSpread = M.abs(emaF - emaS) / price;
    const isTrending = trendDir !== 0 && emaSpread > 0.004;
    const isStrongTrend = isTrending && emaSpread > 0.01;
    const isSideways = trendDir === 0 && volRatio < 1.3 && emaSpread < 0.003;
    const isVolatile = volRatio > 2.0 || atrPct > 0.04;
    const isExtreme = volRatio > 3.0 || atrPct > 0.06;

    // ─── Risk ───
    if (eq > S.peakEq) S.peakEq = eq;
    const drawdown = (S.peakEq - eq) / S.peakEq;
    let ddThrottle = 1.0;
    if (drawdown > 0.20) ddThrottle = 0.25;
    else if (drawdown > 0.15) ddThrottle = 0.50;
    else if (drawdown > 0.10) ddThrottle = 0.75;

    const riskPerTrade = 0.015;
    const stopMultiple = 2.0;
    const stopDist = atr * stopMultiple;
    const riskAmt = eq * riskPerTrade * ddThrottle;
    let volScalar = 1.0 / M.max(1.0, volRatio * 0.7);
    if (volScalar > 1.0) volScalar = 1.0;
    let rawSize = (riskAmt * volScalar) / stopDist;
    const maxKellySize = eq * 0.5 / price;
    if (rawSize > maxKellySize) rawSize = maxKellySize;
    if (rawSize <= 0 || rawSize !== rawSize) return orders;

    const slPct = stopDist / price * 100;
    const tpPct = slPct * 2.5;
    const tp3Pct = slPct * 3.0;
    const trailPct = slPct * 0.85;

    // ─── Positions ───
    let hasLong = false, hasShort = false, longCount = 0, shortCount = 0;
    for (const p of pos) {
      if (p.direction === 'long') { hasLong = true; longCount++; }
      if (p.direction === 'short') { hasShort = true; shortCount++; }
    }
    const barsSinceEntry = n - S.lastEntryBar;
    const minBars = isTrending ? 4 : isSideways ? 20 : 8;

    // ─── Exits ───
    if (isExtreme && pos.length > 0) {
      if (hasLong) orders.push({ close: true, side: 'sell' });
      if (hasShort) orders.push({ close: true, side: 'buy' });
      return orders;
    }
    if (drawdown > 0.22 && pos.length > 0) {
      if (hasLong) orders.push({ close: true, side: 'sell' });
      if (hasShort) orders.push({ close: true, side: 'buy' });
      return orders;
    }
    if (hasLong && trendDir === -1 && emaSpread > 0.003) orders.push({ close: true, side: 'sell' });
    if (hasShort && trendDir === 1 && emaSpread > 0.003) orders.push({ close: true, side: 'buy' });

    // ─── Entries ───
    if (barsSinceEntry >= minBars && !isExtreme && !isVolatile) {
      // Trend following
      if (isTrending) {
        if (trendDir === 1 && rsi > 40 && rsi < 72 && longCount === 0) {
          const boost = isStrongTrend ? 1.25 : 1.0;
          const base = rawSize * boost;
          orders.push({ side: 'buy', type: 'market', size: base * 0.6, stopLoss: slPct, takeProfit: tp3Pct, trailingStop: 0 });
          orders.push({ side: 'buy', type: 'market', size: base * 0.4, stopLoss: slPct, takeProfit: 0, trailingStop: trailPct });
          S.lastEntryBar = n; S.pyramidCount = 0;
        }
        if (trendDir === -1 && rsi < 60 && rsi > 28 && shortCount === 0) {
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
        if (rsi < 22) { orders.push({ side: 'buy', type: 'market', size: rawSize * 0.4, stopLoss: slPct * 0.6, takeProfit: slPct * 1.0 }); S.lastEntryBar = n; }
        if (rsi > 78) { orders.push({ side: 'sell', type: 'market', size: rawSize * 0.4, stopLoss: slPct * 0.6, takeProfit: slPct * 1.0 }); S.lastEntryBar = n; }
      }
    }

    return orders;
  },

  onOrderFilled(ctx) {},
  onLiquidation(ctx) { S.pyramidCount = 0; },
  onFinish(ctx) {},
};
