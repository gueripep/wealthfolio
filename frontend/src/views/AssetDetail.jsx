import { ArrowLeft, Plus, TrendingUp, Trash2 } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';
import { getAssetSummary, formatCurrency } from '../utils/helpers';

export default function AssetDetail({ symbol, navigate, openModal }) {
  const { portfolio, currentPrices, savePortfolio } = usePortfolio();

  const asset = getAssetSummary(portfolio, currentPrices, symbol);
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
        <label className="input-label">Classification</label>
        <select value={asset.category} onChange={handleCategoryChange}>
          {portfolio.customCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
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
