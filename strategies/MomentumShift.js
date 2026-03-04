// Strategy state — persists across candles
let state = {};

export default {
  name: "Momentum Shift (MACD + Volume Dilution + Visuals)",

  init(ctx) {
    state = {
      peakEquity: ctx.equity,
      lastEntryBar: -999,
      macdLine: [],
      signalLine: [],
      macdHist: [],
      zeroLine: [],
      volumeSMA: [],
      atrValues: [],
      longSignal: [],
      shortSignal: []
    };
  },

  onCandle(ctx) {
    const orders = [];
    const { candles, candle, positions, equity } = ctx;
    const n = candles.length;
    const M = ctx.utils.Math;

    if (n < 60) return orders;

    const close = candle.close;

    // ───── EMA helper ─────
    const ema = (period, arr) => {
      const k = 2 / (period + 1);
      let value = arr[n - period];
      for (let i = n - period + 1; i < n; i++) {
        value = arr[i] * k + value * (1 - k);
      }
      return value;
    };

    const closes = candles.map(c => c.close);

    // ───── MACD (12, 26, 9) ─────
    const ema12 = ema(12, closes);
    const ema26 = ema(26, closes);
    const macd = ema12 - ema26;

    state.macdLine[n - 1] = macd;

    const macdSlice = state.macdLine.slice(-9);
    let signal = macdSlice[0];
    const k = 2 / (9 + 1);
    for (let i = 1; i < macdSlice.length; i++) {
      signal = macdSlice[i] * k + signal * (1 - k);
    }

    state.signalLine[n - 1] = signal;

    const hist = macd - signal;
    state.macdHist[n - 1] = hist;
    state.zeroLine[n - 1] = 0;

    // ───── Volume SMA ─────
    const volPeriod = 20;
    let volSum = 0;
    for (let i = n - volPeriod; i < n; i++) {
      volSum += candles[i].volume;
    }
    const volSMA = volSum / volPeriod;
    state.volumeSMA[n - 1] = volSMA;

    const volumeWeak = candle.volume < volSMA * 0.8;

    // ───── ATR (14) ─────
    let atrSum = 0;
    for (let i = n - 14; i < n; i++) {
      const hi = candles[i].high;
      const lo = candles[i].low;
      const pc = candles[i - 1].close;
      let tr = hi - lo;
      if (M.abs(hi - pc) > tr) tr = M.abs(hi - pc);
      if (M.abs(lo - pc) > tr) tr = M.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / 14;
    state.atrValues[n - 1] = atr;

    // ───── Momentum Shift Detection ─────
    const prevHist = state.macdHist[n - 2];

    const bullishShift =
      prevHist < 0 &&
      hist > 0 &&
      volumeWeak &&
      macd < 0;

    const bearishShift =
      prevHist > 0 &&
      hist < 0 &&
      volumeWeak &&
      macd > 0;

    state.longSignal[n - 1] = bullishShift ? close : null;
    state.shortSignal[n - 1] = bearishShift ? close : null;

    // ───── Risk Management ─────
    const riskPct = 0.01;
    const stopDist = atr * 1.8;
    const riskAmount = equity * riskPct;
    const positionSize = riskAmount / stopDist;

    if (equity > state.peakEquity) state.peakEquity = equity;
    const drawdown = (state.peakEquity - equity) / state.peakEquity;

    let throttle = 1.0;
    if (drawdown > 0.20) throttle = 0.3;
    else if (drawdown > 0.15) throttle = 0.5;
    else if (drawdown > 0.10) throttle = 0.75;

    const size = positionSize * throttle;

    const slPct = (stopDist / close) * 100;
    const tpPct = slPct * 2.2;

    if (positions.length === 0 && n - state.lastEntryBar > 8) {

      if (bullishShift) {
        orders.push({
          side: "buy",
          type: "market",
          size,
          stopLoss: slPct,
          takeProfit: tpPct,
        });
        state.lastEntryBar = n;
      }

      if (bearishShift) {
        orders.push({
          side: "sell",
          type: "market",
          size,
          stopLoss: slPct,
          takeProfit: tpPct,
        });
        state.lastEntryBar = n;
      }
    }

    // ───── Chart Overlays ─────
    ctx.indicators["MACD"] = {
        values: state.macdLine,
        color: "#fd9644",
        panel: "indicators"
      };
      
      ctx.indicators["Signal"] = {
        values: state.signalLine,
        color: "#4b7bec",
        panel: "indicators"
      };
      
      ctx.indicators["Histogram"] = {
        values: state.macdHist,
        color: "#a5b1c2",
        panel: "indicators"
      };
      
      ctx.indicators["Zero"] = {
        values: state.zeroLine,
        color: "#000000",
        panel: "indicators"
      };

      /*
      ctx.indicators["Volume SMA"] = {
        values: state.volumeSMA,
        color: "#8854d0",
        panel: "indicators"
      };
*/
    ctx.indicators["ATR 14"] = { values: state.atrValues, color: "#eb3b5a", panel: "indicators" };
    ctx.indicators["Long Signal"] = { values: state.longSignal, color: "#20bf6b" };
    ctx.indicators["Short Signal"] = { values: state.shortSignal, color: "#eb3b5a" };

    return orders;
  },

  onOrderFilled(ctx) {},

  onLiquidation(ctx) {
    state.lastEntryBar = -999;
  },

  onFinish(ctx) {}
};