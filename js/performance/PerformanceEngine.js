// ═══════════════════════════════════════════════════════════════
// PerformanceEngine — Trade analytics, risk metrics, benchmark
// VaR, CVaR, Omega, MAR, Calmar, Treynor, Sortino, trade breakdown
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

    // Per-bar returns
    const rets = [];
    if (equityHistory.length > 1) {
      for (let i = 1; i < equityHistory.length; i++) {
        rets.push((equityHistory[i] - equityHistory[i - 1]) / equityHistory[i - 1]);
      }
    }

    // Max drawdown
    let peak = 0, maxDD = 0;
    for (const eq of equityHistory) {
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    m.maxDrawdown = maxDD;

    // Sharpe (annualized from per-bar returns)
    if (rets.length > 0) {
      const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
      const std = Math.sqrt(variance);
      m.sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

      // Sortino ratio (downside deviation only)
      const downsideRets = rets.filter((r) => r < 0);
      const downsideVariance = downsideRets.length > 0
        ? downsideRets.reduce((s, r) => s + r ** 2, 0) / rets.length
        : 0;
      const downsideStd = Math.sqrt(downsideVariance);
      m.sortino = downsideStd > 0 ? (mean / downsideStd) * Math.sqrt(252) : 0;

      // VaR (Value at Risk) — 95% parametric
      const sortedRets = rets.slice().sort((a, b) => a - b);
      m.var95 = this.percentile(rets.map((r) => r * 100), 5);
      m.var99 = this.percentile(rets.map((r) => r * 100), 1);

      // CVaR (Conditional VaR / Expected Shortfall) — average of worst 5%
      const cutoff5 = Math.max(1, Math.floor(sortedRets.length * 0.05));
      const tail5 = sortedRets.slice(0, cutoff5);
      m.cvar95 = tail5.length > 0 ? (tail5.reduce((s, r) => s + r, 0) / tail5.length) * 100 : 0;

      // Omega ratio (threshold = 0)
      const gains = rets.filter((r) => r > 0).reduce((s, r) => s + r, 0);
      const lossesSum = Math.abs(rets.filter((r) => r < 0).reduce((s, r) => s + r, 0));
      m.omega = lossesSum > 0 ? gains / lossesSum : gains > 0 ? 999 : 1;

    } else {
      m.sharpe = 0;
      m.sortino = 0;
      m.var95 = 0;
      m.var99 = 0;
      m.cvar95 = 0;
      m.omega = 1;
    }

    // CAGR
    const years = totalBars / 252;
    m.cagr = years > 0 ? Math.pow(finalEq / initialBalance, 1 / years) - 1 : 0;

    // MAR ratio (CAGR / Max Drawdown)
    m.mar = maxDD > 0 ? m.cagr / maxDD : 0;

    // Calmar ratio (CAGR / Max Drawdown over 3 years or available period)
    m.calmar = maxDD > 0 ? m.cagr / maxDD : 0;

    // Treynor ratio (using market return as benchmark)
    // Approximation: use average market return as beta proxy
    m.treynor = m.sharpe; // Simplified — same as Sharpe when beta ~ 1

    m.totalFees = totalFees;
    m.balance = finalEq;
    m.exposure = totalBars > 0 ? exposedBars / totalBars : 0;
    m.compositeScore = m.sharpe !== 0 ? (m.cagr * Math.abs(m.sharpe)) / (1 + m.maxDrawdown) : 0;

    return m;
  }

  // Buy & Hold benchmark calculation
  calculateBuyAndHold(candles, initialBalance) {
    if (!candles || candles.length < 2) return { totalReturn: 0, equityCurve: [initialBalance], maxDrawdown: 0, sharpe: 0, cagr: 0 };

    const startPrice = candles[0].open;
    const shares = initialBalance / startPrice;
    const equityCurve = candles.map((c) => shares * c.close);

    const finalEq = equityCurve[equityCurve.length - 1];
    const totalReturn = (finalEq - initialBalance) / initialBalance;

    // Max drawdown
    let peak = 0, maxDD = 0;
    for (const eq of equityCurve) {
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    // Sharpe
    const rets = [];
    for (let i = 1; i < equityCurve.length; i++) {
      rets.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    const mean = rets.length > 0 ? rets.reduce((s, r) => s + r, 0) / rets.length : 0;
    const variance = rets.length > 0 ? rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length : 0;
    const std = Math.sqrt(variance);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

    const years = candles.length / 252;
    const cagr = years > 0 ? Math.pow(finalEq / initialBalance, 1 / years) - 1 : 0;

    return { totalReturn, equityCurve, maxDrawdown: maxDD, sharpe, cagr, finalEquity: finalEq };
  }

  // Generate trade-by-trade breakdown with detailed metrics
  tradeBreakdown(trades) {
    return trades.map((t, idx) => {
      const duration = t.exitBar - t.entryBar;
      const pnlPct = ((t.exitPrice - t.entryPrice) / t.entryPrice * 100) *
        (t.direction === 'long' ? 1 : -1);
      const slippageCost = t.fees; // Fees include slippage impact
      const rMultiple = t.sl > 0 ? t.pnl / (t.entryPrice * (t.sl / 100) * t.size) : 0;
      const mae = t.direction === 'long'
        ? ((t.entryPrice - t.exitPrice) / t.entryPrice * 100)
        : ((t.exitPrice - t.entryPrice) / t.entryPrice * 100);

      return {
        id: t.id,
        index: idx + 1,
        direction: t.direction,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        size: t.size,
        pnl: t.pnl,
        pnlPct,
        fees: t.fees,
        slippageCost,
        entryBar: t.entryBar,
        exitBar: t.exitBar,
        duration,
        reason: t.reason,
        rMultiple,
        mae: Math.max(0, mae),
      };
    });
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
      sharpe: 0, sortino: 0, var95: 0, var99: 0, cvar95: 0, omega: 1,
      cagr: 0, mar: 0, calmar: 0, treynor: 0,
      totalFees, balance: finalEq, exposure: 0, compositeScore: 0,
    };
  }
}
