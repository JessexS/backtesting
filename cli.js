#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// CLI — Command-line backtest runner for automated testing / CI-CD
// Usage: node cli.js [options]
// ═══════════════════════════════════════════════════════════════

import { MarketEngine } from './js/market/MarketEngine.js';
import { TradingEngine } from './js/trading/TradingEngine.js';
import { ExecutionEngine } from './js/trading/ExecutionEngine.js';
import { StrategySandbox } from './js/strategy/StrategySandbox.js';
import { PerformanceEngine } from './js/performance/PerformanceEngine.js';
import { MonteCarloEngine } from './js/montecarlo/MonteCarloEngine.js';
import fs from 'fs';
import path from 'path';

// ─── Argument Parsing ───

function parseArgs(args) {
  const opts = {
    strategy: null,
    candles: 500,
    seed: 42,
    startPrice: 100,
    volatility: 2,
    bias: 0,
    balance: 10000,
    leverage: 10,
    mode: 'futures',
    sl: 0,
    tp: 0,
    trail: 0,
    makerFee: 0.02,
    takerFee: 0.04,
    slippage: 0.05,
    mcRuns: 0,
    mcCandles: 500,
    output: null,
    format: 'text',
    quiet: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '-s': case '--strategy': opts.strategy = next; i++; break;
      case '-n': case '--candles': opts.candles = +next; i++; break;
      case '--seed': opts.seed = +next; i++; break;
      case '--start-price': opts.startPrice = +next; i++; break;
      case '--volatility': opts.volatility = +next; i++; break;
      case '--bias': opts.bias = +next; i++; break;
      case '--balance': opts.balance = +next; i++; break;
      case '--leverage': opts.leverage = +next; i++; break;
      case '--mode': opts.mode = next; i++; break;
      case '--sl': opts.sl = +next; i++; break;
      case '--tp': opts.tp = +next; i++; break;
      case '--trail': opts.trail = +next; i++; break;
      case '--maker-fee': opts.makerFee = +next; i++; break;
      case '--taker-fee': opts.takerFee = +next; i++; break;
      case '--slippage': opts.slippage = +next; i++; break;
      case '--mc-runs': opts.mcRuns = +next; i++; break;
      case '--mc-candles': opts.mcCandles = +next; i++; break;
      case '-o': case '--output': opts.output = next; i++; break;
      case '-f': case '--format': opts.format = next; i++; break;
      case '-q': case '--quiet': opts.quiet = true; break;
      case '-h': case '--help': opts.help = true; break;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
Backtesting CLI — Run backtests from the command line

USAGE:
  node cli.js -s <strategy-file> [options]

OPTIONS:
  -s, --strategy <file>    Strategy JS file (required)
  -n, --candles <num>      Number of candles to simulate (default: 500)
  --seed <num>             Market seed (default: 42)
  --start-price <num>      Starting price (default: 100)
  --volatility <num>       Market volatility % (default: 2)
  --bias <num>             Market bias (default: 0)
  --balance <num>          Starting balance (default: 10000)
  --leverage <num>         Leverage for futures (default: 10)
  --mode <futures|spot>    Trading mode (default: futures)
  --sl <num>               Default stop loss % (default: 0)
  --tp <num>               Default take profit % (default: 0)
  --trail <num>            Default trailing stop % (default: 0)
  --maker-fee <num>        Maker fee % (default: 0.02)
  --taker-fee <num>        Taker fee % (default: 0.04)
  --slippage <num>         Slippage % (default: 0.05)
  --mc-runs <num>          Monte Carlo runs (0 = skip, default: 0)
  --mc-candles <num>       Candles per MC run (default: 500)
  -o, --output <file>      Output file (default: stdout)
  -f, --format <fmt>       Output format: text, json, csv (default: text)
  -q, --quiet              Suppress progress output
  -h, --help               Show this help message

EXAMPLES:
  node cli.js -s strategies/my_strat.js -n 1000 --seed 123
  node cli.js -s strategies/my_strat.js -f json -o results.json
  node cli.js -s strategies/my_strat.js --mc-runs 100 --balance 50000
`);
}

// ─── Strategy Loading ───

function loadStrategy(filePath) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Strategy file not found: ${absPath}`);
    process.exit(1);
  }

  const code = fs.readFileSync(absPath, 'utf-8');
  return code;
}

