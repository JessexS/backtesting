export class CandleAggregator {
  constructor(intervalMs = 60_000) {
    this.intervalMs = intervalMs;
    this.current = null;
    this.candles = [];
  }

  _slot(ts) {
    return Math.floor(ts / this.intervalMs);
  }

  pushTick(tick) {
    const slot = this._slot(tick.timestamp);
    if (!this.current || this.current.slot !== slot) {
      if (this.current) this.candles.push(this.current.candle);
      this.current = {
        slot,
        candle: {
          time: slot,
          ts: slot * this.intervalMs,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tick.size || 0,
          bestBid: tick.bestBid,
          bestAsk: tick.bestAsk,
          spread: tick.spread,
          mid: tick.mid,
        },
      };
      return this.current.candle;
    }

    const c = this.current.candle;
    c.high = Math.max(c.high, tick.price);
    c.low = Math.min(c.low, tick.price);
    c.close = tick.price;
    c.volume += tick.size || 0;
    c.bestBid = tick.bestBid;
    c.bestAsk = tick.bestAsk;
    c.spread = tick.spread;
    c.mid = tick.mid;
    return c;
  }

  closeCurrent() {
    if (!this.current) return null;
    this.candles.push(this.current.candle);
    const c = this.current.candle;
    this.current = null;
    return c;
  }

  getCandles(includeCurrent = true) {
    if (!includeCurrent || !this.current) return this.candles;
    return [...this.candles, this.current.candle];
  }
}
