import { generateParameterCombos } from '../core/ParameterSpace.js';
import { runBacktest } from '../core/BacktestEngine.js';

self.onmessage = (ev) => {
  const { candles, strategyDefinition, executionModel, parameterSpace } = ev.data;
  const combos = generateParameterCombos(parameterSpace);
  const results = [];
  for (let i = 0; i < combos.length; i++) {
    const parameters = combos[i];
    const r = runBacktest({ candles, strategyDefinition, parameters, executionModel });
    results.push({ parameters, totalReturn: r.totalReturn, finalBalance: r.finalBalance });
  }
  results.sort((a, b) => b.totalReturn - a.totalReturn);
  self.postMessage({ results, tested: combos.length });
};
