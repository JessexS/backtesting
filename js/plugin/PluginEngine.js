// ═══════════════════════════════════════════════════════════════
// PluginEngine — Custom indicator & user extension system
// Supports registering indicators, signal generators, and hooks
// ═══════════════════════════════════════════════════════════════

export class PluginEngine {
  constructor() {
    this.indicators = new Map();
    this.signalGenerators = new Map();
    this.hooks = { beforeTick: [], afterTick: [], onTrade: [], onMetrics: [] };
    this._builtInIndicators();
  }

  // Register a custom indicator
  registerIndicator(name, config) {
    const indicator = {
      name,
      calc: config.calc,           // (candles, params) => number[]
      params: config.params || {},  // { period: 14, ... }
      overlay: config.overlay !== false, // draw on price chart
      color: config.color || '#fff',
      dash: config.dash || [],
      description: config.description || '',
    };
    this.indicators.set(name, indicator);
  }

  // Register a signal generator plugin
  registerSignalGenerator(name, config) {
    this.signalGenerators.set(name, {
      name,
      generate: config.generate, // (candles, indicators, params) => { signal: 'buy'|'sell'|null, strength: 0-1 }
      params: config.params || {},
      description: config.description || '',
    });
  }

  // Register hook
  registerHook(event, fn) {
    if (this.hooks[event]) {
      this.hooks[event].push(fn);
    }
  }

  // Run hooks
  runHooks(event, ctx) {
    for (const fn of (this.hooks[event] || [])) {
      try { fn(ctx); } catch (e) { console.warn(`Plugin hook error (${event}):`, e); }
    }
  }

  // Calculate an indicator
  calculate(name, candles, params = {}) {
    const indicator = this.indicators.get(name);
    if (!indicator) return null;
    const mergedParams = { ...indicator.params, ...params };
    return indicator.calc(candles, mergedParams);
  }

  // Get all indicator names
  getIndicatorNames() {
    return Array.from(this.indicators.keys());
  }

  // Get indicator config
  getIndicator(name) {
    return this.indicators.get(name);
  }

  // Get all signal generators
  getSignalGeneratorNames() {
    return Array.from(this.signalGenerators.keys());
  }

