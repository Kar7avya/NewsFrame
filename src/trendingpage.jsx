import { useState, useEffect, useRef } from "react";

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "politics", label: "Politics" },
  { id: "economy", label: "Economy" },
  { id: "sports", label: "Sports" },
  { id: "technology", label: "Technology" },
  { id: "world", label: "World" },
];

const TIME_PERIODS = [
  { id: "today",   label: "Today",      desc: "last 24 hours" },
  { id: "week",    label: "Last 7 days", desc: "past week" },
  { id: "month",   label: "Last 30 days", desc: "past month" },
  { id: "quarter", label: "Last 3 months", desc: "past quarter" },
  { id: "year",    label: "This year",   desc: "past 12 months" },
];

function getTrendPrompt(timePeriod) {
  const timeMap = {
    today:   "in the last 24 hours",
    week:    "in the last 7 days",
    month:   "in the last 30 days",
    quarter: "in the last 3 months",
    year:    "in the last 12 months",
  };
  const timeDesc = timeMap[timePeriod] || "right now";
  return `You are a news intelligence agent tracking what Indians are talking about ${timeDesc}.

Generate exactly 10 trending news topics in India from ${timeDesc}. For each topic output this EXACT format — one per line, no extra text:

TOPIC: [topic name — max 6 words] | CATEGORY: [Politics/Economy/Sports/Technology/World/Health/Entertainment] | HEAT: [number 1-100 representing trending intensity] | SUMMARY: [one sentence — what happened ${timeDesc}] | KEYWORDS: [3 comma-separated search keywords] | SENTIMENT: [Positive/Negative/Neutral] | SOURCE_HINT: [which newspaper would cover this most — TOI/BBC/Hindu/ET/IndiaToday]

Output exactly 10 lines. No numbering. No preamble. No extra text.`;
}

function useTrending(category, timePeriod, refreshKey) {
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const cache = useRef({});

  useEffect(() => {
    async function fetch_() {
      const key = `${category}_${timePeriod}`;
      if (refreshKey === 0 && cache.current[key]) {
        setTopics(cache.current[key]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const timeMap = { today:"last 24 hours", week:"last 7 days", month:"last 30 days", quarter:"last 3 months", year:"last 12 months" };
        const timeDesc = timeMap[timePeriod] || "right now";
        const catPart = category === "all" ? "" : `${category} `;
        const userMsg = `What are the top 10 trending ${catPart}news topics in India from the ${timeDesc}?`;

        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            max_tokens: 1500,
            temperature: 0.7,
            messages: [{ role: "system", content: getTrendPrompt(timePeriod) }, { role: "user", content: userMsg }],
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch trends");
        const data = await res.json();
        const text = data.choices[0].message.content;
        const parsed = parseTrends(text);
        cache.current[key] = parsed;
        setTopics(parsed);
        setLastUpdated(new Date());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    fetch_();
  }, [category, timePeriod, refreshKey]);

  return { topics, loading, error, lastUpdated };
}

function parseTrends(text) {
  return text.split("\n")
    .filter(l => l.includes("TOPIC:") && l.includes("CATEGORY:"))
    .slice(0, 10)
    .map((line, i) => {
      const get = (key, next) => {
        const si = line.indexOf(key + ":");
        if (si === -1) return "";
        const after = line.slice(si + key.length + 1).trim();
        if (!next) return after.split("|")[0].trim();
        const ni = after.indexOf("|");
        return ni === -1 ? after.trim() : after.slice(0, ni).trim();
      };
      return {
        id: i,
        topic: get("TOPIC"),
        category: get("CATEGORY"),
        heat: Math.min(100, Math.max(1, parseInt(get("HEAT")) || 50)),
        summary: get("SUMMARY"),
        keywords: get("KEYWORDS").split(",").map(k => k.trim()).filter(Boolean),
        sentiment: get("SENTIMENT"),
        sourceHint: get("SOURCE_HINT"),
        rank: i + 1,
      };
    })
    .filter(t => t.topic);
}

function getSearchUrl(topic, keywords) {
  const q = encodeURIComponent(keywords[0] || topic);
  return `https://www.google.com/search?q=${q}+India+news`;
}

function HeatBar({ value }) {
  const color = value >= 75 ? "#ef4444" : value >= 50 ? "#f97316" : value >= 25 ? "#eab308" : "#22c55e";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "#f1f0ec", borderRadius: 100, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 100, transition: "width 1s ease" }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color, fontWeight: 600, minWidth: 28 }}>{value}</span>
    </div>
  );
}

