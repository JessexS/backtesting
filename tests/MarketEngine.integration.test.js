import { MarketEngine } from '../js/market/MarketEngine.js';

test('tick loop produces valid candles', () => {
  const m = new MarketEngine({ seed: 42, barSeconds: 60 });
  for (let i = 0; i < 100; i++) m.tick();
  const history = m.getHistory();
  expect(history.length).toBeGreaterThan(0);
  for (const c of history) {
    expect(Number.isFinite(c.open)).toBe(true);
    expect(Number.isFinite(c.high)).toBe(true);
    expect(Number.isFinite(c.low)).toBe(true);
    expect(Number.isFinite(c.close)).toBe(true);
    expect(Number.isFinite(c.volume)).toBe(true);
  }
});

test('reset(seed) reproduces sequence', () => {
  const m = new MarketEngine({ seed: 7, barSeconds: 60 });
  for (let i = 0; i < 10; i++) m.tick();
  const firstRun = m.getHistory().map((c) => c.close);
  m.reset(7);
  for (let i = 0; i < 10; i++) m.tick();
  const secondRun = m.getHistory().map((c) => c.close);
  expect(secondRun).toEqual(firstRun);
});
