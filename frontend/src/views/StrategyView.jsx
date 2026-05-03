import { useState, useEffect } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { usePortfolio } from "../context/PortfolioContext";
import { getAssetSummary, formatCurrency } from "../utils/helpers";

ChartJS.register(ArcElement, Tooltip, Legend);

export default function StrategyView() {
  const { portfolio, currentPrices, exchangeRates } = usePortfolio();

  const [useMargin, setUseMargin] = useState(false);
  const [fedRate, setFedRate] = useState(
    () => parseFloat(localStorage.getItem("wf_fedRate")) || 5.3,
  );
  const [platformRate, setPlatformRate] = useState(
    () => parseFloat(localStorage.getItem("wf_platformRate")) || 6.5,
  );
  const [marketVol, setMarketVol] = useState(
    () => parseFloat(localStorage.getItem("wf_marketVol")) || 16.0,
  );
  const [swapSpread, setSwapSpread] = useState(
    () => parseFloat(localStorage.getItem("wf_swapSpread")) || 0.5,
  );
  const [categoryVols, setCategoryVols] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("wf_categoryVols")) || {};
    } catch {
      return {};
    }
  });

  const [showCostHelp, setShowCostHelp] = useState(false);

  useEffect(() => {
    localStorage.setItem("wf_fedRate", fedRate);
    localStorage.setItem("wf_platformRate", platformRate);
    localStorage.setItem("wf_marketVol", marketVol);
    localStorage.setItem("wf_swapSpread", swapSpread);
    localStorage.setItem("wf_categoryVols", JSON.stringify(categoryVols));
  }, [fedRate, platformRate, marketVol, swapSpread, categoryVols]);

  const assets = getAssetSummary(portfolio, currentPrices);

  let totalValueBase = 0;
  assets.forEach((a) => {
    const priceData = currentPrices[a.symbol] || { price: 0, currency: "USD" };
    const rate =
      exchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] || 1.0;
    totalValueBase += a.quantity * priceData.price * rate;
  });

  // Chart & Rebalancing Logic
  const exposureRepData = {}; // Raw Exposure per category
  const netWorthRepData = {}; // Net Worth per category
  let calcGrossExposure = 0;
  let calcNetExposure = 0;

  assets.forEach((a) => {
    const priceData = currentPrices[a.symbol] || { price: 0, currency: "USD" };
    const rate =
      exchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] || 1.0;
    const valBase = a.quantity * priceData.price * rate;
    if (valBase > 0) {
      let mix = {};
      if (typeof a.category === "string") {
        mix = { [a.category || "Other"]: 1.0 };
      } else if (typeof a.category === "object" && a.category !== null) {
        mix = a.category;
      } else {
        mix = { Other: 1.0 };
      }
      Object.entries(mix).forEach(([catName, weight]) => {
        const componentValue = valBase * weight;
        calcGrossExposure += componentValue;

        if (!portfolio.debtCategories?.includes(catName)) {
          calcNetExposure += componentValue;
          if (componentValue > 0) {
            exposureRepData[catName] =
              (exposureRepData[catName] || 0) + componentValue;
            netWorthRepData[catName] =
              (netWorthRepData[catName] || 0) + valBase * (weight / weight); // Placeholder for proper net worth distribution
          }
        }
      });
    }
  });

  const repLabels = Object.keys(netWorthRepData);
  const repValues = Object.values(netWorthRepData);
  const repTotal = repValues.reduce((a, b) => a + b, 0);

  const targetKeys = Object.keys(portfolio.targetAllocation || {});
  const allCategoriesSet = new Set([...repLabels, ...targetKeys]);
  const allTargetCategories = Array.from(allCategoriesSet)
    .filter((cat) => {
      const currentVal = exposureRepData[cat] || 0;
      const targetVal = portfolio.targetAllocation?.[cat] || 0;
      return currentVal > 0 || targetVal > 0;
    })
    .sort((a, b) => (exposureRepData[b] || 0) - (exposureRepData[a] || 0));

  const grossExposure = calcGrossExposure;
  const netExposure = calcNetExposure;

  const grossMult = totalValueBase > 0 ? grossExposure / totalValueBase : 0;
  const netMult = totalValueBase > 0 ? netExposure / totalValueBase : 0;

  // Calculate best/cheapest assets per category
  const bestLeveragePerCat = {};
  const best1xPerCat = {};
  const cheapestPerCat = {};
  assets.forEach((a) => {
    const mix =
      typeof a.category === "object" && a.category !== null
        ? a.category
        : { [a.category || "Other"]: 1.0 };
    // Get max weight for this asset to guess default TER if missing
    const maxWeight = Math.max(...Object.values(mix));
    const assetTer = portfolio.assetTers?.[a.symbol] ?? 0;

    Object.entries(mix).forEach(([cat, weight]) => {
      // For leverage engines
      if (!bestLeveragePerCat[cat] || weight > bestLeveragePerCat[cat].weight) {
        bestLeveragePerCat[cat] = {
          symbol: a.symbol,
          weight: weight,
          ter: assetTer,
        };
      }
      // For margin rebalancing (closest to 1x)
      if (
        !best1xPerCat[cat] ||
        Math.abs(weight - 1.0) < Math.abs(best1xPerCat[cat].weight - 1.0)
      ) {
        best1xPerCat[cat] = { symbol: a.symbol, weight: weight, ter: assetTer };
      }
      // Cheapest in category
      if (!cheapestPerCat[cat] || assetTer < cheapestPerCat[cat].ter) {
        cheapestPerCat[cat] = { symbol: a.symbol, ter: assetTer };
      }
    });
  });

  // Rebalancing Logic: Global Buy Plan
  const targetRatio = portfolio.targetNetExposure || 1.0;
  const buyPlan = [];
  let finalNetWorth = totalValueBase;
  let finalTargetExposure = totalValueBase * targetRatio;
  let hasLeverageConflict = false;
  let maxPossibleLeverage = 1.0;
  let catConfigs = {};
  let normalizationFactor = 1.0;

  if (
    portfolio.targetAllocation &&
    Object.keys(portfolio.targetAllocation).length > 0
  ) {
    // 1. Map categories to their best available leverage
    let nonDebtTargetPctSum = 0;
    Object.entries(portfolio.targetAllocation).forEach(([cat, targetPct]) => {
      const isDebt = portfolio.debtCategories?.includes(cat);
      const instrument = useMargin
        ? best1xPerCat[cat] || { symbol: "?", weight: 1.0 }
        : bestLeveragePerCat[cat] || { symbol: "?", weight: 1.0 };

      catConfigs[cat] = {
        weight: targetPct / 100,
        leverage: useMargin ? 1.0 : instrument.weight,
        symbol: instrument.symbol,
        ter: instrument.ter,
        benchmarkTer: cheapestPerCat[cat]?.ter || 0.1,
        currentExp: exposureRepData[cat] || 0,
        isDebt: isDebt,
      };

      if (!isDebt) {
        nonDebtTargetPctSum += targetPct;
      }
    });

    normalizationFactor =
      nonDebtTargetPctSum > 0 ? 100 / nonDebtTargetPctSum : 1.0;

    // 2. Calculate Max Possible Leverage for this Allocation (Non-Debt only)
    const sum_wi_over_Li = Object.values(catConfigs)
      .filter((cfg) => !cfg.isDebt)
      .reduce(
        (sum, cfg) => sum + (cfg.weight * normalizationFactor) / cfg.leverage,
        0,
      );
    maxPossibleLeverage = sum_wi_over_Li > 0 ? 1 / sum_wi_over_Li : 1.0;
    hasLeverageConflict =
      !useMargin && targetRatio > maxPossibleLeverage + 0.001;

    // 3. Solve for Total Cash Needed (S)
    const A = Object.values(catConfigs)
      .filter((cfg) => !cfg.isDebt)
      .reduce(
        (sum, cfg) =>
          sum + (cfg.weight * normalizationFactor * targetRatio) / cfg.leverage,
        0,
      );
    const C = Object.values(catConfigs)
      .filter((cfg) => !cfg.isDebt)
      .reduce(
        (sum, cfg) =>
          sum +
          (cfg.weight * normalizationFactor * targetRatio * totalValueBase -
            cfg.currentExp) /
            cfg.leverage,
        0,
      );
    const S = A < 0.99 ? C / (1 - A) : 0;

    const totalCashNeeded = useMargin ? 0 : Math.max(0, S);
    finalTargetExposure = (totalValueBase + totalCashNeeded) * targetRatio;
    // 3. Calculate individual buy/sell amounts
    const allKnownCategories = new Set([
      ...Object.keys(portfolio.targetAllocation),
      ...Object.keys(exposureRepData),
    ]);

    // Track projected state after standard allocation buys
    let tempNetWorth = totalValueBase;
    let tempExposure = grossExposure;

    allKnownCategories.forEach((cat) => {
      const config = catConfigs[cat] || {
        weight: 0,
        leverage: 1.0,
        symbol: best1xPerCat[cat]?.symbol || "?",
        ter: 0,
        benchmarkTer: 0,
        currentExp: exposureRepData[cat] || 0,
        isDebt: portfolio.debtCategories?.includes(cat),
      };

      const targetExp =
        finalTargetExposure * (config.weight * normalizationFactor);
      const gap = targetExp - config.currentExp;

      if (gap > 1) {
        const amount = gap / config.leverage;
        buyPlan.push({
          type: "BUY",
          category: cat,
          gap: gap,
          instrument: config.symbol,
          amount: amount,
          weight: config.leverage,
          ter: config.ter,
          benchmarkTer: config.benchmarkTer,
          isPossible: true, // We'll re-evaluate 'Boost' later
        });
        tempNetWorth += amount;
        tempExposure += gap;
      } else if (config.weight === 0 && config.currentExp > 1) {
        buyPlan.push({
          type: "SELL",
          category: cat,
          gap: Math.abs(config.currentExp),
          instrument: "All Assets",
          amount: config.currentExp,
          weight: 1.0,
          isPossible: true,
        });
        tempExposure -= Math.abs(config.currentExp); // Exposure is removed, net worth (cash) stays
      }
    });

    // 5. Finalize Projected Values for UI
    finalNetWorth = totalValueBase + totalCashNeeded;
    finalTargetExposure = finalNetWorth * targetRatio;
  }

  const nextBuy = buyPlan
    .filter((i) => i.type === "BUY" && i.isPossible)
    .sort((a, b) => b.amount - a.amount)[0];

  return (
    <main id="main-content" style={{ paddingBottom: "100px" }}>
      {nextBuy && (
        <div
          className="card"
          style={{
            background:
              "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)",
            border: "1px solid rgba(16, 185, 129, 0.2)",
            padding: "28px",
            marginBottom: "24px",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-15px",
              right: "-15px",
              fontSize: "6rem",
              opacity: 0.03,
              fontWeight: 900,
              pointerEvents: "none",
              color: "#10b981",
              transform: "rotate(-5deg)",
            }}
          >
            DCA
          </div>

          <div className="flex-between" style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#10b981",
                  boxShadow: "0 0 10px #10b981",
                }}
              ></div>
              <div
                className="muted"
                style={{
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.2em",
                  color: "#10b981",
                  fontWeight: 800,
                }}
              >
                Next DCA Priority
              </div>
            </div>
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                background: "rgba(255,255,255,0.05)",
                padding: "4px 10px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              BASED ON LARGEST EXPOSURE GAP
            </div>
          </div>

          <div className="flex-between" style={{ alignItems: "flex-start" }}>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "2.5rem",
                  fontWeight: 900,
                  letterSpacing: "-0.04em",
                  color: "var(--text-main)",
                  lineHeight: 1,
                }}
              >
                {nextBuy.instrument}
              </h2>
              <div
                style={{
                  fontSize: "1.1rem",
                  marginTop: "12px",
                  color: "var(--text-muted)",
                }}
              >
                In category:{" "}
                <strong style={{ color: "#818cf8", fontWeight: 700 }}>
                  {nextBuy.category}
                </strong>
              </div>
              <p
                style={{
                  margin: "16px 0 0 0",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  maxWidth: "400px",
                  lineHeight: 1.5,
                }}
              >
                Focus your next contribution here. This asset is currently the
                most under-allocated relative to your target strategy.
              </p>
            </div>
          </div>

          <div
            style={{
              marginTop: "24px",
              display: "flex",
              gap: "24px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              paddingTop: "20px",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              <span
                style={{
                  fontSize: "0.65rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Leverage
              </span>
              <strong
                style={{ fontSize: "0.95rem", color: "var(--text-main)" }}
              >
                {nextBuy.weight}x
              </strong>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              <span
                style={{
                  fontSize: "0.65rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Target Weight
              </span>
              <strong
                style={{ fontSize: "0.95rem", color: "var(--text-main)" }}
              >
                {(portfolio.targetAllocation[nextBuy.category] || 0).toFixed(1)}
                %
              </strong>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                marginLeft: "auto",
                textAlign: "right",
              }}
            >
              <span
                style={{
                  fontSize: "0.65rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Total Gap
              </span>
              <strong
                style={{ fontSize: "0.95rem", color: "var(--text-main)" }}
              >
                {formatCurrency(nextBuy.amount, portfolio.baseCurrency)}
              </strong>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex-between" style={{ marginBottom: "16px" }}>
          <h3 style={{ marginBottom: 0 }}>Asset Repartition</h3>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Net Exposure:{" "}
              <strong style={{ color: "var(--text-main)" }}>
                {netMult.toFixed(2)}x
              </strong>
              {portfolio.targetNetExposure !== undefined && (
                <span style={{ marginLeft: "4px", opacity: 0.8 }}>
                  / {portfolio.targetNetExposure.toFixed(2)}x
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              Gross Exposure:{" "}
              <strong style={{ color: "var(--text-main)" }}>
                {grossMult.toFixed(2)}x
              </strong>
            </div>
          </div>
        </div>
        <div style={{ height: "250px", position: "relative" }}>
          <Doughnut
            data={{
              labels: repLabels.map(
                (l, i) =>
                  `${l} (${((repValues[i] / repTotal) * 100).toFixed(1)}%)`,
              ),
              datasets: [
                {
                  data: repValues,
                  backgroundColor: [
                    "#6366f1",
                    "#ec4899",
                    "#10b981",
                    "#f59e0b",
                    "#3b82f6",
                    "#8b5cf6",
                    "#f97316",
                  ],
                  borderWidth: 0,
                },
              ],
            }}
            options={{
              plugins: {
                legend: { position: "bottom", labels: { color: "#94a3b8" } },
              },
              cutout: "70%",
              maintainAspectRatio: false,
              animation: { duration: 350 },
            }}
          />
        </div>

        {portfolio.targetAllocation &&
          Object.keys(portfolio.targetAllocation).length > 0 && (
            <div
              style={{
                marginTop: "24px",
                borderTop: "1px solid var(--border-color)",
                paddingTop: "16px",
              }}
            >
              <div
                className="flex-between"
                style={{
                  marginBottom: "12px",
                  fontSize: "0.8rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                <div style={{ flex: 1 }}>Target Breakdown</div>
                <div style={{ width: "60px", textAlign: "right" }}>Actual</div>
                <div style={{ width: "60px", textAlign: "right" }}>Target</div>
                <div style={{ width: "60px", textAlign: "right" }}>Delta</div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {allTargetCategories.map((cat) => {
                  const currentPct =
                    repTotal > 0
                      ? ((netWorthRepData[cat] || 0) / repTotal) * 100
                      : 0;
                  const targetPct = portfolio.targetAllocation[cat] || 0;
                  const deltaPct = currentPct - targetPct;
                  const isOffTarget = Math.abs(deltaPct) > 5;
                  return (
                    <div
                      key={`compare-${cat}`}
                      className="flex-between"
                      style={{ fontSize: "0.85rem" }}
                    >
                      <div
                        style={{ flex: 1, fontWeight: isOffTarget ? 600 : 400 }}
                      >
                        {cat}
                      </div>
                      <div style={{ width: "60px", textAlign: "right" }}>
                        {currentPct.toFixed(1)}%
                      </div>
                      <div
                        style={{
                          width: "60px",
                          textAlign: "right",
                          color: "var(--text-muted)",
                        }}
                      >
                        {targetPct.toFixed(1)}%
                      </div>
                      <div
                        style={{ width: "60px", textAlign: "right" }}
                        className={
                          deltaPct > 0.1
                            ? "gain"
                            : deltaPct < -0.1
                              ? "loss"
                              : "muted"
                        }
                      >
                        {deltaPct > 0.1 ? "+" : ""}
                        {Math.abs(deltaPct) < 0.1 ? "0.0" : deltaPct.toFixed(1)}
                        %
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
      </div>

      {buyPlan.length > 0 && (
        <div
          className="card"
          style={{
            border: "1px solid rgba(99, 102, 241, 0.3)",
            background:
              "linear-gradient(145deg, rgba(22, 24, 33, 1) 0%, rgba(30, 34, 47, 1) 100%)",
          }}
        >
          <div className="flex-between" style={{ marginBottom: "16px" }}>
            <h3 style={{ marginBottom: 0, fontSize: "1rem" }}>
              Path to Target
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <label
                className="switch-wrapper"
                style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}
              >
                <div className="switch">
                  <input
                    type="checkbox"
                    checked={useMargin}
                    onChange={(e) => setUseMargin(e.target.checked)}
                  />
                  <span className="slider"></span>
                </div>
                Use Margin
              </label>
              <span
                className="indicator"
                style={{
                  background: "rgba(99, 102, 241, 0.2)",
                  color: "#818cf8",
                  fontSize: "0.7rem",
                }}
              >
                {useMargin ? "MARGIN PLAN" : "BUY LIST"}
              </span>
            </div>
          </div>
          <p
            className="muted"
            style={{ fontSize: "0.8rem", marginBottom: "20px" }}
          >
            To reach your {portfolio.targetNetExposure?.toFixed(2)}x non-debt
            exposure target{" "}
            {useMargin ? "by borrowing funds:" : "using your current assets:"}
          </p>

          {!useMargin &&
            buyPlan.some((i) => i.type === "BUY" && !i.isPossible) && (
              <div
                style={{
                  padding: "12px",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "8px",
                  marginBottom: "20px",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.8rem",
                    color: "#ef4444",
                    fontWeight: 600,
                    display: "flex",
                    gap: "8px",
                  }}
                >
                  <span>⚠️</span>
                  <span>
                    Plan Unreachable: You need at least one Leveraged ETF (&gt;{" "}
                    {targetRatio.toFixed(2)}x) to hit this target without
                    margin.
                  </span>
                </p>
              </div>
            )}
          {hasLeverageConflict && (
            <div
              style={{
                padding: "12px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "8px",
                marginBottom: "20px",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#ef4444",
                  fontWeight: 600,
                  display: "flex",
                  gap: "8px",
                }}
              >
                <span>🚫</span>
                <span>
                  Goal Unattainable: Your target allocation can only support up
                  to {maxPossibleLeverage.toFixed(2)}x leverage. To reach{" "}
                  {targetRatio.toFixed(2)}x, you must add an asset with higher
                  leverage (e.g. 3x ETF), change your allocation goal, or enable
                  Margin Mode.
                </span>
              </p>
            </div>
          )}
          {!hasLeverageConflict && (
            <>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {buyPlan.map((item) => (
                  <div
                    key={`${item.type}-${item.category}`}
                    style={{
                      padding: "12px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: "8px",
                      borderLeft: `3px solid ${item.type === "SELL" ? "#ef4444" : item.isPossible ? "#6366f1" : "#ef4444"}`,
                    }}
                  >
                    <div
                      className="flex-between"
                      style={{ marginBottom: "4px" }}
                    >
                      <strong
                        style={{
                          fontSize: "0.9rem",
                          color:
                            item.type === "BUY" && !item.isPossible
                              ? "#ef4444"
                              : "var(--text-main)",
                        }}
                      >
                        {item.category}
                        {item.isBoosted && (
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "0.65rem",
                              background: "rgba(99, 102, 241, 0.2)",
                              color: "#818cf8",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              verticalAlign: "middle",
                            }}
                          >
                            LEVERAGE BOOST
                          </span>
                        )}
                      </strong>
                      <span
                        className={
                          item.type === "SELL"
                            ? "loss"
                            : item.isPossible
                              ? "gain"
                              : "loss"
                        }
                        style={{ fontWeight: 700 }}
                      >
                        {item.type === "SELL" ? "-" : "+"}
                        {formatCurrency(item.gap, portfolio.baseCurrency)}{" "}
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 400,
                            opacity: 0.8,
                          }}
                        >
                          exp.
                        </span>
                      </span>
                    </div>

                    {item.type === "SELL" ? (
                      <div
                        className="muted"
                        style={{
                          fontSize: "0.8rem",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        <span style={{ color: "#ef4444" }}>
                          Sell all positions (Exit Category)
                        </span>
                        <span style={{ fontSize: "0.7rem" }}>0% target</span>
                      </div>
                    ) : item.isPossible ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div
                          className="muted"
                          style={{
                            fontSize: "0.8rem",
                            display: "flex",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>
                            {useMargin ? "Borrow & Buy" : "Buy"}{" "}
                            <strong>
                              {formatCurrency(
                                item.amount,
                                portfolio.baseCurrency,
                              )}
                            </strong>{" "}
                            of {item.instrument}
                          </span>
                          <span style={{ fontSize: "0.7rem" }}>
                            ({item.weight}x leverage)
                          </span>
                        </div>
                        {!useMargin &&
                          (item.ter > item.benchmarkTer || item.weight > 1) && (
                            <div
                              style={{
                                fontSize: "0.7rem",
                                color: "#f59e0b",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                                padding: "8px",
                                background: "rgba(245, 158, 11, 0.05)",
                                borderRadius: "6px",
                                border: "1px solid rgba(245, 158, 11, 0.2)",
                              }}
                            >
                              {item.ter > item.benchmarkTer && (
                                <div className="flex-between">
                                  <span>
                                    Fee Premium (TER):{" "}
                                    <strong>
                                      {(item.ter - item.benchmarkTer).toFixed(
                                        2,
                                      )}
                                      %
                                    </strong>
                                  </span>
                                  <span>
                                    {formatCurrency(
                                      (item.amount *
                                        (item.ter - item.benchmarkTer)) /
                                        100,
                                      portfolio.baseCurrency,
                                    )}
                                    /yr
                                  </span>
                                </div>
                              )}
                              {item.weight > 1 && (
                                <>
                                  <div className="flex-between">
                                    <span>
                                      Borrowing ({(item.weight - 1).toFixed(1)}
                                      x):{" "}
                                      <strong>
                                        {((item.weight - 1) * fedRate).toFixed(
                                          2,
                                        )}
                                        %
                                      </strong>
                                    </span>
                                    <span>
                                      {formatCurrency(
                                        item.amount *
                                          (item.weight - 1) *
                                          (fedRate / 100),
                                        portfolio.baseCurrency,
                                      )}
                                      /yr
                                    </span>
                                  </div>
                                  <div className="flex-between">
                                    <span>
                                      Swap Spread (
                                      {(item.weight - 1).toFixed(1)}x):{" "}
                                      <strong>
                                        {(
                                          (item.weight - 1) *
                                          swapSpread
                                        ).toFixed(2)}
                                        %
                                      </strong>
                                    </span>
                                    <span>
                                      {formatCurrency(
                                        item.amount *
                                          (item.weight - 1) *
                                          (swapSpread / 100),
                                        portfolio.baseCurrency,
                                      )}
                                      /yr
                                    </span>
                                  </div>
                                  <div
                                    className="flex-between"
                                    style={{
                                      color: "#818cf8",
                                      borderTop:
                                        "1px solid rgba(129, 140, 248, 0.2)",
                                      paddingTop: "4px",
                                      marginTop: "2px",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                      }}
                                    >
                                      <span title="The mathematical effect of compounding. This applies to ANY strategy that rebalances to a fixed leverage target.">
                                        Rebalancing Drag:
                                      </span>
                                      <input
                                        type="number"
                                        value={
                                          categoryVols[item.category] ??
                                          marketVol
                                        }
                                        onChange={(e) =>
                                          setCategoryVols({
                                            ...categoryVols,
                                            [item.category]:
                                              parseFloat(e.target.value) || 0,
                                          })
                                        }
                                        style={{
                                          width: "40px",
                                          padding: "1px 3px",
                                          fontSize: "0.65rem",
                                          background: "rgba(0,0,0,0.3)",
                                          border:
                                            "1px solid rgba(129, 140, 248, 0.3)",
                                          color: "#818cf8",
                                          borderRadius: "4px",
                                        }}
                                      />
                                      <span style={{ fontSize: "0.65rem" }}>
                                        % vol
                                      </span>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                      <strong style={{ fontSize: "0.75rem" }}>
                                        {(
                                          0.5 *
                                          (Math.pow(item.weight, 2) -
                                            item.weight) *
                                          Math.pow(
                                            (categoryVols[item.category] ??
                                              marketVol) / 100,
                                            2,
                                          ) *
                                          100
                                        ).toFixed(2)}
                                        %
                                      </strong>
                                      <div style={{ fontSize: "0.65rem" }}>
                                        {formatCurrency(
                                          item.amount *
                                            (0.5 *
                                              (Math.pow(item.weight, 2) -
                                                item.weight) *
                                              Math.pow(
                                                (categoryVols[item.category] ??
                                                  marketVol) / 100,
                                                2,
                                              )),
                                          portfolio.baseCurrency,
                                        )}
                                        /yr
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "#ef4444",
                          marginTop: "4px",
                          fontStyle: "italic",
                        }}
                      >
                        ⚠️ Impossible to reach {targetRatio.toFixed(2)}x target
                        with {item.weight}x assets.
                        {item.weight <= 1
                          ? " Add a leveraged ETF (2x, 3x) to this category."
                          : ` Need higher leverage than ${item.weight}x.`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: "20px",
                  padding: "12px",
                  background: "rgba(255, 251, 235, 0.05)",
                  borderRadius: "6px",
                  border: "1px dashed rgba(245, 158, 11, 0.3)",
                }}
              >
                {useMargin ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          color: "#f59e0b",
                        }}
                      >
                        Total Margin Required:
                      </p>
                      <strong style={{ color: "#f59e0b" }}>
                        {formatCurrency(
                          buyPlan.reduce((a, b) => a + (b.amount || 0), 0),
                          portfolio.baseCurrency,
                        )}
                      </strong>
                    </div>

                    <div
                      style={{
                        padding: "10px",
                        background: "rgba(245, 158, 11, 0.08)",
                        borderRadius: "6px",
                        border: "1px solid rgba(245, 158, 11, 0.2)",
                      }}
                    >
                      <div
                        className="flex-between"
                        style={{ marginBottom: "8px" }}
                      >
                        <span
                          style={{
                            fontSize: "0.7rem",
                            color: "#f59e0b",
                            fontWeight: 600,
                          }}
                        >
                          COST CALCULATOR
                        </span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span
                            style={{ fontSize: "0.65rem", color: "#f59e0b" }}
                          >
                            Platform Rate:
                          </span>
                          <input
                            type="number"
                            value={platformRate}
                            onChange={(e) =>
                              setPlatformRate(parseFloat(e.target.value) || 0)
                            }
                            step="0.1"
                            style={{
                              width: "50px",
                              padding: "2px 4px",
                              fontSize: "0.7rem",
                              background: "rgba(0,0,0,0.3)",
                              border: "1px solid rgba(245, 158, 11, 0.3)",
                              color: "#f59e0b",
                              borderRadius: "4px",
                            }}
                          />
                          <span
                            style={{ fontSize: "0.65rem", color: "#f59e0b" }}
                          >
                            %
                          </span>
                        </div>
                      </div>
                      <div
                        className="flex-between"
                        style={{ fontSize: "0.75rem", color: "#f59e0b" }}
                      >
                        <span>Est. Annual Cost:</span>
                        <strong>
                          {formatCurrency(
                            buyPlan.reduce((a, b) => a + (b.amount || 0), 0) *
                              (platformRate / 100),
                            portfolio.baseCurrency,
                          )}
                        </strong>
                      </div>
                      <div
                        className="flex-between"
                        style={{
                          fontSize: "0.7rem",
                          color: "#f59e0b",
                          opacity: 0.8,
                          marginTop: "2px",
                        }}
                      >
                        <span>Monthly "Rent":</span>
                        <span>
                          {formatCurrency(
                            (buyPlan.reduce((a, b) => a + (b.amount || 0), 0) *
                              (platformRate / 100)) /
                              12,
                            portfolio.baseCurrency,
                          )}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        borderTop: "1px solid rgba(245, 158, 11, 0.2)",
                        paddingTop: "8px",
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          color: "#f59e0b",
                          display: "flex",
                          justifyContent: "space-between",
                          opacity: 0.9,
                        }}
                      >
                        <span>Projected Debt/Equity Ratio:</span>
                        <strong>
                          {(
                            (buyPlan.reduce((a, b) => a + (b.amount || 0), 0) /
                              totalValueBase) *
                            100
                          ).toFixed(1)}
                          %
                        </strong>
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.75rem",
                          color: "#f59e0b",
                          display: "flex",
                          justifyContent: "space-between",
                          opacity: 0.9,
                        }}
                      >
                        <span>Final Leverage:</span>
                        <strong>{targetRatio.toFixed(2)}x</strong>
                      </p>
                    </div>

                    <div
                      style={{
                        marginTop: "12px",
                        borderTop: "1px dashed rgba(245, 158, 11, 0.2)",
                        paddingTop: "10px",
                      }}
                    >
                      <div
                        className="flex-between"
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        <span>LETF Strategy Cost:</span>
                        <span>
                          ~{" "}
                          {formatCurrency(
                            buyPlan.reduce((a, b) => {
                              const targetExposure = b.amount;
                              const valueInLETF = targetExposure / 3;
                              const leverageDebt = targetExposure * (2 / 3);
                              const volDrag =
                                valueInLETF *
                                0.5 *
                                (Math.pow(3, 2) - 3) *
                                Math.pow(marketVol / 100, 2);
                              const swapDrag =
                                leverageDebt * (swapSpread / 100);
                              const terDrag = (valueInLETF * 0.95) / 100;
                              const internalInterest =
                                leverageDebt * (fedRate / 100);
                              return (
                                a +
                                volDrag +
                                swapDrag +
                                terDrag +
                                internalInterest
                              );
                            }, 0),
                            portfolio.baseCurrency,
                          )}
                          /yr
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "0.6rem",
                          color: "#10b981",
                          marginTop: "2px",
                        }}
                      >
                        * Includes institutional rates ({fedRate}% +{" "}
                        {swapSpread}%) + Rebalancing Drag.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      margin: 0,
                      fontSize: "0.75rem",
                      color: "#f59e0b",
                      display: "flex",
                      gap: "8px",
                    }}
                  >
                    <span>💡</span>
                    <span style={{ flex: 1 }}>
                      {buyPlan.every((i) => i.isPossible) ? (
                        useMargin ? (
                          `Margin required: ${formatCurrency(
                            buyPlan.reduce((a, b) => a + (b.amount || 0), 0),
                            portfolio.baseCurrency,
                          )}. Watch your liquidation price!`
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                              width: "100%",
                            }}
                          >
                            <div
                              className="flex-between"
                              style={{
                                borderTop:
                                  "1px solid rgba(255, 255, 255, 0.05)",
                                paddingTop: "8px",
                                marginTop: "4px",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#f59e0b",
                                  fontWeight: 600,
                                }}
                              >
                                STRATEGY TOTAL HOLDING COST
                              </span>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  justifyContent: "flex-end",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    color: "#f59e0b",
                                  }}
                                >
                                  Interest (Fed):
                                </span>
                                <input
                                  type="number"
                                  value={fedRate}
                                  onChange={(e) =>
                                    setFedRate(parseFloat(e.target.value) || 0)
                                  }
                                  step="0.1"
                                  style={{
                                    width: "45px",
                                    padding: "1px 4px",
                                    fontSize: "0.65rem",
                                    background: "rgba(0,0,0,0.3)",
                                    border: "1px solid rgba(245, 158, 11, 0.3)",
                                    color: "#f59e0b",
                                    borderRadius: "4px",
                                  }}
                                />
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    color: "#f59e0b",
                                  }}
                                >
                                  % | Swap:
                                </span>
                                <input
                                  type="number"
                                  value={swapSpread}
                                  onChange={(e) =>
                                    setSwapSpread(
                                      parseFloat(e.target.value) || 0,
                                    )
                                  }
                                  step="0.1"
                                  style={{
                                    width: "45px",
                                    padding: "1px 4px",
                                    fontSize: "0.65rem",
                                    background: "rgba(0,0,0,0.3)",
                                    border: "1px solid rgba(245, 158, 11, 0.3)",
                                    color: "#f59e0b",
                                    borderRadius: "4px",
                                  }}
                                />
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    color: "#f59e0b",
                                  }}
                                >
                                  %
                                </span>
                              </div>
                            </div>
                            <div
                              className="flex-between"
                              style={{ opacity: 1, marginTop: "8px" }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <span style={{ fontSize: "0.8rem" }}>
                                  Total Expected Holding Cost:
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.6rem",
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  Fixed Fees + Expected Rebalancing Drag
                                </span>
                              </div>
                              <strong
                                style={{ color: "#f59e0b", fontSize: "1.1rem" }}
                              >
                                {formatCurrency(
                                  Object.entries(
                                    portfolio.targetAllocation,
                                  ).reduce((total, [cat, targetPct]) => {
                                    const config = catConfigs[cat] || {
                                      weight: targetPct / 100,
                                      leverage: 1.0,
                                      ter: 0,
                                      benchmarkTer: 0,
                                    };
                                    const normalizedWeight =
                                      config.weight * normalizationFactor;
                                    const T = targetRatio;
                                    const L = config.leverage;
                                    const catVol =
                                      categoryVols[cat] ?? marketVol;
                                    const w =
                                      L > 1
                                        ? Math.min(
                                            1,
                                            Math.max(0, (T - 1) / (L - 1)),
                                          )
                                        : 0;
                                    const assetValue =
                                      finalNetWorth * normalizedWeight;
                                    const valueInLETF = assetValue * w;
                                    const valueInCore = assetValue * (1 - w);
                                    const internalDebt = valueInLETF * (L - 1);

                                    const terDrag =
                                      (valueInLETF * (config.ter || 0)) / 100 +
                                      (valueInCore * 0.07) / 100;
                                    const borrowDrag =
                                      internalDebt * (fedRate / 100);
                                    const swapDrag =
                                      internalDebt * (swapSpread / 100);
                                    const volDrag =
                                      valueInLETF *
                                      0.5 *
                                      (Math.pow(L, 2) - L) *
                                      Math.pow(catVol / 100, 2);

                                    return (
                                      total +
                                      terDrag +
                                      borrowDrag +
                                      swapDrag +
                                      volDrag
                                    );
                                  }, 0),
                                  portfolio.baseCurrency,
                                )}
                                /yr
                              </strong>
                            </div>
                            <div
                              className="flex-between"
                              style={{
                                opacity: 0.8,
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              <span>Projected Net Worth / Total Exposure:</span>
                              <span>
                                {formatCurrency(
                                  finalNetWorth,
                                  portfolio.baseCurrency,
                                )}{" "}
                                /{" "}
                                {formatCurrency(
                                  finalTargetExposure,
                                  portfolio.baseCurrency,
                                )}
                              </span>
                            </div>

                            <div
                              style={{
                                marginTop: "12px",
                                borderTop: "1px dashed rgba(245, 158, 11, 0.2)",
                                paddingTop: "10px",
                              }}
                            >
                              <div
                                className="flex-between"
                                style={{
                                  fontSize: "0.65rem",
                                  color: "#f59e0b",
                                  opacity: 0.8,
                                  marginBottom: "4px",
                                }}
                              >
                                <span>VS. MARGIN ALTERNATIVE</span>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                  }}
                                >
                                  <span>Margin Rate:</span>
                                  <input
                                    type="number"
                                    value={platformRate}
                                    onChange={(e) =>
                                      setPlatformRate(
                                        parseFloat(e.target.value) || 0,
                                      )
                                    }
                                    step="0.1"
                                    style={{
                                      width: "45px",
                                      padding: "1px 4px",
                                      fontSize: "0.65rem",
                                      background: "rgba(0,0,0,0.3)",
                                      border:
                                        "1px solid rgba(245, 158, 11, 0.3)",
                                      color: "#f59e0b",
                                      borderRadius: "4px",
                                    }}
                                  />
                                  <span>%</span>
                                </div>
                              </div>
                              <div
                                className="flex-between"
                                style={{
                                  fontSize: "0.75rem",
                                  color: "var(--text-muted)",
                                }}
                              >
                                <span>Margin Strategy Cost:</span>
                                <span>
                                  {formatCurrency(
                                    (finalTargetExposure - finalNetWorth) *
                                      (platformRate / 100) +
                                      (finalTargetExposure * 0.07) / 100 +
                                      finalNetWorth *
                                        0.5 *
                                        (Math.pow(targetRatio, 2) -
                                          targetRatio) *
                                        Math.pow(marketVol / 100, 2),
                                    portfolio.baseCurrency,
                                  )}
                                  /yr
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: "0.6rem",
                                  color: "var(--text-muted)",
                                  marginTop: "2px",
                                }}
                              >
                                * Includes platform interest ({platformRate}%) +
                                same Rebalancing Drag.
                              </div>
                            </div>
                            <button
                              onClick={() => setShowCostHelp(!showCostHelp)}
                              style={{
                                fontSize: "0.65rem",
                                color: "#f59e0b",
                                padding: 0,
                                textAlign: "left",
                                marginTop: "4px",
                                textDecoration: "underline",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                display: "block",
                              }}
                            >
                              {showCostHelp
                                ? "Hide helper"
                                : "How to find these values?"}
                            </button>

                            {showCostHelp && (
                              <div
                                style={{
                                  marginTop: "12px",
                                  padding: "12px",
                                  background: "rgba(0, 0, 0, 0.2)",
                                  borderRadius: "8px",
                                  fontSize: "0.7rem",
                                  border: "1px solid rgba(245, 158, 11, 0.2)",
                                  color: "#f59e0b",
                                }}
                              >
                                <div
                                  style={{
                                    marginBottom: "8px",
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.05em",
                                  }}
                                >
                                  Variable Guidance
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "8px",
                                  }}
                                >
                                  <div>
                                    <strong>Interest (Fed):</strong>{" "}
                                    Institutional rate inside ETFs. Usually
                                    ~5.3%.
                                  </div>
                                  <div>
                                    <strong>Rebalancing Drag:</strong> The cost
                                    of maintaining a fixed leverage ratio. This
                                    applies to <strong>BOTH</strong> LETFs and
                                    Margin strategies if you rebalance. In
                                    trending markets, this can turn into a
                                    "Boost."
                                  </div>
                                  <div
                                    style={{
                                      marginTop: "4px",
                                      opacity: 0.8,
                                      fontStyle: "italic",
                                    }}
                                  >
                                    Note: LETFs are often cheaper than retail
                                    margin because their internal rate (Fed Rate
                                    + Spread) is significantly lower than
                                    typical broker margin rates.
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      ) : (
                        "Some targets are unreachable with your current assets. Review the red items above."
                      )}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  );
}
