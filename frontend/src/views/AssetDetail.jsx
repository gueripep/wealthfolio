import { useState } from 'react';
import { ArrowLeft, Plus, TrendingUp, Trash2 } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { getAssetSummary, formatCurrency } from '../utils/helpers';

export default function AssetDetail({ symbol, navigate, openModal }) {
  const { portfolio, currentPrices, savePortfolio } = usePortfolio();

  const asset = getAssetSummary(portfolio, currentPrices, symbol);
  
  const isMixObj = asset && typeof asset.category === 'object' && asset.category !== null;
  const [mixMode, setMixMode] = useState(isMixObj);
  
  const [mixWeights, setMixWeights] = useState(() => {
    const initial = {};
    if (isMixObj) {
      Object.entries(asset.category).forEach(([k,v]) => { initial[k] = (v * 100).toString(); });
    } else if (asset) {
      initial[asset.category || portfolio.customCategories[0]] = '100';
    }
    return initial;
  });

  if (!asset) return null;

  const priceData = currentPrices[symbol] || { price: 0, currency: 'USD', dayChangePercent: 0, name: symbol };
  const change = priceData.dayChangePercent || 0;

  const handleRemove = () => {
    if (window.confirm(`Are you sure you want to remove ${symbol} and all its transactions?`)) {
      const newCats = { ...portfolio.categories };
      delete newCats[symbol];
      const newTxs = portfolio.transactions.filter(t => t.symbol !== symbol);
      savePortfolio({ ...portfolio, categories: newCats, transactions: newTxs });
      navigate('dashboard');
    }
  };

  const handleCategoryChange = (e) => {
    savePortfolio({
      ...portfolio,
      categories: { ...portfolio.categories, [symbol]: e.target.value }
    });
  };

  const handleMixToggle = (e) => {
    const checked = e.target.checked;
    setMixMode(checked);
    if (!checked) {
       const mainCat = Object.keys(mixWeights).reduce((a,b) => (parseFloat(mixWeights[a]) || 0) > (parseFloat(mixWeights[b]) || 0) ? a : b, portfolio.customCategories[0]);
       savePortfolio({ ...portfolio, categories: { ...portfolio.categories, [symbol]: mainCat } });
    } else {
       applyMix(mixWeights);
    }
  };

  const applyMix = (weights = mixWeights) => {
    const finalMix = {};
    Object.entries(weights).forEach(([c, v]) => {
      const parsed = parseFloat(v);
      if (!isNaN(parsed) && parsed !== 0) {
        finalMix[c] = parsed / 100.0;
      }
    });
    if (Object.keys(finalMix).length === 0) {
      finalMix[portfolio.customCategories[0]] = 1.0;
    }
    savePortfolio({ ...portfolio, categories: { ...portfolio.categories, [symbol]: finalMix } });
  };

  return (
    <section id="asset-detail-view" style={{paddingBottom: '100px'}}>
      <header className="flex-between" style={{marginBottom: '20px'}}>
        <button className="btn btn-secondary" onClick={() => navigate('dashboard')} style={{padding: '8px'}}>
          <ArrowLeft size={18} />
        </button>
        <h2>{symbol}</h2>
        <button className="btn btn-primary" onClick={() => openModal('transaction', symbol)} style={{padding: '8px 12px', fontSize: '0.8rem'}}>
          <Plus size={14} />
          <span>Add Tx</span>
        </button>
      </header>

      <div className="card">
        <div className="flex-between">
          <h3>{priceData.name}</h3>
          <div style={{fontSize: '1.5rem', fontWeight: 700}}>
            {formatCurrency(priceData.price, priceData.currency)}
          </div>
        </div>
        <div className={change >= 0 ? 'gain' : 'loss'}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
        </div>
      </div>

      <div className="card">
        <h3 style={{marginBottom: '16px'}}>External Data</h3>
        <a href={`https://finance.yahoo.com/quote/${symbol}`} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', textDecoration: 'none'}}>
          <TrendingUp size={18} />
          <span>View on Yahoo Finance</span>
        </a>
      </div>

      <div className="card">
        <div className="flex-between" style={{marginBottom: '12px'}}>
          <label className="input-label" style={{marginBottom: 0}}>Classification</label>
          <label className="switch-wrapper" style={{fontSize: '0.85rem'}}>
            <div className="switch">
              <input type="checkbox" checked={mixMode} onChange={handleMixToggle} />
              <span className="slider"></span>
            </div>
            ETF Mix / Leveraged
          </label>
        </div>
        {!mixMode ? (
          <select value={typeof asset.category === 'string' ? asset.category : portfolio.customCategories[0]} onChange={handleCategoryChange}>
            {portfolio.customCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        ) : (
          <div>
            <p className="muted" style={{fontSize: '0.8rem', marginBottom: '12px'}}>
              Set percentages for each category (e.g., 80 for 80%). Total can exceed 100% for leveraged ETFs.
            </p>
            {portfolio.customCategories.map(cat => (
              <div key={cat} className="flex-between" style={{marginBottom: '8px', gap: '12px'}}>
                <span style={{fontSize: '0.9rem', width: '100px'}}>{cat}</span>
                <input 
                  type="number" 
                  step="any"
                  placeholder="0"
                  value={mixWeights[cat] || ''} 
                  onChange={(e) => {
                    const newWeights = { ...mixWeights, [cat]: e.target.value };
                    setMixWeights(newWeights);
                  }}
                  style={{flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)'}}
                />
                <span style={{fontSize: '0.9rem'}}>%</span>
              </div>
            ))}
            <button 
              className="btn btn-primary" 
              style={{width: '100%', marginTop: '12px', display: 'flex', justifyContent: 'center', gap: '8px'}} 
              onClick={(e) => { 
                applyMix(); 
                const btn = e.currentTarget;
                const originalText = btn.innerHTML;
                btn.innerHTML = 'Saved!';
                btn.style.background = '#10b981';
                setTimeout(() => {
                  btn.innerHTML = originalText;
                  btn.style.background = '';
                }, 1500);
              }}
            >
              Validate Mix
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{marginBottom: '12px'}}>Transaction History</h3>
        <div>
          {asset.transactions.map((t, i) => (
            <div key={i} style={{padding: '8px 0', borderBottom: '1px solid var(--border)'}} className="flex-between">
              <div>
                <div style={{fontWeight: 500}}>{t.type}</div>
                <div className="muted">{new Date(t.date).toLocaleDateString()}</div>
              </div>
              <div style={{textAlign: 'right'}}>
                <div>{t.quantity} @ {formatCurrency(t.price, priceData.currency)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{margin: '20px 0 40px 0'}}>
        <button className="btn" onClick={handleRemove} style={{width: '100%', background: 'var(--error-bg)', color: 'var(--error)', border: '1px solid #ef444433'}}>
          <Trash2 size={18} />
          <span>Remove Asset</span>
        </button>
      </div>
    </section>
  );
}
