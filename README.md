## Backtest project

This repo is a **single-file browser backtesting engine** (`backtest_engine.html`) plus a strategy file (`arm_strategy_v2.js`).

### Run it

```bash
cd /home/js/backtest_project
python -m http.server 8000
```

Then open `http://localhost:8000/backtest_engine.html`.

### TODO:

[ ] - real trade simulation (order book implemented)
[ ] - separate paper trading, live strategy testing and monte carlo into different tabs.
[ ] - Change UI into more modern look and take in to account the new changes.
[ ] - Ability to visualize the monte carlo data better both raw data wise and visual representation wise. Add help texts to show if the results are good or bad.
[ ] - Ability to get real stock and crypto data to test with both in live strat and monte carlo.
[ ] - Ability to scramble real data price movements but start and end prices stay the same.
