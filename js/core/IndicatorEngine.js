import SMA from '../indicators/SMA.js';
import EMA from '../indicators/EMA.js';

export class IndicatorEngine {
  constructor(custom = []) {
    this.registry = new Map();
    [SMA, EMA, ...custom].forEach((i) => this.registry.set(i.name, i));
  }

  list() {
    return [...this.registry.values()].map((i) => ({ name: i.name, paramSchema: i.paramSchema }));
  }

  compute(candles, indicators = []) {
    const out = {};
    for (const spec of indicators) {
      const ind = this.registry.get(spec.name);
      if (!ind) throw new Error(`Unknown indicator: ${spec.name}`);
      out[spec.id] = ind.calculate(candles, spec.params || {});
    }
    return out;
  }
}