// ─── Run Backtest ───

function runBacktest(opts) {
  const market = new MarketEngine({
    seed: opts.seed,
    startPrice: opts.startPrice,
    volatility: opts.volatility,
    bias: opts.bias,
    switchPct: 5,
  });

  const trading = new TradingEngine({
    mode: opts.mode,
    leverage: opts.leverage,
    makerFee: opts.makerFee,
    takerFee: opts.takerFee,
    slippage: opts.slippage,
    balance: opts.balance,
    sl: opts.sl,
    tp: opts.tp,
    trail: opts.trail,
  });

  const execution = new ExecutionEngine(trading);
  const sandbox = new StrategySandbox();
  const perf = new PerformanceEngine();

  // Load strategy
  const code = loadStrategy(opts.strategy);
  sandbox.loadFromCode(code);

  if (sandbox.error) {
    console.error(`Strategy error: ${sandbox.error}`);
    process.exit(1);
  }

  if (!sandbox.isLoaded()) {
    console.error('Strategy failed to load');
    process.exit(1);
  }

  sandbox.init({ equity: trading.equity, balance: trading.balance });

  // Run simulation
  for (let i = 0; i < opts.candles; i++) {
    const candle = market.tick();
    const history = market.getHistory();
    const liqs = trading.update(candle);

    if (liqs.length > 0) {
      sandbox.onLiquidation({
        candle, candles: history, positions: trading.positions,
        equity: trading.equity, balance: trading.balance, fees: trading.totalFees,
      });
    }

    const orders = sandbox.run({
      candle, candles: history, positions: trading.positions,
      equity: trading.equity, balance: trading.balance, fees: trading.totalFees,
    });

    if (orders.length > 0) {
      execution.execute(orders, candle);
    }

    if (!opts.quiet && i % 100 === 0) {
      process.stderr.write(`\rProcessing candle ${i + 1}/${opts.candles}...`);
    }
  }

  if (!opts.quiet) process.stderr.write('\r' + ' '.repeat(50) + '\r');

  sandbox.finish({ equity: trading.equity, balance: trading.balance });

  const metrics = perf.calculate(
    trading.closedTrades, trading.equityHistory,
    opts.balance, trading.totalFees,
    trading.exposedBars, trading.totalBars,
  );

  return {
    metrics,
    trades: trading.closedTrades,
    equityHistory: trading.equityHistory,
    finalBalance: trading.balance,
    finalEquity: trading.equity,
  };
}

// ─── Monte Carlo ───

async function runMC(opts, baseResult) {
  const mc = new MonteCarloEngine();
  const code = loadStrategy(opts.strategy);

  const config = {
    numRuns: opts.mcRuns,
    candlesPerRun: opts.mcCandles,
    marketParams: {
      seed: opts.seed,
      startPrice: opts.startPrice,
      volatility: opts.volatility,
      bias: opts.bias,
      switchPct: 5,
    },
    tradingSettings: {
      mode: opts.mode,
      leverage: opts.leverage,
      makerFee: opts.makerFee,
      takerFee: opts.takerFee,
      slippage: opts.slippage,
      balance: opts.balance,
      sl: opts.sl,
      tp: opts.tp,
      trail: opts.trail,
    },
    strategyCode: code,
    mode: 'seed',
    scrambleOptions: { mode: 'seed' },
  };

  const result = await mc.run(config, (current, total) => {
    if (!opts.quiet) {
      process.stderr.write(`\rMonte Carlo: ${current}/${total}`);
    }
  });

  if (!opts.quiet) process.stderr.write('\r' + ' '.repeat(50) + '\r');

  return result.summary;
}

// ─── Output Formatting ───

