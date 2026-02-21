// ═══════════════════════════════════════════════════════════════
// WalkForwardEngine — Walk-forward analysis & cross-validation
// Splits data into in-sample (IS) and out-of-sample (OOS) windows
// ═══════════════════════════════════════════════════════════════

import { MarketEngine } from '../market/MarketEngine.js';
import { TradingEngine } from '../trading/TradingEngine.js';
import { ExecutionEngine } from '../trading/ExecutionEngine.js';
import { StrategySandbox } from '../strategy/StrategySandbox.js';
import { PerformanceEngine } from '../performance/PerformanceEngine.js';

export class WalkForwardEngine {
  constructor() {
    this._cancelled = false;
    this.lastResults = null;
  }

  cancel() { this._cancelled = true; }

  // Walk-forward analysis: rolling IS/OOS windows
  async run(config, onProgress) {
    this._cancelled = false;
    const {
      totalCandles = 2000,
      windowSize = 500,       // IS window size
      oosSize = 100,          // OOS window size
      stepSize = 100,         // step between windows
      marketParams,
      tradingSettings,
      strategyObject,
      strategyCode,
    } = config;

    // Generate full dataset first
    const me = new MarketEngine(marketParams);
    const fullHistory = [];
    for (let i = 0; i < totalCandles; i++) fullHistory.push(me.tick());

    const perf = new PerformanceEngine();
    const windows = [];
    let windowIdx = 0;

    for (let start = 0; start + windowSize + oosSize <= totalCandles; start += stepSize) {
      if (this._cancelled) break;

      const isStart = start;
      const isEnd = start + windowSize;
      const oosStart = isEnd;
      const oosEnd = Math.min(isEnd + oosSize, totalCandles);

      const isCandles = fullHistory.slice(isStart, isEnd);
      const oosCandles = fullHistory.slice(oosStart, oosEnd);

      // Run strategy on IS period
      const isMetrics = this._runOnCandles(isCandles, tradingSettings, strategyObject, strategyCode, perf);

      // Run strategy on OOS period
      const oosMetrics = this._runOnCandles(oosCandles, tradingSettings, strategyObject, strategyCode, perf);

      windows.push({
        windowIdx: windowIdx++,
        isStart, isEnd, oosStart, oosEnd,
        isMetrics,
        oosMetrics,
        isReturn: isMetrics.totalReturn,
        oosReturn: oosMetrics.totalReturn,
        isSharpe: isMetrics.sharpe,
        oosSharpe: oosMetrics.sharpe,
        isMaxDD: isMetrics.maxDrawdown,
        oosMaxDD: oosMetrics.maxDrawdown,
        walkForwardEfficiency: isMetrics.totalReturn !== 0
          ? oosMetrics.totalReturn / isMetrics.totalReturn
          : 0,
      });

      if (onProgress) {
        const totalWindows = Math.floor((totalCandles - windowSize - oosSize) / stepSize) + 1;
        onProgress(windowIdx, totalWindows);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Summary
    const summary = this._summarize(windows);
    this.lastResults = { windows, summary, config };
    return this.lastResults;
  }

  // K-Fold cross-validation
  async kFold(config, onProgress) {
    this._cancelled = false;
    const {
      totalCandles = 2000,
      folds = 5,
      marketParams,
      tradingSettings,
      strategyObject,
      strategyCode,
    } = config;

    const me = new MarketEngine(marketParams);
    const fullHistory = [];
    for (let i = 0; i < totalCandles; i++) fullHistory.push(me.tick());

    const perf = new PerformanceEngine();
    const foldSize = Math.floor(totalCandles / folds);
    const results = [];

    for (let fold = 0; fold < folds; fold++) {
      if (this._cancelled) break;

      const testStart = fold * foldSize;
      const testEnd = (fold + 1) * foldSize;
      const testCandles = fullHistory.slice(testStart, testEnd);

      // Train on all other folds
      const trainCandles = [...fullHistory.slice(0, testStart), ...fullHistory.slice(testEnd)];

      const trainMetrics = this._runOnCandles(trainCandles, tradingSettings, strategyObject, strategyCode, perf);
      const testMetrics = this._runOnCandles(testCandles, tradingSettings, strategyObject, strategyCode, perf);

      results.push({
        fold,
        trainMetrics,
        testMetrics,
        trainReturn: trainMetrics.totalReturn,
        testReturn: testMetrics.totalReturn,
        trainSharpe: trainMetrics.sharpe,
        testSharpe: testMetrics.sharpe,
      });

      if (onProgress) {
        onProgress(fold + 1, folds);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    this.lastResults = { folds: results, config };
    return this.lastResults;
  }

  _runOnCandles(candles, tradingSettings, strategyObject, strategyCode, perf) {
    const te = new TradingEngine({ ...tradingSettings });
    const ee = new ExecutionEngine(te);
    const sandbox = new StrategySandbox();

    if (strategyObject) {
      const clone = {};
      for (const key in strategyObject) {
        if (typeof strategyObject[key] === 'function') clone[key] = strategyObject[key].bind(strategyObject);
        else clone[key] = strategyObject[key];
      }
      sandbox.setStrategy(clone);
    } else if (strategyCode) {
      sandbox.loadFromCode(strategyCode);
    }

    if (sandbox.isLoaded()) {
      sandbox.init({ equity: te.equity, balance: te.balance });
    }

    const history = [];
    for (const c of candles) {
      history.push(c);
      te.update(c);
      if (sandbox.isLoaded()) {
        const orders = sandbox.run({
          candle: c, candles: history,
          positions: te.positions, equity: te.equity,
          balance: te.balance, fees: te.totalFees,
        });
        ee.execute(orders, c);
      }
    }

    return perf.calculate(te.closedTrades, te.equityHistory, tradingSettings.balance, te.totalFees, te.exposedBars, te.totalBars);
  }

  _summarize(windows) {
    if (windows.length === 0) return null;

    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;

    const oosReturns = windows.map((w) => w.oosReturn * 100);
    const oosSharp = windows.map((w) => w.oosSharpe);
    const wfEfficiency = windows.map((w) => w.walkForwardEfficiency);
    const oosPositive = oosReturns.filter((r) => r > 0).length;

    return {
      totalWindows: windows.length,
      avgOosReturn: avg(oosReturns),
      avgOosSharpe: avg(oosSharp),
      avgWalkForwardEfficiency: avg(wfEfficiency),
      oosPositiveRate: oosPositive / windows.length,
      avgIsReturn: avg(windows.map((w) => w.isReturn * 100)),
      avgIsSharpe: avg(windows.map((w) => w.isSharpe)),
      consistency: oosPositive / windows.length >= 0.6 ? 'Good' :
                   oosPositive / windows.length >= 0.4 ? 'Fair' : 'Poor',
    };
  }

  exportCSV() {
    if (!this.lastResults?.windows) return '';
    const header = 'window,isStart,isEnd,oosStart,oosEnd,isReturn%,oosReturn%,isSharpe,oosSharpe,isMaxDD%,oosMaxDD%,wfEfficiency';
    const rows = this.lastResults.windows.map((w) =>
      [w.windowIdx, w.isStart, w.isEnd, w.oosStart, w.oosEnd,
        (w.isReturn * 100).toFixed(2), (w.oosReturn * 100).toFixed(2),
        w.isSharpe.toFixed(3), w.oosSharpe.toFixed(3),
        (w.isMaxDD * 100).toFixed(2), (w.oosMaxDD * 100).toFixed(2),
        w.walkForwardEfficiency.toFixed(4)].join(',')
    );
    return header + '\n' + rows.join('\n');
  }
}
