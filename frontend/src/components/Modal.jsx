import { useState, useRef } from "react";
import { X } from "lucide-react";
import { usePortfolio } from "../context/PortfolioContext";

export default function Modal({ mode, symbol, closeModal, navigate }) {
  const {
    portfolio,
    savePortfolio,
    currentPrices,
    setCurrentPrices,
    addTransaction,
  } = usePortfolio();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [txType, setTxType] = useState("BUY");
  const [txQuantity, setTxQuantity] = useState("");
  const [txPrice, setTxPrice] = useState(
    symbol ? currentPrices[symbol]?.price || "" : "",
  );
  const existingCat = symbol ? portfolio.categories[symbol] : null;
  const isMix = typeof existingCat === "object" && existingCat !== null;

  const [txCategory, setTxCategory] = useState(
    existingCat || portfolio.customCategories[0],
  );

  const searchTimeoutRef = useRef(null);

  const handleSearch = (e) => {
    const q = e.target.value;
    setSearchQuery(q);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/search?q=${q}`);
        const data = await resp.json();
        setSearchResults(data);
      } catch (err) {}
    }, 300);
  };

  const selectAsset = async (res) => {
    const newCats = { ...portfolio.categories };
    if (!newCats[res.symbol]) {
      newCats[res.symbol] = portfolio.customCategories[0] || "Stock";
    }
    savePortfolio({ ...portfolio, categories: newCats });

    try {
      const resp = await fetch(`/api/quote/${res.symbol}`);
      const data = await resp.json();
      setCurrentPrices((prev) => ({ ...prev, [res.symbol]: data }));
    } catch (e) {}

    closeModal();
    // navigate to dashboard so it reflects, or we just close.
  };

  const saveTx = () => {
    addTransaction(symbol, txType, txQuantity, txPrice, txCategory);
    closeModal();
  };

  return (
    <div
      className="modal-overlay"
      style={{ display: "flex" }}
      onClick={(e) => {
        if (e.target.className === "modal-overlay") closeModal();
      }}
    >
      <div className="modal-content card" style={{ marginBottom: 0 }}>
        <button className="modal-close" onClick={closeModal}>
          <X size={18} />
        </button>

        {mode === "asset" && (
          <div id="modal-search-step">
            <h2 style={{ marginBottom: "20px" }}>Add Asset</h2>
            <div className="input-group">
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearch}
                placeholder="Search ticker (e.g. AAPL, BTC-USD)..."
              />
              <div id="search-results" style={{ marginTop: "8px" }}>
                {searchResults.map((res) => (
                  <div
                    key={res.symbol}
                    className="card"
                    style={{ padding: "12px", cursor: "pointer" }}
                    onClick={() => selectAsset(res)}
                  >
                    <strong>{res.symbol}</strong> - {res.name}{" "}
                    <span className="muted">({res.type})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {mode === "transaction" && (
          <div id="transaction-form">
            <h3 style={{ marginBottom: "16px" }}>{symbol}</h3>
            <div className="input-group">
              <label className="input-label">Type</label>
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value)}
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="DEPOSIT">CASH DEPOSIT</option>
                <option value="WITHDRAWAL">CASH WITHDRAWAL</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">Quantity</label>
              <input
                type="number"
                step="any"
                value={txQuantity}
                onChange={(e) => setTxQuantity(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Price per Share</label>
              <input
                type="number"
                step="any"
                value={txPrice}
                onChange={(e) => setTxPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="input-group">
              <label className="input-label">Category</label>
              {isMix ? (
                <div
                  style={{
                    padding: "8px",
                    background: "var(--bg)",
                    borderRadius: "4px",
                    fontSize: "0.9rem",
                    border: "1px solid var(--border)",
                  }}
                  className="muted"
                >
                  ETF Mix configured. Edit in Asset Detail.
                </div>
              ) : (
                <select
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                >
                  {portfolio.customCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={saveTx}
            >
              Save Transaction
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
