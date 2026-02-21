// ═══════════════════════════════════════════════════════════════
// MarketSimulator — Order-flow driven bid/ask market simulation
// ═══════════════════════════════════════════════════════════════

import { OrderBookEngine } from './OrderBookEngine.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIME_NAMES = ['bull', 'bear', 'sideways', 'swing', 'breakout', 'crash'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class MarketSimulator {
  constructor(params = {}) {
    this.rng = mulberry32(params.seed ?? 42);
    this.tickSize = params.tickSize ?? 0.01;
    this.barSeconds = params.barSeconds ?? 60;
    this.baseVol = (params.volatility ?? 2) / 100;
    this.bias = (params.bias ?? 0) / 100;
    this.switchPct = (params.switchPct ?? 5) / 100;

    this.lambdaBid = params.lambdaBid ?? 0.85; // events/sec
    this.lambdaAsk = params.lambdaAsk ?? 0.83;
    this.lambdaLiquidity = params.lambdaLiquidity ?? 0.18;

    this.sizeXm = params.sizeXm ?? 3;
    this.sizeAlpha = params.sizeAlpha ?? 1.55;
    this.sizeCap = params.sizeCap ?? 150;

    this.avgSpreadTicks = params.avgSpreadTicks ?? 2;
    this.priceImpact = params.priceImpact ?? 0.00009;

    this.book = new OrderBookEngine({
      tickSize: this.tickSize,
      startPrice: params.startPrice ?? 100,
      levels: params.bookLevels ?? 24,
      baseDepth: params.baseDepth ?? 60,
    });

    this.price = params.startPrice ?? 100;
    this.history = [];
    this.regimeCounts = Object.fromEntries(REGIME_NAMES.map((r) => [r, 0]));
    this.orderFlowEma = 0;
    this.sigma = Math.max(0.0005, this.baseVol * 0.65);
  }

  _randExp(rate) {
    const u = this.rng();
    return -Math.log(1 - u + 1e-12) / Math.max(rate, 1e-6);
  }

  _randPareto(xm, alpha) {
    const u = 1 - this.rng();
    return xm / Math.pow(u, 1 / alpha);
  }

  _orderSize() {
    return clamp(this._randPareto(this.sizeXm, this.sizeAlpha), 0.2, this.sizeCap);
  }

  _classifyRegime(imbalance, ret, spreadRel) {
    if (ret < -0.01 || imbalance < -0.35) return 'crash';
    if (ret > 0.008 || imbalance > 0.35) return 'breakout';
    if (Math.abs(imbalance) < 0.06 && spreadRel < 0.0015) return 'sideways';
    if (imbalance > 0.12) return 'bull';
    if (imbalance < -0.12) return 'bear';
    return 'swing';
  }

  _rebalanceSpread() {
    const top = this.book.getTopOfBook();
    const spreadTicks = Math.max(1, Math.round(top.spread / this.tickSize));
    const target = Math.max(1, this.avgSpreadTicks + Math.round(this.orderFlowEma * 1.5));
    if (spreadTicks < target) {
      this.book.addLiquidity('ask', 1, 4);
      this.book.addLiquidity('bid', 1, 4);
    }
  }

  _runBar() {
    let t = 0;
    const trades = [];
    let vol = 0;
    let buyVol = 0;
    let sellVol = 0;

    while (t < this.barSeconds) {
      const topSnap = this.book.getTopOfBook();
      if (topSnap.mid < this.price * 0.92 || topSnap.mid > this.price * 1.08) {
        this.book.quoteAround(this.price, 6, 70);
      }

      const totalLambda = this.lambdaBid + this.lambdaAsk + this.lambdaLiquidity;
      t += this._randExp(totalLambda);
      if (t >= this.barSeconds) break;

      const u = this.rng();
      const pbid = this.lambdaBid / totalLambda;
      const pask = this.lambdaAsk / totalLambda;

      if (u < pbid) {
        const sz = this._orderSize();
        const fill = this.book.marketOrder('buy', sz);
        if (fill.filled > 0) {
          trades.push(...fill.trades);
          vol += fill.filled;
          buyVol += fill.filled;
          this.orderFlowEma = 0.92 * this.orderFlowEma + 0.08 * (fill.filled / Math.max(1, sz));
          this.price += this.price * this.priceImpact * Math.sqrt(fill.filled);
          this.price = clamp(this.price, 1, (this.history.length ? this.history[0].open : this.price) * 8);
        }
      } else if (u < pbid + pask) {
        const sz = this._orderSize();
        const fill = this.book.marketOrder('sell', sz);
        if (fill.filled > 0) {
          trades.push(...fill.trades);
          vol += fill.filled;
          sellVol += fill.filled;
          this.orderFlowEma = 0.92 * this.orderFlowEma - 0.08 * (fill.filled / Math.max(1, sz));
          this.price -= this.price * this.priceImpact * Math.sqrt(fill.filled);
          this.price = clamp(this.price, 1, (this.history.length ? this.history[0].open : this.price) * 8);
        }
      } else {
        const side = this.rng() < 0.5 ? 'bid' : 'ask';
        this.book.addLiquidity(side, 2, 10 + this.rng() * 18);
      }

      this._rebalanceSpread();
      const dNow = this.book.totalDepth(3);
      if (dNow.bidDepth < 8) this.book.addLiquidity('bid', 3, 20);
      if (dNow.askDepth < 8) this.book.addLiquidity('ask', 3, 20);
    }

    this.book.prune(this.price, 90);
    this.book.tightenSpread(this.avgSpreadTicks + 2, 65);
    const top = this.book.getTopOfBook();
    const mid = top.mid;
    const open = this.history.length ? this.history[this.history.length - 1].close : mid;

    let high = open;
    let low = open;
    let close = mid;

    if (trades.length > 0) {
      for (const tr of trades) {
        high = Math.max(high, tr.price);
        low = Math.min(low, tr.price);
      }
      close = trades[trades.length - 1].price;
    } else {
      high = Math.max(open, mid);
      low = Math.min(open, mid);
      close = mid;
    }

    const depth = this.book.totalDepth(5);
    const imbalance = (buyVol - sellVol) / Math.max(1, buyVol + sellVol);
    const ret = (close - open) / Math.max(open, 1e-9);
    const spreadRel = top.spread / Math.max(mid, 1e-9);

    const targetSigma = Math.max(0.0003, this.baseVol * (0.55 + 0.8 * Math.abs(imbalance)));
    this.sigma = 0.9 * this.sigma + 0.1 * targetSigma;

    const regime = this._classifyRegime(imbalance + this.bias * 10, ret, spreadRel);
    this.regimeCounts[regime]++;

    // keep OHLC consistency with bid/ask context
    const qHi = Math.max(high, close, open, top.bestAsk);
    const qLo = Math.min(low, close, open, top.bestBid);

    const candle = {
      time: this.history.length,
      ts: this.history.length * this.barSeconds * 1000,
      open,
      high: qHi,
      low: Math.max(this.tickSize, qLo),
      close,
      volume: vol,
      regime,
      bestBid: top.bestBid,
      bestAsk: top.bestAsk,
      spread: top.spread,
      mid,
      bidDepth: depth.bidDepth,
      askDepth: depth.askDepth,
      imbalance,
    };

    this.history.push(candle);
    this.price = close;
    return candle;
  }

  next() { return this._runBar(); }
}
