import { useState, useEffect, useRef } from 'react';
import { usePortfolio } from './context/PortfolioContext';
import AuthScreen from './components/AuthScreen';
import BottomNav from './components/BottomNav';
import Dashboard from './views/Dashboard';
import ImportView from './views/ImportView';
import SettingsView from './views/SettingsView';
import AssetDetail from './views/AssetDetail';
import Modal from './components/Modal';

export default function App() {
  const { authToken, setCurrentUser, setPortfolio, setCurrentPrices } = usePortfolio();
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedAsset, setSelectedAsset] = useState(null);
  
  const [modalMode, setModalMode] = useState(null); // 'asset', 'transaction', or null
  const [modalSymbol, setModalSymbol] = useState(null);
  const scrollPositionRef = useRef(0);

  useEffect(() => {
    const bootstrap = async () => {
      if (authToken) {
        try {
          const resp = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (resp.ok) {
            const user = await resp.json();
            setCurrentUser(user);
            await initApp();
            setLoading(false);
            return;
          }
        } catch (err) {}
        // Token invalid, fall through
      }
      setLoading(false);
    };
    bootstrap();
  }, [authToken]);

  const initApp = async () => {
    // Attempt to load from backend
    let loaded = false;
    let currentPort = null;
    try {
      const resp = await fetch('/api/portfolio', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data) {
          if (!data.customCategories) data.customCategories = ['Stock', 'Crypto', 'ETF', 'Cash', 'Other'];
          if (!data.baseCurrency) data.baseCurrency = 'USD';
          setPortfolio(data);
          currentPort = data;
          loaded = true;
        }
      }
    } catch(e) {}
    
    if (!loaded) {
      const local = localStorage.getItem('wealthfolio_portfolio');
      if (local) {
        const data = JSON.parse(local);
        if (!data.customCategories) data.customCategories = ['Stock', 'Crypto', 'ETF', 'Cash', 'Other'];
        if (!data.baseCurrency) data.baseCurrency = 'USD';
        setPortfolio(data);
        currentPort = data;
      }
    }
    
    if (currentPort) {
      fetchLatestPrices(currentPort);
    }
  };

  const fetchLatestPrices = async (port) => {
    const symbols = [...new Set([
      ...(port.transactions || []).map(t => t.symbol),
      ...Object.keys(port.categories || {})
    ])];
    
    if (symbols.length === 0) return;

    try {
      const resp = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols })
      });
      if (resp.ok) {
        const data = await resp.json();
        setCurrentPrices(prev => ({ ...prev, ...data }));
      }
    } catch (e) {}
  };

  const navigate = (view, asset = null) => {
    if (view === 'assetDetail') {
      setSelectedAsset(asset);
    }
    
    if (currentView === 'dashboard' && view !== 'dashboard') {
      scrollPositionRef.current = window.scrollY;
    }
    
    setCurrentView(view);
    
    if (view === 'dashboard') {
      requestAnimationFrame(() => window.scrollTo(0, scrollPositionRef.current));
    } else {
      window.scrollTo(0, 0);
    }
  };

  const openModal = (mode, symbol = null) => {
    setModalMode(mode);
    setModalSymbol(symbol);
  };

  const closeModal = () => {
    setModalMode(null);
    setModalSymbol(null);
  };

  if (loading) {
    return <div id="auth-screen"><div className="spinner" style={{margin: 'auto'}}></div></div>;
  }

  if (!authToken) {
    return <AuthScreen onLogin={() => {}} />;
  }

  return (
    <div id="app">
      {currentView === 'dashboard' && <Dashboard navigate={navigate} openModal={openModal} />}
      {currentView === 'import' && <ImportView />}
      {currentView === 'categories' && <SettingsView />}
      {currentView === 'assetDetail' && <AssetDetail symbol={selectedAsset} navigate={navigate} openModal={openModal} />}
      
      <BottomNav currentView={currentView} navigate={navigate} />
      
      {modalMode && (
        <Modal 
          mode={modalMode} 
          symbol={modalSymbol} 
          closeModal={closeModal} 
          navigate={navigate}
        />
      )}
    </div>
  );
}
