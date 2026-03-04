let state = {};

export default {
  name: "MAD Loop Strategy (Accurate Pine Conversion)",

  init(ctx) {
    state = {
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

    if (n < 80) return orders;

    const close = candle.close;
    const high = candle.high;
    const low = candle.low;

    // ───────────────── PARAMETERS ─────────────────

    const bbLength = 25;
    const bbMultP = 1.4;
    const bbMultN = 1.0;

    const flLength = 10;
    const a_ = 10;
    const b_ = 60;
    const thLong = 23;
    const thShort = 3;

    const signalMode = "Combined";

    const riskPct = 0.01;
    const atrLen = 14;

    // ───────────────── EMA (Stateful) ─────────────────

    const kBB = 2 / (bbLength + 1);
    const kFL = 2 / (flLength + 1);

    if (state.emaBB === null) state.emaBB = close;
    if (state.emaFL === null) state.emaFL = close;

    state.emaBB = close * kBB + state.emaBB * (1 - kBB);
    state.emaFL = close * kFL + state.emaFL * (1 - kFL);

    // ───────────────── MAD BB ─────────────────

    let madBB = 0;
    for (let i = n - bbLength; i < n; i++) {
      madBB += Math.abs(candles[i].close - state.emaBB);
    }
    madBB /= bbLength;

    const upper = state.emaBB + madBB * bbMultP;
    const lower = state.emaBB - madBB * bbMultN;

    state.upperBB[n - 1] = upper;
    state.lowerBB[n - 1] = lower;

    let bbScore = 0;
    if (state.prevClose <= upper && close > upper) bbScore = 1;
    if (state.prevClose >= lower && close < lower) bbScore = -1;

    // ───────────────── MAD FL LOOP ─────────────────

    let madFL = 0;
    for (let i = n - flLength; i < n; i++) {
      madFL += Math.abs(candles[i].close - state.emaFL);
    }
    madFL /= flLength;

    const weighted = state.emaFL * madFL;

    let loopScore = 0;
    for (let i = a_; i <= b_; i++) {
      if (n - i < 0) continue;
      loopScore += weighted > candles[n - i].close ? 1 : -1;
    }

    state.madFL[n - 1] = loopScore;

    let flScore = 0;
    if (state.prevMadFL <= thLong && loopScore > thLong) flScore = 1;
    if (state.prevMadFL >= thShort && loopScore < thShort) flScore = -1;

    // ───────────────── COMBINED ─────────────────

    const combined = (bbScore + flScore) / 2;
    state.combined[n - 1] = combined;

    let finalScore = 0;

    if (signalMode === "BB") finalScore = bbScore;
    else if (signalMode === "FL") finalScore = flScore;
    else {
      if (combined > 0) finalScore = 1;
      if (combined < 0) finalScore = -1;
    }

    // ───────────────── ATR (True Range) ─────────────────

    let atrSum = 0;
    for (let i = n - atrLen; i < n; i++) {
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

    const atr = atrSum / atrLen;

    const stopDist = atr * 1.8;
    const size = (equity * riskPct) / stopDist;

    const slPct = (stopDist / close) * 100;
    const tpPct = slPct * 2.0;

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