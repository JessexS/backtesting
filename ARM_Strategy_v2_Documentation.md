claude --resume 1441e0d5-753f-4257-ab9a-90434d22c501


# Adaptive Regime Momentum (ARM) Strategy v2.0

## 1. Quantitative Reasoning

The composite score to maximize is:

```
Score = (CAGR * Sharpe) / (1 + MaxDD)
```

This rewards strategies that achieve high absolute return (CAGR), high risk-adjusted return (Sharpe in numerator), and low drawdown (denominator penalty). The optimal approach isn't maximum aggression or maximum conservatism — it's **volatility-scaled trend capture with hard drawdown containment**.

### Why trend following works on this generator

The Gen class produces six regimes. Four of them (bull, bear, breakout, crash) have non-zero drift. Drift creates autocorrelation in returns — prices trend. The EMA crossover system detects when drift has been sustained long enough for the EMAs to align. The key insight is that regime duration is stochastic but bounded: bull and bear regimes have high self-transition probability (0.65 and 0.60 respectively), meaning they persist. Breakout has `dur:[10,30]` and crash has `dur:[5,20]`, meaning they're short-lived but high-magnitude. The strategy must capture the persistent trends and survive the explosive ones.

### Why triple-EMA alignment beats dual crossover

A single EMA crossover (e.g., 12/26) generates false signals during swing regime (cyclical, no net drift, vM=1.3). Triple alignment (EMA12 > EMA26 > EMA50 for bull) requires sustained directional movement across three timescales, filtering out swing oscillations. The EMA spread threshold (0.4% of price) further eliminates noise — alignment must be meaningful, not marginal.

### Why mean reversion is included but constrained

Sideways regime has `mr: 0.15` — explicit mean reversion toward anchor price. RSI extremes (<22 or >78) in low-volatility, non-trending conditions identify overshoot. But mean reversion is traded at 40% size with tighter stops because the edge is smaller and regime misclassification risk is higher.

---

## 2. Exact Parameter Values

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| EMA Fast | 12 | Captures 2-3 week momentum |
| EMA Medium | 26 | Monthly trend filter |
| EMA Slow | 50 | Quarterly trend anchor |
| ATR Period | 14 | Standard volatility measure |
| RSI Period | 14 | Momentum oscillator |
| Vol Window (short) | 20 | Current regime vol estimate |
| Vol Window (long) | 50 | Baseline vol estimate |
| Stop Distance | 2.0 x ATR | Below noise threshold |
| Take Profit | 5.0 x ATR (2.5:1 R:R) | Positive expectancy requires R:R > 1/(win_rate) |
| Trailing Stop | 1.7 x ATR (0.85 x SL) | Tightens as trade matures |
| Risk Per Trade | 1.5% of equity | Kelly-bounded, survivable |
| Kelly Cap | 50% of full Kelly | Conservative sizing |
| DD Throttle 10% | 75% size | Gradual reduction |
| DD Throttle 15% | 50% size | Aggressive reduction |
| DD Throttle 20% | 25% size | Near-stop trading |
| DD Emergency Exit | 22% | Close all positions |
| EMA Spread Threshold | 0.4% of price | Minimum for trend signal |
| Strong Trend Threshold | 1.0% of price | Pyramid trigger |
| RSI Long Entry | 40-72 | Confirms momentum without overbought |
| RSI Short Entry | 28-60 | Confirms weakness without oversold |
| RSI MR Long | <22 | Extreme oversold |
| RSI MR Short | >78 | Extreme overbought |
| Min Bars (trending) | 4 | Anti-whipsaw |
| Min Bars (sideways) | 20 | Anti-overtrade in chop |
| Min Bars (transitional) | 8 | Moderate filter |
| Max Pyramids | 1 | One add per trend |
| Pyramid Size | 50% of base | Reduced add |
| MR Size | 40% of base | Small mean reversion |
| Vol Ratio Threshold (high) | 2.0 | Reduce exposure |
| Vol Ratio Threshold (extreme) | 3.0 | Exit all |
| ATR% Threshold (high) | 4.0% | Reduce exposure |
| ATR% Threshold (extreme) | 6.0% | Exit all |

---

## 3. Position Sizing Model

The sizing formula:

```
baseRisk     = equity * 0.015
ddMultiplier = f(drawdown)   in {1.0, 0.75, 0.5, 0.25}
volScalar    = min(1.0, 1.0 / max(1.0, volRatio * 0.7))
stopDistance  = ATR * 2.0

rawSize = (baseRisk * ddMultiplier * volScalar) / stopDistance
size    = min(rawSize, equity * 0.5 / price)    // Kelly cap
```

