import { TickMarketSimulator } from '../js/core/TickMarketSimulator.js';

test('deterministic with same seed', () => {
  const a = new TickMarketSimulator({ seed: 42, startPrice: 100 });
  const b = new TickMarketSimulator({ seed: 42, startPrice: 100 });
  const pa = [];
  const pb = [];
  for (let i = 0; i < 60; i++) {
    pa.push(a.nextTick().price);
    pb.push(b.nextTick().price);
  }
  expect(pa).toEqual(pb);
});
