// ═══════════════════════════════════════════════════════════════
// TradingEngine — Position lifecycle, SL/TP/Trail, liquidation
// ═══════════════════════════════════════════════════════════════

export class TradingEngine {
  constructor(settings) {
    this.mode = settings.mode || 'futures';
    this.leverage = settings.leverage || 10;
    this.makerFee = (settings.makerFee || 0.02) / 100;
    this.takerFee = (settings.takerFee || 0.04) / 100;
    this.slippage = (settings.slippage || 0.05) / 100;
    this.maintRate = (settings.maintRate || 0.5) / 100;
    this.balance = settings.balance || 10000;
    this.equity = this.balance;
    this.positions = [];
    this.closedTrades = [];
    this.totalFees = 0;
    this.equityHistory = [];
    this.posIdCounter = 0;
    this.sizeMode = settings.sizeMode || 'fixed';
    this.sizeVal = settings.sizeVal || 1000;
    this.defaultSL = settings.sl || 0;
    this.defaultTP = settings.tp || 0;
    this.defaultTrail = settings.trail || 0;
    this.partialFill = (settings.partialFill || 100) / 100;
    this.ordersToProcess = [];
    this.exposedBars = 0;
    this.totalBars = 0;
  }

  getSize(price) {
    if (this.sizeMode === 'percent') return (this.equity * (this.sizeVal / 100)) / price;
    return this.sizeVal / price;
  }

  submitOrder(order) {
    this.ordersToProcess.push(order);
  }

  processOrders(candle) {
    const pending = this.ordersToProcess.splice(0);
    for (const o of pending) {
      if (o.close) { this._closePosition(o, candle); continue; }
      const price = candle.close;
      const side = o.side;
      const slip = side === 'buy' ? 1 + this.slippage : 1 - this.slippage;
      const execPrice = price * slip;
      let size = o.size || this.getSize(execPrice);
      size *= this.partialFill;
      if (size <= 0) continue;

      let notional = size * execPrice;
      const fee = notional * this.takerFee;
      let margin = this.mode === 'futures' ? notional / this.leverage : notional;

      if (margin + fee > this.balance) {
        margin = this.balance - fee;
        size = (margin * (this.mode === 'futures' ? this.leverage : 1)) / execPrice;
        if (size <= 0) continue;
        notional = size * execPrice;
      }

      this.balance -= margin + fee;
      this.totalFees += fee;

      const sl = o.stopLoss || this.defaultSL;
      const tp = o.takeProfit || this.defaultTP;
      const trail = o.trailingStop || this.defaultTrail;
      const dir = side === 'buy' ? 'long' : 'short';

      this.positions.push({
        id: ++this.posIdCounter, direction: dir, side, entryPrice: execPrice,
        size, notional, margin, fee, sl, tp, trail,
        trailHigh: execPrice, trailLow: execPrice,
        entryBar: candle.time, unrealizedPnl: 0,
      });
    }
  }

  _closePosition(order, candle) {
    let toClose = [];
    if (order.positionId) {
      toClose = this.positions.filter((p) => p.id === order.positionId);
    } else if (order.side === 'sell') {
      toClose = this.positions.filter((p) => p.direction === 'long');
    } else if (order.side === 'buy') {
      toClose = this.positions.filter((p) => p.direction === 'short');
    }
    for (const p of toClose) this._exitPosition(p, candle.close, candle, 'signal');
  }

  _exitPosition(pos, exitPrice, candle, reason) {
    const slip = pos.direction === 'long' ? 1 - this.slippage : 1 + this.slippage;
    const price = exitPrice * slip;
    const fee = pos.size * price * this.takerFee;
    this.totalFees += fee;

    let pnl;
    if (pos.direction === 'long') pnl = (price - pos.entryPrice) * pos.size;
    else pnl = (pos.entryPrice - price) * pos.size;
    pnl -= fee;

    this.balance += pos.margin + pnl;

    this.closedTrades.push({
      id: pos.id, direction: pos.direction,
      entryPrice: pos.entryPrice, exitPrice: price,
      size: pos.size, pnl, fees: pos.fee + fee,
      entryBar: pos.entryBar, exitBar: candle.time,
      reason, sl: pos.sl,
    });

    const idx = this.positions.indexOf(pos);
    if (idx >= 0) this.positions.splice(idx, 1);
  }

