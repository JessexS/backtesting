// ═══════════════════════════════════════════════════════════════
// StrategyLoader — Discovers and loads strategies from /strategies/
// Populates dropdown, excludes files starting with _
// ═══════════════════════════════════════════════════════════════

export class StrategyLoader {
  constructor() {
    this.strategies = new Map(); // name -> { module, name, fileName }
    this.manifestUrl = 'strategies/manifest.json';
  }

  async loadAll() {
    try {
      const res = await fetch(this.manifestUrl);
      if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
      const manifest = await res.json();

      for (const fileName of manifest.strategies) {
        if (fileName.startsWith('_')) continue;
        try {
          const mod = await import(`../../strategies/${fileName}`);
          const strategy = mod.default;
          if (!strategy || !strategy.name) {
            console.warn(`Strategy ${fileName} missing 'name' export, skipping`);
            continue;
          }
          this.strategies.set(strategy.name, { module: strategy, name: strategy.name, fileName });
        } catch (e) {
          console.warn(`Failed to load strategy ${fileName}:`, e.message);
        }
      }
    } catch (e) {
      console.warn('Strategy manifest not found, using empty list:', e.message);
    }
  }

  getNames() {
    return Array.from(this.strategies.keys());
  }

  get(name) {
    const entry = this.strategies.get(name);
    return entry ? entry.module : null;
  }

  getAll() {
    return Array.from(this.strategies.values());
  }

  populateDropdown(selectEl) {
    // Keep the "Custom" option
    const customOpt = selectEl.querySelector('option[value="custom"]');
    selectEl.innerHTML = '';
    if (customOpt) selectEl.appendChild(customOpt);

    for (const [name, entry] of this.strategies) {
      const opt = document.createElement('option');
      opt.value = entry.fileName;
      opt.textContent = name;
      selectEl.appendChild(opt);
    }
  }

  getStrategyByFileName(fileName) {
    for (const [, entry] of this.strategies) {
      if (entry.fileName === fileName) return entry.module;
    }
    return null;
  }
}
