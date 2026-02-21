// ═══════════════════════════════════════════════════════════════
// OrderBookEngine — Minimal limit order book with matching
// ═══════════════════════════════════════════════════════════════

export class OrderBookEngine {
  constructor({ tickSize = 0.01, startPrice = 100, levels = 24, baseDepth = 60 } = {}) {
    this.tickSize = tickSize;
    this.levels = levels;
    this.baseDepth = baseDepth;
    this.bids = new Map();
    this.asks = new Map();
    this.lastTradePrice = startPrice;
    this._seedBook(startPrice);
  }

  _roundTick(px) {
    return Math.max(this.tickSize, Math.round(px / this.tickSize) * this.tickSize);
  }

  _seedBook(mid) {
    const midTick = this._roundTick(mid);
    for (let i = 1; i <= this.levels; i++) {
      const bidPx = this._roundTick(midTick - i * this.tickSize);
      const askPx = this._roundTick(midTick + i * this.tickSize);
      this.bids.set(bidPx, this.baseDepth * (1 + 0.04 * (this.levels - i)));
      this.asks.set(askPx, this.baseDepth * (1 + 0.04 * (this.levels - i)));
    }
  }

  _bestBid() {
    let best = -Infinity;
    for (const [px, qty] of this.bids) if (qty > 0 && px > best) best = px;
    return Number.isFinite(best) ? best : null;
  }

  _bestAsk() {
    let best = Infinity;
    for (const [px, qty] of this.asks) if (qty > 0 && px < best) best = px;
    return Number.isFinite(best) ? best : null;
  }

  getTopOfBook() {
    const bid = this._bestBid();
    const ask = this._bestAsk();
    if (bid == null || ask == null) {
      const px = this.lastTradePrice;
      return { bestBid: px - this.tickSize, bestAsk: px + this.tickSize, spread: this.tickSize * 2, mid: px };
    }
    return { bestBid: bid, bestAsk: ask, spread: ask - bid, mid: (ask + bid) / 2 };
  }

  _consumeLevel(sideMap, px, qty) {
    const avail = sideMap.get(px) || 0;
    if (avail <= 0) return { filled: 0, remaining: qty };
    const filled = Math.min(avail, qty);
    const left = avail - filled;
    if (left <= 1e-9) sideMap.delete(px); else sideMap.set(px, left);
    return { filled, remaining: qty - filled };
  }

  marketOrder(side, qty) {
    let remaining = qty;
    let notional = 0;
    let filled = 0;
    const trades = [];

    if (side === 'buy') {
      while (remaining > 1e-9) {
        const ask = this._bestAsk();
        if (ask == null) break;
        const r = this._consumeLevel(this.asks, ask, remaining);
        if (r.filled <= 0) break;
        remaining = r.remaining;
        filled += r.filled;
        notional += r.filled * ask;
        this.lastTradePrice = ask;
        trades.push({ price: ask, size: r.filled, side: 'buy' });
      }
    } else {
      while (remaining > 1e-9) {
        const bid = this._bestBid();
        if (bid == null) break;
        const r = this._consumeLevel(this.bids, bid, remaining);
        if (r.filled <= 0) break;
        remaining = r.remaining;
        filled += r.filled;
        notional += r.filled * bid;
        this.lastTradePrice = bid;
        trades.push({ price: bid, size: r.filled, side: 'sell' });
      }
    }

    return {
      filled,
      avgPrice: filled > 0 ? notional / filled : this.lastTradePrice,
      trades,
      unfilled: Math.max(0, remaining),
    };
  }

  limitOrder(side, price, qty) {
    const px = this._roundTick(price);
    if (qty <= 0) return { posted: 0 };

    if (side === 'buy') {
      const ask = this._bestAsk();
      if (ask != null && px >= ask) return this.marketOrder('buy', qty);
      this.bids.set(px, (this.bids.get(px) || 0) + qty);
    } else {
      const bid = this._bestBid();
      if (bid != null && px <= bid) return this.marketOrder('sell', qty);
      this.asks.set(px, (this.asks.get(px) || 0) + qty);
    }

    return { posted: qty, filled: 0, trades: [] };
  }

  addLiquidity(side, levels = 3, qtyPerLevel = 20) {
    const { bestBid, bestAsk } = this.getTopOfBook();
    for (let i = 1; i <= levels; i++) {
      if (side === 'bid') {
        const px = this._roundTick(bestBid - i * this.tickSize);
        this.bids.set(px, (this.bids.get(px) || 0) + qtyPerLevel / i);
      } else {
        const px = this._roundTick(bestAsk + i * this.tickSize);
        this.asks.set(px, (this.asks.get(px) || 0) + qtyPerLevel / i);
      }
    }
  }



  quoteAround(mid, levels = 4, qty = 45) {
    const c = this._roundTick(mid);
    for (let i = 1; i <= levels; i++) {
      const bid = this._roundTick(c - i * this.tickSize);
      const ask = this._roundTick(c + i * this.tickSize);
      this.bids.set(bid, (this.bids.get(bid) || 0) + qty / i);
      this.asks.set(ask, (this.asks.get(ask) || 0) + qty / i);
    }
  }
  tightenSpread(targetTicks = 2, qty = 50) {
    const top = this.getTopOfBook();
    const currentTicks = Math.max(1, Math.round(top.spread / this.tickSize));
    if (currentTicks <= targetTicks) return;

    const mid = this.lastTradePrice || top.mid;
    const half = Math.max(1, Math.floor(targetTicks / 2));
    const bid = this._roundTick(mid - half * this.tickSize);
    const ask = this._roundTick(mid + half * this.tickSize);
    this.bids.set(bid, (this.bids.get(bid) || 0) + qty);
    this.asks.set(ask, (this.asks.get(ask) || 0) + qty);
  }

  prune(referencePrice, keepLevels = 80) {
    const center = this._roundTick(referencePrice);
    const minBid = center - keepLevels * this.tickSize;
    const maxAsk = center + keepLevels * this.tickSize;

    for (const px of this.bids.keys()) if (px < minBid) this.bids.delete(px);
    for (const px of this.asks.keys()) if (px > maxAsk) this.asks.delete(px);
  }
  totalDepth(levels = 5) {
    const bidDepth = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, levels).reduce((s, [, q]) => s + q, 0);
    const askDepth = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, levels).reduce((s, [, q]) => s + q, 0);
    return { bidDepth, askDepth };
  }
}
