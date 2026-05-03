import { createContext, useContext, useState, useEffect } from 'react';

const PortfolioContext = createContext();

export const usePortfolio = () => useContext(PortfolioContext);

export const PortfolioProvider = ({ children }) => {
  const [authToken, setAuthToken] = useState(localStorage.getItem('wealthfolio_auth_token'));
  const [currentUser, setCurrentUser] = useState(null);
  
  const [portfolio, setPortfolio] = useState({
    transactions: [],
    categories: {},
    customCategories: ['Stock', 'Crypto', 'ETF', 'Cash', 'Other'],
    baseCurrency: 'USD'
  });
  
  const [currentPrices, setCurrentPrices] = useState({});
  const [exchangeRates, setExchangeRates] = useState({ 'USDUSD': 1.0 });

  useEffect(() => {
    if (authToken) {
      localStorage.setItem('wealthfolio_auth_token', authToken);
    } else {
      localStorage.removeItem('wealthfolio_auth_token');
    }
  }, [authToken]);

  const logout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setPortfolio({
      transactions: [],
      categories: {},
      customCategories: ['Stock', 'Crypto', 'ETF', 'Cash', 'Other'],
      baseCurrency: 'USD'
    });
    setCurrentPrices({});
    setExchangeRates({ 'USDUSD': 1.0 });
  };

  const ensureIds = (p) => {
    if (!p || !p.transactions) return p;
    const generateId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
    let modified = false;
    const newTxs = p.transactions.map(t => {
      if (!t.id) {
        modified = true;
        return { ...t, id: generateId() };
      }
      return t;
    });
    return modified ? { ...p, transactions: newTxs } : p;
  };

  const savePortfolio = async (newPortfolio) => {
    const portfolioWithIds = ensureIds(newPortfolio);
    setPortfolio(portfolioWithIds);
    localStorage.setItem('wealthfolio_portfolio', JSON.stringify(portfolioWithIds));
    
    if (authToken) {
      try {
        await fetch('/api/portfolio', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ data: portfolioWithIds })
        });
      } catch (err) {
        console.error('Failed to sync portfolio to backend', err);
      }
    }
  };

  const deleteTransaction = (txId) => {
    if (window.confirm('Are you sure you want to delete this transaction?')) {
      const newTxs = portfolio.transactions.filter(t => t.id !== txId);
      savePortfolio({ ...portfolio, transactions: newTxs });
    }
  };

  const addTransaction = (symbol, txType, txQuantity, txPrice, txCategory) => {
    const tx = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
      symbol: symbol,
      type: txType,
      quantity: parseFloat(txQuantity),
      price: parseFloat(txPrice),
      date: new Date().toISOString()
    };
    savePortfolio({
      ...portfolio,
      transactions: [...portfolio.transactions, tx],
      categories: { ...portfolio.categories, [symbol]: txCategory }
    });
  };

  return (
    <PortfolioContext.Provider value={{
      authToken, setAuthToken,
      currentUser, setCurrentUser,
      portfolio, setPortfolio,
      currentPrices, setCurrentPrices,
      exchangeRates, setExchangeRates,
      savePortfolio,
      deleteTransaction,
      addTransaction,
      logout
    }}>
      {children}
    </PortfolioContext.Provider>
  );
};
