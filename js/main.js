// ═══════════════════════════════════════════════════════════════
// main.js — Application entry point, event wiring, main loop
// ═══════════════════════════════════════════════════════════════

import { MarketEngine } from './market/MarketEngine.js';
import { TradingEngine } from './trading/TradingEngine.js';
import { ExecutionEngine } from './trading/ExecutionEngine.js';
import { RiskEngine } from './trading/RiskEngine.js';
import { StrategyLoader } from './strategy/StrategyLoader.js';
import { StrategySandbox } from './strategy/StrategySandbox.js';
import { PerformanceEngine } from './performance/PerformanceEngine.js';
import { MonteCarloEngine } from './montecarlo/MonteCarloEngine.js';
import { ChaosEngine } from './montecarlo/ChaosEngine.js';
import { UIEngine } from './ui/UIEngine.js';
import { OptimizerEngine } from './optimizer/OptimizerEngine.js';
import { WalkForwardEngine } from './walkforward/WalkForwardEngine.js';
import { DataEngine } from './data/DataEngine.js';
import { ReportEngine } from './report/ReportEngine.js';
import { StorageEngine } from './storage/StorageEngine.js';
import { PluginEngine } from './plugin/PluginEngine.js';

// ─── App State ───

const APP = {
  market: null,
  trading: null,
  execution: null,
  risk: new RiskEngine(),
  sandbox: null,
  performance: new PerformanceEngine(),
  mc: new MonteCarloEngine(),
  ui: new UIEngine(),
  loader: new StrategyLoader(),
  optimizer: new OptimizerEngine(),
  walkForward: new WalkForwardEngine(),
  dataEngine: new DataEngine(),
  reportEngine: new ReportEngine(),
  storage: new StorageEngine(),
  pluginEngine: new PluginEngine(),
  running: false,
  paused: false,
  timer: null,
  speed: 800,
  strategyEnabled: false,
  lastTradeIdx: 0,
  realDataCandles: null,  // For real data mode
  realDataIdx: 0,
};

// ─── Helpers ───

function getMarketParams() {
  return {
    seed: +document.getElementById('rSd').value,
    startPrice: +document.getElementById('rS').value,
    volatility: +document.getElementById('rV').value,
    bias: +document.getElementById('rB').value,
    switchPct: +document.getElementById('rSw').value,
  };
}

function getTradingSettings() {
  return {
    mode: document.getElementById('tMode').value,
    leverage: +document.getElementById('tLev').value,
    makerFee: +document.getElementById('tMakerFee').value,
    takerFee: +document.getElementById('tTakerFee').value,
    slippage: +document.getElementById('tSlippage').value,
    maintRate: +document.getElementById('tMaintRate').value,
    balance: +document.getElementById('tBalance').value,
    sizeMode: document.getElementById('tSizeMode').value,
    sizeVal: +document.getElementById('tSizeVal').value,
    sl: +document.getElementById('tSL').value,
    tp: +document.getElementById('tTP').value,
    trail: +document.getElementById('tTrail').value,
    partialFill: +document.getElementById('tPartialFill').value,
    marketImpact: document.getElementById('tMarketImpact').checked,
  };
}

function getScrambleOptions() {
  return {
    mode: document.getElementById('mcScrambleMode').value,
    intensity: +document.getElementById('mcIntensity').value,
    scrambles: {
      volatility: document.getElementById('mcScrVol').checked,
      drift: document.getElementById('mcScrDrift').checked,
      regime: document.getElementById('mcScrRegime').checked,
      fee: document.getElementById('mcScrFee').checked,
      slippage: document.getElementById('mcScrSlip').checked,
      spread: document.getElementById('mcScrSpread').checked,
      maintMargin: document.getElementById('mcScrMaint').checked,
      leverage: document.getElementById('mcScrLev').checked,
      sizeMultiplier: document.getElementById('mcScrSize').checked,
    },
  };
}


// ─── Strategy Loading ───

function readStrategyParams(strat) {
  if (!strat?.params) return {};
  const result = {};
  for (const fields of Object.values(strat.params)) {
    for (const [key, def] of Object.entries(fields)) {
      const el = document.getElementById('sp_' + key);
      if (el) {
        if (def.type === 'select') result[key] = el.value === '1';
        else result[key] = +el.value;
      } else {
        if (def.type === 'select') result[key] = String(def.default) === '1';
        else result[key] = def.default;
      }
    }
  }
  return result;
}

