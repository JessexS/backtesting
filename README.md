## Backtest project

This repo is a **single-file browser backtesting engine** (`backtest_engine.html`) plus a strategy file (`arm_strategy_v2.js`).

### Run it

- **Option A (recommended)**: serve the folder and open in a browser

```bash
cd /home/js/backtest_project
python -m http.server 8000
```

Then open `http://localhost:8000/backtest_engine.html`.

- **Option B**: open the HTML file directly

Open `backtest_engine.html` in your browser (the strategy is bundled via a local `<script src="./arm_strategy_v2.js">`).

### Strategy loading

- On page load the UI will **auto-load ARM v2** from `arm_strategy_v2.js`.
- In the Trading Panel you can also click **“Load ARM v2”** (bundled) or paste/edit code and click **“Load Strategy”**.

