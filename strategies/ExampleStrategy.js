// ═══════════════════════════════════════════════════════════════
// Example Strategy — Simple EMA Crossover
// Buys when fast EMA > slow EMA, sells on reversal
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
  name: "EMA Crossover (Example)",

  init(ctx) {
    S = {
      peakEq: ctx.equity,
      lastEntryBar: -999,
    };
  },

  onCandle(ctx) {
    const orders = [];
    const { candles, candle, positions, equity } = ctx;
    const n = candles.length;
    if (n < 60) return orders;

    const emaFast = calcEMA(candles, n, 12);
    const emaSlow = calcEMA(candles, n, 26);
    const price = candle.close;

    // Indicator overlay for chart
    if (!ctx.indicators._emaFast) ctx.indicators._emaFast = [];
    if (!ctx.indicators._emaSlow) ctx.indicators._emaSlow = [];
    ctx.indicators._emaFast[n - 1] = emaFast;
    ctx.indicators._emaSlow[n - 1] = emaSlow;
    ctx.indicators['EMA 12'] = { values: ctx.indicators._emaFast, color: '#26de81' };
    ctx.indicators['EMA 26'] = { values: ctx.indicators._emaSlow, color: '#fc5c65' };

    const bullish = emaFast > emaSlow;
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

    // Exits
    if (hasLong && !bullish) orders.push({ close: true, side: 'sell' });
    if (hasShort && bullish) orders.push({ close: true, side: 'buy' });

    // Entries
    if (barsSince >= 5 && positions.length === 0) {
      const size = (equity * 0.01) / (atr * 2);
      if (bullish) {
        orders.push({ side: 'buy', type: 'market', size, stopLoss: slPct, takeProfit: slPct * 2 });
        S.lastEntryBar = n;
      } else {
        orders.push({ side: 'sell', type: 'market', size, stopLoss: slPct, takeProfit: slPct * 2 });
        S.lastEntryBar = n;
      }
    }

    return orders;
  },

  onOrderFilled(ctx) {},
  onLiquidation(ctx) { S.lastEntryBar = -999; },
  onFinish(ctx) {},
};