  // Load plugin from code string
  loadFromCode(code) {
    try {
      const fn = new Function('plugin', code);
      fn(this);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Built-in indicators library
  _builtInIndicators() {
    // SMA
    this.registerIndicator('SMA', {
      calc: (candles, params) => {
        const period = params.period || 20;
        const values = new Array(candles.length).fill(null);
        for (let i = period - 1; i < candles.length; i++) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
          values[i] = sum / period;
        }
        return values;
      },
      params: { period: 20 },
      color: '#45aaf2',
      description: 'Simple Moving Average',
    });

    // EMA
    this.registerIndicator('EMA', {
      calc: (candles, params) => {
        const period = params.period || 20;
        const k = 2 / (period + 1);
        const values = new Array(candles.length).fill(null);
        if (candles.length < period) return values;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += candles[i].close;
        values[period - 1] = sum / period;
        for (let i = period; i < candles.length; i++) {
          values[i] = candles[i].close * k + values[i - 1] * (1 - k);
        }
        return values;
      },
      params: { period: 20 },
      color: '#fed330',
      description: 'Exponential Moving Average',
    });

    // RSI
    this.registerIndicator('RSI', {
      calc: (candles, params) => {
        const period = params.period || 14;
        const values = new Array(candles.length).fill(null);
        if (candles.length < period + 1) return values;

        let avgGain = 0, avgLoss = 0;
        for (let i = 1; i <= period; i++) {
          const delta = candles[i].close - candles[i - 1].close;
          if (delta > 0) avgGain += delta;
          else avgLoss -= delta;
        }
        avgGain /= period;
        avgLoss /= period;
        values[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

        for (let i = period + 1; i < candles.length; i++) {
          const delta = candles[i].close - candles[i - 1].close;
          const gain = delta > 0 ? delta : 0;
          const loss = delta < 0 ? -delta : 0;
          avgGain = (avgGain * (period - 1) + gain) / period;
          avgLoss = (avgLoss * (period - 1) + loss) / period;
          values[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        }
        return values;
      },
      params: { period: 14 },
      overlay: false,
      color: '#a55eea',
      description: 'Relative Strength Index',
    });

    // ATR
    this.registerIndicator('ATR', {
      calc: (candles, params) => {
        const period = params.period || 14;
        const values = new Array(candles.length).fill(null);
        if (candles.length < period + 1) return values;

        const trs = [0];
        for (let i = 1; i < candles.length; i++) {
          const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - candles[i - 1].close),
            Math.abs(candles[i].low - candles[i - 1].close)
          );
          trs.push(tr);
        }

        let sum = 0;
        for (let i = 1; i <= period; i++) sum += trs[i];
        values[period] = sum / period;
        for (let i = period + 1; i < candles.length; i++) {
          values[i] = (values[i - 1] * (period - 1) + trs[i]) / period;
        }
        return values;
      },
      params: { period: 14 },
      overlay: false,
      color: '#fd9644',
      description: 'Average True Range',
    });

    // Bollinger Bands
    this.registerIndicator('BB_Upper', {
      calc: (candles, params) => {
        const period = params.period || 20;
        const mult = params.mult || 2;
        const values = new Array(candles.length).fill(null);
        for (let i = period - 1; i < candles.length; i++) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
          const mean = sum / period;
          let sq = 0;
          for (let j = i - period + 1; j <= i; j++) sq += (candles[j].close - mean) ** 2;
          values[i] = mean + mult * Math.sqrt(sq / period);
        }
        return values;
      },
      params: { period: 20, mult: 2 },
      color: 'rgba(69,170,242,0.4)',
      dash: [4, 4],
      description: 'Bollinger Band Upper',
    });

    this.registerIndicator('BB_Lower', {
      calc: (candles, params) => {
        const period = params.period || 20;
        const mult = params.mult || 2;
        const values = new Array(candles.length).fill(null);
        for (let i = period - 1; i < candles.length; i++) {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
          const mean = sum / period;
          let sq = 0;
          for (let j = i - period + 1; j <= i; j++) sq += (candles[j].close - mean) ** 2;
          values[i] = mean - mult * Math.sqrt(sq / period);
        }
        return values;
      },
      params: { period: 20, mult: 2 },
      color: 'rgba(69,170,242,0.4)',
      dash: [4, 4],
      description: 'Bollinger Band Lower',
    });

    // VWAP
    this.registerIndicator('VWAP', {
      calc: (candles) => {
        const values = new Array(candles.length).fill(null);
        let cumTP = 0, cumVol = 0;
        for (let i = 0; i < candles.length; i++) {
          const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
          cumTP += tp * candles[i].volume;
          cumVol += candles[i].volume;
          values[i] = cumVol > 0 ? cumTP / cumVol : tp;
        }
        return values;
      },
      color: '#26de81',
      dash: [6, 3],
      description: 'Volume Weighted Average Price',
    });

    // MACD (returns as an object with signal, histogram)
    this.registerIndicator('MACD', {
      calc: (candles, params) => {
        const fast = params.fast || 12;
        const slow = params.slow || 26;
        const signal = params.signal || 9;

        const ema = (data, period) => {
          const k = 2 / (period + 1);
          const result = [data[0]];
          for (let i = 1; i < data.length; i++) {
            result.push(data[i] * k + result[i - 1] * (1 - k));
          }
          return result;
        };

        const closes = candles.map((c) => c.close);
        const emaFast = ema(closes, fast);
        const emaSlow = ema(closes, slow);
        const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
        const signalLine = ema(macdLine, signal);

        return macdLine.map((v, i) => i >= slow ? v : null);
      },
      overlay: false,
      color: '#58a6ff',
      description: 'Moving Average Convergence Divergence',
    });
  }
}
