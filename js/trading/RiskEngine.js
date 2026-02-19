// ═══════════════════════════════════════════════════════════════
// RiskEngine — Pre-trade risk checks and position sizing
// ═══════════════════════════════════════════════════════════════

export class RiskEngine {
  constructor(config = {}) {
    this.maxPositions = config.maxPositions ?? 10;
    this.maxDrawdownPct = config.maxDrawdownPct ?? 25;
    this.maxLeverageExposure = config.maxLeverageExposure ?? 100;
    this.maxSinglePositionPct = config.maxSinglePositionPct ?? 50;
  }

  validate(order, tradingEngine, candle) {
    const te = tradingEngine;
    const errors = [];

    // Max positions
    if (!order.close && te.positions.length >= this.maxPositions) {
      errors.push(`Max positions (${this.maxPositions}) reached`);
    }

    // Max drawdown circuit breaker
    if (!order.close) {
      const initialBalance = te.equityHistory.length > 0 ? te.equityHistory[0] : te.balance;
      const dd = (initialBalance - te.equity) / initialBalance * 100;
      if (dd >= this.maxDrawdownPct) {
        errors.push(`Drawdown ${dd.toFixed(1)}% exceeds limit ${this.maxDrawdownPct}%`);
      }
    }

    // Single position size limit
    if (!order.close && order.size) {
      const notional = order.size * candle.close;
      const pct = (notional / te.equity) * 100;
      if (pct > this.maxSinglePositionPct) {
        errors.push(`Position ${pct.toFixed(0)}% of equity exceeds limit ${this.maxSinglePositionPct}%`);
      }
    }

    // Total leverage exposure
    if (!order.close && te.mode === 'futures') {
      const currentExposure = te.positions.reduce((s, p) => s + p.notional, 0);
      const newNotional = (order.size || te.getSize(candle.close)) * candle.close;
      const totalExposure = ((currentExposure + newNotional) / te.equity) * 100;
      if (totalExposure > this.maxLeverageExposure) {
        errors.push(`Leverage exposure ${totalExposure.toFixed(0)}% exceeds limit`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  calculatePositionSize(equity, riskPct, stopDistPct, price) {
    const riskAmount = equity * (riskPct / 100);
    const stopDist = price * (stopDistPct / 100);
    if (stopDist <= 0) return 0;
    return riskAmount / stopDist;
  }

  kellySize(winRate, avgWin, avgLoss, equity, price, cap = 0.5) {
    if (avgLoss <= 0 || avgWin <= 0) return 0;
    const b = avgWin / avgLoss;
    const kelly = (winRate * b - (1 - winRate)) / b;
    const clampedKelly = Math.max(0, Math.min(cap, kelly));
    return (equity * clampedKelly) / price;
  }

  drawdownThrottle(equity, peakEquity) {
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > 0.20) return 0.25;
    if (dd > 0.15) return 0.50;
    if (dd > 0.10) return 0.75;
    return 1.0;
  }
}
