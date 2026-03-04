// ═══════════════════════════════════════════════════════════════
// MarketEngine — Synthetic OHLCV candle generation with regimes
// Realism: fat tails, vol persistence, duration-dependent transitions,
// volume tied to |return|, gaps, path-based OHLC, optional regime visibility
// ═══════════════════════════════════════════════════════════════

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const REGIMES = {
  bull:     { drift:  0.003, vM: 0.8, mr: 0,    dur: [20, 80],  color: '#26de81' },
  bear:     { drift: -0.003, vM: 1.0, mr: 0,    dur: [15, 60],  color: '#fc5c65' },
  sideways: { drift:  0,     vM: 0.5, mr: 0.15, dur: [30, 100], color: '#45aaf2' },
  swing:    { drift:  0,     vM: 1.3, mr: 0.08, dur: [20, 60],  color: '#fed330', sc: 20 },
  breakout: { drift:  0.006, vM: 2.5, mr: 0,    dur: [10, 30],  color: '#fd9644' },
  crash:    { drift: -0.015, vM: 4.0, mr: 0,    dur: [5, 20],   color: '#a55eea' },
};

export const REGIME_NAMES = Object.keys(REGIMES);

export const TRANSITIONS = {
  bull:     { bull: 0.65, bear: 0.05, sideways: 0.12, swing: 0.10, breakout: 0.06, crash: 0.02 },
  bear:     { bull: 0.05, bear: 0.60, sideways: 0.15, swing: 0.10, breakout: 0.02, crash: 0.08 },
  sideways: { bull: 0.15, bear: 0.12, sideways: 0.45, swing: 0.18, breakout: 0.07, crash: 0.03 },
  swing:    { bull: 0.12, bear: 0.10, sideways: 0.20, swing: 0.40, breakout: 0.10, crash: 0.08 },
  breakout: { bull: 0.25, bear: 0.05, sideways: 0.10, swing: 0.10, breakout: 0.40, crash: 0.10 },
  crash:    { bull: 0.05, bear: 0.30, sideways: 0.20, swing: 0.15, breakout: 0.05, crash: 0.25 },
};

// Box-Muller: standard normal
function normal(rng) {
  const u1 = rng(), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  return z;
}

// Student-t with df degrees of freedom (heavy tails; df small = fatter)
function studentT(rng, df) {
  const z = normal(rng);
  let chi2 = 0;
  for (let i = 0; i < df; i++) {
    const n = normal(rng);
    chi2 += n * n;
  }
  if (chi2 < 1e-10) chi2 = 1e-10;
  return z * Math.sqrt((df - 2) / chi2);
}

// ─────────────────────────────────────────────
// INDICATOR PANEL (Secondary Chart Area)
// ─────────────────────────────────────────────