function SentBadge({ s }) {
  const isPos = s?.toLowerCase().includes("pos");
  const isNeg = s?.toLowerCase().includes("neg");
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 100,
      background: isPos ? "#f0fdf4" : isNeg ? "#fef2f2" : "#f5f4f2",
      color: isPos ? "#15803d" : isNeg ? "#b91c1c" : "#78716c",
      border: `1px solid ${isPos ? "#bbf7d0" : isNeg ? "#fecaca" : "#e8e6e1"}`,
    }}>{s || "Neutral"}</span>
  );
}

function CatBadge({ cat }) {
  const colors = {
    politics: ["#fef3c7", "#92400e"], economy: ["#dbeafe", "#1e40af"],
    sports: ["#dcfce7", "#166534"], technology: ["#ede9fe", "#5b21b6"],
    world: ["#fce7f3", "#9d174d"], health: ["#d1fae5", "#065f46"],
    entertainment: ["#fef9c3", "#713f12"],
  };
  const [bg, text] = colors[cat?.toLowerCase()] || ["#f1f0ec", "#57534e"];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 100, background: bg, color: text, textTransform: "uppercase", letterSpacing: ".04em" }}>
      {cat}
    </span>
  );
}

function TopicCard({ topic, rank, onSearch }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#fff", border: `1px solid ${hovered ? "#1d4ed8" : "#e8e6e1"}`,
        borderRadius: 12, padding: "1.1rem 1.25rem", cursor: "pointer",
        transition: "all .2s", transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered ? "0 8px 24px rgba(29,78,216,.1)" : "0 1px 4px rgba(0,0,0,.04)",
        animation: `fadeUp .4s ease ${rank * 0.05}s both`,
      }}
      onClick={() => onSearch(topic.topic)}
    >
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: rank <= 3 ? "#1d4ed8" : "#f1f0ec",
            color: rank <= 3 ? "#fff" : "#57534e", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0,
            fontFamily: "'JetBrains Mono',monospace",
          }}>
            {rank <= 3 ? ["🔥", "⚡", "💥"][rank - 1] : `${rank}`}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1c1917", lineHeight: 1.3, marginBottom: 3 }}>{topic.topic}</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <CatBadge cat={topic.category} />
              <SentBadge s={topic.sentiment} />
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 12.5, color: "#57534e", lineHeight: 1.6, marginBottom: 10 }}>{topic.summary}</div>

      {/* Heat bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4 }}>Trending heat</div>
        <HeatBar value={topic.heat} />
      </div>

      {/* Keywords */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
        {topic.keywords.map((k, i) => (
          <span key={i} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 6, background: "#f1f0ec", color: "#57534e", fontFamily: "'JetBrains Mono',monospace" }}>#{k}</span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          onClick={e => { e.stopPropagation(); onSearch(topic.topic); }}
          style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 100, border: "none", background: "#1d4ed8", color: "#fff", cursor: "pointer" }}>
          📰 Get full report
        </button>
        <a
          href={getSearchUrl(topic.topic, topic.keywords)}
          target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#fff", color: "#57534e", textDecoration: "none", cursor: "pointer" }}>
          🔍 Search news
        </a>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1.1rem 1.25rem", animation: "shimmer 1.5s infinite" }}>
      {[["70%", 14], ["100%", 10], ["85%", 10], ["40%", 6]].map(([w, h], i) => (
        <div key={i} style={{ height: h, background: "#f1f0ec", borderRadius: 6, width: w, marginBottom: 10 }} />
      ))}
    </div>
  );
}

