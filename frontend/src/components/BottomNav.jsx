import { LayoutDashboard, Target, Download, Settings } from "lucide-react";

export default function BottomNav({ currentView, navigate }) {
  return (
    <nav className="bottom-nav">
      <a
        href="#"
        className={`nav-item ${currentView === "dashboard" || currentView === "assetDetail" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          navigate("dashboard");
        }}
      >
        <LayoutDashboard size={24} />
        <span>Dashboard</span>
      </a>
      <a
        href="#"
        className={`nav-item ${currentView === "strategy" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          navigate("strategy");
        }}
      >
        <Target size={24} />
        <span>Strategy</span>
      </a>
      <a
        href="#"
        className={`nav-item ${currentView === "import" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          navigate("import");
        }}
      >
        <Download size={24} />
        <span>Import</span>
      </a>
      <a
        href="#"
        className={`nav-item ${currentView === "categories" ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          navigate("categories");
        }}
      >
        <Settings size={24} />
        <span>Settings</span>
      </a>
    </nav>
  );
}
