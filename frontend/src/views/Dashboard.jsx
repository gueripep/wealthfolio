import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, ArcElement } from 'chart.js';
import { usePortfolio } from '../context/PortfolioContext';
import { getAssetSummary, formatCurrency, getExchangeRate } from '../utils/helpers';
import { calculateAnalytics } from '../utils/analytics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, ArcElement);

export default function Dashboard({ navigate, openModal }) {
  const { portfolio, currentPrices, exchangeRates } = usePortfolio();
  const [displayMode, setDisplayMode] = useState('tickers');
  const [selectedPeriod, setSelectedPeriod] = useState('1mo');
  
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);

  const getGradient = (ctx, chartArea, scales) => {
    const { y } = scales;
    const zeroPos = y.getPixelForValue(0);
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    const stop = (zeroPos - chartArea.top) / (chartArea.bottom - chartArea.top);
    const clampedStop = Math.max(0, Math.min(stop, 1));
    gradient.addColorStop(0, '#10b981');
    gradient.addColorStop(clampedStop, '#10b981');
    gradient.addColorStop(clampedStop, '#ef4444');
    gradient.addColorStop(1, '#ef4444');
    return gradient;
  };
  
  const assets = getAssetSummary(portfolio, currentPrices);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const data = await calculateAnalytics(portfolio, currentPrices, exchangeRates, selectedPeriod, assets);
        setAnalytics(data);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    fetchData();
  }, [portfolio, currentPrices, exchangeRates, selectedPeriod]);

  // Total Value Calculation
  let totalValueBase = 0;
  const renderedAssetList = [];

  if (displayMode === 'tickers') {
    assets.forEach(asset => {
      const priceData = currentPrices[asset.symbol] || { price: 0, currency: 'USD' };
      const pair = `${priceData.currency}${portfolio.baseCurrency}`;
      const rate = exchangeRates[pair] || 1.0;
      const valueBase = (asset.quantity * priceData.price) * rate;
      totalValueBase += valueBase;

      const startPrice = analytics?.periodStartPrices?.[asset.symbol] || priceData.price;
      const startValueBase = (asset.quantity * startPrice) * rate;
      const periodGainBase = valueBase - startValueBase;
      const periodGainPct = startValueBase > 0 ? (periodGainBase / startValueBase) * 100 : 0;

      renderedAssetList.push(
        <div key={asset.symbol} className="card" style={{cursor: 'pointer'}} onClick={() => navigate('assetDetail', asset.symbol)}>
          <div className="flex-between">
            <div>
              <div style={{fontWeight: 600}}>{asset.symbol}</div>
              <div className="muted">{typeof asset.category === 'string' ? asset.category : 'ETF Mix'} • {asset.quantity.toFixed(2)} units</div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div style={{fontWeight: 700}}>{formatCurrency(valueBase, portfolio.baseCurrency)}</div>
              <div className="muted" style={{fontSize: '0.75rem'}}>{formatCurrency(priceData.price, priceData.currency)}</div>
              <div className={periodGainBase >= 0 ? 'gain' : 'loss'} style={{fontSize: '0.8rem'}}>
                {periodGainBase >= 0 ? '+' : ''}{formatCurrency(periodGainBase, portfolio.baseCurrency)} ({periodGainPct.toFixed(2)}%)
              </div>
            </div>
          </div>
        </div>
      );
    });
  } else {
    const catSummary = {};
    assets.forEach(asset => {
      const priceData = currentPrices[asset.symbol] || { price: 0, currency: 'USD' };
      const pair = `${priceData.currency}${portfolio.baseCurrency}`;
      const rate = exchangeRates[pair] || 1.0;
      const valueBase = (asset.quantity * priceData.price) * rate;
      let mix = {};
      if (typeof asset.category === 'string') {
        mix = { [asset.category || 'Other']: 1.0 };
      } else if (typeof asset.category === 'object' && asset.category !== null) {
        mix = asset.category;
      } else {
        mix = { 'Other': 1.0 };
      }
      
      Object.entries(mix).forEach(([catName, weight]) => {
        if (!catSummary[catName]) {
          catSummary[catName] = { name: catName, value: 0, assetsCount: 0, assetSymbols: [] };
        }
        catSummary[catName].value += valueBase * weight;
        if (!catSummary[catName].assetSymbols.includes(asset.symbol)) {
          catSummary[catName].assetsCount++;
          catSummary[catName].assetSymbols.push(asset.symbol);
        }
      });
    });

    const categoriesList = Object.values(catSummary).sort((a, b) => b.value - a.value);
    categoriesList.forEach(cat => {
      totalValueBase += cat.value;
      let catStartValueBase = 0;
      cat.assetSymbols.forEach(symbol => {
        const qty = getAssetSummary(portfolio, currentPrices, symbol).quantity;
        const startPrice = analytics?.periodStartPrices?.[symbol] || (currentPrices[symbol]?.price || 0);
        const priceData = currentPrices[symbol] || { currency: 'USD' };
        const rate = exchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] || 1.0;
        
        const assetCategory = portfolio.categories[symbol];
        let weight = 0;
        if (typeof assetCategory === 'object' && assetCategory !== null) {
          weight = assetCategory[cat.name] || 0;
        } else if (assetCategory === cat.name || (!assetCategory && cat.name === 'Other')) {
          weight = 1.0;
        }

        catStartValueBase += (qty * startPrice) * rate * weight;
      });

      const periodGainBase = cat.value - catStartValueBase;
      const periodGainPct = catStartValueBase > 0 ? (periodGainBase / catStartValueBase) * 100 : 0;

      renderedAssetList.push(
        <div key={cat.name} className="card">
          <div className="flex-between">
            <div>
              <div style={{fontWeight: 600}}>{cat.name}</div>
              <div className="muted">{cat.assetsCount} assets: {cat.assetSymbols.join(', ')}</div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div style={{fontWeight: 700}}>{formatCurrency(cat.value, portfolio.baseCurrency)}</div>
              <div className={periodGainBase >= 0 ? 'gain' : 'loss'} style={{fontSize: '0.8rem'}}>
                {periodGainBase >= 0 ? '+' : ''}{formatCurrency(periodGainBase, portfolio.baseCurrency)} ({periodGainPct.toFixed(2)}%)
              </div>
            </div>
          </div>
        </div>
      );
    });
  }

  // Chart Logic
  const repData = {};
  let calcGrossExposure = 0;
  let calcNetExposure = 0;

  assets.forEach(a => {
    const priceData = currentPrices[a.symbol] || { price: 0, currency: 'USD' };
    const rate = exchangeRates[`${priceData.currency}${portfolio.baseCurrency}`] || 1.0;
    const valBase = (a.quantity * priceData.price) * rate;
    if (valBase > 0) {
      let mix = {};
      if (typeof a.category === 'string') {
        mix = { [a.category || 'Other']: 1.0 };
      } else if (typeof a.category === 'object' && a.category !== null) {
        mix = a.category;
      } else {
        mix = { 'Other': 1.0 };
      }
      Object.entries(mix).forEach(([catName, weight]) => {
        const componentValue = valBase * weight;
        calcGrossExposure += componentValue;
        
        if (!portfolio.debtCategories?.includes(catName)) {
          calcNetExposure += componentValue;
          if (componentValue > 0) {
            repData[catName] = (repData[catName] || 0) + componentValue;
          }
        }
      });
    }
  });

  const repLabels = Object.keys(repData);
  const repValues = Object.values(repData);
  const repTotal = repValues.reduce((a, b) => a + b, 0);

  const targetKeys = Object.keys(portfolio.targetAllocation || {});
  const allCategoriesSet = new Set([...repLabels, ...targetKeys]);
  const allTargetCategories = Array.from(allCategoriesSet).filter(cat => {
     const currentVal = repData[cat] || 0;
     const targetVal = portfolio.targetAllocation?.[cat] || 0;
     return currentVal > 0 || targetVal > 0;
  }).sort((a, b) => (repData[b] || 0) - (repData[a] || 0));
  
  const grossExposure = calcGrossExposure;
  const netExposure = calcNetExposure;
  
  const grossMult = totalValueBase > 0 ? (grossExposure / totalValueBase) : 0;
  const netMult = totalValueBase > 0 ? (netExposure / totalValueBase) : 0;

  const getCommonOptions = () => ({
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      x: { display: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: selectedPeriod === '2d' ? 8 : 5, color: '#64748b' } },
      y: { display: true, position: 'right', grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#64748b', maxTicksLimit: 5 } }
    },
    maintainAspectRatio: false,
    animation: {
      duration: 350
    }
  });

  const diff = analytics?.relativeGains?.[analytics.relativeGains.length - 1] || 0;
  const startValue = analytics?.portfolioValues?.[0] || 1;
  const pct = (diff / startValue) * 100;

  return (
    <main id="main-content" style={{paddingBottom: '100px'}}>
      {/* Summary Card */}
      <div className="card">
        <div className="flex-between">
          <span className="muted">Total Portfolio Value</span>
          <span className={`indicator ${pct >= 0 ? 'gain' : 'loss'}`}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</span>
        </div>
        <div style={{fontSize: '2.5rem', fontWeight: 700, margin: '8px 0'}}>
          {formatCurrency(totalValueBase, portfolio.baseCurrency)}
        </div>
        <div className="flex-between">
          <span className="muted">Gain/Loss ({selectedPeriod.toUpperCase()})</span>
          <span className={diff >= 0 ? 'gain' : 'loss'}>{diff >= 0 ? '+' : ''}{formatCurrency(diff, portfolio.baseCurrency)}</span>
        </div>
      </div>

      {/* Charts Section */}
      <div className="card">
        <div className="segmented-control" style={{marginBottom: '24px', fontSize: '0.75rem'}}>
          {['2d', '5d', '1mo', '1y', 'max'].map(p => (
            <div key={p} className={`segment-item ${selectedPeriod === p ? 'active' : ''}`} onClick={() => setSelectedPeriod(p)}>
              {p.toUpperCase()}
            </div>
          ))}
        </div>

        <div className="flex-between" style={{marginBottom: '12px'}}>
          <h3 style={{marginBottom: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em'}} className="muted">Performance</h3>
          <div className={diff >= 0 ? 'gain' : 'loss'} style={{fontWeight: 600}}>
            {diff >= 0 ? '+' : ''}{formatCurrency(diff, portfolio.baseCurrency)} ({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)
          </div>
        </div>
        <div style={{position: 'relative', height: '180px', marginBottom: '32px'}}>
          {loading && (
            <div className="flex-center" style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(22, 24, 33, 0.7)', borderRadius: '8px', zIndex: 5}}>
              <div className="spinner"></div>
            </div>
          )}
          {analytics && (
            <Line 
              data={{
                labels: analytics.allDates.map(d => new Date(d).toLocaleDateString()),
                datasets: [
                  {
                    label: 'Portfolio',
                    data: analytics.relativeGains,
                    borderColor: (context) => {
                      const chart = context.chart;
                      const {ctx, chartArea} = chart;
                      if (!chartArea) return '#10b981';
                      return getGradient(ctx, chartArea, chart.scales);
                    },
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.2,
                    fill: {
                      target: 'origin',
                      above: 'rgba(16, 185, 129, 0.15)',
                      below: 'rgba(239, 68, 68, 0.15)'
                    }
                  },
                  ...(analytics.sp500RelativeGains?.length ? [{
                    label: 'S&P 500',
                    data: analytics.sp500RelativeGains,
                    borderColor: 'rgba(251, 191, 36, 0.85)',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.2,
                    borderDash: [4, 3]
                  }] : [])
                ]
              }}
              options={getCommonOptions()}
            />
          )}
        </div>

        <div className="flex-between" style={{marginBottom: '12px'}}>
          <h3 style={{marginBottom: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em'}} className="muted">Value Evolution</h3>
        </div>
        <div style={{height: '180px', position: 'relative'}}>
          {analytics && (
            <Line 
              data={{
                labels: analytics.allDates.map(d => new Date(d).toLocaleDateString()),
                datasets: [{
                  label: 'Value',
                  data: analytics.portfolioValues,
                  borderColor: '#8b5cf6',
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.2,
                  fill: true,
                  backgroundColor: 'rgba(139, 92, 246, 0.1)'
                }]
              }}
              options={getCommonOptions()}
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex-between" style={{marginBottom: '16px'}}>
          <h3 style={{marginBottom: 0}}>Asset Repartition</h3>
          <div style={{textAlign: 'right'}}>
            <div className="muted" style={{fontSize: '0.75rem'}}>
              Net Exposure: <strong style={{color: 'var(--text-main)'}}>{netMult.toFixed(2)}x</strong>
              {portfolio.targetNetExposure !== undefined && (
                <span style={{marginLeft: '4px', opacity: 0.8}}>/ {portfolio.targetNetExposure.toFixed(2)}x</span>
              )}
            </div>
            <div className="muted" style={{fontSize: '0.75rem'}}>Gross Exposure: <strong style={{color: 'var(--text-main)'}}>{grossMult.toFixed(2)}x</strong></div>
          </div>
        </div>
        <div style={{height: '250px', position: 'relative'}}>
          <Doughnut 
            data={{
              labels: repLabels.map((l, i) => `${l} (${((repValues[i] / repTotal) * 100).toFixed(1)}%)`),
              datasets: [{
                data: repValues,
                backgroundColor: ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#f97316'],
                borderWidth: 0
              }]
            }}
            options={{
              plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } },
              cutout: '70%',
              maintainAspectRatio: false,
              animation: { duration: 350 }
            }}
          />
        </div>

        {portfolio.targetAllocation && Object.keys(portfolio.targetAllocation).length > 0 && (
          <div style={{marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px'}}>
            <div className="flex-between" style={{marginBottom: '12px', fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em'}}>
              <div style={{flex: 1}}>Target Breakdown</div>
              <div style={{width: '60px', textAlign: 'right'}}>Actual</div>
              <div style={{width: '60px', textAlign: 'right'}}>Target</div>
              <div style={{width: '60px', textAlign: 'right'}}>Delta</div>
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              {allTargetCategories.map(cat => {
                const currentPct = repTotal > 0 ? ((repData[cat] || 0) / repTotal) * 100 : 0;
                const targetPct = portfolio.targetAllocation[cat] || 0;
                const deltaPct = currentPct - targetPct;
                const isOffTarget = Math.abs(deltaPct) > 5;
                return (
                  <div key={`compare-${cat}`} className="flex-between" style={{fontSize: '0.85rem'}}>
                    <div style={{flex: 1, fontWeight: isOffTarget ? 600 : 400}}>{cat}</div>
                    <div style={{width: '60px', textAlign: 'right'}}>{currentPct.toFixed(1)}%</div>
                    <div style={{width: '60px', textAlign: 'right', color: 'var(--text-muted)'}}>{targetPct.toFixed(1)}%</div>
                    <div style={{width: '60px', textAlign: 'right'}} className={deltaPct > 0.1 ? 'gain' : (deltaPct < -0.1 ? 'loss' : 'muted')}>
                      {deltaPct > 0.1 ? '+' : ''}{Math.abs(deltaPct) < 0.1 ? '0.0' : deltaPct.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="dashboard-header">
          <h3>Your Assets</h3>
          <button className="btn btn-primary" onClick={() => openModal('asset')} style={{padding: '8px 16px', fontSize: '0.8rem'}}>
            <Plus size={14} />
            <span>Add Asset</span>
          </button>
        </div>
        <div className="segmented-control">
          <div className={`segment-item ${displayMode === 'tickers' ? 'active' : ''}`} onClick={() => setDisplayMode('tickers')}>Tickers</div>
          <div className={`segment-item ${displayMode === 'categories' ? 'active' : ''}`} onClick={() => setDisplayMode('categories')}>Asset Classes</div>
        </div>
        <div id="asset-list">
          {renderedAssetList}
        </div>
      </div>
    </main>
  );
}
