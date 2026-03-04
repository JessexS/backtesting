// ═══════════════════════════════════════════════════════════════
// Example Strategy — Reverse EMA Crossover
// Longs when EMA 90 crosses below EMA 7, shorts when crosses above
// Trade taken when next candle closes outside both EMAs
// ═══════════════════════════════════════════════════════════════

let S = {};

function calcEMA(candles, n, period) {
  const k = 2 / (period + 1);
  let start = Math.max(0, n - period * 4);
  let val = candles[start].close;
  for (let i = start + 1; i < n; i++) {
    val = candles[i].close * k + val * (1 - k);
  }
  return val;
}

export default {
  name: "Reverse EMA Crossover",

  init(ctx) {
    S = {
      peakEq: ctx.equity,
      lastEntryBar: -999,
      prevEma7: null,
      prevEma90: null,
      positions: {}, // Track entry prices and TP status: { posKey: { entryPrice, tp1hit, tp2hit } }
    };
  },

  onCandle(ctx) {
    const orders = [];
    const { candles, candle, positions, equity } = ctx;
    const n = candles.length;
    if (n < 60) return orders;

    const emaFast = calcEMA(candles, n, 7);
    const emaSlow = calcEMA(candles, n, 90);
    const price = candle.close;

    // Indicator overlay for chart
    if (!ctx.indicators._emaFast) ctx.indicators._emaFast = [];
    if (!ctx.indicators._emaSlow) ctx.indicators._emaSlow = [];
    ctx.indicators._emaFast[n - 1] = emaFast;
    ctx.indicators._emaSlow[n - 1] = emaSlow;
    ctx.indicators['EMA 7'] = { values: ctx.indicators._emaFast, color: '#26de81' };
    ctx.indicators['EMA 90'] = { values: ctx.indicators._emaSlow, color: '#fc5c65' };

    const hasLong = positions.some((p) => p.direction === 'long');
    const hasShort = positions.some((p) => p.direction === 'short');

    // ATR for sizing
    let atrSum = 0;
    for (let i = n - 14; i < n; i++) {
      const hi = candles[i].high, lo = candles[i].low, pc = candles[i - 1].close;
      let tr = hi - lo;
      if (Math.abs(hi - pc) > tr) tr = Math.abs(hi - pc);
      if (Math.abs(lo - pc) > tr) tr = Math.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / 14;
    const slPct = (atr * 2 / price) * 100;

    // Drawdown throttle
    if (equity > S.peakEq) S.peakEq = equity;
    const dd = (S.peakEq - equity) / S.peakEq;
    if (dd > 0.20 && positions.length > 0) {
      for (const p of positions) orders.push({ close: true, side: p.direction === 'long' ? 'sell' : 'buy' });
      return orders;
    }

    const barsSince = n - S.lastEntryBar;

    // Detect crossovers and check price closes outside both EMAs
    const ema90BelowEma7 = emaSlow < emaFast;
    const prevEma90BelowEma7 = S.prevEma90 !== null && S.prevEma90 < S.prevEma7;

    // EMA 90 crossed below EMA 7 (bullish crossover) - potential long
    const bullishCrossover = S.prevEma90 !== null && !prevEma90BelowEma7 && ema90BelowEma7;
    // EMA 90 crossed above EMA 7 (bearish crossover) - potential short
    const bearishCrossover = S.prevEma90 !== null && prevEma90BelowEma7 && !ema90BelowEma7;

    // Price closes above both EMAs
    const priceAboveBoth = price > emaFast && price > emaSlow;
    // Price closes below both EMAs
    const priceBelowBoth = price < emaFast && price < emaSlow;

    // Track position entry prices on new positions
    for (const pos of positions) {
      const posKey = `${pos.direction}_${S.lastEntryBar}`;
      if (!S.positions[posKey]) {
        S.positions[posKey] = { entryPrice: pos.entryPrice, tp1hit: false, tp2hit: false, size: pos.size };
      }
    }

    // Check for partial take-profits at 1:3 and 1:5 RR
    for (const pos of positions) {
      const posKey = `${pos.direction}_${S.lastEntryBar}`;
      const tracking = S.positions[posKey];
      if (!tracking) continue;

      const rr1_3Price = tracking.entryPrice + (slPct / 100 * tracking.entryPrice * 3) * (pos.direction === 'long' ? 1 : -1);
      const rr1_5Price = tracking.entryPrice + (slPct / 100 * tracking.entryPrice * 5) * (pos.direction === 'long' ? 1 : -1);

      if (pos.direction === 'long') {
        // Close 25% at 1:3 RR
        if (price >= rr1_3Price && !tracking.tp1hit) {
          orders.push({ side: 'sell', type: 'market', size: tracking.size * 0.25 });
          tracking.tp1hit = true;
        }
        // Close 50% at 1:5 RR
        if (price >= rr1_5Price && !tracking.tp2hit) {
          orders.push({ side: 'sell', type: 'market', size: tracking.size * 0.50 });
          tracking.tp2hit = true;
        }
      } else {
        // Close 25% at 1:3 RR
        if (price <= rr1_3Price && !tracking.tp1hit) {
          orders.push({ side: 'buy', type: 'market', size: tracking.size * 0.25 });
          tracking.tp1hit = true;
        }
        // Close 50% at 1:5 RR
        if (price <= rr1_5Price && !tracking.tp2hit) {
          orders.push({ side: 'buy', type: 'market', size: tracking.size * 0.50 });
          tracking.tp2hit = true;
        }
      }
    }

    // Close remaining 25% when EMA crossover reverses
    if (hasLong && bearishCrossover) orders.push({ close: true, side: 'sell' });
    if (hasShort && bullishCrossover) orders.push({ close: true, side: 'buy' });

    // Entries: trade when price closes outside both EMAs after crossover
    if (barsSince >= 5 && positions.length === 0) {
      const size = (equity * 0.05) / (atr * 2);
      if (bullishCrossover && priceAboveBoth) {
        orders.push({ side: 'buy', type: 'market', size, stopLoss: slPct });
        S.lastEntryBar = n;
      } else if (bearishCrossover && priceBelowBoth) {
        orders.push({ side: 'sell', type: 'market', size, stopLoss: slPct });
        S.lastEntryBar = n;
      }
    }

    // Update previous EMA values for next candle
    S.prevEma7 = emaFast;
    S.prevEma90 = emaSlow;

    return orders;
  },

  onOrderFilled(ctx) {},
  onLiquidation(ctx) {
    S.lastEntryBar = -999;
    S.positions = {};
  },
  onFinish(ctx) {},
};
