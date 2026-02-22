export const DEFAULT_TIMEFRAME = '1h';

export const TIMEFRAME_TO_MS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export const DEFAULT_SEED = 42;
export const HISTORY_MAX_BARS = 5000;
