# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Commands

**Backend** (Python 3.14, FastAPI — run from `backend/`):
```bash
../.venv/bin/python main.py          # starts on http://localhost:8000
```

**Frontend** (Vite — run from `frontend/`):
```bash
npm run dev      # starts on http://localhost:5173 (proxies /api → :8000)
npm run build    # outputs to frontend/dist/
```

Both start automatically on folder open via `.vscode/tasks.json`.

Install Python deps into the project venv:
```bash
.venv/bin/pip install <package>
```

## Architecture

This is a **single-user portfolio tracker** that became **multi-user** after a login system was added. The architecture is a strict two-tier split:

### Backend (`backend/main.py`) — single file
FastAPI app backed by a local **SQLite** file (`backend/wealthfolio.db`). All tables live in one DB:

| Table | Purpose |
|---|---|
| `users` | email + bcrypt password hash |
| `portfolios` | one JSON blob per user (entire portfolio state) |
| `config` | persists JWT secret key across restarts |
| `price_cache` | Yahoo Finance quote cache (1h TTL) |
| `exchange_rate_cache` | FX rate cache (1h TTL) |
| `history_cache` | Historical price cache (15m intraday / 4h daily TTL) |

Auth uses **PyJWT** (30-day tokens) + **bcrypt**. All market data comes from `yfinance`. Protected endpoints use `Depends(get_current_user)` which validates the Bearer token.

### Frontend (`frontend/`) — single file app
`index.html` + `main.js` + `style.css` — no framework, plain ES modules bundled by Vite.

**State:** one `portfolio` object in memory, mirrored to both `localStorage` and the backend on every save:
```js
portfolio = { transactions, categories, customCategories, baseCurrency }
```

**Auth flow:** `bootstrap()` runs on load → checks `localStorage` for a JWT → calls `/api/auth/me` to validate → if ok, calls `initApp()` which loads portfolio from backend (falls back to localStorage). Shows `#auth-screen` overlay if no valid token.

**Data flow on save:** `savePortfolio()` → writes to `localStorage` AND `PUT /api/portfolio` with full portfolio JSON.

**Rendering:** `calculateAndRender()` → `renderAssetList()` (asset cards + totals) + `updatePerformanceChart()` (three Chart.js charts). Both are async because they await exchange rate fetches.

`frontend/src/` is an unused Vite scaffold — all real code is in `frontend/main.js`, `frontend/style.css`, and `frontend/index.html` at the root of `frontend/`.

## Key Gotchas

- `fetchLatestPrices` and `getExchangeRate` must check `resp.ok` before reading `resp.json()` — error responses return `{"detail":"..."}` with no `price`/`rate` field, causing `undefined * number = NaN` in portfolio value calculations.
- The `baseCurrency` select and period/mode segment controls all use class `segment-item`. Only scope segment-item selectors to `#app .segment-item[data-mode]` to avoid clobbering auth tab click handlers.
- The JWT secret is auto-generated on first run and stored in the `config` DB table so tokens survive server restarts.
- `portfolio.baseCurrency` defaults to `'USD'` but must be checked before calling `formatCurrency` since old localStorage snapshots may not have it.
