export function runExecution(candles, actionsByIndex, executionModel = {}) {
  const fee = (executionModel.feePct ?? 0.04) / 100;
  const slippage = (executionModel.slippagePct ?? 0.05) / 100;
  const sizePct = (executionModel.sizePct ?? 100) / 100;
  let cash = executionModel.startBalance ?? 10_000;
  let qty = 0;
  let entry = null;
  const trades = [];
  const equity = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const actions = actionsByIndex[i] || [];
    const pxBuy = c.close * (1 + slippage);
    const pxSell = c.close * (1 - slippage);

    if (actions.includes('buy') && qty === 0) {
      const alloc = cash * sizePct;
      qty = alloc / pxBuy;
      const fees = alloc * fee;
      cash -= alloc + fees;
      entry = pxBuy;
      trades.push({ side: 'buy', time: c.time, price: pxBuy, fees });
    }

    if (actions.includes('sell') && qty > 0) {
      const value = qty * pxSell;
      const fees = value * fee;
      const pnl = value - fees - qty * entry;
      cash += value - fees;
      trades.push({ side: 'sell', time: c.time, price: pxSell, fees, pnl });
      qty = 0;
      entry = null;
    }

    equity.push(cash + qty * c.close);
  }

  return { trades, equity, finalBalance: equity[equity.length - 1] ?? cash };
}
