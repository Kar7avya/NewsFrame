import { useState } from "react";
import NewsLens from "./NewsLens";
import TrendingPage from "./trendingpage";
import EssayPage from "./EssayPage";
 
export default function App() {
  const [page, setPage] = useState("home"); // "home" | "trending" | "essay"
  const [searchQuery, setSearchQuery] = useState("");
 
  // Called when user clicks "Get full report" on a trending topic
  function handleTrendingSearch(topic) {
    setSearchQuery(topic);
    setPage("home");
  }
 
  return (
    <div style={{ fontFamily: "Inter, sans-serif" }}>
 
      {/* ── NAV BAR ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 999,
        background: "rgba(255,255,255,0.95)", backdropFilter: "blur(10px)",
        borderBottom: "1px solid #e8e6e1", height: 52,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1.5rem",
      }}>
        {/* Logo */}
        <div
          onClick={() => setPage("home")}
          style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.2rem", letterSpacing: "-.01em", cursor: "pointer" }}>
          News<em style={{ fontStyle: "italic", color: "#1d4ed8" }}>Lens</em>
        </div>
 
        {/* Nav links */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setPage("home")}
            style={{
              padding: "6px 14px", borderRadius: 100, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 500, transition: "all .15s",
              background: page === "home" ? "#1c1917" : "transparent",
              color: page === "home" ? "#fff" : "#57534e",
            }}>
            🔍 Search
          </button>
          <button
            onClick={() => setPage("trending")}
            style={{
              padding: "6px 14px", borderRadius: 100, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 500, transition: "all .15s",
              background: page === "trending" ? "#1c1917" : "transparent",
              color: page === "trending" ? "#fff" : "#57534e",
              display: "flex", alignItems: "center", gap: 5,
            }}>
            🔥 Trending
            <span style={{ fontSize: 10, background: "#ef4444", color: "#fff", padding: "1px 5px", borderRadius: 100, fontWeight: 700 }}>LIVE</span>
          </button>
          <button
            onClick={() => setPage("essay")}
            style={{
              padding: "6px 14px", borderRadius: 100, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 500, transition: "all .15s",
              background: page === "essay" ? "#1c1917" : "transparent",
              color: page === "essay" ? "#fff" : "#57534e",
              display: "flex", alignItems: "center", gap: 5,
            }}>
            ✍️ Essay
            <span style={{ fontSize: 10, background: "#1d4ed8", color: "#fff", padding: "1px 5px", borderRadius: 100, fontWeight: 700 }}>IAS</span>
          </button>
        </div>
      </nav>
 
      {/* ── PAGE CONTENT ── */}
      <div style={{ paddingTop: 52 }}>
        {page === "home" && (
          <NewsLens initialQuery={searchQuery} onQueryUsed={() => setSearchQuery("")} />
        )}
        {page === "trending" && (
          <TrendingPage onSearchTopic={handleTrendingSearch} />
        )}
        {page === "essay" && (
          <EssayPage />
        )}
      </div>
 
    </div>
  );
}