function formatText(result, mcSummary) {
  const m = result.metrics;
  let out = '';
  out += '═══════════════════════════════════════════════\n';
  out += '  BACKTEST RESULTS\n';
  out += '═══════════════════════════════════════════════\n\n';
  out += `  Total Return:     ${(m.totalReturn * 100).toFixed(2)}%\n`;
  out += `  Final Balance:    $${result.finalBalance.toFixed(2)}\n`;
  out += `  Final Equity:     $${result.finalEquity.toFixed(2)}\n`;
  out += `  Total Trades:     ${m.totalTrades}\n`;
  out += `  Win Rate:         ${(m.winRate * 100).toFixed(1)}%\n`;
  out += `  Profit Factor:    ${m.profitFactor.toFixed(2)}\n`;
  out += `  Sharpe Ratio:     ${m.sharpe.toFixed(3)}\n`;
  out += `  Sortino Ratio:    ${m.sortino.toFixed(3)}\n`;
  out += `  Max Drawdown:     ${(m.maxDrawdown * 100).toFixed(2)}%\n`;
  out += `  Avg Win:          $${m.avgWin.toFixed(2)}\n`;
  out += `  Avg Loss:         $${m.avgLoss.toFixed(2)}\n`;
  out += `  Expectancy:       $${m.expectancy.toFixed(2)}\n`;
  out += `  Total Fees:       $${m.totalFees.toFixed(2)}\n`;
  out += `  Exposure:         ${(m.exposure * 100).toFixed(1)}%\n`;

  if (m.var95 !== undefined) {
    out += `\n  ── Risk Metrics ──\n`;
    out += `  VaR 95%:          ${(m.var95 * 100).toFixed(2)}%\n`;
    out += `  VaR 99%:          ${(m.var99 * 100).toFixed(2)}%\n`;
    out += `  CVaR 95%:         ${(m.cvar95 * 100).toFixed(2)}%\n`;
    out += `  Omega Ratio:      ${m.omega.toFixed(3)}\n`;
    out += `  Calmar Ratio:     ${m.calmar.toFixed(3)}\n`;
  }

  if (mcSummary) {
    out += `\n  ── Monte Carlo ──\n`;
    out += `  MC Runs:          ${mcSummary.runs}\n`;
    out += `  Avg Return:       ${(mcSummary.avgReturn * 100).toFixed(2)}%\n`;
    out += `  Median Return:    ${(mcSummary.medianReturn * 100).toFixed(2)}%\n`;
    out += `  Worst Return:     ${(mcSummary.worstReturn * 100).toFixed(2)}%\n`;
    out += `  Best Return:      ${(mcSummary.bestReturn * 100).toFixed(2)}%\n`;
    out += `  Ruin Probability: ${(mcSummary.ruinProbability * 100).toFixed(1)}%\n`;
  }

  out += '\n═══════════════════════════════════════════════\n';
  return out;
}

function formatJSON(result, mcSummary) {
  return JSON.stringify({ ...result, monteCarlo: mcSummary || null }, null, 2);
}

function formatCSV(result) {
  const lines = ['metric,value'];
  const m = result.metrics;
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'number') {
      lines.push(`${k},${v}`);
    }
  }
  return lines.join('\n');
}

// ─── Main ───

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!opts.strategy) {
    console.error('Error: Strategy file required. Use -s <file> or --help for usage.');
    process.exit(1);
  }

  if (!opts.quiet) {
    console.error(`Running backtest: ${opts.candles} candles, seed ${opts.seed}`);
  }

  const result = runBacktest(opts);

  let mcSummary = null;
  if (opts.mcRuns > 0) {
    mcSummary = await runMC(opts, result);
  }

  let output;
  switch (opts.format) {
    case 'json': output = formatJSON(result, mcSummary); break;
    case 'csv': output = formatCSV(result); break;
    default: output = formatText(result, mcSummary);
  }

  if (opts.output) {
    fs.writeFileSync(opts.output, output);
    if (!opts.quiet) console.error(`Results written to ${opts.output}`);
  } else {
    console.log(output);
  }

  // Exit code: 0 if profitable, 1 if loss
  process.exit(result.metrics.totalReturn >= 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(2);
});
