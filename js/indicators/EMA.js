export default {
  name: 'EMA',
  paramSchema: {
    period: { type: 'number', min: 1, max: 500, default: 20 },
  },
  calculate(candles, params = {}) {
    const p = Math.max(1, params.period ?? 20);
    const out = new Array(candles.length).fill(null);
    const a = 2 / (p + 1);
    let prev = null;
    for (let i = 0; i < candles.length; i++) {
      const v = candles[i].close;
      prev = prev == null ? v : (a * v + (1 - a) * prev);
      out[i] = prev;
    }
    return out;
  },
};
