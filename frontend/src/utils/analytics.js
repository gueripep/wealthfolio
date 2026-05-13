import { getExchangeRate } from "./helpers";

export async function calculateAnalytics(
  portfolio,
  currentPrices,
  exchangeRates,
  period,
  assets,
) {
  const symbols = assets.map((a) => a.symbol);

  const pairsToFetch = [];
  const localExchangeRates = { ...exchangeRates };

  symbols.forEach((s) => {
    const currency =
      s === "$$CASH_TX"
        ? portfolio.baseCurrency
        : currentPrices[s]?.currency || "USD";
    if (currency !== portfolio.baseCurrency) {
      const pair = `${currency}${portfolio.baseCurrency}`;
      if (localExchangeRates[pair] == null) {
        pairsToFetch.push({ from: currency, to: portfolio.baseCurrency });
      }
    }
  });

  if (pairsToFetch.length > 0) {
    try {
      const resp = await fetch("/api/exchange_rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs: pairsToFetch }),
      });
      if (resp.ok) {
        const data = await resp.json();
        Object.assign(localExchangeRates, data);
      }
    } catch (e) {}
  }

  // 1. Batch S&P 500 with other symbols to save a network round trip
  const fetchSymbols = [...symbols];
  if (!fetchSymbols.includes("^GSPC")) {
    fetchSymbols.push("^GSPC");
  }

  // Calculate earliest transaction date for "max" view to avoid fetching 40 years of useless data
  let start_date = null;
  if (period === "max" && portfolio.transactions && portfolio.transactions.length > 0) {
    const txDates = portfolio.transactions.map((t) => new Date(t.date).getTime());
    const minDate = new Date(Math.min(...txDates));
    // Buffer by 7 days to ensure we have a starting price for the calculation
    minDate.setDate(minDate.getDate() - 7);
    start_date = minDate.toISOString().split("T")[0];
  }

  let historyMap = {};
  if (fetchSymbols.length > 0) {
    try {
      const resp = await fetch("/api/histories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: fetchSymbols,
          period: start_date ? undefined : period,
          start: start_date,
        }),
      });
      if (resp.ok) {
        historyMap = await resp.json();
      }
    } catch (e) {}
  }

  // Ensure every symbol has an array
  fetchSymbols.forEach((s) => {
    if (!historyMap[s] || !Array.isArray(historyMap[s])) {
      historyMap[s] = [];
    }
  });

  // 2. CRITICAL: Pre-index history data by date for O(1) lookup
  // This replaces the O(N) .find() inside the double loop (Days * Symbols)
  const indexedHistory = {};
  fetchSymbols.forEach((s) => {
    indexedHistory[s] = {};
    historyMap[s].forEach((entry) => {
      indexedHistory[s][entry.date] = entry;
    });
  });

  const histories = symbols.map((s) => historyMap[s]);

  let allDates = [];
  const dateSet = new Set();
  histories.forEach((h) => {
    if (Array.isArray(h)) h.forEach((d) => dateSet.add(d.date));
  });
  allDates = Array.from(dateSet).sort();

  if (allDates.length === 0) {
    return null;
  }

  const periodStartPrices = {};
  symbols.forEach((s) => {
    const firstData = historyMap[s][0];
    if (firstData) periodStartPrices[s] = firstData.close;
  });

  const sortedTxs = [...portfolio.transactions].sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );

  let portfolioGains = [];
  let portfolioValues = [];
  const lastKnownPrices = { ...periodStartPrices };
  const assetBalances = {};
  const assetCosts = {};
  let realizedGainBase = 0;

  symbols.forEach((s) => {
    assetBalances[s] = 0;
    assetCosts[s] = 0;
  });

  let txIdx = 0;

  allDates.forEach((dateStr) => {
    let dailyUnrealizedGainBase = 0;
    let dailyValueBase = 0;
    const dateObj = dateStr.includes("T")
      ? new Date(dateStr)
      : new Date(dateStr + "T23:59:59.999Z");

    while (
      txIdx < sortedTxs.length &&
      new Date(sortedTxs[txIdx].date) <= dateObj
    ) {
      const tx = sortedTxs[txIdx];
      if (assetBalances.hasOwnProperty(tx.symbol)) {
        const currency =
          tx.symbol === "$$CASH_TX"
            ? portfolio.baseCurrency
            : currentPrices[tx.symbol]?.currency || "USD";
        const pair = `${currency}${portfolio.baseCurrency}`;
        const rate = localExchangeRates[pair] || 1.0;

        if (tx.type === "BUY" || tx.type === "DEPOSIT") {
          assetBalances[tx.symbol] += tx.quantity;
          assetCosts[tx.symbol] += tx.quantity * tx.price;
        } else if (tx.type === "SELL" || tx.type === "WITHDRAWAL") {
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

    symbols.forEach((symbol) => {
      if (symbol === "$$CASH_TX") {
        lastKnownPrices[symbol] = 1.0;
      } else {
        // Optimized O(1) lookup using our indexed object
        const dayData = indexedHistory[symbol][dateStr];
        if (dayData) lastKnownPrices[symbol] = dayData.close;
      }

      const qty = assetBalances[symbol];
      const price = lastKnownPrices[symbol];
      const costBasis = assetCosts[symbol];

      if (price !== undefined) {
        const currency =
          symbol === "$$CASH_TX"
            ? portfolio.baseCurrency
            : currentPrices[symbol]?.currency || "USD";
        const pair = `${currency}${portfolio.baseCurrency}`;
        const rate = localExchangeRates[pair] || 1.0;
        const valueBase = qty * price * rate;
        dailyValueBase += valueBase;
        dailyUnrealizedGainBase += valueBase - costBasis * rate;
      }
    });
    portfolioGains.push(dailyUnrealizedGainBase + realizedGainBase);
    portfolioValues.push(dailyValueBase);
  });

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  let currentLiveValueTotal = 0;
  let currentLiveCostTotal = 0;

  for (const asset of assets) {
    const priceData = currentPrices[asset.symbol] || {
      price: 0,
      currency: "USD",
    };
    
    let price = priceData.price;
    if (!price) {
      price = lastKnownPrices[asset.symbol] || 0;
    }

    const rate =
      localExchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] ||
      1.0;
    currentLiveValueTotal += asset.quantity * price * rate;
    currentLiveCostTotal += asset.totalCost * rate;
  }

  let currentLiveGainTotal =
    currentLiveValueTotal - currentLiveCostTotal + realizedGainBase;

  const lastDate = allDates[allDates.length - 1];
  if (!lastDate.includes(todayStr)) {
    allDates.push(new Date().toISOString());
    portfolioGains.push(currentLiveGainTotal);
    portfolioValues.push(currentLiveValueTotal);
  } else {
    portfolioGains[portfolioGains.length - 1] = currentLiveGainTotal;
    portfolioValues[portfolioValues.length - 1] = currentLiveValueTotal;
  }

  if (period === "max") {
    const firstMovingIdx = portfolioGains.findIndex((g) => g !== 0);
    if (firstMovingIdx > 0) {
      allDates = allDates.slice(firstMovingIdx);
      portfolioGains = portfolioGains.slice(firstMovingIdx);
      portfolioValues = portfolioValues.slice(firstMovingIdx);
    }
  }

  const startPoint = portfolioGains[0] || 0;
  const relativeGains = portfolioGains.map((g) => g - startPoint);

  let sp500RelativeGains = [];
  const spHistory = historyMap["^GSPC"] || [];
  if (Array.isArray(spHistory) && spHistory.length > 0) {
    const spSorted = spHistory.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const portfolioBase = portfolioValues[0] || 1;
    let spBase = null;
    sp500RelativeGains = allDates.map((dateStr) => {
      let lo = 0,
        hi = spSorted.length - 1,
        found = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (spSorted[mid].date <= dateStr) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found === null) return null;
      const spClose = spSorted[found].close;
      if (spBase === null) spBase = spClose;
      return (spClose / spBase - 1) * portfolioBase;
    });
  }

  return {
    allDates,
    relativeGains,
    sp500RelativeGains,
    portfolioValues,
    periodStartPrices,
    currentLiveValueTotal,
  };
}
