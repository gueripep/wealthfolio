from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import yfinance as yf
import pandas as pd
from typing import Optional
import requests
import sqlite3
import json
import hashlib
import secrets
import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
import os
import asyncio

DB_PATH = "wealthfolio.db"

# --- DB Initialization ---

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Cache tables
    c.execute('''
        CREATE TABLE IF NOT EXISTS price_cache (
            ticker TEXT PRIMARY KEY,
            data TEXT,
            last_updated TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS exchange_rate_cache (
            pair TEXT PRIMARY KEY,
            rate REAL,
            last_updated TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS history_cache (
            cache_key TEXT PRIMARY KEY,
            data TEXT,
            last_updated TIMESTAMP
        )
    ''')

    # Auth tables
    c.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS portfolios (
            user_id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    # Config table for persisting secret key across restarts
    c.execute('''
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')

    conn.commit()
    conn.close()

def get_or_create_secret_key() -> str:
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT value FROM config WHERE key = 'jwt_secret'")
    row = c.fetchone()
    if row:
        conn.close()
        return row[0]
    key = secrets.token_hex(32)
    c.execute("INSERT INTO config (key, value) VALUES ('jwt_secret', ?)", (key,))
    conn.commit()
    conn.close()
    return key

init_db()
SECRET_KEY = get_or_create_secret_key()

# --- FastAPI App ---

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Auth Utilities ---

security = HTTPBearer()

class RegisterRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class PortfolioData(BaseModel):
    data: dict

def create_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=30)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=["HS256"])
        return {"id": int(payload["sub"]), "email": payload["email"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- Auth Endpoints ---

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    password_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
        conn.commit()
        user_id = c.lastrowid
        token = create_token(user_id, email)
        return {"token": token, "user": {"id": user_id, "email": email}}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    finally:
        conn.close()

@app.post("/api/auth/login")
def login(req: LoginRequest):
    email = req.email.strip().lower()

    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        if not bcrypt.checkpw(req.password.encode(), row["password_hash"].encode()):
            raise HTTPException(status_code=401, detail="Invalid email or password")

        token = create_token(row["id"], row["email"])
        return {"token": token, "user": {"id": row["id"], "email": row["email"]}}
    finally:
        conn.close()

@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"id": user["id"], "email": user["email"]}

# --- Portfolio Endpoints ---

@app.get("/api/portfolio")
def get_portfolio(user: dict = Depends(get_current_user)):
    conn = get_db()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM portfolios WHERE user_id = ?", (user["id"],))
        row = c.fetchone()
        if not row:
            return None
        return json.loads(row["data"])
    finally:
        conn.close()

@app.put("/api/portfolio")
def save_portfolio(payload: PortfolioData, user: dict = Depends(get_current_user)):
    conn = get_db()
    try:
        c = conn.cursor()
        data_str = json.dumps(payload.data)
        c.execute(
            "INSERT OR REPLACE INTO portfolios (user_id, data, updated_at) VALUES (?, ?, ?)",
            (user["id"], data_str, datetime.now().isoformat())
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

# --- Market Data Endpoints ---

@app.get("/api/quote/{ticker}")
def get_quote(ticker: str):
    ticker = ticker.upper()
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT data, last_updated FROM price_cache WHERE ticker = ?", (ticker,))
        row = c.fetchone()

        if row:
            cached_data, last_updated = row
            last_updated_dt = datetime.fromisoformat(last_updated)
            if datetime.now() - last_updated_dt < timedelta(hours=1):
                conn.close()
                return json.loads(cached_data)

        t = yf.Ticker(ticker)
        info = t.info

        current_price = info.get("regularMarketPrice") or info.get("currentPrice")
        previous_close = info.get("regularMarketPreviousClose") or info.get("previousClose")

        if current_price is None:
            hist = t.history(period="1d")
            if not hist.empty:
                current_price = hist['Close'].iloc[-1]
            else:
                conn.close()
                raise HTTPException(status_code=404, detail="Ticker not found or no price available")

        day_change = 0
        day_change_percent = 0
        if current_price and previous_close:
            day_change = current_price - previous_close
            day_change_percent = (day_change / previous_close) * 100

        result = {
            "symbol": ticker,
            "price": current_price,
            "dayChange": day_change,
            "dayChangePercent": day_change_percent,
            "name": info.get("longName") or info.get("shortName") or ticker,
            "currency": info.get("currency", "USD")
        }

        c.execute("INSERT OR REPLACE INTO price_cache (ticker, data, last_updated) VALUES (?, ?, ?)",
                  (ticker, json.dumps(result), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return result
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/history/{ticker}")
def get_history(ticker: str, period: str = "1mo"):
    ticker = ticker.upper()

    if ticker == "$$CASH_TX":
        return []

    interval = "1d"
    if period in ["1d", "2d"]:
        interval = "15m"
    elif period == "5d":
        interval = "1h"

    cache_key = f"{ticker}:{period}:{interval}"
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT data, last_updated FROM history_cache WHERE cache_key = ?", (cache_key,))
        row = c.fetchone()

        if row:
            cached_data, last_updated = row
            last_updated_dt = datetime.fromisoformat(last_updated)
            cache_limit = timedelta(minutes=15) if interval != "1d" else timedelta(hours=4)
            if datetime.now() - last_updated_dt < cache_limit:
                conn.close()
                return json.loads(cached_data)

        t = yf.Ticker(ticker)
        hist = t.history(period=period, interval=interval)
        if hist.empty:
            hist = t.history(period=period, interval="1d")
            if hist.empty:
                conn.close()
                raise HTTPException(status_code=404, detail=f"No history found for {ticker} with period {period}")

        data = []
        for date, row_data in hist.iterrows():
            date_str = date.strftime("%Y-%m-%dT%H:%M:%S") if interval != "1d" else date.strftime("%Y-%m-%d")
            data.append({
                "date": date_str,
                "close": float(row_data['Close']),
                "high": float(row_data['High']),
                "low": float(row_data['Low']),
                "open": float(row_data['Open'])
            })

        c.execute("INSERT OR REPLACE INTO history_cache (cache_key, data, last_updated) VALUES (?, ?, ?)",
                  (cache_key, json.dumps(data), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return data
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_ticker(q: str):
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={q}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers)
        data = response.json()

        results = []
        for quote in data.get("quotes", []):
            if quote.get("quoteType") in ["EQUITY", "ETF", "CRYPTOCURRENCY"]:
                results.append({
                    "symbol": quote.get("symbol"),
                    "name": quote.get("shortname") or quote.get("longname"),
                    "type": quote.get("quoteType"),
                    "exchDisp": quote.get("exchDisp")
                })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/exchange_rate/{from_curr}/{to_curr}")
def get_exchange_rate(from_curr: str, to_curr: str):
    from_curr = from_curr.upper()
    to_curr = to_curr.upper()

    if from_curr == to_curr:
        return {"rate": 1.0, "from": from_curr, "to": to_curr}

    pair = f"{from_curr}{to_curr}"

    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT rate, last_updated FROM exchange_rate_cache WHERE pair = ?", (pair,))
        row = c.fetchone()

        if row:
            rate, last_updated = row
            last_updated_dt = datetime.fromisoformat(last_updated)
            if datetime.now() - last_updated_dt < timedelta(hours=1):
                conn.close()
                return {"rate": rate, "from": from_curr, "to": to_curr, "cached": True}

        ticker = f"{pair}=X"
        t = yf.Ticker(ticker)
        info = t.info
        rate = info.get("regularMarketPrice") or info.get("currentPrice")

        if rate is None:
            hist = t.history(period="1d")
            if not hist.empty:
                rate = hist['Close'].iloc[-1]
            else:
                conn.close()
                raise HTTPException(status_code=404, detail=f"Exchange rate for {pair} not found")

        c.execute("INSERT OR REPLACE INTO exchange_rate_cache (pair, rate, last_updated) VALUES (?, ?, ?)",
                  (pair, rate, datetime.now().isoformat()))
        conn.commit()
        return {"rate": rate, "from": from_curr, "to": to_curr, "cached": False}
    except Exception as e:
        if 'conn' in locals():
            conn.close()
        raise HTTPException(status_code=500, detail=str(e))

class BatchSymbolsRequest(BaseModel):
    symbols: list[str]
    period: str = "1mo"

class BatchPairsRequest(BaseModel):
    pairs: list[dict] # [{"from": "USD", "to": "EUR"}]

@app.post("/api/quotes")
async def get_quotes_batch(req: BatchSymbolsRequest):
    results = {}
    async def fetch(ticker):
        try:
            results[ticker] = await asyncio.to_thread(get_quote, ticker)
        except Exception:
            pass
    await asyncio.gather(*(fetch(t) for t in req.symbols))
    return results

@app.post("/api/histories")
async def get_histories_batch(req: BatchSymbolsRequest):
    results = {}
    async def fetch(ticker):
        try:
            results[ticker] = await asyncio.to_thread(get_history, ticker, req.period)
        except Exception:
            results[ticker] = []
    await asyncio.gather(*(fetch(t) for t in req.symbols))
    return results

@app.post("/api/exchange_rates")
async def get_exchange_rates_batch(req: BatchPairsRequest):
    results = {}
    async def fetch(pair):
        from_curr = pair.get("from")
        to_curr = pair.get("to")
        if not from_curr or not to_curr:
            return
        try:
            data = await asyncio.to_thread(get_exchange_rate, from_curr, to_curr)
            results[f"{from_curr}{to_curr}"] = data.get("rate", 1.0)
        except Exception:
            results[f"{from_curr}{to_curr}"] = 1.0
    await asyncio.gather(*(fetch(p) for p in req.pairs))
    return results

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
