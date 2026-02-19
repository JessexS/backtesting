// ═══════════════════════════════════════════════════════════════
// PerformanceEngine — Trade analytics and performance metrics
// ═══════════════════════════════════════════════════════════════

export class PerformanceEngine {
  calculate(trades, equityHistory, initialBalance, totalFees, exposedBars, totalBars) {
    const m = {};
    m.totalTrades = trades.length;
    if (m.totalTrades === 0) return this._empty(initialBalance, equityHistory, totalFees, totalBars);

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    m.wins = wins.length;
    m.losses = losses.length;
    m.winRate = m.wins / m.totalTrades;

    const totalWin = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    m.profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? 999 : 0;
    m.avgWin = wins.length > 0 ? totalWin / wins.length : 0;
    m.avgLoss = losses.length > 0 ? totalLoss / losses.length : 0;
    m.expectancy = m.winRate * m.avgWin - (1 - m.winRate) * m.avgLoss;

    // Max consecutive losses
    let maxCL = 0, cl = 0;
    for (const t of trades) {
      if (t.pnl <= 0) { cl++; if (cl > maxCL) maxCL = cl; } else cl = 0;
    }
    m.maxConsecLoss = maxCL;

    // Average R-multiple
    const rMultiples = trades.filter((t) => t.sl > 0).map((t) => {
      const risk = t.entryPrice * (t.sl / 100) * t.size;
      return risk > 0 ? t.pnl / risk : 0;
    });
    m.avgR = rMultiples.length > 0 ? rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length : 0;

    // Kelly
    if (m.avgLoss > 0 && m.avgWin > 0) {
      const b = m.avgWin / m.avgLoss;
      m.kelly = (m.winRate * b - (1 - m.winRate)) / b;
    } else m.kelly = 0;

    // Equity metrics
    const finalEq = equityHistory.length > 0 ? equityHistory[equityHistory.length - 1] : initialBalance;
    m.totalReturn = (finalEq - initialBalance) / initialBalance;

    // Max drawdown
    let peak = 0, maxDD = 0;
    for (const eq of equityHistory) {
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    m.maxDrawdown = maxDD;

    // Sharpe (annualized from per-bar returns)
    if (equityHistory.length > 1) {
      const rets = [];
      for (let i = 1; i < equityHistory.length; i++) {
        rets.push((equityHistory[i] - equityHistory[i - 1]) / equityHistory[i - 1]);
      }
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
      const std = Math.sqrt(variance);
      m.sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    } else m.sharpe = 0;

    // CAGR
    const years = totalBars / 252;
    m.cagr = years > 0 ? Math.pow(finalEq / initialBalance, 1 / years) - 1 : 0;
    m.totalFees = totalFees;
    m.balance = finalEq;
    m.exposure = totalBars > 0 ? exposedBars / totalBars : 0;
    m.compositeScore = m.sharpe !== 0 ? (m.cagr * Math.abs(m.sharpe)) / (1 + m.maxDrawdown) : 0;

    return m;
  }

  riskOfRuin(winRate, avgWin, avgLoss, ruinThreshold = 0.5) {
    if (avgLoss <= 0 || winRate >= 1) return 0;
    const r = avgWin / avgLoss;
    const q = 1 - winRate;
    if (winRate * r <= q) return 1;
    const edge = winRate * r - q;
    return Math.pow(q / (winRate * r), Math.ceil(1 / (ruinThreshold * r)));
  }

  percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  _empty(initialBalance, equityHistory, totalFees, totalBars) {
    const finalEq = equityHistory.length > 0 ? equityHistory[equityHistory.length - 1] : initialBalance;
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, expectancy: 0, maxConsecLoss: 0, avgR: 0, kelly: 0,
      totalReturn: (finalEq - initialBalance) / initialBalance, maxDrawdown: 0,
      sharpe: 0, cagr: 0, totalFees, balance: finalEq, exposure: 0, compositeScore: 0,
    };
  }
}
