// ═══════════════════════════════════════════════════════════════
// StrategySandbox — Safe execution wrapper for strategies
// No DOM, no window, no fetch. Catches all errors.
// ═══════════════════════════════════════════════════════════════

export class StrategySandbox {
  constructor() {
    this.strategy = null;
    this.error = null;
    this.indicators = {};
  }

  setStrategy(strategyObj) {
    this.error = null;
    this.strategy = strategyObj;
    this.indicators = {};
  }

  loadFromCode(code) {
    this.error = null;
    this.indicators = {};
    try {
      const forbidden = [
        'window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket',
        'eval', 'Function', 'import', 'require', 'localStorage',
        'sessionStorage', 'indexedDB', 'alert', 'confirm', 'prompt',
        'setTimeout', 'setInterval', 'globalThis', 'self',
      ];
      const prefix = forbidden.map((f) => `var ${f}=undefined;`).join('');
      const fn = new Function(
        prefix + '\n' + code +
        '\nreturn {' +
        'init:typeof init==="function"?init:undefined,' +
        'onCandle:typeof onCandle==="function"?onCandle:undefined,' +
        'onOrderFilled:typeof onOrderFilled==="function"?onOrderFilled:undefined,' +
        'onLiquidation:typeof onLiquidation==="function"?onLiquidation:undefined,' +
        'onFinish:typeof onFinish==="function"?onFinish:undefined' +
        '};'
      );
      this.strategy = fn();
      if (!this.strategy.onCandle) {
        throw new Error('onCandle() function is required');
      }
    } catch (e) {
      this.error = e.message;
      this.strategy = null;
    }
  }

  init(ctx) {
    this.indicators = {};
    if (!this.strategy?.init) return;
    try {
      const safeCtx = this._sanitize(ctx);
      // Pass user-configured params from the UI into the strategy
      if (this.strategy._userParams) safeCtx.params = this.strategy._userParams;
      this.strategy.init(safeCtx);
    }
    catch (e) { this.error = e.message; }
  }

  run(ctx) {
    if (!this.strategy?.onCandle) return [];
    try {
      const safeCtx = this._sanitize(ctx);
      safeCtx.indicators = this.indicators;
      const orders = this.strategy.onCandle(safeCtx);
      return Array.isArray(orders) ? orders : [];
    } catch (e) {
      this.error = 'Runtime: ' + e.message;
      return [];
    }
  }

  onOrderFilled(ctx) {
    if (!this.strategy?.onOrderFilled) return;
    try { this.strategy.onOrderFilled(this._sanitize(ctx)); }
    catch (e) { this.error = e.message; }
  }

  onLiquidation(ctx) {
    if (!this.strategy?.onLiquidation) return;
    try { this.strategy.onLiquidation(this._sanitize(ctx)); }
    catch (e) { this.error = e.message; }
  }

  finish(ctx) {
    if (!this.strategy?.onFinish) return;
    try { this.strategy.onFinish(this._sanitize(ctx)); }
    catch (e) { /* ignore finish errors */ }
  }

  clearError() { this.error = null; }

  isLoaded() { return this.strategy !== null && this.strategy.onCandle !== undefined; }

  _sanitize(ctx) {
    return {
      candle: ctx.candle,
      candles: ctx.candles,
      positions: ctx.positions ? ctx.positions.map((p) => ({ ...p })) : [],
      equity: ctx.equity,
      balance: ctx.balance,
      fees: ctx.fees || 0,
      orders: [],
      utils: { Math },
      indicators: this.indicators,
    };
  }
}
