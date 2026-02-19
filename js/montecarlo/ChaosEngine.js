// ═══════════════════════════════════════════════════════════════
// ChaosEngine — Parameter scrambling and stress test generation
// ═══════════════════════════════════════════════════════════════

import { mulberry32 } from '../market/MarketEngine.js';

export class ChaosEngine {
  constructor(seed = 12345) {
    this.rng = mulberry32(seed);
  }

  reseed(seed) {
    this.rng = mulberry32(seed);
  }

  // Gaussian via Box-Muller
  gaussian() {
    const u1 = this.rng();
    const u2 = this.rng();
    return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  }

  // Uniform in [-1, 1]
  uniform() {
    return this.rng() * 2 - 1;
  }

  // Logistic map chaos (deterministic, bounded [-1,1])
  _logisticState = 0.4;
  deterministicChaos() {
    const r = 3.99;
    this._logisticState = r * this._logisticState * (1 - this._logisticState);
    return this._logisticState * 2 - 1;
  }

  // Get perturbation value based on mode
  perturbation(mode) {
    switch (mode) {
      case 'gaussian': return this.gaussian();
      case 'uniform': return this.uniform();
      case 'chaos': return this.deterministicChaos();
      default: return this.gaussian();
    }
  }

  // Scramble market parameters
  scrambleMarketParams(baseParams, options) {
    const { mode, intensity, scrambles } = options;
    const factor = intensity / 100;
    const p = { ...baseParams };

    if (scrambles.volatility) {
      p.volatility *= 1 + this.perturbation(mode) * factor * 0.5;
      p.volatility = Math.max(0.1, Math.min(10, p.volatility));
    }
    if (scrambles.drift) {
      p.bias += this.perturbation(mode) * factor * 0.3;
      p.bias = Math.max(-2, Math.min(2, p.bias));
    }
    if (scrambles.regime) {
      p.switchPct *= 1 + this.perturbation(mode) * factor * 0.4;
      p.switchPct = Math.max(1, Math.min(50, p.switchPct));
    }

    return p;
  }

  // Scramble trading settings
  scrambleTradingSettings(baseSettings, options) {
    const { mode, intensity, scrambles } = options;
    const factor = intensity / 100;
    const s = { ...baseSettings };

    if (scrambles.fee) {
      const fMult = 1 + Math.abs(this.perturbation(mode)) * factor * 2;
      s.makerFee *= fMult;
      s.takerFee *= fMult;
    }
    if (scrambles.slippage) {
      s.slippage *= 1 + Math.abs(this.perturbation(mode)) * factor * 3;
      s.slippage = Math.min(1, s.slippage);
    }
    if (scrambles.spread) {
      s.slippage += Math.abs(this.perturbation(mode)) * factor * 0.1;
    }
    if (scrambles.maintMargin) {
      s.maintRate *= 1 + Math.abs(this.perturbation(mode)) * factor;
      s.maintRate = Math.min(5, s.maintRate);
    }
    if (scrambles.leverage) {
      const dir = this.perturbation(mode) > 0 ? 1 : -1;
      s.leverage = Math.max(1, Math.min(100, Math.round(s.leverage * (1 + dir * factor * 0.3))));
    }
    if (scrambles.sizeMultiplier) {
      s.sizeVal *= 1 + this.perturbation(mode) * factor * 0.3;
      s.sizeVal = Math.max(10, s.sizeVal);
    }

    return s;
  }

  // Generate stress test parameters
  stressParams(baseParams, stressType, runIndex) {
    const p = { ...baseParams };

    switch (stressType) {
      case 'crash_burst':
        p.volatility *= 2 + runIndex * 0.1;
        p.bias = -Math.abs(p.bias || 0.1) * (1 + runIndex * 0.2);
        p.switchPct *= 2;
        break;
      case 'vol_cluster':
        p.volatility *= 1.5 + Math.sin(runIndex * 0.5) * 1.5;
        p.switchPct *= 0.5;
        break;
      case 'liquidity_shock':
        p.volatility *= 3;
        break;
    }

    return p;
  }

  stressTradingSettings(baseSettings, stressType) {
    const s = { ...baseSettings };

    switch (stressType) {
      case 'crash_burst':
        s.slippage *= 3;
        break;
      case 'vol_cluster':
        s.takerFee *= 1.5;
        break;
      case 'liquidity_shock':
        s.slippage *= 5;
        s.partialFill = Math.max(20, (s.partialFill || 100) * 0.4);
        break;
    }

    return s;
  }

  // Get preset config
  static getPreset(name) {
    switch (name) {
      case 'low': return { intensity: 15 };
      case 'medium': return { intensity: 35 };
      case 'extreme': return { intensity: 70 };
      default: return { intensity: 35 };
    }
  }
}