  update(candle) {
    this.totalBars++;
    if (this.positions.length > 0) this.exposedBars++;
    const liquidated = [];

    for (let i = this.positions.length - 1; i >= 0; i--) {
      const p = this.positions[i];

      // Trail tracking
      if (p.direction === 'long') { if (candle.high > p.trailHigh) p.trailHigh = candle.high; }
      else { if (candle.low < p.trailLow || p.trailLow === p.entryPrice) p.trailLow = candle.low; }

      // Stop Loss
      if (p.sl > 0) {
        if (p.direction === 'long' && candle.low <= p.entryPrice * (1 - p.sl / 100)) {
          this._exitPosition(p, p.entryPrice * (1 - p.sl / 100), candle, 'stop_loss'); continue;
        }
        if (p.direction === 'short' && candle.high >= p.entryPrice * (1 + p.sl / 100)) {
          this._exitPosition(p, p.entryPrice * (1 + p.sl / 100), candle, 'stop_loss'); continue;
        }
      }

      // Take Profit
      if (p.tp > 0) {
        if (p.direction === 'long' && candle.high >= p.entryPrice * (1 + p.tp / 100)) {
          this._exitPosition(p, p.entryPrice * (1 + p.tp / 100), candle, 'take_profit'); continue;
        }
        if (p.direction === 'short' && candle.low <= p.entryPrice * (1 - p.tp / 100)) {
          this._exitPosition(p, p.entryPrice * (1 - p.tp / 100), candle, 'take_profit'); continue;
        }
      }

      // Trailing Stop
      if (p.trail > 0) {
        if (p.direction === 'long') {
          const ts = p.trailHigh * (1 - p.trail / 100);
          if (candle.low <= ts) { this._exitPosition(p, ts, candle, 'trailing_stop'); continue; }
        } else {
          const ts = p.trailLow * (1 + p.trail / 100);
          if (candle.high >= ts) { this._exitPosition(p, ts, candle, 'trailing_stop'); continue; }
        }
      }

      // Liquidation (futures)
      if (this.mode === 'futures') {
        let liqPrice;
        if (p.direction === 'long') liqPrice = p.entryPrice * (1 - 1 / this.leverage + this.maintRate);
        else liqPrice = p.entryPrice * (1 + 1 / this.leverage - this.maintRate);
        if ((p.direction === 'long' && candle.low <= liqPrice) || (p.direction === 'short' && candle.high >= liqPrice)) {
          this.closedTrades.push({
            id: p.id, direction: p.direction,
            entryPrice: p.entryPrice, exitPrice: liqPrice,
            size: p.size, pnl: -p.margin, fees: p.fee,
            entryBar: p.entryBar, exitBar: candle.time,
            reason: 'liquidation', sl: p.sl,
          });
          this.positions.splice(i, 1);
          liquidated.push(this.closedTrades[this.closedTrades.length - 1]);
          continue;
        }
      }

      // Unrealized PnL
      if (p.direction === 'long') p.unrealizedPnl = (candle.close - p.entryPrice) * p.size;
      else p.unrealizedPnl = (p.entryPrice - candle.close) * p.size;
    }

    const uPnl = this.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    this.equity = this.balance + uPnl + this.positions.reduce((s, p) => s + p.margin, 0);
    this.equityHistory.push(this.equity);
    return liquidated;
  }

  getState() {
    return {
      balance: this.balance, equity: this.equity,
      positions: this.positions, closedTrades: this.closedTrades,
      totalFees: this.totalFees, equityHistory: this.equityHistory,
    };
  }
}
