// ═══════════════════════════════════════════════════════════════
// MonteCarloEngine — Multi-mode Monte Carlo simulation engine
// Modes: seed, scramble, combined, stress
// Async execution with progress callbacks
// ═══════════════════════════════════════════════════════════════

import { MarketEngine } from '../market/MarketEngine.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { ExecutionEngine } from '../trading/ExecutionEngine.js';
import { StrategySandbox } from '../strategy/StrategySandbox.js';
import { PerformanceEngine } from '../performance/PerformanceEngine.js';
import { ChaosEngine } from './ChaosEngine.js';

export class MonteCarloEngine {
  constructor() {
    this._cancelled = false;
    this.lastResults = null;
    this.lastConfig = null;
  }

  cancel() { this._cancelled = true; }

  async run(config, onProgress) {
    this._cancelled = false;
    const {
      numRuns, candlesPerRun, marketParams, tradingSettings,
      strategyCode, strategyObject,
      mode, scrambleOptions, chaosPreset,
    } = config;

    this.lastConfig = config;
    const results = [];
    const perf = new PerformanceEngine();
    const chaos = new ChaosEngine(marketParams.seed + 99999);

    const BATCH = 5;
    const stressTypes = ['crash_burst', 'vol_cluster', 'liquidity_shock'];

    for (let run = 0; run < numRuns; run++) {
      if (this._cancelled) break;

      // Determine params for this run
      let mp = { ...marketParams };
      let ts = { ...tradingSettings };

      switch (mode) {
        case 'seed':
          mp.seed = marketParams.seed + run;
          break;

        case 'scramble':
          mp.seed = marketParams.seed + run;
          chaos.reseed(marketParams.seed + run + 77777);
          mp = chaos.scrambleMarketParams(mp, scrambleOptions);
          ts = chaos.scrambleTradingSettings(ts, scrambleOptions);
          break;

        case 'combined':
          mp.seed = marketParams.seed + run;
          chaos.reseed(marketParams.seed + run + 77777);
          mp = chaos.scrambleMarketParams(mp, scrambleOptions);
          ts = chaos.scrambleTradingSettings(ts, scrambleOptions);
          // Add stress on every 5th run
          if (run % 5 === 0) {
            const st = stressTypes[run % stressTypes.length];
            mp = chaos.stressParams(mp, st, run);
            ts = chaos.stressTradingSettings(ts, st);
          }
          break;

        case 'stress':
          mp.seed = marketParams.seed + run;
          const stressType = stressTypes[run % stressTypes.length];
          mp = chaos.stressParams(mp, stressType, run);
          ts = chaos.stressTradingSettings(ts, stressType);
          break;
      }

      // Run simulation
      const me = new MarketEngine(mp);
      const te = new TradingEngine(ts);
      const ee = new ExecutionEngine(te);
      let sandbox = null;

      if (strategyObject || strategyCode) {
        sandbox = new StrategySandbox();
        if (strategyObject) sandbox.setStrategy(strategyObject);
        else sandbox.loadFromCode(strategyCode);
      }

      if (sandbox?.isLoaded()) {
        sandbox.init({ equity: te.equity, balance: te.balance });
      }

      for (let i = 0; i < candlesPerRun; i++) {
        const c = me.tick();
        const liqs = te.update(c);

        if (sandbox?.isLoaded()) {
          if (liqs.length > 0) {
            sandbox.onLiquidation({
              candle: c, candles: me.getHistory(),
              positions: te.positions, equity: te.equity,
              balance: te.balance, fees: te.totalFees,
            });
          }
          const orders = sandbox.run({
            candle: c, candles: me.getHistory(),
            positions: te.positions, equity: te.equity,
            balance: te.balance, fees: te.totalFees,
          });
          ee.execute(orders, c);
        }
      }

      if (sandbox) sandbox.finish({ equity: te.equity, balance: te.balance });

      const metrics = perf.calculate(
        te.closedTrades, te.equityHistory,
        tradingSettings.balance, te.totalFees,
        te.exposedBars, te.totalBars
      );
      metrics.equityCurve = te.equityHistory;
      metrics.seed = mp.seed;

      // Risk of ruin
      metrics.riskOfRuin = perf.riskOfRuin(metrics.winRate, metrics.avgWin, metrics.avgLoss);

      results.push(metrics);

      // Yield to event loop every BATCH runs
      if (run % BATCH === 0 && onProgress) {
        onProgress(run + 1, numRuns);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Summary statistics
    const summary = this._summarize(results, perf);
    this.lastResults = { runs: results, summary, config };
    return this.lastResults;
  }

  _summarize(results, perf) {
    if (results.length === 0) return null;

    const extract = (key) => results.map((r) => r[key]);
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const std = (arr) => {
      const m = avg(arr);
      return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
    };

    const returns = extract('totalReturn').map((r) => r * 100);
    const sharpes = extract('sharpe');
    const dds = extract('maxDrawdown').map((d) => d * 100);
    const wrs = extract('winRate').map((w) => w * 100);
    const pfs = extract('profitFactor');
    const rors = extract('riskOfRuin');
    const scores = extract('compositeScore');
    const finals = extract('balance');

    const meanSharpe = avg(sharpes);
    const stdSharpe = std(sharpes);

    return {
      returns: { mean: avg(returns), median: perf.percentile(returns, 50), min: Math.min(...returns), max: Math.max(...returns), std: std(returns) },
      sharpe: { mean: meanSharpe, median: perf.percentile(sharpes, 50), min: Math.min(...sharpes), max: Math.max(...sharpes) },
      maxDD: { mean: avg(dds), median: perf.percentile(dds, 50), min: Math.min(...dds), max: Math.max(...dds) },
      winRate: { mean: avg(wrs), median: perf.percentile(wrs, 50), min: Math.min(...wrs), max: Math.max(...wrs) },
      profitFactor: { mean: avg(pfs), median: perf.percentile(pfs, 50), min: Math.min(...pfs), max: Math.max(...pfs) },
      riskOfRuin: { mean: avg(rors), max: Math.max(...rors) },
      finalEquity: { mean: avg(finals), median: perf.percentile(finals, 50), min: Math.min(...finals), max: Math.max(...finals) },
      score: { mean: avg(scores), median: perf.percentile(scores, 50), min: Math.min(...scores), max: Math.max(...scores) },
      stabilityScore: stdSharpe > 0 ? meanSharpe / stdSharpe : 0,
      tailLoss95: perf.percentile(returns, 5),
      positiveRate: returns.filter((r) => r > 0).length / returns.length,
      totalRuns: results.length,
    };
  }

  // Export to CSV
  exportCSV() {
    if (!this.lastResults) return '';
    const header = 'seed,return,sharpe,maxDD,winRate,profitFactor,riskOfRuin,finalEquity';
    const rows = this.lastResults.runs.map((r) =>
      [r.seed, (r.totalReturn * 100).toFixed(2), r.sharpe.toFixed(3),
       (r.maxDrawdown * 100).toFixed(2), (r.winRate * 100).toFixed(1),
       r.profitFactor.toFixed(2), r.riskOfRuin.toFixed(4),
       r.balance.toFixed(2)].join(',')
    );
    return header + '\n' + rows.join('\n');
  }

  // Export to JSON
  exportJSON() {
    if (!this.lastResults) return '{}';
    return JSON.stringify({
      config: {
        numRuns: this.lastConfig?.numRuns,
        candlesPerRun: this.lastConfig?.candlesPerRun,
        mode: this.lastConfig?.mode,
        scrambleOptions: this.lastConfig?.scrambleOptions,
        marketParams: this.lastConfig?.marketParams,
      },
      summary: this.lastResults.summary,
      runs: this.lastResults.runs.map((r) => ({
        seed: r.seed, totalReturn: r.totalReturn, sharpe: r.sharpe,
        maxDrawdown: r.maxDrawdown, winRate: r.winRate,
        profitFactor: r.profitFactor, riskOfRuin: r.riskOfRuin,
        balance: r.balance, compositeScore: r.compositeScore,
      })),
    }, null, 2);
  }
}