function loadCurrentStrategy() {
  if (!APP.sandbox) APP.sandbox = new StrategySandbox();
  APP.sandbox.clearError();
  APP.ui.showStratError('');

  const sel = document.getElementById('tStratSelect').value;

  if (sel === 'custom') {
    const code = document.getElementById('tStratCode').value;
    if (!code.trim()) return;
    APP.sandbox.loadFromCode(code);
  } else {
    const strat = APP.loader.getStrategyByFileName(sel);
    if (strat) {
      const userParams = readStrategyParams(strat);
      const clone = {};
      for (const key in strat) {
        if (typeof strat[key] === 'function') clone[key] = strat[key].bind(strat);
        else clone[key] = strat[key];
      }
      clone._userParams = userParams;
      APP.sandbox.setStrategy(clone);
    } else {
      APP.ui.showStratError('Strategy not found: ' + sel);
      return;
    }
  }

  if (APP.sandbox.error) {
    APP.ui.showStratError(APP.sandbox.error);
  } else if (APP.sandbox.isLoaded()) {
    APP.ui.showStratError('OK: Strategy loaded');
    setTimeout(() => APP.ui.showStratError(''), 2000);
    // Enable optimizer if strategy has params
    updateOptimizerUI();
  }
}

function onStrategySelect() {
  const sel = document.getElementById('tStratSelect').value;
  const textarea = document.getElementById('tStratCode');
  const paramsContainer = document.getElementById('stratParamsContainer');

  paramsContainer.innerHTML = '';

  if (sel === 'custom') {
    textarea.value = '';
    textarea.disabled = false;
  } else {
    const strat = APP.loader.getStrategyByFileName(sel);
    textarea.value = strat ? `// ${strat.name}\n// Select "Load Strategy" to activate` : '';
    textarea.disabled = true;

    if (strat?.params) {
      let html = '<div class="strat-settings">';
      for (const [section, fields] of Object.entries(strat.params)) {
        html += `<div class="section-label">${section}</div>`;
        html += '<div class="input-row">';
        for (const [key, def] of Object.entries(fields)) {
          html += `<div class="input-group"><label>${def.label || key}</label>`;
          if (def.type === 'select') {
            html += `<select id="sp_${key}">`;
            for (const [val, label] of Object.entries(def.options)) {
              html += `<option value="${val}" ${val === String(def.default) ? 'selected' : ''}>${label}</option>`;
            }
            html += '</select>';
          } else {
            html += `<input type="number" id="sp_${key}" value="${def.default}" min="${def.min ?? ''}" max="${def.max ?? ''}" step="${def.step ?? 1}">`;
          }
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
      paramsContainer.innerHTML = html;
    }
  }
  updateOptimizerUI();
}

// ─── Optimizer UI ───

function updateOptimizerUI() {
  const sel = document.getElementById('tStratSelect').value;
  const strat = sel !== 'custom' ? APP.loader.getStrategyByFileName(sel) : null;
  const container = document.getElementById('optParamRanges');
  const btn = document.getElementById('btnOptimize');

  if (!strat?.params) {
    container.innerHTML = '<span style="color:var(--muted);font-size:10px">Load a strategy with params to configure ranges</span>';
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  let html = '';
  for (const [section, fields] of Object.entries(strat.params)) {
    for (const [key, def] of Object.entries(fields)) {
      if (def.type === 'select') continue;
      const min = def.min ?? 0;
      const max = def.max ?? (def.default * 3);
      const step = def.step ?? 1;
      html += `<div class="input-row" style="margin-bottom:4px">
        <div class="input-group" style="margin-bottom:2px"><label style="font-size:8px">${def.label || key} min</label><input type="number" class="opt-range" data-key="${key}" data-type="min" value="${min}" step="${step}"></div>
        <div class="input-group" style="margin-bottom:2px"><label style="font-size:8px">${def.label || key} max</label><input type="number" class="opt-range" data-key="${key}" data-type="max" value="${max}" step="${step}"></div>
      </div>`;
    }
  }
  container.innerHTML = html;
}

function getParamRanges() {
  const ranges = {};
  document.querySelectorAll('.opt-range').forEach((el) => {
    const key = el.dataset.key;
    const type = el.dataset.type;
    if (!ranges[key]) ranges[key] = {};
    ranges[key][type] = +el.value;
  });

  // Add step info from strategy params
  const sel = document.getElementById('tStratSelect').value;
  const strat = sel !== 'custom' ? APP.loader.getStrategyByFileName(sel) : null;
  if (strat?.params) {
    for (const fields of Object.values(strat.params)) {
      for (const [key, def] of Object.entries(fields)) {
        if (ranges[key]) {
          ranges[key].step = def.step ?? 1;
          ranges[key].steps = 5; // Default grid steps
        }
      }
    }
  }

  return ranges;
}

// ─── Main Tick ───

function tick() {
  if (!APP.running || APP.paused) return;

  let c, history;

  if (APP.realDataCandles && APP.realDataIdx < APP.realDataCandles.length) {
    // Real data mode: replay candles
    c = APP.realDataCandles[APP.realDataIdx++];
    history = APP.realDataCandles.slice(0, APP.realDataIdx);

    if (APP.realDataIdx >= APP.realDataCandles.length) {
      const liqs = APP.trading.update(c);
      updateUI(history);
      stopLive();
      return;
    }
  } else if (APP.market) {
    // Synthetic mode
    c = APP.market.tick();
    history = APP.market.getHistory();
  } else {
    return;
  }

  const liqs = APP.trading.update(c);

  // Strategy execution
  if (APP.strategyEnabled && APP.sandbox?.isLoaded()) {
    if (liqs.length > 0) {
      APP.sandbox.onLiquidation({
        candle: c, candles: history, positions: APP.trading.positions,
        equity: APP.trading.equity, balance: APP.trading.balance, fees: APP.trading.totalFees,
      });
    }

    const orders = APP.sandbox.run({
      candle: c, candles: history, positions: APP.trading.positions,
      equity: APP.trading.equity, balance: APP.trading.balance, fees: APP.trading.totalFees,
    });

    if (orders.length > 0) {
      APP.execution.execute(orders, c);
      for (const o of orders) {
        if (!o.close) APP.ui.chart.addMarker(c.time, o.side === 'buy' ? 'buy' : 'sell', c.close);
      }
    }

    if (APP.sandbox.error) APP.ui.showStratError(APP.sandbox.error);
  }

  // Trade markers
  const trades = APP.trading.closedTrades;
  APP.ui.addTradeMarkers(APP.ui.chart, trades, APP.lastTradeIdx);
  APP.lastTradeIdx = trades.length;

  updateUI(history);
}

function updateUI(history) {
  if (!APP.trading) return;
  const n = history.length;
  if (!n) return;
  const c = history[n - 1];

  APP.ui.updateTopbar(history, APP.trading);
  if (APP.market) {
    APP.ui.updateLeftSidebar(history, APP.market.getRegimeCounts());
  } else {
    // Real data — no regime counts
    APP.ui.updateLeftSidebar(history, {});
  }
  APP.ui.updateDrawdown(APP.trading.equityHistory);

  if (n % 3 === 0 || n < 10) APP.ui.updateTimeline(history);

  const metrics = APP.performance.calculate(
    APP.trading.closedTrades, APP.trading.equityHistory,
    getTradingSettings().balance, APP.trading.totalFees,
    APP.trading.exposedBars, APP.trading.totalBars,
  );
  APP.ui.updatePerformance(metrics, APP.trading);
  APP.ui.updatePositions(APP.trading.positions, closePosition);
  APP.ui.updateTradeLog(APP.trading.closedTrades);
  APP.ui.updateChart(history, APP.sandbox?.indicators);

  // Benchmark comparison
  if (n > 10) {
    const bm = APP.performance.calculateBuyAndHold(history, getTradingSettings().balance);
    APP.ui.updateBenchmark(metrics, bm);
  }

  APP.ui.flash(c.close >= c.open);

  if (APP.strategyEnabled && APP.trading.equityHistory.length > 1) {
    APP.ui.showEquityArea(true);
    APP.ui.updateEquityChart(APP.trading.equityHistory);
  }
}

// ─── Controls ───

function startLive() {
  if (APP.running && APP.paused) {
    APP.paused = false;
    APP.timer = setInterval(tick, APP.speed);
    APP.ui.setRunningState('running');
    return;
  }

  const ts = getTradingSettings();
  APP.trading = new TradingEngine(ts);
  APP.execution = new ExecutionEngine(APP.trading);
  APP.sandbox = new StrategySandbox();
  APP.lastTradeIdx = 0;
  APP.realDataIdx = 0;

  const dataSource = document.getElementById('dataSource').value;
  if (dataSource !== 'synthetic' && APP.realDataCandles) {
    // Real data mode
    APP.market = null;
  } else {
    // Synthetic mode
    const mp = getMarketParams();
    APP.market = new MarketEngine(mp);
    APP.realDataCandles = null;
  }

  if (APP.strategyEnabled) {
    loadCurrentStrategy();
    if (APP.sandbox.isLoaded()) {
      APP.sandbox.init({ equity: APP.trading.equity, balance: APP.trading.balance });
    }
  }

  APP.ui.initCharts();
  APP.running = true;
  APP.paused = false;
  APP.ui.setRunningState('running');
  APP.ui.showEquityArea(APP.strategyEnabled);
  APP.timer = setInterval(tick, APP.speed);
}

function pauseLive() {
  if (!APP.running) return;
  APP.paused = true;
  clearInterval(APP.timer);
  APP.ui.setRunningState('paused');
}

function stopLive() {
  if (!APP.running) return;
  APP.running = false;
  APP.paused = false;
  clearInterval(APP.timer);
  APP.ui.setRunningState('stopped');
  if (APP.sandbox) APP.sandbox.finish({ equity: APP.trading.equity, balance: APP.trading.balance });

  // Enable save button
  document.getElementById('btnSaveRun').disabled = false;
}

function resetAll() {
  stopLive();
  APP.market = null;
  APP.trading = null;
  APP.realDataCandles = null;
  APP.realDataIdx = 0;
  APP.ui.reset();
  APP.ui.setRunningState('idle');
  document.getElementById('btnSaveRun').disabled = true;
}

function closePosition(id) {
  if (!APP.trading) return;
  const pos = APP.trading.positions.find((p) => p.id === id);
  if (!pos) return;
  const history = APP.market ? APP.market.getHistory() : APP.realDataCandles.slice(0, APP.realDataIdx);
  APP.execution.execute(
    [{ close: true, positionId: id, side: pos.direction === 'long' ? 'sell' : 'buy' }],
    history[history.length - 1],
  );
}

function manualBuy() {
  if (APP.strategyEnabled || !APP.running) return;
  const history = APP.market ? APP.market.getHistory() : APP.realDataCandles?.slice(0, APP.realDataIdx);
  if (!history?.length) return;
  APP.execution.execute([{ side: 'buy', type: 'market' }], history[history.length - 1]);
}

function manualSell() {
  if (APP.strategyEnabled || !APP.running) return;
  const history = APP.market ? APP.market.getHistory() : APP.realDataCandles?.slice(0, APP.realDataIdx);
  if (!history?.length) return;
  APP.execution.execute([{ side: 'sell', type: 'market' }], history[history.length - 1]);
}

// ─── Monte Carlo ───

async function runMonteCarlo() {
  const btn = document.getElementById('btnMC');
  btn.disabled = true;
  btn.textContent = 'Running...';

  const ts = getTradingSettings();
  const mp = getMarketParams();
  const mcMode = document.getElementById('mcMode').value;

  let stratCode = null;
  let stratObj = null;

  if (APP.strategyEnabled) {
    const sel = document.getElementById('tStratSelect').value;
    if (sel === 'custom') {
      stratCode = document.getElementById('tStratCode').value;
    } else {
      stratObj = APP.loader.getStrategyByFileName(sel);
    }
  }

  const config = {
    numRuns: +document.getElementById('mcRuns').value,
    candlesPerRun: +document.getElementById('mcCandles').value,
    marketParams: mp,
    tradingSettings: ts,
    strategyCode: stratCode,
    strategyObject: stratObj,
    mode: mcMode,
    scrambleOptions: getScrambleOptions(),
  };

  try {
    const result = await APP.mc.run(config, (current, total) => {
      APP.ui.setMCProgress(current, total);
    });

    APP.ui.renderMCResults(result.summary, result.runs);
    APP.ui.setMCProgress(0, 0);

    if (document.getElementById('mcOverlay').checked && result.runs.length > 0) {
      APP.ui.showEquityArea(true);
      if (!APP.ui.eqChart) APP.ui.initCharts();
      const curves = result.runs.map((r) => r.equityCurve);
      const best = result.runs.reduce((a, b) => a.totalReturn > b.totalReturn ? a : b);
      APP.ui.updateEquityChart(best.equityCurve, curves);
    }
  } catch (e) {
    document.getElementById('mcResults').innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = '\u25B6 RUN MONTE CARLO';
}

// ─── Real Data ───

async function fetchRealData() {
  const source = document.getElementById('dataSource').value;
  const statusEl = document.getElementById('dataStatus');
  statusEl.textContent = 'Fetching...';

  try {
    let candles;
    if (source === 'binance') {
      const symbol = document.getElementById('dataSymbol').value;
      const interval = document.getElementById('dataInterval').value;
      const limit = +document.getElementById('dataLimit').value;
      candles = await APP.dataEngine.fetchBinanceOHLCV(symbol, interval, limit);
      document.getElementById('pairBadge').textContent = symbol;
    } else if (source === 'coingecko') {
      const coin = document.getElementById('dataCoin').value;
      const days = +document.getElementById('dataDays').value;
      candles = await APP.dataEngine.fetchCryptoOHLCV(coin, 'usd', days);
      document.getElementById('pairBadge').textContent = coin.toUpperCase() + '/USD';
    }

    APP.realDataCandles = candles;
    statusEl.textContent = `Loaded ${candles.length} candles`;
    statusEl.style.color = 'var(--green)';
    document.getElementById('btnScramble').disabled = false;
  } catch (e) {
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = 'var(--red)';
  }
}

function scrambleData() {
  if (!APP.realDataCandles) return;
  const seed = +document.getElementById('scrambleSeed').value;
  APP.realDataCandles = APP.dataEngine.scrambleData(APP.realDataCandles, seed);
  document.getElementById('dataStatus').textContent = `Data scrambled (seed: ${seed})`;
}

// ─── Optimizer ───

async function runOptimizer() {
  const btn = document.getElementById('btnOptimize');
  btn.disabled = true;
  btn.textContent = 'Running...';

  const mode = document.getElementById('optMode').value;
  const sel = document.getElementById('tStratSelect').value;
  const stratObj = sel !== 'custom' ? APP.loader.getStrategyByFileName(sel) : null;

  if (!stratObj) {
    document.getElementById('optResults').innerHTML = '<span style="color:var(--red)">Load a strategy first</span>';
    btn.disabled = false;
    btn.textContent = 'Run Optimizer';
    return;
  }

  const config = {
    paramRanges: getParamRanges(),
    marketParams: getMarketParams(),
    tradingSettings: getTradingSettings(),
    strategyObject: stratObj,
    candlesPerRun: +document.getElementById('optCandles').value,
    objective: document.getElementById('optObjective').value,
  };

  try {
    let result;
    if (mode === 'grid') {
      result = await APP.optimizer.gridSearch(config, (current, total) => {
        document.getElementById('optProgress').style.display = '';
        document.getElementById('optProgressFill').style.width = (current / total * 100) + '%';
        document.getElementById('optProgressText').textContent = `${current}/${total}`;
      });
    } else {
      config.populationSize = +document.getElementById('optPopulation').value;
      config.generations = +document.getElementById('optGenerations').value;
      config.mutationRate = +document.getElementById('optMutation').value;
      result = await APP.optimizer.geneticOptimize(config, (gen, total, best) => {
        document.getElementById('optProgress').style.display = '';
        document.getElementById('optProgressFill').style.width = (gen / total * 100) + '%';
        document.getElementById('optProgressText').textContent = `Gen ${gen}/${total} | Best: ${(best?.compositeScore || 0).toFixed(4)}`;
      });
    }

    // Display results
    const top5 = result.results.slice(0, 5);
    let html = '<div style="font-size:10px"><div class="section-label">Top Results</div>';
    for (const r of top5) {
      html += `<div style="background:var(--bg);border:1px solid var(--border);padding:6px;margin-bottom:4px">`;
      for (const [k, v] of Object.entries(r.params)) {
        html += `<span style="color:var(--blue)">${k}:</span> ${typeof v === 'number' ? v.toFixed(2) : v} `;
      }
      html += `<br><span style="color:var(--muted)">Return: ${(r.totalReturn * 100).toFixed(2)}% | Sharpe: ${r.sharpe.toFixed(3)} | Score: ${r.compositeScore.toFixed(4)}</span></div>`;
    }
    html += '</div>';
    document.getElementById('optResults').innerHTML = html;
    document.getElementById('optProgress').style.display = 'none';

    // Show heatmap if grid search with 2+ params
    if (mode === 'grid' && result.paramNames.length >= 2) {
      const heatmap = APP.optimizer.generateHeatmap(result.results, result.paramNames[0], result.paramNames[1], result.objective);
      if (heatmap) APP.ui.drawHeatmap(heatmap);
    }
  } catch (e) {
    document.getElementById('optResults').innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = 'Run Optimizer';
}

// ─── Walk-Forward ───

async function runWalkForward() {
  const btn = document.getElementById('btnWalkForward');
  btn.disabled = true;
  btn.textContent = 'Running...';

  const sel = document.getElementById('tStratSelect').value;
  let stratObj = null;
  let stratCode = null;

  if (sel === 'custom') {
    stratCode = document.getElementById('tStratCode').value;
  } else {
    stratObj = APP.loader.getStrategyByFileName(sel);
  }

  const config = {
    totalCandles: +document.getElementById('wfCandles').value,
    windowSize: +document.getElementById('wfWindow').value,
    oosSize: +document.getElementById('wfOos').value,
    stepSize: +document.getElementById('wfStep').value,
    marketParams: getMarketParams(),
    tradingSettings: getTradingSettings(),
    strategyObject: stratObj,
    strategyCode: stratCode,
  };

  try {
    const result = await APP.walkForward.run(config, (current, total) => {
      document.getElementById('wfProgress').style.display = '';
      document.getElementById('wfProgressFill').style.width = (current / total * 100) + '%';
      document.getElementById('wfProgressText').textContent = `${current}/${total} windows`;
    });

    APP.ui.renderWalkForwardResults(result);
    document.getElementById('wfProgress').style.display = 'none';
  } catch (e) {
    document.getElementById('wfResults').innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
  }

  btn.disabled = false;
  btn.textContent = 'Run Walk-Forward';
}

// ─── Report Generation ───

function generateReport() {
  if (!APP.trading) return;

  const history = APP.market ? APP.market.getHistory() : APP.realDataCandles?.slice(0, APP.realDataIdx);
  const metrics = APP.performance.calculate(
    APP.trading.closedTrades, APP.trading.equityHistory,
    getTradingSettings().balance, APP.trading.totalFees,
    APP.trading.exposedBars, APP.trading.totalBars,
  );

  const benchmark = history ? APP.performance.calculateBuyAndHold(history, getTradingSettings().balance) : null;
  const sel = document.getElementById('tStratSelect').value;
  const strat = sel !== 'custom' ? APP.loader.getStrategyByFileName(sel) : null;

  const html = APP.reportEngine.generate({
    metrics,
    trades: APP.trading.closedTrades,
    equityHistory: APP.trading.equityHistory,
    candles: history,
    benchmark,
    mcSummary: APP.mc.lastResults?.summary,
    wfSummary: APP.walkForward.lastResults?.summary,
    settings: getTradingSettings(),
    strategyName: strat?.name || 'Custom Strategy',
    timestamp: new Date().toISOString().slice(0, 19),
  });

  download(html, 'backtest_report.html', 'text/html');
}

// ─── Storage ───

async function saveCurrentRun() {
  if (!APP.trading) return;
  try {
    await APP.storage.init();
    const sel = document.getElementById('tStratSelect').value;
    const strat = sel !== 'custom' ? APP.loader.getStrategyByFileName(sel) : null;

    const metrics = APP.performance.calculate(
      APP.trading.closedTrades, APP.trading.equityHistory,
      getTradingSettings().balance, APP.trading.totalFees,
      APP.trading.exposedBars, APP.trading.totalBars,
    );

    await APP.storage.saveRun({
      strategy: strat?.name || 'Custom',
      metrics,
      settings: getTradingSettings(),
      marketParams: getMarketParams(),
      equityCurve: APP.trading.equityHistory,
      trades: APP.trading.closedTrades,
      totalCandles: APP.trading.totalBars,
    });

    await refreshSavedRuns();
  } catch (e) {
    console.warn('Failed to save run:', e);
  }
}

async function refreshSavedRuns() {
  try {
    await APP.storage.init();
    const runs = await APP.storage.getRuns(10);
    const el = document.getElementById('savedRuns');
    if (runs.length === 0) {
      el.innerHTML = '<span style="color:var(--muted)">No saved runs</span>';
      return;
    }

    let html = '';
    for (const run of runs) {
      const date = new Date(run.timestamp).toLocaleDateString();
      const ret = run.metrics ? (run.metrics.totalReturn * 100).toFixed(1) + '%' : '?';
      const cls = run.metrics?.totalReturn >= 0 ? 'up' : 'down';
      html += `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border);font-size:10px">
        <span>${run.strategy}</span><span>${date}</span><span class="${cls}">${ret}</span>
        <button class="btn btn-ghost btn-sm delete-run" data-id="${run.id}" style="padding:1px 4px;font-size:8px">x</button>
      </div>`;
    }
    el.innerHTML = html;

    el.querySelectorAll('.delete-run').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await APP.storage.deleteRun(+btn.dataset.id);
        await refreshSavedRuns();
      });
    });
  } catch (e) {
    console.warn('Failed to load saved runs:', e);
  }
}

// ─── Plugin Indicators ───

function populatePluginIndicators() {
  const select = document.getElementById('pluginIndicator');
  select.innerHTML = '<option value="">Select indicator...</option>';
  for (const name of APP.pluginEngine.getIndicatorNames()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
}

// ─── Export ───

let exportFmt = 'xlsx';

function openModal() {
  const n = APP.market ? APP.market.getHistory().length : (APP.realDataCandles ? APP.realDataIdx : 0);
  document.getElementById('modalSub').textContent = n + ' candles saved.';
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function doExport() {
  const data = APP.market ? APP.market.getHistory() : APP.realDataCandles?.slice(0, APP.realDataIdx);
  if (!data) return;

  if (exportFmt === 'json') {
    download(JSON.stringify(data, null, 2), 'market_data.json', 'application/json');
  } else {
    if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
    const wb = XLSX.utils.book_new();
    const wsData = data.map((c) => ({ Bar: c.time, Open: c.open, High: c.high, Low: c.low, Close: c.close, Volume: Math.round(c.volume), Regime: c.regime }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wsData), 'OHLCV');
    if (APP.market) {
      const rc = APP.market.getRegimeCounts();
      const total = Object.values(rc).reduce((s, v) => s + v, 0);
      const rsData = Object.keys(rc).map((r) => ({ Regime: r, Count: rc[r], Pct: total > 0 ? (rc[r] / total * 100).toFixed(1) + '%' : '0%' }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rsData), 'Regimes');
    }
    XLSX.writeFile(wb, 'market_data.xlsx');
  }
  closeModal();
}

function exportTradeCSV() {
  if (!APP.trading || !APP.trading.closedTrades.length) return;
  const lines = ['ID,Direction,Entry,Exit,Size,PnL,Fees,EntryBar,ExitBar,Reason,Duration,MarketImpact'];
  for (const t of APP.trading.closedTrades) {
    lines.push([t.id, t.direction, t.entryPrice.toFixed(4), t.exitPrice.toFixed(4), t.size.toFixed(6),
      t.pnl.toFixed(2), t.fees.toFixed(4), t.entryBar, t.exitBar, t.reason,
      t.exitBar - t.entryBar, (t.marketImpact || 0).toFixed(6)].join(','));
  }
  download(lines.join('\n'), 'trades.csv', 'text/csv');
}

function download(content, name, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Sidebar Tab Switching ───

function initSidebarTabs() {
  document.querySelectorAll('.sidebar-tabs').forEach((tabBar) => {
    const tabs = tabBar.querySelectorAll('.sidebar-tab');
    const container = tabBar.parentElement;

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        container.querySelectorAll('.sidebar-panel').forEach((p) => p.classList.remove('active'));
        const panel = container.querySelector('#' + tab.dataset.panel);
        if (panel) panel.classList.add('active');
      });
    });
  });
}

