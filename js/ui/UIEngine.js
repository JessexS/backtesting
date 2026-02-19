// ═══════════════════════════════════════════════════════════════
// UIEngine — All DOM manipulation, Chart, EquityChart, mobile tabs
// ═══════════════════════════════════════════════════════════════

import { REGIMES, REGIME_NAMES } from '../market/MarketEngine.js';

// ─── CandlestickChart ───

class CandlestickChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    this.markers = [];
    this.offset = 0;
    this.barWidth = 9;
    this.hoverIdx = -1;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartOffset = 0;
    this.indicatorOverlays = {};
    this._bind();
  }

  _bind() {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        this.barWidth += e.deltaY < 0 ? 1 : -1;
        this.barWidth = Math.max(3, Math.min(30, this.barWidth));
      } else {
        this.offset += e.deltaY > 0 ? 3 : -3;
      }
      this._clampOffset();
      this.draw();
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartOffset = this.offset;
    });

    const onMove = (e) => {
      if (this.isDragging) {
        const dx = this.dragStartX - e.clientX;
        this.offset = this.dragStartOffset + Math.round(dx / (this.barWidth + 1));
        this._clampOffset();
        this.draw();
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const idx = this.offset + Math.floor(mx / (this.barWidth + 1));
        if (idx >= 0 && idx < this.data.length) {
          this.hoverIdx = idx;
          this._showTooltip(this.data[idx], idx);
        } else {
          this.hoverIdx = -1;
          document.getElementById('tooltip').style.display = 'none';
        }
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', () => { this.isDragging = false; });
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIdx = -1;
      document.getElementById('tooltip').style.display = 'none';
    });

    // Touch support
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.dragStartX = e.touches[0].clientX;
        this.dragStartOffset = this.offset;
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) {
        const dx = this.dragStartX - e.touches[0].clientX;
        this.offset = this.dragStartOffset + Math.round(dx / (this.barWidth + 1));
        this._clampOffset();
        this.draw();
      }
    }, { passive: true });
    this.canvas.addEventListener('touchend', () => { this.isDragging = false; }, { passive: true });
  }

  _clampOffset() {
    const visible = Math.floor(this.canvas.width / (this.barWidth + 1));
    this.offset = Math.max(0, Math.min(Math.max(0, this.data.length - visible), this.offset));
  }

  _showTooltip(c, idx) {
    const tt = document.getElementById('tooltip');
    tt.style.display = 'block';
    document.getElementById('tta').textContent = 'Bar ' + c.time;
    document.getElementById('tto').textContent = c.open.toFixed(2);
    document.getElementById('tth').textContent = c.high.toFixed(2);
    document.getElementById('ttl').textContent = c.low.toFixed(2);
    document.getElementById('ttc').textContent = c.close.toFixed(2);
    document.getElementById('ttv').textContent = Math.round(c.volume).toLocaleString();
    document.getElementById('ttr').textContent = c.regime;
    const chgEl = document.getElementById('ttchg');
    if (idx > 0 && this.data[idx - 1]) {
      const prev = this.data[idx - 1].close;
      const pct = ((c.close - prev) / prev * 100).toFixed(2);
      chgEl.textContent = (pct >= 0 ? '+' : '') + pct + '%';
      chgEl.style.color = pct >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      chgEl.textContent = '—';
      chgEl.style.color = '';
    }
  }

  setData(d) { this.data = d; }
  addMarker(idx, type, price) { this.markers.push({ idx, type, price }); }
  clearMarkers() { this.markers = []; }
  setIndicatorOverlays(o) { this.indicatorOverlays = o || {}; }

  autoScroll() {
    const visible = Math.floor(this.canvas.width / (this.barWidth + 1));
    if (this.data.length > visible) this.offset = this.data.length - visible;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  draw() {
    const W = this.canvas.width, H = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    if (!this.data.length) return;

    const barStep = this.barWidth + 1;
    const visible = Math.floor(W / barStep);
    const start = Math.max(0, this.offset);
    const end = Math.min(this.data.length, start + visible);
    if (end <= start) return;

    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < end; i++) {
      if (this.data[i].low < lo) lo = this.data[i].low;
      if (this.data[i].high > hi) hi = this.data[i].high;
    }
    for (const name in this.indicatorOverlays) {
      const ov = this.indicatorOverlays[name];
      for (let i = start; i < end; i++) {
        const v = ov.values[i];
        if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
    const pad = (hi - lo) * 0.05;
    lo -= pad; hi += pad;
    if (hi === lo) { hi += 1; lo -= 1; }
    const toY = (p) => H - (p - lo) / (hi - lo) * H;

    // Grid
    ctx.strokeStyle = 'rgba(28,40,48,0.6)';
    ctx.lineWidth = 0.5;
    ctx.fillStyle = '#4a6070';
    ctx.font = '9px "IBM Plex Mono"';
    for (let g = 0; g <= 6; g++) {
      const gy = (g / 6) * H;
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      ctx.fillText((hi - (g / 6) * (hi - lo)).toFixed(2), 4, gy - 2);
    }

    // Candles
    for (let i = start; i < end; i++) {
      const c = this.data[i];
      const x = (i - start) * barStep;
      const bull = c.close >= c.open;
      const color = bull ? '#26de81' : '#fc5c65';
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      const cx = x + this.barWidth / 2;
      ctx.beginPath(); ctx.moveTo(cx, toY(c.high)); ctx.lineTo(cx, toY(c.low)); ctx.stroke();
      const bt = toY(Math.max(c.open, c.close));
      const bb = toY(Math.min(c.open, c.close));
      ctx.fillStyle = color;
      ctx.fillRect(x, bt, this.barWidth, Math.max(1, bb - bt));
    }

    // Indicator overlays
    for (const name in this.indicatorOverlays) {
      const ov = this.indicatorOverlays[name];
      ctx.strokeStyle = ov.color || '#fff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(ov.dash || []);
      ctx.beginPath();
      let started = false;
      for (let i = start; i < end; i++) {
        const v = ov.values[i];
        if (v != null) {
          const x = (i - start) * barStep + this.barWidth / 2;
          const y = toY(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Markers
    for (const m of this.markers) {
      if (m.idx < start || m.idx >= end) continue;
      const x = (m.idx - start) * barStep + this.barWidth / 2;
      const y = toY(m.price);
      ctx.fillStyle = (m.type === 'buy' || m.type === 'long') ? '#26de81' : '#fc5c65';
      ctx.beginPath();
      if (m.type === 'buy' || m.type === 'long') {
        ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 8); ctx.lineTo(x + 5, y + 8);
      } else {
        ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 8); ctx.lineTo(x + 5, y - 8);
      }
      ctx.fill();
    }

    // Crosshair
    if (this.hoverIdx >= start && this.hoverIdx < end) {
      const hx = (this.hoverIdx - start) * barStep + this.barWidth / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, H); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

// ─── EquityChart ───

class EquityChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    this.overlays = [];
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  setData(d) { this.data = d; }
  setOverlays(o) { this.overlays = o || []; }

  draw() {
    const W = this.canvas.width, H = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const all = [this.data, ...this.overlays];
    let lo = Infinity, hi = -Infinity;
    for (const arr of all) for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) { lo -= 100; hi += 100; }
    const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
    const toY = (v) => H - (v - lo) / (hi - lo) * H;

    for (const ov of this.overlays) {
      if (ov.length < 2) continue;
      ctx.strokeStyle = 'rgba(100,150,200,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < ov.length; i++) {
        const x = i / (ov.length - 1) * W;
        if (i === 0) ctx.moveTo(x, toY(ov[i])); else ctx.lineTo(x, toY(ov[i]));
      }
      ctx.stroke();
    }

    if (this.data.length < 2) return;
    const isPos = this.data[this.data.length - 1] >= this.data[0];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, isPos ? 'rgba(38,222,129,0.3)' : 'rgba(252,92,101,0.3)');
    grad.addColorStop(1, 'rgba(6,8,10,0)');
    ctx.beginPath();
    for (let i = 0; i < this.data.length; i++) {
      const x = i / (this.data.length - 1) * W;
      if (i === 0) ctx.moveTo(x, toY(this.data[i])); else ctx.lineTo(x, toY(this.data[i]));
    }
    ctx.strokeStyle = isPos ? '#26de81' : '#fc5c65';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.fillStyle = '#4a6070'; ctx.font = '9px "IBM Plex Mono"';
    ctx.fillText(hi.toFixed(0), 4, 12);
    ctx.fillText(lo.toFixed(0), 4, H - 4);
  }
}

// ─── UIEngine ───

export class UIEngine {
  constructor() {
    this.chart = null;
    this.eqChart = null;
    this._lastTradeIdx = 0;
    this._mobileTab = 'chart';
    this._initMobileTabs();
    this._initPanelCollapse();
    this._initSliderBindings();
    this._initMcModeToggle();
  }

  initCharts() {
    this.chart = new CandlestickChart('cc');
    this.chart.resize();
    this.eqChart = new EquityChart('eqc');
    this.eqChart.resize();
  }

  resize() {
    if (this.chart) { this.chart.resize(); this.chart.draw(); }
    if (this.eqChart) { this.eqChart.resize(); this.eqChart.draw(); }
  }

  // ─── Mobile Tabs ───

  _initMobileTabs() {
    const tabs = document.querySelectorAll('.mob-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this._switchMobileTab(tab.dataset.tab);
      });
    });
  }

  _switchMobileTab(tab) {
    this._mobileTab = tab;
    const left = document.getElementById('sidebarLeft');
    const main = document.getElementById('mainArea');
    const right = document.getElementById('sidebarRight');

    [left, main, right].forEach((el) => el.classList.remove('mob-active'));

    switch (tab) {
      case 'chart':
        left.classList.add('mob-active');
        main.classList.add('mob-active');
        break;
      case 'trading':
        right.classList.add('mob-active');
        // Show trading panels, hide MC
        this._showPanels(['panelStrategy', 'panelPositions'], right);
        break;
      case 'montecarlo':
        right.classList.add('mob-active');
        this._showPanels(['panelMonteCarlo'], right);
        break;
      case 'performance':
        right.classList.add('mob-active');
        this._showPanels(['panelPerformance', 'panelTradeLog'], right);
        break;
    }
    setTimeout(() => this.resize(), 50);
  }

  _showPanels(ids, container) {
    // On mobile, all panels in right sidebar are always in DOM
    // We just scroll to the right area
    const panels = container.querySelectorAll('.panel');
    panels.forEach((p) => {
      p.style.display = ids.some((id) => p.id === id || !p.id) ? '' : 'none';
    });
  }

  // ─── Panel Collapse ───

  _initPanelCollapse() {
    document.querySelectorAll('.panel-collapse').forEach((panel) => {
      panel.querySelector('.panel-title').addEventListener('click', () => {
        panel.classList.toggle('open');
      });
      const body = panel.querySelector('.panel-body');
      if (body) body.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  // ─── Slider Bindings ───

  _initSliderBindings() {
    const bind = (id, labelId, fmt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        document.getElementById(labelId).textContent = fmt(el.value);
      });
    };
    bind('rS', 'lbS', (v) => (+v).toLocaleString('fi'));
    bind('rV', 'lbV', (v) => v + '%');
    bind('rB', 'lbB', (v) => (+v >= 0 ? '+' : '') + v + '%');
    bind('rSw', 'lbSw', (v) => v + '%');
    bind('rSd', 'lbSd', (v) => v);
    bind('mcIntensity', 'lbMcIntensity', (v) => v + '%');
  }

  // ─── MC Mode Toggle ───

  _initMcModeToggle() {
    const modeEl = document.getElementById('mcMode');
    if (!modeEl) return;
    modeEl.addEventListener('change', () => {
      const mode = modeEl.value;
      const show = (id, vis) => {
        const el = document.getElementById(id);
        if (el) el.style.display = vis ? '' : 'none';
      };
      show('mcChaosPresetGroup', mode === 'combined' || mode === 'scramble');
      show('mcScrambleModeGroup', mode === 'scramble' || mode === 'combined');
      show('mcIntensityGroup', mode === 'scramble' || mode === 'combined');
      show('mcScrambleChecks', mode === 'scramble' || mode === 'combined');
    });
  }

  // ─── Speed Grid ───

  initSpeedGrid(callback) {
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        callback(+btn.dataset.ms);
      });
    });
  }

  // ─── State Updates ───

  setRunningState(state) {
    const dot = document.getElementById('dot');
    const badge = document.getElementById('liveBadge');
    const btnStart = document.getElementById('btnStart');
    const btnPause = document.getElementById('btnPause');
    const btnStop = document.getElementById('btnStop');

    dot.className = 'logo-dot';
    badge.className = 'live-badge';

    switch (state) {
      case 'running':
        dot.classList.add('live');
        badge.classList.add('show', 'live');
        badge.textContent = 'LIVE';
        btnStart.disabled = true;
        btnPause.disabled = false;
        btnStop.disabled = false;
        break;
      case 'paused':
        dot.classList.add('paused');
        badge.classList.add('show', 'paused');
        badge.textContent = 'PAUSED';
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = false;
        break;
      case 'stopped':
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = true;
        document.getElementById('btnExport').disabled = false;
        document.getElementById('btnExportTrades').disabled = false;
        break;
      case 'idle':
        btnStart.disabled = false;
        btnPause.disabled = true;
        btnStop.disabled = true;
        break;
    }
  }

  setStrategyEnabled(enabled) {
    document.getElementById('manualTradeBtns').style.display = enabled ? 'none' : '';
    document.getElementById('tradeBlockedMsg').classList.toggle('show', enabled);
  }

  showEquityArea(show) {
    document.getElementById('eqArea').style.display = show ? 'block' : 'none';
  }

  // ─── Data Updates ───

  updateTopbar(history, trading) {
    const n = history.length;
    if (!n) return;
    const c = history[n - 1];

    document.getElementById('tkP').textContent = c.close.toFixed(2);
    const chg = n > 1 ? ((c.close - history[0].close) / history[0].close * 100).toFixed(2) : '0.00';
    const chgEl = document.getElementById('tkC');
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg + '%';
    chgEl.className = 'tick-val ' + (chg >= 0 ? 'fu' : 'fd');

    let allHigh = -Infinity, allLow = Infinity;
    for (const h of history) { if (h.high > allHigh) allHigh = h.high; if (h.low < allLow) allLow = h.low; }
    document.getElementById('tkH').textContent = allHigh.toFixed(2);
    document.getElementById('tkL').textContent = allLow.toFixed(2);
    document.getElementById('tkV').textContent = Math.round(c.volume).toLocaleString();
    document.getElementById('tkR').textContent = c.regime;
    document.getElementById('tkEq').textContent = trading.equity.toFixed(0);
  }

  updateLeftSidebar(history, regimeCounts) {
    const n = history.length;
    if (!n) return;
    const c = history[n - 1];

    document.getElementById('liveCount').textContent = n;
    document.getElementById('stS').textContent = history[0].open.toFixed(2);
    document.getElementById('stN').textContent = c.close.toFixed(2);

    let allHigh = -Infinity, allLow = Infinity;
    for (const h of history) { if (h.high > allHigh) allHigh = h.high; if (h.low < allLow) allLow = h.low; }
    document.getElementById('stH').textContent = allHigh.toFixed(2);
    document.getElementById('stL').textContent = allLow.toFixed(2);

    const ret = ((c.close - history[0].open) / history[0].open * 100).toFixed(2);
    const retEl = document.getElementById('stRt');
    retEl.textContent = (ret >= 0 ? '+' : '') + ret + '%';
    retEl.className = 'stat-value ' + (ret >= 0 ? 'up' : 'down');

    const total = Object.values(regimeCounts).reduce((s, v) => s + v, 0);
    REGIME_NAMES.forEach((r) => {
      document.getElementById('pct-' + r).textContent = (total > 0 ? (regimeCounts[r] / total * 100).toFixed(0) : 0) + '%';
      const ri = document.getElementById('ri-' + r);
      ri.style.borderLeft = c.regime === r ? '2px solid ' + REGIMES[r].color : '2px solid transparent';
    });
  }

  updateDrawdown(equityHistory) {
    let peak = 0, maxDD = 0;
    for (const eq of equityHistory) { if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
    document.getElementById('stDD').textContent = (maxDD * 100).toFixed(1) + '%';
  }

  updateTimeline(history) {
    const n = history.length;
    if (n < 2) return;
    let html = '';
    let segStart = 0;
    for (let i = 1; i <= n; i++) {
      if (i === n || history[i].regime !== history[segStart].regime) {
        const w = (i - segStart) / n * 100;
        html += `<div style="width:${w}%;height:100%;background:${REGIMES[history[segStart].regime].color}" title="${history[segStart].regime} (${Math.round(w)}%)"></div>`;
        segStart = i;
      }
    }
    document.getElementById('tlBar').innerHTML = html;
  }

  updatePerformance(metrics, trading) {
    const uPnl = trading.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const rPnl = trading.closedTrades.reduce((s, t) => s + t.pnl, 0);

    document.getElementById('pmBal').textContent = trading.balance.toFixed(2);
    document.getElementById('pmEq').textContent = trading.equity.toFixed(2);
    this._setPnl('pmUPnl', uPnl);
    this._setPnl('pmRPnl', rPnl);
    document.getElementById('pmWR').textContent = (metrics.winRate * 100).toFixed(1) + '%';
    document.getElementById('pmPF').textContent = metrics.profitFactor.toFixed(2);
    document.getElementById('pmSh').textContent = metrics.sharpe.toFixed(2);
    document.getElementById('pmDD').textContent = (metrics.maxDrawdown * 100).toFixed(1) + '%';
    document.getElementById('pmExp').textContent = metrics.expectancy.toFixed(2);
    document.getElementById('pmKe').textContent = (metrics.kelly * 100).toFixed(1) + '%';
    document.getElementById('pmAvgR').textContent = metrics.avgR.toFixed(2);
    document.getElementById('pmMCL').textContent = metrics.maxConsecLoss;
    document.getElementById('pmExpo').textContent = (metrics.exposure * 100).toFixed(1) + '%';
    document.getElementById('pmFees').textContent = metrics.totalFees.toFixed(2);
  }

  _setPnl(id, val) {
    const el = document.getElementById(id);
    el.textContent = val.toFixed(2);
    el.className = 'stat-value sm ' + (val >= 0 ? 'up' : 'down');
  }

  updatePositions(positions, onClose) {
    let html = '';
    for (const p of positions) {
      const pnlPct = ((p.unrealizedPnl / p.margin) * 100).toFixed(1);
      const cls = p.unrealizedPnl >= 0 ? 'up' : 'down';
      const dirColor = p.direction === 'long' ? 'var(--green)' : 'var(--red)';
      html += `<div class="pos-item"><div class="pos-head"><span style="color:${dirColor}">${p.direction.toUpperCase()} #${p.id}</span><button class="pos-close-btn" data-id="${p.id}">Close</button></div><div class="pos-detail"><span>Entry: ${p.entryPrice.toFixed(2)}</span><span>Size: ${p.size.toFixed(4)}</span><span class="${cls}">PnL: ${p.unrealizedPnl.toFixed(2)} (${pnlPct}%)</span></div></div>`;
    }
    const list = document.getElementById('posList');
    list.innerHTML = html;
    document.getElementById('posCount').textContent = '(' + positions.length + ')';

    list.querySelectorAll('.pos-close-btn').forEach((btn) => {
      btn.addEventListener('click', () => onClose(+btn.dataset.id));
    });
  }

  updateTradeLog(trades) {
    let html = '';
    const start = Math.max(0, trades.length - 30);
    for (let i = trades.length - 1; i >= start; i--) {
      const t = trades[i];
      const dirColor = t.direction === 'long' ? 'var(--green)' : 'var(--red)';
      const cls = t.pnl >= 0 ? 'up' : 'down';
      html += `<div style="font-size:9px;padding:2px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="color:${dirColor}">${t.direction.toUpperCase()} #${t.id}</span><span>${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}</span><span class="${cls}">${t.pnl.toFixed(2)}</span><span style="color:var(--muted)">${t.reason}</span></div>`;
    }
    document.getElementById('tradeLog').innerHTML = html;
    document.getElementById('tradeCount').textContent = '(' + trades.length + ')';
  }

  updateChart(history, strategyIndicators) {
    if (!this.chart) return;
    this.chart.setData(history);

    if (strategyIndicators) {
      const overlays = {};
      for (const name in strategyIndicators) {
        if (name.startsWith('_')) continue;
        const ind = strategyIndicators[name];
        if (ind?.values) overlays[name] = ind;
      }
      this.chart.setIndicatorOverlays(overlays);
      this._updateIndicatorLegend(overlays);
    }

    this.chart.autoScroll();
    this.chart.draw();
  }

  _updateIndicatorLegend(overlays) {
    let html = '';
    for (const name in overlays) {
      html += `<span class="ind-badge" style="border-color:${overlays[name].color};color:${overlays[name].color}">${name}</span>`;
    }
    document.getElementById('indLegend').innerHTML = html;
  }

  updateEquityChart(equityHistory, overlays) {
    if (!this.eqChart) return;
    this.eqChart.setData(equityHistory);
    if (overlays) this.eqChart.setOverlays(overlays);
    this.eqChart.resize();
    this.eqChart.draw();
  }

  addTradeMarkers(chart, trades, fromIdx) {
    for (let i = fromIdx; i < trades.length; i++) {
      const t = trades[i];
      chart.addMarker(t.exitBar, t.direction === 'long' ? 'sell' : 'buy', t.exitPrice);
    }
  }

  flash(isGreen) {
    const ncf = document.getElementById('ncf');
    ncf.style.opacity = '0.5';
    ncf.style.background = isGreen ? 'rgba(38,222,129,0.1)' : 'rgba(252,92,101,0.1)';
    setTimeout(() => { ncf.style.opacity = '0'; }, 120);
  }

  showStratError(msg) {
    const el = document.getElementById('stratError');
    el.textContent = msg;
    el.classList.toggle('show', !!msg);
    el.style.color = msg && !msg.startsWith('OK') ? '' : 'var(--green)';
  }

  // ─── Monte Carlo Results ───

  renderMCResults(summary) {
    if (!summary) { document.getElementById('mcResults').innerHTML = ''; return; }

    const row = (label, obj) =>
      `<tr><td>${label}</td><td>${obj.mean.toFixed(2)}</td><td>${obj.median.toFixed(2)}</td><td>${obj.min.toFixed(2)}</td><td>${obj.max.toFixed(2)}</td></tr>`;

    let html = '<table class="mc-table"><thead><tr><th>Metric</th><th>Mean</th><th>Median</th><th>Min</th><th>Max</th></tr></thead><tbody>';
    html += row('Return %', summary.returns);
    html += row('Sharpe', summary.sharpe);
    html += row('Max DD %', summary.maxDD);
    html += row('Win Rate %', summary.winRate);
    html += row('PF', summary.profitFactor);
    html += row('Score', summary.score);
    html += `<tr><td>Risk of Ruin</td><td colspan="4">${(summary.riskOfRuin.mean * 100).toFixed(2)}% (max: ${(summary.riskOfRuin.max * 100).toFixed(2)}%)</td></tr>`;
    html += `<tr><td>95% Tail Loss</td><td colspan="4">${summary.tailLoss95.toFixed(2)}%</td></tr>`;
    html += `<tr><td>Stability</td><td colspan="4">${summary.stabilityScore.toFixed(3)}</td></tr>`;
    html += '</tbody></table>';
    html += `<div style="margin-top:6px;font-size:10px;color:var(--muted)">Positive: <span style="color:var(--green)">${Math.round(summary.positiveRate * 100)}% of ${summary.totalRuns} runs</span></div>`;

    document.getElementById('mcResults').innerHTML = html;
    document.getElementById('btnMcExportCsv').disabled = false;
    document.getElementById('btnMcExportJson').disabled = false;
  }

  setMCProgress(current, total) {
    const bar = document.getElementById('mcProgress');
    const fill = document.getElementById('mcProgressFill');
    const text = document.getElementById('mcProgressText');
    if (total <= 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    fill.style.width = (current / total * 100) + '%';
    text.textContent = `${current}/${total}`;
  }

  // ─── Reset ───

  reset() {
    this._lastTradeIdx = 0;
    document.getElementById('liveCount').textContent = '0';
    ['tkP', 'tkC', 'tkH', 'tkL', 'tkV', 'tkR', 'tkEq', 'stS', 'stN', 'stH', 'stL', 'stDD', 'stRt'].forEach((id) => {
      document.getElementById(id).textContent = '—';
    });
    ['pmBal', 'pmEq', 'pmUPnl', 'pmRPnl', 'pmWR', 'pmPF', 'pmSh', 'pmDD', 'pmExp', 'pmKe', 'pmAvgR', 'pmMCL', 'pmExpo', 'pmFees'].forEach((id) => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('tlBar').innerHTML = '';
    document.getElementById('indLegend').innerHTML = '';
    document.getElementById('posList').innerHTML = '';
    document.getElementById('posCount').textContent = '(0)';
    document.getElementById('tradeLog').innerHTML = '';
    document.getElementById('tradeCount').textContent = '(0)';
    document.getElementById('btnExport').disabled = true;
    document.getElementById('btnExportTrades').disabled = true;
    this.showEquityArea(false);
    document.getElementById('mcResults').innerHTML = '';
    if (this.chart) { this.chart.data = []; this.chart.markers = []; this.chart.indicatorOverlays = {}; this.chart.draw(); }
    if (this.eqChart) { this.eqChart.data = []; this.eqChart.overlays = []; this.eqChart.draw(); }
  }
}
