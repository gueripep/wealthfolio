import { getExchangeRate } from './helpers';

export async function calculateAnalytics(portfolio, currentPrices, exchangeRates, period, assets) {
  const symbols = assets.map(a => a.symbol);
  
  const ratePromises = symbols.map(s => {
    const currency = s === '$$CASH_TX' ? portfolio.baseCurrency : (currentPrices[s]?.currency || 'USD');
    return getExchangeRate(exchangeRates, currency, portfolio.baseCurrency);
  });
  await Promise.all(ratePromises);

  const historyPromises = symbols.map(s => fetch(`/api/history/${s}?period=${period}`).then(r => r.json()).catch(() => []));
  const histories = await Promise.all(historyPromises);

  const historyMap = {};
  symbols.forEach((s, i) => {
    historyMap[s] = Array.isArray(histories[i]) ? histories[i] : [];
  });

  let allDates = [];
  const dateSet = new Set();
  histories.forEach(h => {
    if (Array.isArray(h)) h.forEach(d => dateSet.add(d.date));
  });
  allDates = Array.from(dateSet).sort();

  if (allDates.length === 0) {
    return null;
  }

  const periodStartPrices = {};
  symbols.forEach(s => {
    const firstData = historyMap[s][0];
    if (firstData) periodStartPrices[s] = firstData.close;
  });

  const sortedTxs = [...portfolio.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

  let portfolioGains = [];
  let portfolioValues = [];
  const lastKnownPrices = { ...periodStartPrices };
  const assetBalances = {};
  const assetCosts = {};
  let realizedGainBase = 0;

  symbols.forEach(s => {
    assetBalances[s] = 0;
    assetCosts[s] = 0;
  });

  let txIdx = 0;

  allDates.forEach(dateStr => {
    let dailyUnrealizedGainBase = 0;
    let dailyValueBase = 0;
    const dateObj = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T23:59:59.999Z');

    while (txIdx < sortedTxs.length && new Date(sortedTxs[txIdx].date) <= dateObj) {
      const tx = sortedTxs[txIdx];
      if (assetBalances.hasOwnProperty(tx.symbol)) {
        const currency = tx.symbol === '$$CASH_TX' ? portfolio.baseCurrency : (currentPrices[tx.symbol]?.currency || 'USD');
        const pair = `${currency}${portfolio.baseCurrency}`;
        const rate = exchangeRates[pair] || 1.0;

        if (tx.type === 'BUY' || tx.type === 'DEPOSIT') {
          assetBalances[tx.symbol] += tx.quantity;
          assetCosts[tx.symbol] += tx.quantity * tx.price;
        } else if (tx.type === 'SELL' || tx.type === 'WITHDRAWAL') {
          if (assetBalances[tx.symbol] > 0) {
            const avgPrice = assetCosts[tx.symbol] / assetBalances[tx.symbol];
            const realized = tx.quantity * (tx.price - avgPrice);
            realizedGainBase += realized * rate;
            assetCosts[tx.symbol] -= tx.quantity * avgPrice;
          }
          assetBalances[tx.symbol] -= tx.quantity;
        }
      }
      txIdx++;
    }

    symbols.forEach(symbol => {
      if (symbol === '$$CASH_TX') {
        lastKnownPrices[symbol] = 1.0;
      } else {
        const dayData = historyMap[symbol].find(d => d.date === dateStr);
        if (dayData) lastKnownPrices[symbol] = dayData.close;
      }

      const qty = assetBalances[symbol];
      const price = lastKnownPrices[symbol];
      const costBasis = assetCosts[symbol];

      if (price !== undefined) {
        const currency = symbol === '$$CASH_TX' ? portfolio.baseCurrency : (currentPrices[symbol]?.currency || 'USD');
        const pair = `${currency}${portfolio.baseCurrency}`;
        const rate = exchangeRates[pair] || 1.0;
        const valueBase = (qty * price) * rate;
        dailyValueBase += valueBase;
        dailyUnrealizedGainBase += valueBase - (costBasis * rate);
      }
    });
    portfolioGains.push(dailyUnrealizedGainBase + realizedGainBase);
    portfolioValues.push(dailyValueBase);
  });

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  let currentLiveValueTotal = 0;
  let currentLiveCostTotal = 0;

  for (const asset of assets) {
    const priceData = currentPrices[asset.symbol] || { price: 0, currency: 'USD' };
    const rate = exchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] || 1.0;
    currentLiveValueTotal += asset.quantity * priceData.price * rate;
    currentLiveCostTotal += asset.totalCost * rate;
  }

  let currentLiveGainTotal = (currentLiveValueTotal - currentLiveCostTotal) + realizedGainBase;

  const lastDate = allDates[allDates.length - 1];
  if (!lastDate.includes(todayStr)) {
    allDates.push(new Date().toISOString());
    portfolioGains.push(currentLiveGainTotal);
    portfolioValues.push(currentLiveValueTotal);
  } else {
    portfolioGains[portfolioGains.length - 1] = currentLiveGainTotal;
    portfolioValues[portfolioValues.length - 1] = currentLiveValueTotal;
  }

  if (period === 'max') {
    const firstMovingIdx = portfolioGains.findIndex(g => g !== 0);
    if (firstMovingIdx > 0) {
      allDates = allDates.slice(firstMovingIdx);
      portfolioGains = portfolioGains.slice(firstMovingIdx);
      portfolioValues = portfolioValues.slice(firstMovingIdx);
    }
  }

  const startPoint = portfolioGains[0] || 0;
  const relativeGains = portfolioGains.map(g => g - startPoint);

  let sp500RelativeGains = [];
  try {
    const spResp = await fetch(`/api/history/%5EGSPC?period=${period}`);
    const spHistory = spResp.ok ? await spResp.json() : [];
    if (Array.isArray(spHistory) && spHistory.length > 0) {
      const spSorted = spHistory.slice().sort((a, b) => a.date < b.date ? -1 : 1);
      const portfolioBase = portfolioValues[0] || 1;
      let spBase = null;
      sp500RelativeGains = allDates.map(dateStr => {
        let lo = 0, hi = spSorted.length - 1, found = null;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (spSorted[mid].date <= dateStr) { found = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (found === null) return null;
        const spClose = spSorted[found].close;
        if (spBase === null) spBase = spClose;
        return ((spClose / spBase) - 1) * portfolioBase;
      });
    }
  } catch (_) {}

  return {
    allDates,
    relativeGains,
    sp500RelativeGains,
    portfolioValues,
    periodStartPrices,
    currentLiveValueTotal
  };
}
