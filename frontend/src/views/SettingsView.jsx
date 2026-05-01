import { useState, useEffect } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { usePortfolio } from '../context/PortfolioContext';

export default function SettingsView() {
  const { currentUser, logout, portfolio, savePortfolio } = usePortfolio();
  const [newCatName, setNewCatName] = useState('');
  const [localTargets, setLocalTargets] = useState(portfolio.targetAllocation || {});
  const [localTargetNetExposure, setLocalTargetNetExposure] = useState(portfolio.targetNetExposure || 1.0);
  const [hasUnsavedTargets, setHasUnsavedTargets] = useState(false);

  useEffect(() => {
    if (!hasUnsavedTargets) {
      setLocalTargets(portfolio.targetAllocation || {});
      setLocalTargetNetExposure(portfolio.targetNetExposure || 1.0);
    }
  }, [portfolio.targetAllocation, portfolio.targetNetExposure, hasUnsavedTargets]);

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

  const toggleDebtCategory = (cat, isDebt) => {
    const debts = portfolio.debtCategories || [];
    const newDebts = isDebt ? [...debts, cat] : debts.filter(c => c !== cat);
    savePortfolio({ ...portfolio, debtCategories: newDebts });
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
      const currentCat = newCats[sym];
      if (typeof currentCat === 'string') {
        if (currentCat === oldName) newCats[sym] = trimmed;
      } else if (typeof currentCat === 'object' && currentCat !== null) {
        if (currentCat[oldName] !== undefined) {
          const val = currentCat[oldName];
          delete currentCat[oldName];
          currentCat[trimmed] = val;
        }
      }
    });
    const newDebts = (portfolio.debtCategories || []).map(c => c === oldName ? trimmed : c);
    const newTargetAllocation = { ...(portfolio.targetAllocation || {}) };
    if (newTargetAllocation[oldName] !== undefined) {
      newTargetAllocation[trimmed] = newTargetAllocation[oldName];
      delete newTargetAllocation[oldName];
    }
    savePortfolio({ ...portfolio, customCategories: newCustom, categories: newCats, debtCategories: newDebts, targetAllocation: newTargetAllocation });
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
        const currentCat = newCats[sym];
        if (typeof currentCat === 'string') {
          if (currentCat === catName) newCats[sym] = fallback;
        } else if (typeof currentCat === 'object' && currentCat !== null) {
          if (currentCat[catName] !== undefined) {
            const val = currentCat[catName];
            delete currentCat[catName];
            currentCat[fallback] = (currentCat[fallback] || 0) + val;
          }
        }
      });
      const newDebts = (portfolio.debtCategories || []).filter(c => c !== catName);
      const newTargetAllocation = { ...(portfolio.targetAllocation || {}) };
      if (newTargetAllocation[catName] !== undefined) {
        newTargetAllocation[fallback] = (newTargetAllocation[fallback] || 0) + newTargetAllocation[catName];
        delete newTargetAllocation[catName];
      }
      savePortfolio({ ...portfolio, customCategories: newCustom, categories: newCats, debtCategories: newDebts, targetAllocation: newTargetAllocation });
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
            <div style={{display: 'flex', flexDirection: 'column'}}>
              <span style={{fontWeight: 500}}>{cat}</span>
              <label className="switch-wrapper muted" style={{fontSize: '0.8rem', marginTop: '6px'}}>
                <div className="switch">
                  <input 
                    type="checkbox" 
                    checked={portfolio.debtCategories?.includes(cat) || false} 
                    onChange={(e) => toggleDebtCategory(cat, e.target.checked)}
                  />
                  <span className="slider"></span>
                </div>
                Is Debt / Leverage
              </label>
            </div>
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

      <div className="card" style={{marginTop: '32px'}}>
        <h3 style={{marginBottom: '16px'}}>Target Asset Allocation</h3>
        <p className="muted" style={{fontSize: '0.85rem', marginBottom: '16px'}}>
          Define your ideal portfolio repartition. The total should ideally be 100%.
        </p>
        <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
          {portfolio.customCategories.map(cat => {
            const currentTarget = localTargets[cat] || 0;
            return (
              <div key={`target-${cat}`} className="flex-between">
                <span style={{fontSize: '0.9rem'}}>{cat}</span>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    value={currentTarget}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setLocalTargets(prev => ({ ...prev, [cat]: val }));
                      setHasUnsavedTargets(true);
                    }}
                    style={{width: '70px', padding: '6px'}}
                  />
                  <span className="muted" style={{fontSize: '0.9rem'}}>%</span>
                </div>
              </div>
            );
          })}
          <div className="flex-between" style={{marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)'}}>
            <strong>Total</strong>
            <strong style={{
              color: Object.values(localTargets).reduce((a, b) => a + b, 0) === 100 ? '#10b981' : '#ef4444'
            }}>
              {Object.values(localTargets).reduce((a, b) => a + b, 0)}%
            </strong>
          </div>
          <div className="flex-between" style={{marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)'}}>
            <strong style={{fontSize: '0.9rem'}}>Target Net Exposure</strong>
            <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
              <input 
                type="number" 
                min="0" 
                step="0.1"
                value={localTargetNetExposure}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  setLocalTargetNetExposure(val);
                  setHasUnsavedTargets(true);
                }}
                style={{width: '70px', padding: '6px'}}
              />
              <span className="muted" style={{fontSize: '0.9rem'}}>x</span>
            </div>
          </div>
          {hasUnsavedTargets && (
            <button 
              className="btn btn-primary" 
              style={{marginTop: '16px', padding: '10px'}}
              onClick={() => {
                savePortfolio({ ...portfolio, targetAllocation: localTargets, targetNetExposure: localTargetNetExposure });
                setHasUnsavedTargets(false);
              }}
            >
              Save Targets
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{marginTop: '32px', border: '1px solid #ef444433'}}>
        <h3 style={{color: '#ef4444', marginBottom: '8px'}}>Danger Zone</h3>
        <p className="muted" style={{marginBottom: '16px', fontSize: '0.9rem'}}>This will permanently delete ALL transactions and reset your portfolio. This action cannot be undone.</p>
        <button className="btn" onClick={wipePortfolio} style={{width: '100%', background: '#ef4444', color: 'white'}}>Wipe Portfolio</button>
      </div>
    </section>
  );
}