// ─── Event Wiring ───

document.addEventListener('DOMContentLoaded', async () => {
  // Load strategies
  await APP.loader.loadAll();
  APP.loader.populateDropdown(document.getElementById('tStratSelect'));

  // Init sidebar tabs
  initSidebarTabs();

  // Top controls
  document.getElementById('btnStart').addEventListener('click', startLive);
  document.getElementById('btnPause').addEventListener('click', pauseLive);
  document.getElementById('btnStop').addEventListener('click', stopLive);
  document.getElementById('btnReset').addEventListener('click', resetAll);

  document.getElementById('btnHelp')?.addEventListener('click', () => {
    document.getElementById('tutorialModal').classList.add('show');
  });
  document.querySelector('.logo')?.addEventListener('click', () => {
    document.getElementById('tutorialModal').classList.add('show');
  });
  document.getElementById('btnCloseTutorial').addEventListener('click', () => {
    document.getElementById('tutorialModal').classList.remove('show');
  });
  document.getElementById('tutorialModal').addEventListener('click', (e) => {
    if (e.target.id === 'tutorialModal') document.getElementById('tutorialModal').classList.remove('show');
  });

  // Speed
  APP.ui.initSpeedGrid((ms) => {
    APP.speed = ms;
    if (APP.running && !APP.paused) {
      clearInterval(APP.timer);
      APP.timer = setInterval(tick, ms);
    }
  });

  // Trading mode
  document.getElementById('tMode').addEventListener('change', () => {
    const isFut = document.getElementById('tMode').value === 'futures';
    document.getElementById('tLev').disabled = !isFut;
    document.getElementById('tMaintRate').disabled = !isFut;
  });

  // Strategy controls
  document.getElementById('tStratEnabled').addEventListener('change', () => {
    APP.strategyEnabled = document.getElementById('tStratEnabled').checked;
    APP.ui.setStrategyEnabled(APP.strategyEnabled);
  });
  document.getElementById('tStratSelect').addEventListener('change', onStrategySelect);
  document.getElementById('btnLoadStrat').addEventListener('click', loadCurrentStrategy);
  document.getElementById('btnUploadStrat').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById('tStratCode').value = ev.target.result;
      document.getElementById('tStratSelect').value = 'custom';
      onStrategySelect();
    };
    reader.readAsText(file);
  });

  // Manual trading
  document.getElementById('btnManualBuy').addEventListener('click', manualBuy);
  document.getElementById('btnManualSell').addEventListener('click', manualSell);

  // Monte Carlo
  document.getElementById('btnMC').addEventListener('click', runMonteCarlo);
  document.getElementById('btnMcExportCsv').addEventListener('click', () => {
    const csv = APP.mc.exportCSV();
    if (csv) download(csv, 'monte_carlo.csv', 'text/csv');
  });
  document.getElementById('btnMcExportJson').addEventListener('click', () => {
    const json = APP.mc.exportJSON();
    if (json) download(json, 'monte_carlo.json', 'application/json');
  });

  // Data source
  document.getElementById('dataSource').addEventListener('change', () => {
    const src = document.getElementById('dataSource').value;
    document.getElementById('binanceOptions').style.display = src === 'binance' ? '' : 'none';
    document.getElementById('coingeckoOptions').style.display = src === 'coingecko' ? '' : 'none';
  });
  document.getElementById('btnFetchData').addEventListener('click', fetchRealData);
  document.getElementById('btnScramble').addEventListener('click', scrambleData);

  // Optimizer
  document.getElementById('optMode').addEventListener('change', () => {
    document.getElementById('geneticOptions').style.display =
      document.getElementById('optMode').value === 'genetic' ? '' : 'none';
  });
  document.getElementById('btnOptimize').addEventListener('click', runOptimizer);

  // Walk-forward
  document.getElementById('btnWalkForward').addEventListener('click', runWalkForward);

  // Report
  document.getElementById('btnReport').addEventListener('click', generateReport);

  // Storage
  document.getElementById('btnSaveRun').addEventListener('click', saveCurrentRun);
  document.getElementById('btnClearRuns')?.addEventListener('click', async () => {
    if (!confirm('Clear all saved runs?')) return;
    await APP.storage.clearAll();
    await refreshSavedRuns();
  });
  refreshSavedRuns();

  // Plugin indicators
  populatePluginIndicators();
  document.getElementById('pluginIndicator').addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) return;
    const ind = APP.pluginEngine.getIndicator(name);
    if (!ind) return;

    const container = document.getElementById('activePlugins');
    const badge = document.createElement('span');
    badge.className = 'ind-badge';
    badge.style.borderColor = ind.color;
    badge.style.color = ind.color;
    badge.textContent = name;
    badge.style.cursor = 'pointer';
    badge.title = 'Click to remove';
    badge.addEventListener('click', () => badge.remove());
    container.appendChild(badge);
  });

  // Export modal
  document.getElementById('btnExport').addEventListener('click', openModal);
  document.getElementById('btnExportTrades').addEventListener('click', exportTradeCSV);
  document.getElementById('btnModalCancel').addEventListener('click', closeModal);
  document.getElementById('btnModalExport').addEventListener('click', doExport);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.querySelectorAll('.exp-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      exportFmt = opt.dataset.fmt;
      document.querySelectorAll('.exp-opt').forEach((o) => o.classList.toggle('sel', o === opt));
    });
  });

  // Resize
  window.addEventListener('resize', () => APP.ui.resize());

  // Init mobile view
  if (window.innerWidth <= 768) {
    document.getElementById('mainArea').classList.add('mob-active');
    document.getElementById('sidebarLeft').classList.add('mob-active');
  }
});