**Derivation:** Given risk per trade `R = 0.015 * equity`, and the stop is at `2 * ATR` from entry, the position size that loses exactly `R` when stopped out is `R / (2 * ATR)`. The volatility scalar inversely adjusts — when current vol is 2x baseline, vol scalar = `1/1.4 ~ 0.71`, reducing size by 29%. The drawdown multiplier creates a discrete step function that aggressively shrinks exposure as equity drops.

**Why this prevents ruin:** Maximum loss per trade = 1.5% * equity * (2.0 + slippage ~ 2.1% worst case). Even 10 consecutive losers only draw down ~14% from the starting equity of that sequence. The drawdown throttle kicks in at 10% DD, further reducing loss velocity.

---

## 4. Risk Model

**Per-trade risk budget:** 1.5% of current equity (not initial capital). This means as equity grows, position sizes grow proportionally (geometric sizing). As equity shrinks, positions shrink, creating convex position sizing.

**Drawdown throttle mechanism:**

```
DD < 10%:   full size (1.0x)
10-15% DD:  75% size
15-20% DD:  50% size
20-22% DD:  25% size
DD > 22%:   emergency close all + halt
```

This creates a "voltage divider" for risk. At 15% DD, the strategy is effectively risking 0.75% per trade (1.5% * 0.5). At this reduced rate, it takes ~20 consecutive losers to push from 15% to 25% DD — extremely unlikely with a >45% win rate.

**Emergency exit at 22% DD** is the circuit breaker. It accepts the loss and preserves 78% of peak capital for recovery.

---

## 5. Stop Logic

**Initial stop:** 2.0 x ATR below entry (long) or above (short). ATR automatically adapts to the current regime's volatility. In bull (vM=0.8, low vol), stops are tight. In breakout (vM=2.5), stops widen proportionally.

**Take profit:** 2.5 x stop distance. This sets the minimum reward-to-risk at 2.5:1. With a 45% win rate: expectancy = 0.45 * 2.5R - 0.55 * 1R = 0.575R per trade. Positive.

**Trailing stop:** 0.85 x stop distance (85% of SL width), trails from the highest high (long) or lowest low (short). Once the trade moves 1 ATR in-the-money, the trail is inside the entry price — the trade is risk-free.

**Signal-based exit:** If the triple-EMA alignment reverses (all three switch order) with >0.3% spread, the position is closed immediately regardless of stop levels. This captures trend reversals faster than the trailing stop.

---

## 6. Leverage Logic

The strategy does **not** directly set leverage — it controls effective leverage through position sizing. However, the engine applies the configured leverage to the margin calculation. The strategy's sizing ensures:

```
effectiveLeverage = (positionSize * price) / equity
```

With the sizing formula, effective leverage is bounded by:

```
maxEffectiveLev = (riskAmt / stopDist * price) / equity
                = (0.015 * equity / (2 * ATR) * price) / equity
                = 0.015 * price / (2 * ATR)
                = 0.015 / (2 * atrPct)
```

For typical atrPct = 1.5%: maxEffectiveLev ~ 0.015 / 0.03 = 0.5. Even with the trend boost (1.25x) and pyramid (0.5x), total effective leverage peaks at ~0.875. The configured leverage (10x) provides headroom for margin — the position sizing naturally keeps actual leverage conservative.

In extreme volatility (atrPct = 6%), effective leverage drops to 0.015/0.12 = 0.125 — almost zero exposure. This is the adaptive leverage mechanism.

---

## 7. Strategy Code

Full strategy code is in: `arm_strategy_v2.js`

### Strategy Lifecycle

- **`init(ctx)`** — Initializes peak equity tracking, entry bar counter, pyramid state
- **`onCandle(ctx)`** — Core logic: computes indicators, classifies regime, manages risk, generates entry/exit orders
- **`onOrderFilled(ctx)`** — No additional logic (SL/TP/trail managed by engine)
- **`onLiquidation(ctx)`** — Resets pyramid counter
- **`onFinish(ctx)`** — No cleanup needed

### Available Context (`ctx`)

```javascript
ctx = {
  candle,      // Current OHLCV candle
  candles,     // Full candle history array
  positions,   // Array of open positions (snapshot)
  equity,      // Current equity (balance + unrealized PnL)
  balance,     // Current cash balance
  fees,        // Total fees paid
  orders,      // Pending orders
  utils: { Math }
}
```

### Order Command Format

```javascript
// New order
{ side: 'buy'|'sell', type: 'market'|'limit'|'stop', size: number,
  stopLoss: pct, takeProfit: pct, trailingStop: pct, price: number }

// Close position
{ close: true, side: 'sell' }  // closes longs
{ close: true, side: 'buy' }   // closes shorts
{ close: true, positionId: id } // close specific position
```

---

## 8. Monte Carlo Robustness Analysis

### Why the strategy remains stable across seeds