export default function TrendingPage({ onSearchTopic }) {
  const [category, setCategory] = useState("all");
  const [timePeriod, setTimePeriod] = useState("today");
  const [refreshKey, setRefreshKey] = useState(0);
  const { topics, loading, error, lastUpdated } = useTrending(category, timePeriod, refreshKey);

  const topHeat = topics.length > 0 ? Math.max(...topics.map(t => t.heat)) : 0;
  const activeTime = TIME_PERIODS.find(t => t.id === timePeriod);

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "#fafaf9", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0%,100% { opacity:1; } 50% { opacity:.5; } }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse-dot { 0%,100% { transform:scale(1); opacity:1; } 50% { transform:scale(1.4); opacity:.6; } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: "#1c1917", color: "#fff", padding: "2.5rem 2rem 2rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse-dot 1.5s infinite" }} />
                <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".12em", textTransform: "uppercase", color: "#a8a29e" }}>Live Trends</span>
              </div>
              <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(1.8rem,4vw,2.75rem)", lineHeight: 1.1, letterSpacing: "-.025em", marginBottom: 6 }}>
                Trending in <em style={{ fontStyle: "italic", color: "#60a5fa" }}>India</em>
              </h1>
              <p style={{ fontSize: 13, color: "#a8a29e", fontWeight: 300 }}>
                Top 10 topics · <span style={{ color: "#60a5fa", fontWeight: 500 }}>{activeTime?.label}</span> · {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-IN", { timeStyle: "short" })}` : "Fetching..."}
              </p>
            </div>
            <button
              onClick={() => { const k = `${category}_${timePeriod}`; delete (useTrending.__cache||{})[k]; setRefreshKey(r => r + 1); }}
              disabled={loading}
              style={{ padding: ".65rem 1.25rem", background: loading ? "#374151" : "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7, transition: "background .15s" }}>
              <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>↻</span>
              {loading ? "Fetching..." : "Refresh"}
            </button>
          </div>

          {/* ── TIME PERIOD PILLS ── */}
          <div style={{ marginTop: "1.25rem", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIME_PERIODS.map(tp => (
              <button key={tp.id} onClick={() => setTimePeriod(tp.id)}
                style={{
                  padding: "6px 14px", borderRadius: 100, border: `1px solid ${timePeriod === tp.id ? "#60a5fa" : "rgba(255,255,255,.15)"}`,
                  background: timePeriod === tp.id ? "#1d4ed8" : "rgba(255,255,255,.06)",
                  color: timePeriod === tp.id ? "#fff" : "#a8a29e",
                  fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
                  transition: "all .15s", fontFamily: "'Inter',sans-serif",
                }}>
                {tp.label}
              </button>
            ))}
          </div>

          {/* Heat meter for top topic */}
          {!loading && topics.length > 0 && (
            <div style={{ marginTop: "1.25rem", background: "rgba(255,255,255,.06)", borderRadius: 10, padding: "1rem 1.25rem" }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".1em", textTransform: "uppercase", color: "#60a5fa", marginBottom: 6 }}>
                🔥 Hottest topic — {activeTime?.desc}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{topics[0]?.topic}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,.1)", borderRadius: 100, overflow: "hidden" }}>
                  <div style={{ width: `${topHeat}%`, height: "100%", background: "linear-gradient(90deg,#3b82f6,#ef4444)", borderRadius: 100, transition: "width 1s ease" }} />
                </div>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "#ef4444", fontWeight: 700 }}>{topHeat} heat</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── CATEGORY + TIME FILTER BAR ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e6e1", padding: ".75rem 2rem", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Category row */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, borderBottom: "1px solid #f1f0ec", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em", alignSelf: "center", marginRight: 4, whiteSpace: "nowrap" }}>Category</span>
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setCategory(cat.id)}
                style={{ padding: "5px 13px", borderRadius: 100, border: `1px solid ${category === cat.id ? "#1d4ed8" : "#e8e6e1"}`, background: category === cat.id ? "#1d4ed8" : "#fff", color: category === cat.id ? "#fff" : "#57534e", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", transition: "all .15s" }}>
                {cat.label}
              </button>
            ))}
          </div>
          {/* Active filters summary */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#a8a29e" }}>
            <span>Showing:</span>
            <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "2px 8px", borderRadius: 100, fontWeight: 500 }}>
              {category === "all" ? "All categories" : category}
            </span>
            <span>·</span>
            <span style={{ background: "#f0fdf4", color: "#15803d", padding: "2px 8px", borderRadius: 100, fontWeight: 500 }}>
              {activeTime?.label}
            </span>
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{ maxWidth: 1100, margin: "2rem auto", padding: "0 1.5rem 4rem" }}>

        {/* Error */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "1rem 1.4rem", fontSize: 13, color: "#b91c1c", marginBottom: "1.5rem" }}>
            <strong>Error:</strong> {error} — Make sure your Groq key is set in .env
          </div>
        )}

        {/* Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
          {loading
            ? Array(10).fill(0).map((_, i) => <SkeletonCard key={i} />)
            : topics.map((topic, i) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  rank={i + 1}
                  onSearch={onSearchTopic}
                />
              ))
          }
        </div>

        {/* Footer note */}
        {!loading && topics.length > 0 && (
          <div style={{ textAlign: "center", marginTop: "2.5rem", fontSize: 12, color: "#a8a29e", fontFamily: "'JetBrains Mono',monospace" }}>
            Click any topic to get a full report · Powered by Groq + Llama 3.3
          </div>
        )}
      </div>
    </div>
  );
}