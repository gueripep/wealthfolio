import { useRef } from 'react';
import Papa from 'papaparse';
import { usePortfolio } from '../context/PortfolioContext';

export default function ImportView() {
  const fileInputRef = useRef(null);
  const { portfolio, savePortfolio } = usePortfolio();

  const parseCSVDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return new Date().toISOString();
    const cleanStr = dateStr.trim();
    if (cleanStr.length === 8 && /^\d+$/.test(cleanStr)) {
      const year = cleanStr.substring(0, 4);
      const month = cleanStr.substring(4, 6);
      const day = cleanStr.substring(6, 8);
      return `${year}-${month}-${day}T12:00:00Z`;
    }
    const date = new Date(cleanStr);
    if (!isNaN(date.getTime())) return date.toISOString();
    return new Date().toISOString();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        let importCount = 0;
        const newPortfolio = { ...portfolio, transactions: [...portfolio.transactions] };
        
        results.data.forEach(row => {
          const type = row['Transaction Type']?.toUpperCase();
          if (['BUY', 'DEPOSIT', 'SELL', 'WITHDRAWAL'].includes(type)) {
            const symbol = row['Symbol'] || (type === 'DEPOSIT' || type === 'WITHDRAWAL' ? '$$CASH_TX' : null);
            if (!symbol) return;
            const tradeDateRaw = row['Trade Date'] || row['Date'];
            const tx = {
              id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11),
              symbol: symbol,
              type: type,
              quantity: Math.abs(parseFloat(row['Quantity'])) || 0,
              price: parseFloat(row['Purchase Price']) || parseFloat(row['Current Price']) || (symbol === '$$CASH_TX' ? 1 : 0),
              date: parseCSVDate(tradeDateRaw)
            };
            newPortfolio.transactions.push(tx);
            importCount++;
            if (!newPortfolio.categories[tx.symbol]) {
              const available = newPortfolio.customCategories;
              if (tx.symbol === '$$CASH_TX') newPortfolio.categories[tx.symbol] = 'Cash';
              else if (tx.symbol.includes('-USD') && available.includes('Crypto')) newPortfolio.categories[tx.symbol] = 'Crypto';
              else if ((tx.symbol.includes('.DE') || tx.symbol.includes('.PA')) && available.includes('Stock')) newPortfolio.categories[tx.symbol] = 'Stock';
              else newPortfolio.categories[tx.symbol] = available[0] || 'Other';
            }
          }
        });
        savePortfolio(newPortfolio);
        alert(`Imported ${importCount} transactions successfully!`);
      }
    });
  };

  return (
    <section id="import-view" style={{paddingBottom: '100px'}}>
      <h2 style={{marginBottom: '20px'}}>Import Portfolio</h2>
      <div className="card">
        <p className="muted" style={{marginBottom: '20px'}}>Upload your Yahoo Finance portfolio export (CSV).</p>
        <input type="file" ref={fileInputRef} accept=".csv" style={{display: 'none'}} onChange={handleFileUpload} />
        <button className="btn btn-secondary" style={{width: '100%'}} onClick={() => fileInputRef.current?.click()}>
          Choose File
        </button>
      </div>
    </section>
  );
}
