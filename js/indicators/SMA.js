export default {
  name: 'SMA',
  paramSchema: {
    period: { type: 'number', min: 1, max: 500, default: 20 },
  },
  calculate(candles, params = {}) {
    const p = Math.max(1, params.period ?? 20);
    const out = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= p) sum -= candles[i - p].close;
      if (i >= p - 1) out[i] = sum / p;
    }
    return out;
  },
};
