import { IndicatorEngine } from './IndicatorEngine.js';
import { StrategyEngine } from './StrategyEngine.js';
import { runExecution } from './ExecutionEngineCore.js';

export function runBacktest({ candles, strategyDefinition, parameters = {}, executionModel = {} }) {
  const indicatorEngine = new IndicatorEngine();
  const strategyEngine = new StrategyEngine();

  const strategy = structuredClone(strategyDefinition);
  // parameter override e.g. fast.period
  for (const [path, value] of Object.entries(parameters)) {
    const parts = path.split('.');
    if (parts.length !== 2) continue;
    const [id, key] = parts;
    const ind = strategy.indicators.find((x) => x.id === id);
    if (ind) ind.params = { ...(ind.params || {}), [key]: value };
  }

  const series = indicatorEngine.compute(candles, strategy.indicators || []);
  const actionsByIndex = candles.map((_, i) => strategyEngine.evaluate(strategy, series, i));
  const exec = runExecution(candles, actionsByIndex, executionModel);

  return {
    ...exec,
    indicatorSeries: series,
    actionsByIndex,
    totalReturn: executionModel.startBalance ? (exec.finalBalance / executionModel.startBalance - 1) : 0,
  };
}