Each seed produces different specific price paths but identical statistical regime properties. The regime transition matrix is constant — bull states self-transition at 65%, bear at 60%. Every seed will contain bull runs, bear runs, sideways periods, and occasional crashes. The strategy's edge comes from exploiting the *drift parameter* inherent to each regime, not from the specific price levels.

### Why the edge is structural, not random

The generator's drift parameters are:
- Bull: +0.3%/candle, Bear: -0.3%/candle
- Breakout: +0.6%/candle, Crash: -1.5%/candle

Triple-EMA alignment is a mathematical consequence of sustained drift. If a regime persists for >12 candles (which bull/bear do with high probability due to self-transition rates), EMAs will align. The strategy captures the drift because drift != 0 in 4 of 6 regimes, and those 4 regimes collectively account for the majority of candles in any seed.

### How variance is controlled

- Volatility-scaled sizing ensures that high-vol regimes (breakout: vM=2.5, crash: vM=4.0) get proportionally smaller positions. The formula `volScalar = 1/max(1, volRatio*0.7)` reduces size by ~40% when vol doubles. This keeps dollar-risk approximately constant across regimes.
- The `minBars` anti-whipsaw filter (4 in trends, 20 in sideways) prevents the strategy from overtrading during regime transitions, which are the primary source of return variance.

### How drawdowns are suppressed

- Three-layer defense: (1) ATR-based stops cap per-trade loss at ~1.5% equity; (2) drawdown throttle reduces sizing at 10/15/20% DD thresholds; (3) emergency close at 22% DD circuit-breaks the strategy.
- The trailing stop converts winning trades into risk-free trades after ~1 ATR of movement, creating positive skew in the return distribution.
- Extreme volatility exit (volRatio > 3.0 or ATR% > 6%) closes all positions during flash crashes before the stop is reached, preventing gap-through risk.

---

## 9. Expected Performance Profile

| Metric | Expected Range (50 seeds) |
|--------|--------------------------|
| Mean Return | +5% to +25% per 500 candles |
| Median Return | +3% to +20% |
| Max Drawdown | 8% to 22% (mean ~14%) |
| Sharpe Ratio | 0.3 to 1.5 (mean ~0.7) |
| Win Rate | 42% to 55% (mean ~47%) |
| Profit Factor | 1.3 to 2.5 (mean ~1.7) |
| Avg R Multiple | 0.3 to 0.8 |
| Exposure Time | 30% to 60% |
| Max Consec Losses | 4 to 9 |
| Composite Score | Positive in >80% of seeds |

---

## 10. Failure Modes

### Mode 1: Extended sideways with false breakouts
If the generator produces long sideways periods (low self-transition for sideways is 0.45, so this is common) with brief breakout fakeouts, the EMA alignment will briefly trigger entries that get stopped out. **Mitigation:** the `emaSpread > 0.4%` threshold filters marginal alignments, and the 1.5% risk cap limits damage.

### Mode 2: Whipsaw during swing regime
Swing regime (sc=20 candle cycle) creates oscillating prices that can repeatedly align and misalign EMAs. **Mitigation:** the `minBars` filter of 8 bars in non-trending conditions prevents re-entry on the opposite side of the same swing.

### Mode 3: Gap-through liquidation in crash
If crash regime hits immediately after a long entry, the price could gap below the stop and liquidation levels in a single candle. **Mitigation:** the extreme volatility exit (atrPct > 6%) closes positions proactively when crash conditions are detected, often on the first or second crash candle.

### Mode 4: Low-activity seeds
Some seeds may spend 70%+ of candles in sideways/swing, producing few trend-following opportunities. Returns will be near-zero but drawdown will also be minimal because the mean reversion component trades at 40% size with tight stops. The composite score approaches zero but doesn't go deeply negative.

### Mode 5: Leverage x large gap
With 10x leverage configured, a 10% adverse move before the next candle open could cause significant loss. The isolated margin model limits this to the margin allocated to that position, not the entire account. The strategy's position sizing ensures margin is a small fraction (~5-8%) of equity, so even total loss of a single position's margin doesn't exceed the drawdown throttle threshold.

---

## 11. UI Configuration

Set these values in the Trading Panel before clicking START:

```
Mode:              Futures (Isolated)
Leverage:          10x
Maker Fee:         0.02%
Taker Fee:         0.04%
Slippage:          0.05%
Maint. Rate:       0.5%
Starting Balance:  10000
Position Sizing:   Fixed Amount
Size Value:        1000    (fallback only; strategy provides its own size)
Stop Loss:         0       (strategy provides its own)
Take Profit:       0       (strategy provides its own)
Trailing Stop:     0       (strategy provides its own)
Partial Fill:      100%
```

For Monte Carlo:

```
Runs:              50
Candles/Run:       500
Overlay:           checked
```

The strategy file is at `arm_strategy_v2.js` — paste its contents into the Strategy Editor textarea, click **Load Strategy**, enable the toggle, then **START**.
