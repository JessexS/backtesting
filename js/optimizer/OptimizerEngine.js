// ═══════════════════════════════════════════════════════════════
// OptimizerEngine — Parameter sweeps: grid search, genetic algo
// ═══════════════════════════════════════════════════════════════

import { MarketEngine } from '../market/MarketEngine.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { ExecutionEngine } from '../trading/ExecutionEngine.js';
import { StrategySandbox } from '../strategy/StrategySandbox.js';
import { PerformanceEngine } from '../performance/PerformanceEngine.js';

export class OptimizerEngine {
  constructor() {
    this._cancelled = false;
    this.lastResults = null;
  }

  cancel() { this._cancelled = true; }

  // Grid search: exhaustive sweep over parameter ranges
  async gridSearch(config, onProgress) {
    this._cancelled = false;
    const { paramRanges, marketParams, tradingSettings, strategyObject, candlesPerRun, objective } = config;

    // Generate all combinations
    const paramNames = Object.keys(paramRanges);
    const combinations = this._generateCombinations(paramRanges);
    const total = combinations.length;
    const results = [];
    const perf = new PerformanceEngine();

    for (let i = 0; i < total; i++) {
      if (this._cancelled) break;

      const params = combinations[i];
      const metrics = await this._runSingle(params, marketParams, tradingSettings, strategyObject, candlesPerRun, perf);
      metrics.params = params;
      results.push(metrics);

      if (i % 3 === 0 && onProgress) {
        onProgress(i + 1, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Sort by objective
    const objKey = objective || 'compositeScore';
    results.sort((a, b) => (b[objKey] || 0) - (a[objKey] || 0));

    this.lastResults = { results, paramNames, objective: objKey, total };
    return this.lastResults;
  }

  // Genetic algorithm optimizer
  async geneticOptimize(config, onProgress) {
    this._cancelled = false;
    const {
      paramRanges, marketParams, tradingSettings, strategyObject,
      candlesPerRun, objective,
      populationSize = 20, generations = 10, mutationRate = 0.2, eliteRatio = 0.2,
    } = config;

    const objKey = objective || 'compositeScore';
    const perf = new PerformanceEngine();
    const paramNames = Object.keys(paramRanges);
    let population = [];

    // Initialize random population
    for (let i = 0; i < populationSize; i++) {
      const params = {};
      for (const name of paramNames) {
        const range = paramRanges[name];
        params[name] = range.min + Math.random() * (range.max - range.min);
        if (range.step) params[name] = Math.round(params[name] / range.step) * range.step;
      }
      population.push(params);
    }

    const allResults = [];
    let bestResult = null;

    for (let gen = 0; gen < generations; gen++) {
      if (this._cancelled) break;

      // Evaluate fitness
      const evaluated = [];
      for (const params of population) {
        if (this._cancelled) break;
        const metrics = await this._runSingle(params, marketParams, tradingSettings, strategyObject, candlesPerRun, perf);
        metrics.params = { ...params };
        metrics.generation = gen;
        evaluated.push(metrics);
        allResults.push(metrics);
      }

      evaluated.sort((a, b) => (b[objKey] || 0) - (a[objKey] || 0));
      if (!bestResult || (evaluated[0][objKey] || 0) > (bestResult[objKey] || 0)) {
        bestResult = evaluated[0];
      }

      if (onProgress) {
        onProgress(gen + 1, generations, bestResult);
        await new Promise((r) => setTimeout(r, 0));
      }

      if (gen === generations - 1) break;

      // Selection + crossover + mutation
      const eliteCount = Math.max(1, Math.floor(populationSize * eliteRatio));
      const elites = evaluated.slice(0, eliteCount).map((e) => e.params);
      const newPop = [...elites];

      while (newPop.length < populationSize) {
        // Tournament selection
        const p1 = this._tournamentSelect(evaluated, objKey);
        const p2 = this._tournamentSelect(evaluated, objKey);
        // Crossover
        const child = {};
        for (const name of paramNames) {
          child[name] = Math.random() < 0.5 ? p1[name] : p2[name];
          // Mutation
          if (Math.random() < mutationRate) {
            const range = paramRanges[name];
            const delta = (range.max - range.min) * 0.1 * (Math.random() * 2 - 1);
            child[name] = Math.max(range.min, Math.min(range.max, child[name] + delta));
            if (range.step) child[name] = Math.round(child[name] / range.step) * range.step;
          }
        }
        newPop.push(child);
      }

      population = newPop;
    }

    allResults.sort((a, b) => (b[objKey] || 0) - (a[objKey] || 0));
    this.lastResults = { results: allResults, paramNames, objective: objKey, best: bestResult };
    return this.lastResults;
  }

  _tournamentSelect(evaluated, objKey, size = 3) {
    let best = null;
    for (let i = 0; i < size; i++) {
      const candidate = evaluated[Math.floor(Math.random() * evaluated.length)];
      if (!best || (candidate[objKey] || 0) > (best[objKey] || 0)) best = candidate;
    }
    return best.params;
  }

  async _runSingle(params, marketParams, tradingSettings, strategyObject, candlesPerRun, perf) {
    const me = new MarketEngine(marketParams);
    const ts = { ...tradingSettings };
    const te = new TradingEngine(ts);
    const ee = new ExecutionEngine(te);
    const sandbox = new StrategySandbox();

    if (strategyObject) {
      const clone = {};
      for (const key in strategyObject) {
        if (typeof strategyObject[key] === 'function') clone[key] = strategyObject[key].bind(strategyObject);
        else clone[key] = strategyObject[key];
      }
      clone._userParams = { ...params };
      sandbox.setStrategy(clone);
    }

    if (sandbox.isLoaded()) {
      sandbox.init({ equity: te.equity, balance: te.balance, params });
    }

    for (let i = 0; i < candlesPerRun; i++) {
      const c = me.tick();
      te.update(c);
      if (sandbox.isLoaded()) {
        const orders = sandbox.run({
          candle: c, candles: me.getHistory(),
          positions: te.positions, equity: te.equity,
          balance: te.balance, fees: te.totalFees,
        });
        ee.execute(orders, c);
      }
    }

    return perf.calculate(te.closedTrades, te.equityHistory, tradingSettings.balance, te.totalFees, te.exposedBars, te.totalBars);
  }

  _generateCombinations(paramRanges) {
    const names = Object.keys(paramRanges);
    const values = names.map((name) => {
      const r = paramRanges[name];
      const vals = [];
      const step = r.step || ((r.max - r.min) / (r.steps || 5));
      for (let v = r.min; v <= r.max + step * 0.01; v += step) {
        vals.push(Math.round(v * 10000) / 10000);
      }
      return vals;
    });

    // Cartesian product
    const combos = [];
    const recurse = (idx, current) => {
      if (idx === names.length) { combos.push({ ...current }); return; }
      for (const val of values[idx]) {
        current[names[idx]] = val;
        recurse(idx + 1, current);
      }
    };
    recurse(0, {});
    return combos;
  }

  // Generate heatmap data for two parameters
  generateHeatmap(results, paramX, paramY, metric) {
    if (!results || !results.length) return null;

    const xVals = [...new Set(results.map((r) => r.params[paramX]))].sort((a, b) => a - b);
    const yVals = [...new Set(results.map((r) => r.params[paramY]))].sort((a, b) => a - b);

    const grid = Array.from({ length: yVals.length }, () => Array(xVals.length).fill(null));

    for (const r of results) {
      const xi = xVals.indexOf(r.params[paramX]);
      const yi = yVals.indexOf(r.params[paramY]);
      if (xi >= 0 && yi >= 0) {
        grid[yi][xi] = r[metric] || 0;
      }
    }

    return { xVals, yVals, grid, paramX, paramY, metric };
  }

  exportCSV() {
    if (!this.lastResults) return '';
    const { results, paramNames } = this.lastResults;
    const header = [...paramNames, 'return', 'sharpe', 'maxDD', 'winRate', 'profitFactor', 'compositeScore'].join(',');
    const rows = results.map((r) =>
      [...paramNames.map((n) => r.params[n]),
        (r.totalReturn * 100).toFixed(2), r.sharpe.toFixed(3),
        (r.maxDrawdown * 100).toFixed(2), (r.winRate * 100).toFixed(1),
        r.profitFactor.toFixed(2), r.compositeScore.toFixed(4)].join(',')
    );
    return header + '\n' + rows.join('\n');
  }
}
