export class StrategyEngine {
  evaluate(strategyDefinition, series, i) {
    const actions = [];
    const val = (id) => series[id]?.[i];
    const prev = (id) => series[id]?.[i - 1];

    for (const rule of strategyDefinition.rules || []) {
      let hit = false;
      const a = val(rule.a);
      const b = val(rule.b);
      const ap = prev(rule.a);
      const bp = prev(rule.b);

      if ([a, b].some((x) => x == null && ['cross', 'above', 'below', 'greaterThan', 'lessThan'].includes(rule.type))) continue;

      switch (rule.type) {
        case 'cross': hit = ap != null && bp != null && ((ap <= bp && a > b) || (ap >= bp && a < b)); break;
        case 'above': hit = a > b; break;
        case 'below': hit = a < b; break;
        case 'greaterThan': hit = a > (rule.value ?? b); break;
        case 'lessThan': hit = a < (rule.value ?? b); break;
        case 'slopePositive': hit = ap != null && a - ap > 0; break;
        case 'slopeNegative': hit = ap != null && a - ap < 0; break;
      }
      if (hit) actions.push(rule.action);
    }

    return actions;
  }
}
