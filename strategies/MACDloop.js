let state = {};

const DEFAULTS = {
  bbLength: 25,
  bbMultP: 1.4,
  bbMultN: 1.0,
  flLength: 10,
  a_: 10,
  b_: 60,
  thLong: 23,
  thShort: 3,
  signalMode: 2,
  riskPct: 1,
  atrLen: 14,
  stopMultiple: 1.8,
  tpMultiple: 2.0,
};

export default {
  name: "MAD Loop Strategy (Accurate Pine Conversion)",

  params: {
    'Bollinger Bands': {
      bbLength: { label: 'BB Period', default: 25, min: 5, max: 100 },
      bbMultP: { label: 'BB Upper Mult', default: 1.4, min: 0.5, max: 5, step: 0.1 },
      bbMultN: { label: 'BB Lower Mult', default: 1.0, min: 0.5, max: 5, step: 0.1 },
    },
    'MAD FL': {
      flLength: { label: 'FL Period', default: 10, min: 2, max: 50 },
      a_: { label: 'Loop Start', default: 10, min: 1, max: 50 },
      b_: { label: 'Loop End', default: 60, min: 10, max: 200 },
      thLong: { label: 'Long Threshold', default: 23, min: 0, max: 100 },
      thShort: { label: 'Short Threshold', default: 3, min: 0, max: 100 },
    },
    'Signal': {
      signalMode: { label: 'Mode', type: 'select', default: '2', options: { '0': 'BB', '1': 'FL', '2': 'Combined' } },
    },
    'Risk': {
      riskPct: { label: 'Risk %', default: 1, min: 0.5, max: 10, step: 0.5 },
      stopMultiple: { label: 'Stop (xATR)', default: 1.8, min: 0.5, max: 5, step: 0.1 },
      tpMultiple: { label: 'TP (xATR)', default: 2.0, min: 0.5, max: 10, step: 0.1 },
    },
    'ATR': {
      atrLen: { label: 'ATR Period', default: 14, min: 5, max: 50 },
    },
  },

  _getParams() {
    const p = { ...DEFAULTS };
    for (const section of Object.values(this.params)) {
      for (const [key, def] of Object.entries(section)) {
        const el = document.getElementById('sp_' + key);
        if (el) {
          if (def.type === 'select') p[key] = +el.value;
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
      lastEntryBar: -999,

      emaBB: null,
      emaFL: null,

      upperBB: [],
      lowerBB: [],
      madFL: [],
      combined: [],

      prevMadFL: 0,
      prevClose: 0
    };
  },

  onCandle(ctx) {
    const { candles, candle, positions, equity } = ctx;
    const orders = [];
    const n = candles.length;
    const P = state.P;

    if (n < 80) return orders;

    const close = candle.close;
    const high = candle.high;
    const low = candle.low;

    // ───────────────── EMA (Stateful) ─────────────────

    const kBB = 2 / (P.bbLength + 1);
    const kFL = 2 / (P.flLength + 1);

    if (state.emaBB === null) state.emaBB = close;
    if (state.emaFL === null) state.emaFL = close;

    state.emaBB = close * kBB + state.emaBB * (1 - kBB);
    state.emaFL = close * kFL + state.emaFL * (1 - kFL);

    // ───────────────── MAD BB ─────────────────

    let madBB = 0;
    for (let i = n - P.bbLength; i < n; i++) {
      madBB += Math.abs(candles[i].close - state.emaBB);
    }
    madBB /= P.bbLength;

    const upper = state.emaBB + madBB * P.bbMultP;
    const lower = state.emaBB - madBB * P.bbMultN;

    state.upperBB[n - 1] = upper;
    state.lowerBB[n - 1] = lower;

    let bbScore = 0;
    if (state.prevClose <= upper && close > upper) bbScore = 1;
    if (state.prevClose >= lower && close < lower) bbScore = -1;

    // ───────────────── MAD FL LOOP ─────────────────

    let madFL = 0;
    for (let i = n - P.flLength; i < n; i++) {
      madFL += Math.abs(candles[i].close - state.emaFL);
    }
    madFL /= P.flLength;

    const weighted = state.emaFL * madFL;

    let loopScore = 0;
    for (let i = P.a_; i <= P.b_; i++) {
      if (n - i < 0) continue;
      loopScore += weighted > candles[n - i].close ? 1 : -1;
    }

    state.madFL[n - 1] = loopScore;

    let flScore = 0;
    if (state.prevMadFL <= P.thLong && loopScore > P.thLong) flScore = 1;
    if (state.prevMadFL >= P.thShort && loopScore < P.thShort) flScore = -1;

    // ───────────────── COMBINED ─────────────────

    const combined = (bbScore + flScore) / 2;
    state.combined[n - 1] = combined;

    let finalScore = 0;

    if (P.signalMode === 0) finalScore = bbScore;
    else if (P.signalMode === 1) finalScore = flScore;
    else {
      if (combined > 0) finalScore = 1;
      if (combined < 0) finalScore = -1;
    }

    // ───────────────── ATR (True Range) ─────────────────

    let atrSum = 0;
    for (let i = n - P.atrLen; i < n; i++) {
      const hi = candles[i].high;
      const lo = candles[i].low;
      const pc = candles[i - 1].close;

      const tr = Math.max(
        hi - lo,
        Math.abs(hi - pc),
        Math.abs(lo - pc)
      );

      atrSum += tr;
    }

    const atr = atrSum / P.atrLen;

    const stopDist = atr * P.stopMultiple;
    const size = (equity * P.riskPct / 100) / stopDist;

    const slPct = (stopDist / close) * 100;
    const tpPct = slPct * P.tpMultiple;

    // ───────────────── EXECUTION ─────────────────

    if (positions.length === 0 && n - state.lastEntryBar > 5) {

      if (finalScore === 1) {
        orders.push({
          side: "buy",
          type: "market",
          size,
          stopLoss: slPct,
          takeProfit: tpPct
        });
        state.lastEntryBar = n;
      }

      if (finalScore === -1) {
        orders.push({
          side: "sell",
          type: "market",
          size,
          stopLoss: slPct,
          takeProfit: tpPct
        });
        state.lastEntryBar = n;
      }
    }

    // ───────────────── VISUALS ─────────────────

    ctx.indicators["Upper MAD Band"] = {
      values: state.upperBB,
      color: "#00ff88",
      panel: "main"
    };

    ctx.indicators["Lower MAD Band"] = {
      values: state.lowerBB,
      color: "#ff0055",
      panel: "main"
    };

    ctx.indicators["MAD Loop Score"] = {
      values: state.madFL,
      color: "#ffaa00",
      panel: "indicators"
    };

    ctx.indicators["Combined Score"] = {
      values: state.combined,
      color: "#8888ff",
      panel: "indicators"
    };

    state.prevMadFL = loopScore;
    state.prevClose = close;

    return orders;
  }
};