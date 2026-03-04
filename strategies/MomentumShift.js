// Strategy state — persists across candles
let state = {};

const DEFAULTS = {
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  volPeriod: 20,
  volumeThreshold: 0.8,
  atrPeriod: 14,
  riskPct: 1,
  stopMultiple: 1.8,
  tpMultiple: 2.2,
  minBars: 8,
  ddMax1: 0.20,
  ddMax2: 0.15,
  ddMax3: 0.10,
};

export default {
  name: "Momentum Shift (MACD + Volume Dil)",

  params: {
    'MACD': {
      macdFast: { label: 'Fast Period', default: 12, min: 5, max: 50 },
      macdSlow: { label: 'Slow Period', default: 26, min: 10, max: 100 },
      macdSignal: { label: 'Signal Period', default: 9, min: 2, max: 30 },
    },
    'Volume': {
      volPeriod: { label: 'SMA Period', default: 20, min: 5, max: 100 },
      volumeThreshold: { label: 'Threshold', default: 0.8, min: 0.1, max: 2, step: 0.1 },
    },
    'Risk': {
      riskPct: { label: 'Risk %', default: 1, min: 0.5, max: 10, step: 0.5 },
      stopMultiple: { label: 'Stop (xATR)', default: 1.8, min: 0.5, max: 5, step: 0.1 },
      tpMultiple: { label: 'TP (xATR)', default: 2.2, min: 0.5, max: 10, step: 0.1 },
      minBars: { label: 'Min Bars Between', default: 8, min: 1, max: 30 },
    },
    'Drawdown': {
      ddMax1: { label: 'Level 1', default: 20, min: 5, max: 50, step: 1 },
      ddMax2: { label: 'Level 2', default: 15, min: 5, max: 40, step: 1 },
      ddMax3: { label: 'Level 3', default: 10, min: 5, max: 30, step: 1 },
    },
    'ATR': {
      atrPeriod: { label: 'Period', default: 14, min: 5, max: 50 },
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
    state = {
      P,
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
    const P = state.P;

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

    // ───── MACD ─────
    const emaFast = ema(P.macdFast, closes);
    const emaSlow = ema(P.macdSlow, closes);
    const macd = emaFast - emaSlow;

    state.macdLine[n - 1] = macd;

    const macdSlice = state.macdLine.slice(-P.macdSignal);
    let signal = macdSlice[0];
    const k = 2 / (P.macdSignal + 1);
    for (let i = 1; i < macdSlice.length; i++) {
      signal = macdSlice[i] * k + signal * (1 - k);
    }

    state.signalLine[n - 1] = signal;

    const hist = macd - signal;
    state.macdHist[n - 1] = hist;
    state.zeroLine[n - 1] = 0;

    // ───── Volume SMA ─────
    let volSum = 0;
    for (let i = n - P.volPeriod; i < n; i++) {
      volSum += candles[i].volume;
    }
    const volSMA = volSum / P.volPeriod;
    state.volumeSMA[n - 1] = volSMA;

    const volumeWeak = candle.volume < volSMA * P.volumeThreshold;

    // ───── ATR ─────
    let atrSum = 0;
    for (let i = n - P.atrPeriod; i < n; i++) {
      const hi = candles[i].high;
      const lo = candles[i].low;
      const pc = candles[i - 1].close;
      let tr = hi - lo;
      if (M.abs(hi - pc) > tr) tr = M.abs(hi - pc);
      if (M.abs(lo - pc) > tr) tr = M.abs(lo - pc);
      atrSum += tr;
    }
    const atr = atrSum / P.atrPeriod;
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
    const stopDist = atr * P.stopMultiple;
    const riskAmount = equity * P.riskPct / 100;
    const positionSize = riskAmount / stopDist;

    if (equity > state.peakEquity) state.peakEquity = equity;
    const drawdown = (state.peakEquity - equity) / state.peakEquity;

    let throttle = 1.0;
    if (drawdown > P.ddMax1) throttle = 0.3;
    else if (drawdown > P.ddMax2) throttle = 0.5;
    else if (drawdown > P.ddMax3) throttle = 0.75;

    const size = positionSize * throttle;

    const slPct = (stopDist / close) * 100;
    const tpPct = slPct * P.tpMultiple;

    if (positions.length === 0 && n - state.lastEntryBar > P.minBars) {

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