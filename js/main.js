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
  running: false,
  paused: false,
  timer: null,
  speed: 800,
  strategyEnabled: false,
  lastTradeIdx: 0,
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
        // Use default
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
      // Read user-configured params from the UI
      const userParams = readStrategyParams(strat);
      // Clone strategy with bound methods so each run gets fresh state
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

    // If strategy has params definition, render UI
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
}

// ─── Main Tick ───

function tick() {
  if (!APP.running || APP.paused || !APP.market) return;
  const c = APP.market.tick();
  const liqs = APP.trading.update(c);
  const history = APP.market.getHistory();

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
  if (!APP.market || !APP.trading) return;
  const n = history.length;
  if (!n) return;
  const c = history[n - 1];

  APP.ui.updateTopbar(history, APP.trading);
  APP.ui.updateLeftSidebar(history, APP.market.getRegimeCounts());
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

  const mp = getMarketParams();
  const ts = getTradingSettings();
  APP.market = new MarketEngine(mp);
  APP.trading = new TradingEngine(ts);
  APP.execution = new ExecutionEngine(APP.trading);
  APP.sandbox = new StrategySandbox();
  APP.lastTradeIdx = 0;

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
}

function resetAll() {
  stopLive();
  APP.market = null;
  APP.trading = null;
  APP.ui.reset();
  APP.ui.setRunningState('idle');
}

function closePosition(id) {
  if (!APP.trading) return;
  const pos = APP.trading.positions.find((p) => p.id === id);
  if (!pos) return;
  const history = APP.market.getHistory();
  APP.execution.execute(
    [{ close: true, positionId: id, side: pos.direction === 'long' ? 'sell' : 'buy' }],
    history[history.length - 1],
  );
}

function manualBuy() {
  if (APP.strategyEnabled || !APP.running) return;
  const history = APP.market.getHistory();
  if (!history.length) return;
  APP.execution.execute([{ side: 'buy', type: 'market' }], history[history.length - 1]);
}

function manualSell() {
  if (APP.strategyEnabled || !APP.running) return;
  const history = APP.market.getHistory();
  if (!history.length) return;
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

    APP.ui.renderMCResults(result.summary);
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

// ─── Export ───

let exportFmt = 'xlsx';

function openModal() {
  const n = APP.market ? APP.market.getHistory().length : 0;
  document.getElementById('modalSub').textContent = n + ' kynttilää tallennettu.';
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function doExport() {
  if (!APP.market) return;
  const data = APP.market.getHistory();

  if (exportFmt === 'json') {
    download(JSON.stringify(data, null, 2), 'market_data.json', 'application/json');
  } else {
    if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
    const wb = XLSX.utils.book_new();
    const wsData = data.map((c) => ({ Bar: c.time, Open: c.open, High: c.high, Low: c.low, Close: c.close, Volume: Math.round(c.volume), Regime: c.regime }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wsData), 'OHLCV');
    const rc = APP.market.getRegimeCounts();
    const total = Object.values(rc).reduce((s, v) => s + v, 0);
    const rsData = Object.keys(rc).map((r) => ({ Regime: r, Count: rc[r], Pct: total > 0 ? (rc[r] / total * 100).toFixed(1) + '%' : '0%' }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rsData), 'Regimes');
    XLSX.writeFile(wb, 'market_data.xlsx');
  }
  closeModal();
}

function exportTradeCSV() {
  if (!APP.trading || !APP.trading.closedTrades.length) return;
  const lines = ['ID,Direction,Entry,Exit,Size,PnL,Fees,EntryBar,ExitBar,Reason'];
  for (const t of APP.trading.closedTrades) {
    lines.push([t.id, t.direction, t.entryPrice.toFixed(4), t.exitPrice.toFixed(4), t.size.toFixed(6), t.pnl.toFixed(2), t.fees.toFixed(4), t.entryBar, t.exitBar, t.reason].join(','));
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

// ─── Event Wiring ───

document.addEventListener('DOMContentLoaded', async () => {
  // Load strategies
  await APP.loader.loadAll();
  APP.loader.populateDropdown(document.getElementById('tStratSelect'));

  // Top controls
  document.getElementById('btnStart').addEventListener('click', startLive);
  document.getElementById('btnPause').addEventListener('click', pauseLive);
  document.getElementById('btnStop').addEventListener('click', stopLive);
  document.getElementById('btnReset').addEventListener('click', resetAll);

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
