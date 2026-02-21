## Backtest Project

A **modular browser-based backtesting engine** with synthetic market generation, strategy sandboxing, Monte Carlo simulation, parameter optimization, and more.

### Architecture

```
index.html                 — Main UI (tab-based sidebar layout)
css/styles.css             — Styles (dark theme, tabs, heatmaps, tutorials)
js/
  main.js                  — App bootstrap, tick loop, UI wiring
  market/MarketEngine.js   — Synthetic OHLCV candle generation (6 regimes)
  trading/TradingEngine.js — Position management, SL/TP/Trail, liquidation, market impact
  trading/ExecutionEngine.js — Strategy→TradingEngine order bridge
  strategy/StrategySandbox.js — Sandboxed strategy execution
  strategy/StrategyLoader.js  — Built-in strategy definitions
  performance/PerformanceEngine.js — Metrics (Sharpe, Sortino, VaR, CVaR, Omega, Calmar, Treynor)
  montecarlo/MonteCarloEngine.js   — Monte Carlo simulation (seed/scramble/stress)
  ui/UIEngine.js           — Canvas charts, heatmaps, MC histogram, trade breakdown
  chaos/ChaosEngine.js     — Chaos/stress scenario injection
  risk/RiskEngine.js       — Position sizing & risk management
  optimizer/OptimizerEngine.js     — Grid search & genetic algorithm optimizer
  walkforward/WalkForwardEngine.js — Walk-forward analysis & K-fold cross-validation
  data/DataEngine.js       — Real market data (Binance, CoinGecko) & data scrambling
  report/ReportEngine.js   — HTML backtest report generator
  storage/StorageEngine.js — IndexedDB persistence for backtest runs
  plugin/PluginEngine.js   — Custom indicator & extension plugin system
cli.js                     — CLI for automated testing / CI-CD
Dockerfile                 — Docker container for deployment
docker-compose.yml         — Docker Compose configuration
```

### Run it

**Browser (Web UI):**
```bash
python -m http.server 8000
```
Then open `http://localhost:8000`.

**CLI:**
```bash
node cli.js -s strategies/my_strategy.js -n 1000 --seed 42
node cli.js -s strategies/my_strategy.js -f json -o results.json
node cli.js -s strategies/my_strategy.js --mc-runs 100 --balance 50000
```

**Docker:**
```bash
docker-compose up --build
# or
docker build -t backtester . && docker run -p 8000:8000 backtester
```

### TODO:

- [x] Real trade simulation (order book implemented)
- [x] Separate paper trading, live strategy testing and monte carlo into different tabs
- [x] Change UI into more modern look and take into account the new changes
- [x] Ability to visualize the monte carlo data better both raw data wise and visual representation wise. Add help texts to show if the results are good or bad
- [x] Ability to get real stock and crypto data to test with both in live strat and monte carlo
- [x] Ability to scramble real data price movements but start and end prices stay the same
- [x] Parameter sweeps / optimizer (grid search, genetic algorithm, Bayesian optimization)
- [x] Cross-validation / walk-forward analysis
- [ ] Multi-symbol & multi-timeframe support
- [x] Risk metrics suite (VaR, CVaR, Omega, MAR, Calmar, Treynor)
- [x] Trade-by-trade breakdown (entry/exit price, slippage, PnL, duration)
- [x] Heatmaps & correlation analysis (parameter pair result heatmaps)
- [x] Equity curve decomposition (peaks, troughs + annotations)
- [x] Benchmark comparison (Buy & Hold, index comparison)
- [x] Report generator (PDF/HTML automatic backtest report)
- [x] Plugin system (custom indicators / user extensions)
- [x] Walk-through tutorials / onboarding UI help
- [ ] Multi-asset / portfolio support (ETF, stocks + crypto combo)
- [x] CLI + API usage for automated testing / CI-CD
- [x] Docker & cloud-ready backtester container
- [x] Persistent store & results database (timeseries + run metadata)
- [x] Realism improvements (market impact modeling, out-of-sample + walk-forward test)
