import { useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

export default function SettingsView() {
  const { currentUser, logout, portfolio, savePortfolio } = usePortfolio();
  const [newCatName, setNewCatName] = useState('');

  const handleBaseCurrencyChange = (e) => {
    savePortfolio({ ...portfolio, baseCurrency: e.target.value });
  };

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (name && !portfolio.customCategories.includes(name)) {
      savePortfolio({ 
        ...portfolio, 
        customCategories: [...portfolio.customCategories, name] 
      });
      setNewCatName('');
    } else if (portfolio.customCategories.includes(name)) {
      alert("Category already exists.");
    }
  };

  const renameCategory = (oldName) => {
    const newName = window.prompt(`Enter new name for "${oldName}":`, oldName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    const trimmed = newName.trim();
    if (portfolio.customCategories.includes(trimmed)) {
      alert("This category name already exists.");
      return;
    }
    const newCustom = portfolio.customCategories.map(c => c === oldName ? trimmed : c);
    const newCats = { ...portfolio.categories };
    Object.keys(newCats).forEach(sym => {
      if (newCats[sym] === oldName) newCats[sym] = trimmed;
    });
    savePortfolio({ ...portfolio, customCategories: newCustom, categories: newCats });
  };

  const removeCategory = (catName) => {
    if (portfolio.customCategories.length <= 1) {
      alert("You must have at least one category.");
      return;
    }
    if (window.confirm(`Remove "${catName}"? Assets will be moved to "${portfolio.customCategories.find(c => c !== catName) || 'Other'}".`)) {
      const newCustom = portfolio.customCategories.filter(c => c !== catName);
      const fallback = newCustom[0] || 'Other';
      const newCats = { ...portfolio.categories };
      Object.keys(newCats).forEach(sym => {
        if (newCats[sym] === catName) newCats[sym] = fallback;
      });
      savePortfolio({ ...portfolio, customCategories: newCustom, categories: newCats });
    }
  };

  const wipePortfolio = () => {
    if (window.confirm("Are you SURE you want to wipe your entire portfolio? This will delete all transactions and cannot be undone.")) {
      savePortfolio({
        ...portfolio,
        transactions: [],
        categories: {}
      });
      alert("Portfolio wiped successfully.");
    }
  };

  return (
    <section id="categories-view">
      <h2 style={{marginBottom: '20px'}}>Settings & Classifications</h2>

      <div className="card" id="account-card">
        <h3 style={{marginBottom: '12px'}}>Account</h3>
        <div className="flex-between">
          <div>
            <div style={{fontWeight: 500}} id="account-email">{currentUser?.email || '—'}</div>
            <div className="muted" style={{fontSize: '0.8rem'}}>Signed in</div>
          </div>
          <button className="btn btn-secondary" onClick={() => { if(window.confirm('Sign out?')) logout(); }} style={{padding: '8px 16px', fontSize: '0.85rem'}}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{marginBottom: '16px'}}>App Settings</h3>
        <div className="input-group">
          <label className="input-label">Base Currency</label>
          <select value={portfolio.baseCurrency || 'USD'} onChange={handleBaseCurrencyChange}>
            <option value="USD">USD - US Dollar</option>
            <option value="EUR">EUR - Euro</option>
            <option value="GBP">GBP - British Pound</option>
            <option value="JPY">JPY - Japanese Yen</option>
            <option value="CAD">CAD - Canadian Dollar</option>
            <option value="AUD">AUD - Australian Dollar</option>
            <option value="CHF">CHF - Swiss Franc</option>
            <option value="CNY">CNY - Chinese Yuan</option>
            <option value="INR">INR - Indian Rupee</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h3 style={{marginBottom: '16px'}}>Add New Category</h3>
        <div className="flex-between" style={{gap: '12px'}}>
          <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="E.g. Real Estate, Private Equity..." style={{flex: 1}} />
          <button className="btn btn-primary" onClick={handleAddCategory} style={{padding: '12px'}}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      
      <div id="category-list">
        {portfolio.customCategories.map(cat => (
          <div className="category-row" key={cat}>
            <span style={{fontWeight: 500}}>{cat}</span>
            <div className="flex-center" style={{gap: '4px'}}>
              <button className="btn-icon" onClick={() => renameCategory(cat)} title="Rename">
                <Pencil size={16} />
              </button>
              <button className="btn-icon" onClick={() => removeCategory(cat)} title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginTop: '32px', border: '1px solid #ef444433'}}>
        <h3 style={{color: '#ef4444', marginBottom: '8px'}}>Danger Zone</h3>
        <p className="muted" style={{marginBottom: '16px', fontSize: '0.9rem'}}>This will permanently delete ALL transactions and reset your portfolio. This action cannot be undone.</p>
        <button className="btn" onClick={wipePortfolio} style={{width: '100%', background: '#ef4444', color: 'white'}}>Wipe Portfolio</button>
      </div>
    </section>
  );
}
