import { CandleAggregator } from '../js/core/CandleAggregator.js';

test('aggregates ticks into candles and closes on boundary', () => {
  const agg = new CandleAggregator(60_000);
  agg.pushTick({ timestamp: 0, price: 100, size: 1, bestBid: 99.9, bestAsk: 100.1, spread: 0.2, mid: 100 });
  agg.pushTick({ timestamp: 30_000, price: 101, size: 2, bestBid: 100.9, bestAsk: 101.1, spread: 0.2, mid: 101 });
  agg.pushTick({ timestamp: 60_000, price: 99, size: 1, bestBid: 98.9, bestAsk: 99.1, spread: 0.2, mid: 99 });

  const candles = agg.getCandles(false);
  expect(candles).toHaveLength(1);
  expect(candles[0].open).toBe(100);
  expect(candles[0].high).toBe(101);
  expect(candles[0].low).toBe(100);
  expect(candles[0].close).toBe(101);
  expect(candles[0].volume).toBe(3);
});
