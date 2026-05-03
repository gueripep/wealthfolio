import { useState } from "react";
import { usePortfolio } from "../context/PortfolioContext";

export default function AuthScreen({ onLogin }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setAuthToken, setCurrentUser, setPortfolio } = usePortfolio();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || "Login failed");
        setLoading(false);
        return;
      }
      setAuthToken(data.token);
      setCurrentUser(data.user);
    } catch (err) {
      setError("Could not connect to server.");
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (password !== passwordConfirm) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.detail || "Registration failed");
        setLoading(false);
        return;
      }

      const localData = localStorage.getItem("wealthfolio_portfolio");
      if (localData) {
        const parsed = JSON.parse(localData);
        if (parsed.transactions && parsed.transactions.length > 0) {
          const migrate = window.confirm(
            `Import ${parsed.transactions.length} existing local transactions?`,
          );
          if (migrate) setPortfolio(parsed);
        }
      }

      setAuthToken(data.token);
      setCurrentUser(data.user);
    } catch (err) {
      setError("Could not connect to server.");
      setLoading(false);
    }
  };

  return (
    <div id="auth-screen">
      <div className="auth-container">
        <div className="auth-logo">
          <div className="auth-logo-icon">W</div>
          <h1 className="auth-title">Wealthfolio</h1>
          <p className="auth-subtitle">Track your investments, your way.</p>
        </div>

        <div className="segmented-control auth-tabs">
          <div
            className={`segment-item ${tab === "login" ? "active" : ""}`}
            onClick={() => setTab("login")}
          >
            Sign In
          </div>
          <div
            className={`segment-item ${tab === "register" ? "active" : ""}`}
            onClick={() => setTab("register")}
          >
            Create Account
          </div>
        </div>

        {tab === "login" ? (
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="input-group">
              <label className="input-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="input-group">
              <label className="input-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                required
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={loading}
            >
              {loading ? "Please wait..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handleRegister}>
            <div className="input-group">
              <label className="input-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="input-group">
              <label className="input-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
              />
            </div>
            <div className="input-group">
              <label className="input-label">Confirm Password</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Repeat password"
                required
                minLength={6}
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={loading}
            >
              {loading ? "Please wait..." : "Create Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