function drawIndicatorPanel(ctx, indicators, width, height) {

  const panelHeight = height * 0.25;     // 25% of total chart height
  const panelTop = height - panelHeight;

  const panelIndicators = Object.entries(indicators)
    .filter(([key, val]) => !key.startsWith("_") && val.panel === "indicators");

  if (panelIndicators.length === 0) return;

  // Background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, panelTop, width, panelHeight);

  // Determine min/max across all indicator values
  let min = Infinity;
  let max = -Infinity;

  panelIndicators.forEach(([_, ind]) => {
    ind.values.forEach(v => {
      if (v == null) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
  });

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const scaleY = v =>
    panelTop + panelHeight - ((v - min) / (max - min)) * panelHeight;

  panelIndicators.forEach(([_, ind]) => {
    ctx.strokeStyle = ind.color || "#ffffff";
    ctx.beginPath();

    ind.values.forEach((v, i) => {
      if (v == null) return;

      const x = (i / ind.values.length) * width;
      const y = scaleY(v);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  });
}

export class Gen {
  constructor(seed, startP, baseV, bias, switchPct, opts = {}) {
    this.rng = mulberry32(seed);
    this.price = startP;
    this.baseV = baseV / 100;
    this.bias = bias / 100;
    this.switchPct = switchPct / 100;
    this.regime = 'sideways';
    this.regimeDur = 0;
    this.maxDur = 50;
    this.anchor = startP;
    this.swingPhase = 0;
    this.history = [];
    this.regimeCounts = {};
    REGIME_NAMES.forEach((r) => (this.regimeCounts[r] = 0));
    this._pickDur();

    // Realism options (defaults keep previous behaviour when not specified)
    this.volPersistence = opts.volPersistence ?? 0.7;       // alpha: vol = alpha*prevVol + (1-alpha)*regimeVol
    this.prevVol = null;                                    // set on first bar
    this.tailDf = opts.tailDf ?? 6;                        // Student-t df (lower = fatter tails)
    this.gapPct = opts.gapPct ?? 0.02;                     // P(open != prev close)
    this.gapVol = opts.gapVol ?? 0.005;                    // volatility of gap size
    this.pathSteps = Math.max(2, opts.pathSteps ?? 10);    // intrabar path steps for OHLC
    this.durationWeight = opts.durationWeight !== false;   // increase switch prob as regime ages
    this.volumeTiedToReturn = opts.volumeTiedToReturn !== false;
    this.exposeRegime = opts.exposeRegime !== false;
  }

  _pickDur() {
    const d = REGIMES[this.regime].dur;
    this.maxDur = d[0] + Math.floor(this.rng() * (d[1] - d[0]));
  }

  _transition() {
    const t = TRANSITIONS[this.regime];
    const r = this.rng();
    let cum = 0;
    for (const k of REGIME_NAMES) {
      cum += t[k];
      if (r < cum) { this.regime = k; break; }
    }
    this.regimeDur = 0;
    this._pickDur();
    this.anchor = this.price;
    this.swingPhase = this.rng() * Math.PI * 2;
  }

  next() {
    this.regimeDur++;
    // Duration-dependent: longer in regime => higher chance to leave
    const durFactor = this.durationWeight && this.maxDur > 0
      ? 1 + this.regimeDur / this.maxDur
      : 1;
    const switchProb = Math.min(1, this.switchPct * durFactor);
    if (this.regimeDur >= this.maxDur || this.rng() < switchProb) this._transition();
    this.regimeCounts[this.regime]++;

    const R = REGIMES[this.regime];
    const regimeVol = this.baseV * R.vM;
    const vol = this.prevVol != null
      ? this.volPersistence * this.prevVol + (1 - this.volPersistence) * regimeVol
      : regimeVol;
    this.prevVol = vol;

    const drift = R.drift + this.bias;
    const mr = R.mr > 0 ? R.mr * (this.anchor - this.price) / this.price : 0;
    const swing = R.sc ? Math.sin(this.swingPhase + this.regimeDur * (2 * Math.PI / R.sc)) * vol * 0.4 : 0;

    // Optional gap: open != prev close
    const open = this.price;
    let barOpen = open;
    if (this.gapPct > 0 && this.rng() < this.gapPct) {
      const gapZ = normal(this.rng);
      barOpen = open * (1 + this.gapVol * gapZ);
      if (barOpen <= 0) barOpen = open * 0.001;
    }

    // Path-based OHLC: intrabar path so high/low and close come from same path
    const stepVol = vol / Math.sqrt(this.pathSteps);
    const stepDrift = (drift + mr + swing) / this.pathSteps;
    let p = barOpen;
    let high = p;
    let low = p;
    for (let s = 0; s < this.pathSteps; s++) {
      const stepZ = this.tailDf > 2 ? studentT(this.rng, this.tailDf) : normal(this.rng);
      p = p * (1 + stepDrift + stepVol * stepZ);
      if (p <= 0) p = barOpen * 0.001;
      if (p > high) high = p;
      if (p < low) low = p;
    }
    const close = p;
    if (low <= 0) low = barOpen * 0.001;

    const barReturn = (close - barOpen) / barOpen;
    // Volume tied to |return| and regime
    const baseVol = 5000 + this.rng() * 15000;
    const volMult = this.volumeTiedToReturn
      ? (1 + 3 * Math.abs(barReturn)) * R.vM
      : R.vM;
    const volume = baseVol * volMult;

    this.price = close;
    const candle = {
      time: this.history.length,
      open: barOpen,
      high,
      low,
      close,
      volume,
      ...(this.exposeRegime && { regime: this.regime }),
    };
    this.history.push(candle);
    return candle;
  }
}

export class MarketEngine {
  constructor(params) {
    const opts = {
      volPersistence: params.volPersistence,
      tailDf: params.tailDf,
      gapPct: params.gapPct,
      gapVol: params.gapVol,
      pathSteps: params.pathSteps,
      durationWeight: params.durationWeight,
      volumeTiedToReturn: params.volumeTiedToReturn,
      exposeRegime: params.exposeRegime,
    };
    this.gen = new Gen(
      params.seed,
      params.startPrice,
      params.volatility,
      params.bias,
      params.switchPct,
      opts
    );
  }

  tick() { return this.gen.next(); }
  getHistory() { return this.gen.history; }
  getRegimeCounts() { return this.gen.regimeCounts; }
}
