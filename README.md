## Backtest project

This repo is a **single-file browser backtesting engine** (`backtest_engine.html`) plus a strategy file (`arm_strategy_v2.js`).

### Run it

```bash
cd /home/js/backtest_project
python -m http.server 8000
```

Then open `http://localhost:8000/backtest_engine.html`.

### TODO:

- [ ] Real trade simulation (order book implemented)
- [ ] Separate paper trading, live strategy testing and monte carlo into different tabs
- [ ] Change UI into more modern look and take into account the new changes
- [ ] Ability to visualize the monte carlo data better both raw data wise and visual representation wise. Add help texts to show if the results are good or bad
- [ ] Ability to get real stock and crypto data to test with both in live strat and monte carlo
- [ ] Ability to scramble real data price movements but start and end prices stay the same
- [ ] Parameter sweeps / optimizer (grid search, genetic algorithm, Bayesian optimization)
- [ ] Cross-validation / walk-forward analysis
- [ ] Multi-symbol & multi-timeframe support
- [ ] Risk metrics suite (VaR, CVaR, Omega, MAR, Calmar, Treynor)
- [ ] Trade-by-trade breakdown (entry/exit price, slippage, PnL, duration)
- [ ] Heatmaps & correlation analysis (parameter pair result heatmaps)
- [ ] Equity curve decomposition (peaks, troughs + annotations)
- [ ] Benchmark comparison (Buy & Hold, index comparison)
- [ ] Report generator (PDF/HTML automatic backtest report)
- [ ] Plugin system (custom indicators / user extensions)
- [ ] Walk-through tutorials / onboarding UI help
- [ ] Multi-asset / portfolio support (ETF, stocks + crypto combo)
- [ ] CLI + API usage for automated testing / CI-CD
- [ ] Docker & cloud-ready backtester container
- [ ] Persistent store & results database (timeseries + run metadata)
- [ ] Realism improvements (market impact modeling, out-of-sample + walk-forward test)