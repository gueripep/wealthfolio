export function formatCurrency(amount, currencyCode = 'USD') {
  const safeAmount = (typeof amount === 'number' && isFinite(amount)) ? amount : 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(safeAmount);
  } catch {
    return safeAmount.toFixed(2);
  }
}

export async function getExchangeRate(exchangeRates, from, to) {
  if (!from || !to) return 1.0;
  if (from === to) return 1.0;
  const pair = `${from}${to}`;
  if (exchangeRates[pair] != null) return exchangeRates[pair];
  try {
    const resp = await fetch(`/api/exchange_rate/${from}/${to}`);
    if (!resp.ok) return 1.0;
    const data = await resp.json();
    return data.rate;
  } catch (e) {
    return 1.0;
  }
}

export function getAssetSummary(portfolio, currentPrices, specificSymbol = null) {
  const summary = {};
  const trackedSymbols = specificSymbol ? [specificSymbol] : Object.keys(portfolio.categories);
  trackedSymbols.forEach(symbol => {
    summary[symbol] = {
      symbol: symbol,
      quantity: 0,
      totalCost: 0,
      category: portfolio.categories[symbol] || portfolio.customCategories[0] || 'Stock',
      transactions: []
    };
  });

  const txs = specificSymbol
    ? portfolio.transactions.filter(t => t.symbol === specificSymbol)
    : portfolio.transactions;

  txs.forEach(tx => {
    if (!summary[tx.symbol]) {
      summary[tx.symbol] = {
        symbol: tx.symbol,
        quantity: 0,
        totalCost: 0,
        category: portfolio.categories[tx.symbol] || portfolio.customCategories[0] || 'Stock',
        transactions: []
      };
    }
    summary[tx.symbol].transactions.push(tx);
    const qty = parseFloat(tx.quantity) || 0;
    const price = parseFloat(tx.price) || 0;
    if (tx.type === 'BUY' || tx.type === 'DEPOSIT') {
      summary[tx.symbol].quantity += qty;
      summary[tx.symbol].totalCost += qty * price;
    } else if (tx.type === 'SELL' || tx.type === 'WITHDRAWAL') {
      if (summary[tx.symbol].quantity > 0) {
        const avgPrice = summary[tx.symbol].totalCost / summary[tx.symbol].quantity;
        summary[tx.symbol].totalCost -= qty * avgPrice;
      }
      summary[tx.symbol].quantity -= qty;
    }
  });

  return specificSymbol ? summary[specificSymbol] : Object.values(summary);
}
