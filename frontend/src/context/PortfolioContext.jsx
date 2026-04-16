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

  const savePortfolio = async (newPortfolio) => {
    setPortfolio(newPortfolio);
    localStorage.setItem('wealthfolio_portfolio', JSON.stringify(newPortfolio));
    
    if (authToken) {
      try {
        await fetch('/api/portfolio', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ data: newPortfolio })
        });
      } catch (err) {
        console.error('Failed to sync portfolio to backend', err);
      }
    }
  };

  return (
    <PortfolioContext.Provider value={{
      authToken, setAuthToken,
      currentUser, setCurrentUser,
      portfolio, setPortfolio,
      currentPrices, setCurrentPrices,
      exchangeRates, setExchangeRates,
      savePortfolio,
      logout
    }}>
      {children}
    </PortfolioContext.Provider>
  );
};
