// ═══════════════════════════════════════════════════════════════
// ARM Strategy v2.0 — Adaptive Regime Momentum
// Multi-regime trend following + constrained mean reversion
// Volatility-adaptive position sizing with drawdown throttle
// ═══════════════════════════════════════════════════════════════

var S;

function init(ctx) {
  S = {
    peakEq: ctx.equity,
    initEq: ctx.equity,
    lastEntryBar: -999,
    pyramidCount: 0,
    maxPyramids: 1
  };
}

function onCandle(ctx) {
  var M = ctx.utils.Math;
  var cs = ctx.candles;
  var c = ctx.candle;
  var n = cs.length;
  var eq = ctx.equity;
  var pos = ctx.positions;
  var orders = [];

  // Require 55 bars for indicator convergence
  if (n < 55) return orders;

  // ═══════════════════════════════════════════
  // INDICATOR ENGINE
  // ═══════════════════════════════════════════

  // EMA calculator (windowed, O(period*4) per call)
  var calcEMA = function(period) {
    var k = 2 / (period + 1);
    var start = n - period * 4;
    if (start < 0) start = 0;
    var val = cs[start].close;
    for (var i = start + 1; i < n; i++) {
      val = cs[i].close * k + val * (1 - k);
    }
    return val;
  };

  var emaF = calcEMA(12);
  var emaM = calcEMA(26);
  var emaS = calcEMA(50);
  var price = c.close;

  // ATR (14-period True Range average)
  var atrSum = 0;
  for (var i = n - 14; i < n; i++) {
    var hi = cs[i].high;
    var lo = cs[i].low;
    var pc = cs[i - 1].close;
    var tr = hi - lo;
    var d1 = M.abs(hi - pc);
    var d2 = M.abs(lo - pc);
    if (d1 > tr) tr = d1;
    if (d2 > tr) tr = d2;
    atrSum += tr;
  }
  var atr = atrSum / 14;
  var atrPct = atr / price;

  // RSI (14-period Wilder smoothing)
  var avgGain = 0;
  var avgLoss = 0;
  for (var i = n - 14; i < n; i++) {
    var diff = cs[i].close - cs[i - 1].close;
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= 14;
  avgLoss /= 14;
  var rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Short-term volatility (20-bar return std)
  var rets20 = [];
  var sum20 = 0;
  for (var i = n - 20; i < n; i++) {
    var r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close;
    rets20.push(r);
    sum20 += r;
  }
  var mean20 = sum20 / 20;
  var vsum20 = 0;
  for (var i = 0; i < 20; i++) {
    var d = rets20[i] - mean20;
    vsum20 += d * d;
  }
  var vol20 = M.sqrt(vsum20 / 20);

  // Medium-term volatility (50-bar return std)
  var rets50 = [];
  var sum50 = 0;
  for (var i = n - 50; i < n; i++) {
    var r = (cs[i].close - cs[i - 1].close) / cs[i - 1].close;
    rets50.push(r);
    sum50 += r;
  }
  var mean50 = sum50 / 50;
  var vsum50 = 0;
  for (var i = 0; i < 50; i++) {
    var d = rets50[i] - mean50;
    vsum50 += d * d;
  }
  var vol50 = M.sqrt(vsum50 / 50);

  // Volatility ratio: current regime vs baseline
  var volRatio = vol50 > 0 ? vol20 / vol50 : 1;

  // ═══════════════════════════════════════════
  // REGIME CLASSIFICATION
  // ═══════════════════════════════════════════

  var bullAlign = emaF > emaM && emaM > emaS;
  var bearAlign = emaF < emaM && emaM < emaS;
  var trendDir = bullAlign ? 1 : bearAlign ? -1 : 0;
  var emaSpread = M.abs(emaF - emaS) / price;

  var isTrending = trendDir !== 0 && emaSpread > 0.004;
  var isStrongTrend = isTrending && emaSpread > 0.01;
  var isSideways = trendDir === 0 && volRatio < 1.3 && emaSpread < 0.003;
  var isVolatile = volRatio > 2.0 || atrPct > 0.04;
  var isExtreme = volRatio > 3.0 || atrPct > 0.06;

  // ═══════════════════════════════════════════
  // RISK MANAGEMENT
  // ═══════════════════════════════════════════

  // Drawdown tracking
  if (eq > S.peakEq) S.peakEq = eq;
  var drawdown = (S.peakEq - eq) / S.peakEq;

  // Drawdown throttle (step function)
  var ddThrottle = 1.0;
  if (drawdown > 0.20) ddThrottle = 0.25;
  else if (drawdown > 0.15) ddThrottle = 0.50;
  else if (drawdown > 0.10) ddThrottle = 0.75;

  // Volatility-adjusted position sizing
  var riskPerTrade = 0.015;
  var stopMultiple = 2.0;
  var stopDist = atr * stopMultiple;
  var riskAmt = eq * riskPerTrade * ddThrottle;

  // Inverse vol scalar: reduce size when vol expands
  var volScalar = 1.0 / M.max(1.0, volRatio * 0.7);
  if (volScalar > 1.0) volScalar = 1.0;

  // Core position size (in base asset units)
  var rawSize = (riskAmt * volScalar) / stopDist;

  // Kelly cap: never exceed 50% of equity in notional
  var maxKellySize = eq * 0.5 / price;
  if (rawSize > maxKellySize) rawSize = maxKellySize;

  // Sanity check
  if (rawSize <= 0 || rawSize !== rawSize) return orders; // NaN check

  // SL / TP / Trail as percentages
  var slPct = stopDist / price * 100;
  var tpPct = slPct * 2.5;
  var tp3Pct = slPct * 3.0;
  var trailPct = slPct * 0.85;

  // ═══════════════════════════════════════════
  // POSITION STATE
  // ═══════════════════════════════════════════

  var hasLong = false;
  var hasShort = false;
  var longCount = 0;
  var shortCount = 0;
  for (var i = 0; i < pos.length; i++) {
    if (pos[i].direction === 'long') { hasLong = true; longCount++; }
    if (pos[i].direction === 'short') { hasShort = true; shortCount++; }
  }

  var barsSinceEntry = n - S.lastEntryBar;
  var minBars = isTrending ? 4 : isSideways ? 20 : 8;

  // ═══════════════════════════════════════════
  // EXIT LOGIC (evaluated first)
  // ═══════════════════════════════════════════

  // Emergency: extreme volatility spike
  if (isExtreme && pos.length > 0) {
    if (hasLong) orders.push({ close: true, side: 'sell' });
    if (hasShort) orders.push({ close: true, side: 'buy' });
    return orders;
  }

  // Emergency: critical drawdown
  if (drawdown > 0.22 && pos.length > 0) {
    if (hasLong) orders.push({ close: true, side: 'sell' });
    if (hasShort) orders.push({ close: true, side: 'buy' });
    return orders;
  }

  // Signal reversal: close long on confirmed bear alignment
  if (hasLong && trendDir === -1 && emaSpread > 0.003) {
    orders.push({ close: true, side: 'sell' });
  }

  // Signal reversal: close short on confirmed bull alignment
  if (hasShort && trendDir === 1 && emaSpread > 0.003) {
    orders.push({ close: true, side: 'buy' });
  }

  // ═══════════════════════════════════════════
  // ENTRY LOGIC
  // ═══════════════════════════════════════════

  if (barsSinceEntry >= minBars && !isExtreme && !isVolatile) {

    // ——— TREND FOLLOWING ———
    if (isTrending) {

      // LONG: bull alignment + momentum confirmed + not overbought
      if (trendDir === 1 && rsi > 40 && rsi < 72 && longCount === 0) {
        var boost = isStrongTrend ? 1.25 : 1.0;
        var baseLongSize = rawSize * boost;
        var scaleLongSize = baseLongSize * 0.6;
        var runnerLongSize = baseLongSize - scaleLongSize;
        // Scale-out leg: fixed 3R take profit, no trail
        orders.push({
          side: 'buy',
          type: 'market',
          size: scaleLongSize,
          stopLoss: slPct,
          takeProfit: tp3Pct,
          trailingStop: 0
        });
        // Runner leg: no hard TP, let trailing stop capture trend
        orders.push({
          side: 'buy',
          type: 'market',
          size: runnerLongSize,
          stopLoss: slPct,
          takeProfit: 0,
          trailingStop: trailPct
        });
        S.lastEntryBar = n;
        S.pyramidCount = 0;
      }

      // SHORT: bear alignment + momentum confirmed + not oversold
      if (trendDir === -1 && rsi < 60 && rsi > 28 && shortCount === 0) {
        var boost = isStrongTrend ? 1.25 : 1.0;
        var baseShortSize = rawSize * boost;
        var scaleShortSize = baseShortSize * 0.6;
        var runnerShortSize = baseShortSize - scaleShortSize;
        // Scale-out leg: fixed 3R take profit, no trail
        orders.push({
          side: 'sell',
          type: 'market',
          size: scaleShortSize,
          stopLoss: slPct,
          takeProfit: tp3Pct,
          trailingStop: 0
        });
        // Runner leg: no hard TP, let trailing stop capture trend
        orders.push({
          side: 'sell',
          type: 'market',
          size: runnerShortSize,
          stopLoss: slPct,
          takeProfit: 0,
          trailingStop: trailPct
        });
        S.lastEntryBar = n;
        S.pyramidCount = 0;
      }

      // PYRAMID: add to winning position in strong trend
      if (isStrongTrend && S.pyramidCount < S.maxPyramids && barsSinceEntry >= 6) {

        // Pyramid long
        if (trendDir === 1 && hasLong && longCount < 2) {
          var entryPnl = 0;
          for (var j = 0; j < pos.length; j++) {
            if (pos[j].direction === 'long') {
              entryPnl = (price - pos[j].entryPrice) / pos[j].entryPrice;
              break;
            }
          }
          // Only pyramid if existing position is profitable by >1.5 ATR
          if (entryPnl > atrPct * 1.5) {
            var basePyrLong = rawSize * 0.5;
            var scalePyrLong = basePyrLong * 0.6;
            var runnerPyrLong = basePyrLong - scalePyrLong;
            // Scale-out pyramid leg
            orders.push({
              side: 'buy',
              type: 'market',
              size: scalePyrLong,
              stopLoss: slPct * 0.8,
              takeProfit: tp3Pct * 0.8,
              trailingStop: 0
            });
            // Runner pyramid leg
            orders.push({
              side: 'buy',
              type: 'market',
              size: runnerPyrLong,
              stopLoss: slPct * 0.8,
              takeProfit: 0,
              trailingStop: trailPct
            });
            S.pyramidCount++;
            S.lastEntryBar = n;
          }
        }

        // Pyramid short
        if (trendDir === -1 && hasShort && shortCount < 2) {
          var entryPnl = 0;
          for (var j = 0; j < pos.length; j++) {
            if (pos[j].direction === 'short') {
              entryPnl = (pos[j].entryPrice - price) / pos[j].entryPrice;
              break;
            }
          }
          if (entryPnl > atrPct * 1.5) {
            var basePyrShort = rawSize * 0.5;
            var scalePyrShort = basePyrShort * 0.6;
            var runnerPyrShort = basePyrShort - scalePyrShort;
            // Scale-out pyramid leg
            orders.push({
              side: 'sell',
              type: 'market',
              size: scalePyrShort,
              stopLoss: slPct * 0.8,
              takeProfit: tp3Pct * 0.8,
              trailingStop: 0
            });
            // Runner pyramid leg
            orders.push({
              side: 'sell',
              type: 'market',
              size: runnerPyrShort,
              stopLoss: slPct * 0.8,
              takeProfit: 0,
              trailingStop: trailPct
            });
            S.pyramidCount++;
            S.lastEntryBar = n;
          }
        }
      }
    }

    // ——— MEAN REVERSION (sideways regime only) ———
    if (isSideways && pos.length === 0 && ddThrottle >= 0.75) {

      // Oversold bounce
      if (rsi < 22) {
        orders.push({
          side: 'buy',
          type: 'market',
          size: rawSize * 0.4,
          stopLoss: slPct * 0.6,
          takeProfit: slPct * 1.0
        });
        S.lastEntryBar = n;
      }

      // Overbought fade
      if (rsi > 78) {
        orders.push({
          side: 'sell',
          type: 'market',
          size: rawSize * 0.4,
          stopLoss: slPct * 0.6,
          takeProfit: slPct * 1.0
        });
        S.lastEntryBar = n;
      }
    }
  }

  return orders;
}

function onOrderFilled(ctx) {
  // No additional logic needed — SL/TP/trail managed by engine
}

function onLiquidation(ctx) {
  // Reset pyramid counter on liquidation
  S.pyramidCount = 0;
}

function onFinish(ctx) {
  // No cleanup needed
}
