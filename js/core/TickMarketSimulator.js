import { OrderBookEngine } from '../market/OrderBookEngine.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class TickMarketSimulator {
  constructor(params = {}) {
    this.rng = mulberry32(params.seed ?? 42);
    this.tickSize = params.tickSize ?? 0.01;
    this.startPrice = params.startPrice ?? 100;
    this.price = this.startPrice;
    this.timeMs = params.startTs ?? 0;
    this.lambdaBid = params.lambdaBid ?? 0.9;
    this.lambdaAsk = params.lambdaAsk ?? 0.88;
    this.lambdaLiquidity = params.lambdaLiquidity ?? 0.2;
    this.priceImpact = params.priceImpact ?? 0.00008;
    this.sizeXm = params.sizeXm ?? 2.5;
    this.sizeAlpha = params.sizeAlpha ?? 1.5;
    this.sizeCap = params.sizeCap ?? 140;
    this.book = new OrderBookEngine({
      tickSize: this.tickSize,
      startPrice: this.startPrice,
      levels: params.bookLevels ?? 24,
      baseDepth: params.baseDepth ?? 60,
    });
  }

  _randExp(rate) {
    const u = this.rng();
    return -Math.log(1 - u + 1e-12) / Math.max(rate, 1e-9);
  }

  _orderSize() {
    const u = 1 - this.rng();
    return clamp(this.sizeXm / Math.pow(u, 1 / this.sizeAlpha), 0.1, this.sizeCap);
  }

  nextTick() {
    const totalLambda = this.lambdaBid + this.lambdaAsk + this.lambdaLiquidity;
    const dtSec = this._randExp(totalLambda);
    this.timeMs += dtSec * 1000;

    const u = this.rng();
    const pBid = this.lambdaBid / totalLambda;
    const pAsk = this.lambdaAsk / totalLambda;

    let side = 'buy';
    let filled = 0;
    let price = this.price;

    if (u < pBid) {
      const sz = this._orderSize();
      const fill = this.book.marketOrder('buy', sz);
      side = 'buy';
      filled = fill.filled;
      price = fill.trades.length ? fill.trades.at(-1).price : this.book.getTopOfBook().mid;
      this.price += this.price * this.priceImpact * Math.sqrt(Math.max(0, filled));
    } else if (u < pBid + pAsk) {
      const sz = this._orderSize();
      const fill = this.book.marketOrder('sell', sz);
      side = 'sell';
      filled = fill.filled;
      price = fill.trades.length ? fill.trades.at(-1).price : this.book.getTopOfBook().mid;
      this.price -= this.price * this.priceImpact * Math.sqrt(Math.max(0, filled));
    } else {
      this.book.addLiquidity(this.rng() < 0.5 ? 'bid' : 'ask', 2, 8 + this.rng() * 18);
    }

    this.book.prune(this.price, 90);
    this.book.tightenSpread(4, 45);
    const top = this.book.getTopOfBook();

    const tick = {
      timestamp: Math.round(this.timeMs),
      price: price || top.mid,
      size: filled || 0,
      side,
      bestBid: top.bestBid,
      bestAsk: top.bestAsk,
      mid: top.mid,
      spread: top.spread,
    };

    if (!Number.isFinite(tick.price) || tick.price <= 0) tick.price = clamp(top.mid, this.tickSize, this.startPrice * 10);
    return tick;
  }
}
