function sample(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMonteCarlo({ equity, trades = [], runs = 200, seed = 7, ruinThreshold = 0.5 }) {
  const rng = mulberry32(seed);
  const returns = [];
  for (let i = 1; i < equity.length; i++) returns.push(equity[i] / equity[i - 1] - 1);
  const tradePnls = trades.filter((t) => t.side === 'sell').map((t) => t.pnl ?? 0);
  const startEq = equity[0] ?? 1;

  const curves = [];
  const maxDDs = [];
  const sharpes = [];
  let ruined = 0;

  for (let r = 0; r < runs; r++) {
    let eq = startEq;
    let peak = eq;
    let maxDD = 0;
    const curve = [eq];

    for (let i = 0; i < returns.length; i++) {
      const rr = returns.length ? sample(returns, rng) : 0;
      const tr = tradePnls.length ? sample(tradePnls, rng) / Math.max(eq, 1e-9) : 0;
      eq *= (1 + rr + tr * 0.02);
      curve.push(eq);
      if (eq > peak) peak = eq;
      maxDD = Math.max(maxDD, (peak - eq) / Math.max(peak, 1e-9));
    }

    const diffs = [];
    for (let i = 1; i < curve.length; i++) diffs.push(curve[i] / curve[i - 1] - 1);
    const mean = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
    const varr = diffs.length ? diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length : 0;
    const sharpe = varr > 0 ? mean / Math.sqrt(varr) * Math.sqrt(252) : 0;

    if (eq < startEq * ruinThreshold) ruined++;
    curves.push(curve);
    maxDDs.push(maxDD);
    sharpes.push(sharpe);
  }

  return {
    curves,
    maxDDDistribution: maxDDs,
    sharpeDistribution: sharpes,
    probabilityOfRuin: runs ? ruined / runs : 0,
  };
}
