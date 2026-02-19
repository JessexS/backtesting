// ═══════════════════════════════════════════════════════════════
// STRATEGY TEMPLATE — DO NOT USE DIRECTLY
// ═══════════════════════════════════════════════════════════════
//
// This file is a reference template for writing trading strategies.
// It does NOT appear in the strategy dropdown (files starting with _ are excluded).
//
// ─── LIFECYCLE ─────────────────────────────────────────────────
//
// 1. init(ctx)           Called once when the strategy is loaded.
//                        Use to initialize state variables.
//
// 2. onCandle(ctx)       Called on every new candle.
//                        Return an array of order objects.
//                        This is where all logic lives.
//
// 3. onOrderFilled(ctx)  Called after an order is filled by the engine.
//                        Use for tracking fills, adjusting state, etc.
//
// 4. onLiquidation(ctx)  Called when a position is liquidated (futures).
//                        Use to reset state, halt trading, etc.
//
// 5. onFinish(ctx)       Called when the simulation ends.
//                        Use for cleanup or final logging.
//
// ─── CONTEXT OBJECT (ctx) ──────────────────────────────────────
//
//   ctx.candle      Current candle: { time, open, high, low, close, volume, regime }
//   ctx.candles     Array of all candles so far (including current)
//   ctx.positions   Array of open positions (copies, read-only):
//                   { id, direction, entryPrice, size, margin, unrealizedPnl, ... }
//   ctx.equity      Current equity (balance + margin + unrealized PnL)
//   ctx.balance     Current cash balance
//   ctx.fees        Total fees paid
//   ctx.utils       { Math } — Math object for calculations
//   ctx.indicators  Object for storing indicator values for chart overlay
//                   Write to this to draw lines on the chart.
//                   Example: ctx.indicators['EMA 50'] = { values: emaArray, color: '#fd9644' }
//
// ─── ORDER FORMAT ──────────────────────────────────────────────
//
//   Entry order:
//   {
//     side: 'buy' | 'sell',      // 'buy' = long entry, 'sell' = short entry
//     type: 'market',            // only market orders supported
//     size: 0.5,                 // position size in base asset units (optional, uses default if omitted)
//     stopLoss: 2.0,             // stop loss as % from entry (optional)
//     takeProfit: 4.0,           // take profit as % from entry (optional)
//     trailingStop: 1.5,         // trailing stop as % (optional)
//   }
//
//   Close order:
//   {
//     close: true,
//     side: 'sell',              // 'sell' closes longs, 'buy' closes shorts
//     positionId: 123,           // optional: close specific position
//   }
//
// ─── INDICATOR CHART OVERLAY ───────────────────────────────────
//
//   To draw an indicator on the chart, write to ctx.indicators:
//
//   // Persistent array (initialize in init, push values in onCandle)
//   if (!ctx.indicators._emaValues) ctx.indicators._emaValues = [];
//   ctx.indicators._emaValues[candles.length - 1] = emaValue;
//   ctx.indicators['EMA 50'] = { values: ctx.indicators._emaValues, color: '#fd9644' };
//
//   Keys starting with _ are internal storage (not drawn).
//   Other keys are displayed as lines on the chart.
//
// ═══════════════════════════════════════════════════════════════

// Strategy state — persists across candles
let state = {};

export default {
  // Display name shown in dropdown
  name: "Template Strategy",

  // Optional: parameter definitions for auto-generated UI
  // params: {
  //   'General': {
  //     lookback: { label: 'Lookback', default: 14, min: 2, max: 100, step: 1 },
  //     threshold: { label: 'Threshold', default: 30, min: 0, max: 100 },
  //     mode: { label: 'Mode', type: 'select', default: 'fast', options: { fast: 'Fast', slow: 'Slow' } },
  //   },
  // },

  init(ctx) {
    // ─── EXAMPLE: Initialize state ───
    state = {
      peakEquity: ctx.equity,
      initialEquity: ctx.equity,
      lastEntryBar: -999,
    };
  },

  onCandle(ctx) {
    const orders = [];
    const { candles, candle, positions, equity, balance } = ctx;
    const n = candles.length;
    const M = ctx.utils.Math;

    // Need enough bars for indicators
    if (n < 55) return orders;

    // ─── EXAMPLE: ATR calculation (14-period) ───
    let atrSum = 0;
    for (let i = n - 14; i < n; i++) {
      const hi = candles[i].high, lo = candles[i].low, pc = candles[i - 1].close;
      let tr = hi - lo;
      if (M.abs(hi - pc) > tr) tr = M.abs(hi - pc);
      if (M.abs(lo - pc) > tr) tr = M.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / 14;
    const price = candle.close;

    // ─── EXAMPLE: Risk-based position sizing ───
    //
    // Risk 1.5% of equity per trade
    // Stop loss at 2× ATR from entry
    const riskPct = 0.015;
    const stopMultiple = 2.0;
    const stopDist = atr * stopMultiple;
    const riskAmount = equity * riskPct;
    const positionSize = riskAmount / stopDist;

    // ─── EXAMPLE: Drawdown throttle ───
    //
    // Reduce position size when in drawdown
    if (equity > state.peakEquity) state.peakEquity = equity;
    const drawdown = (state.peakEquity - equity) / state.peakEquity;

    let throttle = 1.0;
    if (drawdown > 0.20) throttle = 0.25;       // 20%+ DD: quarter size
    else if (drawdown > 0.15) throttle = 0.50;   // 15%+ DD: half size
    else if (drawdown > 0.10) throttle = 0.75;   // 10%+ DD: 75% size

    const adjustedSize = positionSize * throttle;

    // ─── EXAMPLE: Emergency exit on critical drawdown ───
    if (drawdown > 0.22 && positions.length > 0) {
      for (const p of positions) {
        orders.push({ close: true, side: p.direction === 'long' ? 'sell' : 'buy' });
      }
      return orders;
    }

    // ─── EXAMPLE: Liquidation awareness ───
    //
    // At 10x leverage, liquidation is ~10% away from entry.
    // Keep stops well inside that range.
    // The onLiquidation callback is called if price reaches liq price.

    // ─── EXAMPLE: Simple entry/exit (replace with real logic) ───
    const slPct = (stopDist / price) * 100;
    const tpPct = slPct * 2.5;

    // Buy signal example
    if (positions.length === 0 && n - state.lastEntryBar > 10) {
      orders.push({
        side: 'buy',
        type: 'market',
        size: adjustedSize,
        stopLoss: slPct,
        takeProfit: tpPct,
      });
      state.lastEntryBar = n;
    }

    return orders;
  },

  onOrderFilled(ctx) {
    // Called after a fill. Use for tracking.
  },

  onLiquidation(ctx) {
    // Called on liquidation. Reset counters, etc.
    state.lastEntryBar = -999;
  },

  onFinish(ctx) {
    // Called at simulation end. Cleanup.
  },
};
