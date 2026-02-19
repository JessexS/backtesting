// ═══════════════════════════════════════════════════════════════
// ExecutionEngine — Bridges strategy orders to TradingEngine
// ═══════════════════════════════════════════════════════════════

export class ExecutionEngine {
  constructor(tradingEngine) {
    this.te = tradingEngine;
  }

  execute(orders, candle) {
    if (!orders || !orders.length) return;
    for (const o of orders) this.te.submitOrder(o);
    this.te.processOrders(candle);
  }
}
