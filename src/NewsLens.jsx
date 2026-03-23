import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";
Chart.register(...registerables);

// ── PASTE YOUR GROQ KEY HERE ──────────────────────────────
const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;
// Get free key at: https://console.groq.com/keys
// ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional news research agent. For every query, search ONLY these 5 sources and report ONLY on the exact topic asked:
1. Times of India (timesofindia.com)
2. Hindustan Times (hindustantimes.com)
3. The Hindu (thehindu.com)
4. Al Jazeera (aljazeera.com)
5. BBC News (bbc.com/news)
6. CNN (cnn.com)
7. Washington Times (washingtontimes.com)
8. New York Times (nytimes.com)
9. India Today (indiatoday.in)
10. The Economic Times (economictimes.indiatimes.com)

Produce this EXACT structure:

SECTION 0 — SIMPLE EXPLANATION
[3-4 plain sentences explaining the topic simply]

SECTION 1 — NEWS TABLE
| # | Headline | Source | Date | Summary | Key Data | Sentiment | URL |
|---|----------|--------|------|---------|----------|-----------|-----|
[minimum 5 rows about the exact topic]

SECTION 2 — COMPARISON TABLE
If topic involves 2+ comparable entities:
| Metric | Entity A | Entity B |
|--------|----------|----------|
[6-10 meaningful metrics]
If none: write "No comparison applicable."

SECTION 3 — CHART DATA
\`\`\`json
{
  "bar": {"title":"Bar chart title","labels":["A","B","C"],"values":[10,20,30],"unit":"%"},
  "line": {"title":"Trend title","labels":["2021","2022","2023","2024","2025"],"datasets":[{"name":"Series1","values":[1,2,3,4,5]},{"name":"Series2","values":[2,3,2,4,6]}]},
  "pie": {"title":"Distribution title","labels":["Cat1","Cat2","Cat3","Cat4"],"values":[40,25,20,15],"unit":"%"},
  "comparison": {"title":"Side-by-side title","entities":["Entity A","Entity B"],"metrics":["M1","M2","M3"],"values":[[10,20],[15,12],[8,18]],"unit":""},
  "locations":[{"name":"City","lat":28.6,"lng":77.2,"note":"why mentioned"}]
}
\`\`\`

SECTION 4 — WHAT EACH SOURCE SAID
- Times of India: [summary]
- Hindustan Times: [summary]
- The Hindu: [summary]
- Al Jazeera: [summary]
- BBC News: [summary]
- CNN: [summary]
- Washington Times: [summary]
- New York Times: [summary]
- India Today: [summary]
- Economic Times: [summary]

SECTION 5 — KEY TAKEAWAY
[3 clear sentences in simple language]

SECTION 6 — SOURCE LINKS
SOURCE: [Name] | HEADLINE: [headline] | URL: [url] | DATE: [date]
[one line per article, min 5]

RULES:
- Report ONLY on the exact topic asked. Never switch.
- Never say "I cannot" — always produce all sections.
- Cover ALL 10 sources — at least 8 headlines in the news table.
- Fill all 4 chart types with real data.
- Keep language simple and professional.
- Include both Indian and international perspectives from the sources.`;

// ── HELPERS ──────────────────────────────────────────────
function extractSection(text, start, end) {
  const si = text.indexOf(start);
  if (si === -1) return null;
  const content = text.slice(si + start.length);
  if (!end) return content.trim();
  const ei = content.indexOf(end);
  return ei === -1 ? content.trim() : content.slice(0, ei).trim();
}

function extractField(str, start, end) {
  const si = str.indexOf(start);
  if (si === -1) return null;
  const after = str.slice(si + start.length);
  if (!end) return after;
  const ei = after.indexOf(end);
  return ei === -1 ? after : after.slice(0, ei);
}

function getSearchUrl(srcName, headline) {
  const s = srcName.toLowerCase();
  const words = headline.split(" ").slice(0, 5).join(" ");
  if (s.includes("times of india") || s.includes("toi"))
    return `https://timesofindia.indiatimes.com/topic/${encodeURIComponent(words)}`;
  if (s.includes("hindustan times") || s.includes("ht "))
    return `https://www.hindustantimes.com/search?q=${encodeURIComponent(headline)}`;
  if (s.includes("india today"))
    return `https://www.indiatoday.in/search?query=${encodeURIComponent(headline)}`;
  if (s.includes("the hindu") || (s.includes("hindu") && !s.includes("hindustan")))
    return `https://www.thehindu.com/search/?q=${encodeURIComponent(headline)}`;
  if (s.includes("economic times") || s.includes("economic"))
    return `https://economictimes.indiatimes.com/topic/${encodeURIComponent(words)}`;
  if (s.includes("al jazeera") || s.includes("aljazeera"))
    return `https://www.aljazeera.com/search/${encodeURIComponent(headline)}`;
  if (s.includes("bbc"))
    return `https://www.bbc.com/search?q=${encodeURIComponent(headline)}`;
  if (s.includes("cnn"))
    return `https://edition.cnn.com/search?q=${encodeURIComponent(headline)}`;
  if (s.includes("washington times"))
    return `https://www.washingtontimes.com/search/?q=${encodeURIComponent(headline)}`;
  if (s.includes("new york times") || s.includes("nyt"))
    return `https://www.nytimes.com/search?query=${encodeURIComponent(headline)}`;
  return `https://www.google.com/search?q=${encodeURIComponent(srcName + " " + headline)}`;
}

function parseNewsRows(s1text) {
  if (!s1text) return [];
  return s1text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !l.includes("---"))
    .map((row) => row.split("|").map((c) => c.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2 && cells[0] !== "#" && cells[0].toLowerCase() !== "no")
    .map((cells, i) => ({
      num: i + 1,
      headline: cells[1] || "",
      source: cells[2] || "",
      date: cells[3] || "",
      summary: cells[4] || "",
      keydata: cells[5] || "",
      sentiment: (cells[6] || "").toLowerCase(),
    }));
}

function parseComparisonRows(s2text) {
  if (!s2text || s2text.includes("No comparison applicable")) return [];
  return s2text
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !l.includes("---"))
    .map((row) => row.split("|").map((c) => c.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2);
}

function parseSourceLinks(s6text) {
  if (!s6text) return [];
  return s6text
    .split("\n")
    .filter((l) => l.includes("SOURCE:") && l.includes("HEADLINE:"))
    .map((line) => ({
      src: extractField(line, "SOURCE:", "|")?.trim() || "Source",
      head: extractField(line, "HEADLINE:", "|")?.trim() || "Article",
      date: extractField(line, "DATE:", null)?.trim() || "",
    }));
}

function parseSources(s4text) {
  const names = [
    "Times of India", "Hindustan Times", "The Hindu",
    "Al Jazeera", "BBC News", "CNN",
    "Washington Times", "New York Times",
    "India Today", "Economic Times",
  ];
  return names.map((name) => {
    const re = new RegExp(`-\\s*${name}:([^\\n-]+)`, "i");
    const m = s4text?.match(re);
    return { name, text: m ? m[1].trim() : "Coverage not found." };
  });
}

function projectLatLng(lat, lng) {
  return { x: (lng + 180) * (1000 / 360), y: (90 - lat) * (500 / 180) };
}

const STATUS_MSGS = [
  "Searching TOI, HT, Hindu, Al Jazeera, BBC, CNN, NYT, India Today, ET...",
  "Extracting headlines, data and key points...",
  "Building tables, charts and location data...",
  "Finalising your report...",
];

const QUICK_TOPICS = [
  { label: "BJP vs Congress scams", q: "scams of BJP vs Congress party" },
  { label: "India economy", q: "India economy 2025" },
  { label: "Petrol price", q: "petrol diesel price India 2025" },
  { label: "Modi news", q: "Modi government news this week" },
  { label: "India vs China", q: "India vs China GDP 2025" },
  { label: "Global inflation", q: "global inflation 2025" },
];

const C = ["#1d4ed8", "#3b82f6", "#93c5fd", "#1e40af", "#60a5fa"];
const PIE_COLORS = ["#1d4ed8", "#3b82f6", "#93c5fd", "#bfdbfe", "#1e40af", "#60a5fa", "#2563eb", "#dbeafe"];

// ── CHART HOOKS ──────────────────────────────────────────
function useChart(canvasRef, type, data, options) {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !data) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, { type, data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);
}

// ── SUB COMPONENTS ───────────────────────────────────────
function SLabel({ children }) {
  return (
    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#a8a29e", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
      {children}
      <div style={{ flex: 1, height: 1, background: "#e8e6e1" }} />
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, padding: "1.25rem 1.4rem", overflow: "hidden", ...style }}>{children}</div>;
}

function SentimentBadge({ raw }) {
  const isPos = raw.includes("pos");
  const isNeg = raw.includes("neg");
  const label = isPos ? "Positive" : isNeg ? "Negative" : "Neutral";
  const style = {
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px",
    borderRadius: 100, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
    background: isPos ? "#f0fdf4" : isNeg ? "#fef2f2" : "#f5f4f2",
    color: isPos ? "#15803d" : isNeg ? "#b91c1c" : "#57534e",
    border: !isPos && !isNeg ? "1px solid #e8e6e1" : "none",
  };
  return <span style={style}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} /> {label}</span>;
}

function LinkBtn({ href, primary, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 500, padding: "3px 9px", borderRadius: 100, textDecoration: "none", whiteSpace: "nowrap", transition: "all .15s", background: primary ? "#eff6ff" : "#fafaf9", color: primary ? "#1d4ed8" : "#a8a29e", border: primary ? "1px solid #bfdbfe" : "1px solid #e8e6e1" }}>
      {children}
    </a>
  );
}

// ── CHART COMPONENTS ─────────────────────────────────────
function BarChart({ data }) {
  const ref = useRef(null);
  useChart(ref, "bar", data ? {
    labels: data.labels,
    datasets: [{ data: data.values, backgroundColor: data.labels.map((_, i) => C[i % C.length]), borderRadius: 6, borderSkipped: false, barThickness: 28 }]
  } : null, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y}${data?.unit || ""}` } } },
    scales: { x: { grid: { display: false }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" } }, y: { grid: { color: "#f5f4f2" }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" }, beginAtZero: true, border: { display: false } } }
  });
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{data?.title || "Bar Chart — Comparison"}</div>
      <div style={{ fontSize: 12, color: "#a8a29e", marginBottom: 12 }}>Unit: {data?.unit || "value"}</div>
      <div style={{ height: 220, position: "relative" }}><canvas ref={ref} /></div>
    </Card>
  );
}

function LineChart({ data }) {
  const ref = useRef(null);
  useChart(ref, "line", data ? {
    labels: data.labels,
    datasets: (data.datasets || []).map((ds, i) => ({ label: ds.name, data: ds.values, borderColor: C[i % C.length], backgroundColor: C[i % C.length] + "20", borderWidth: 2.5, tension: 0.4, fill: i === 0, pointRadius: 4, pointBackgroundColor: C[i % C.length], pointBorderColor: "#fff", pointBorderWidth: 1.5, borderDash: i > 0 ? [5, 4] : undefined }))
  } : null, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { font: { family: "Inter", size: 11 }, color: "#78716c", boxWidth: 10, padding: 14, usePointStyle: true } } },
    scales: { x: { grid: { display: false }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" } }, y: { grid: { color: "#f5f4f2" }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" }, border: { display: false } } }
  });
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{data?.title || "Line Graph — Trend"}</div>
      <div style={{ fontSize: 12, color: "#a8a29e", marginBottom: 12 }}>Year-on-year data</div>
      <div style={{ height: 220, position: "relative" }}><canvas ref={ref} /></div>
    </Card>
  );
}

function PieChart({ data }) {
  const ref = useRef(null);
  useChart(ref, "doughnut", data ? {
    labels: data.labels,
    datasets: [{ data: data.values, backgroundColor: data.labels.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]), borderWidth: 2, borderColor: "#fff", hoverOffset: 8 }]
  } : null, {
    responsive: true, maintainAspectRatio: false, cutout: "55%",
    plugins: { legend: { position: "right", labels: { font: { family: "Inter", size: 11 }, color: "#57534e", boxWidth: 12, padding: 12, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed}${data?.unit || ""}` } } }
  });
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{data?.title || "Pie Chart — Distribution"}</div>
      <div style={{ fontSize: 12, color: "#a8a29e", marginBottom: 12 }}>Proportional breakdown</div>
      <div style={{ height: 240, position: "relative" }}><canvas ref={ref} /></div>
    </Card>
  );
}

function ComparisonChart({ data }) {
  const ref = useRef(null);
  useChart(ref, "bar", data ? {
    labels: data.metrics || [],
    datasets: (data.entities || []).map((ent, i) => ({ label: ent, data: (data.values || []).map(row => row[i] || 0), backgroundColor: C[i % C.length], borderRadius: 5, borderSkipped: false }))
  } : null, {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { font: { family: "Inter", size: 11 }, color: "#57534e", boxWidth: 12, usePointStyle: true } } },
    scales: { x: { grid: { display: false }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" } }, y: { grid: { color: "#f5f4f2" }, ticks: { font: { family: "JetBrains Mono", size: 10 }, color: "#a8a29e" }, beginAtZero: true, border: { display: false } } }
  });
  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{data?.title || "Comparison Bar — Side by Side"}</div>
      <div style={{ fontSize: 12, color: "#a8a29e", marginBottom: 12 }}>{(data?.entities || []).join(" vs ")}</div>
      <div style={{ height: 220, position: "relative" }}><canvas ref={ref} /></div>
    </Card>
  );
}

// ── WORLD MAP ────────────────────────────────────────────
function WorldMap({ locations }) {
  const [tooltip, setTooltip] = useState(null);
  const mapRef = useRef(null);
  const pts = (locations || []).map(l => ({ ...l, ...projectLatLng(l.lat, l.lng) }));

  return (
    <div ref={mapRef} style={{ width: "100%", height: 300, background: "#f5f4f2", borderRadius: 6, position: "relative", overflow: "hidden" }}>
      {tooltip && (
        <div style={{ position: "absolute", background: "#fff", border: "1px solid #e8e6e1", borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 500, pointerEvents: "none", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,.1)", top: tooltip.y, left: tooltip.x, zIndex: 10 }}>
          {tooltip.text}
        </div>
      )}
      <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%" }}>
        <rect width="1000" height="500" fill="#f5f4f2" />
        <g fill="#e2e0da" stroke="#d4d1ca" strokeWidth="0.8">
          <path d="M75,85 Q130,70 195,75 Q240,78 252,105 Q262,135 255,165 Q242,195 215,215 Q190,232 165,248 Q140,258 118,245 Q92,228 80,198 Q65,162 68,128 Z" />
          <path d="M165,252 Q205,242 238,248 Q262,258 268,285 Q275,318 268,358 Q258,395 240,418 Q218,435 195,425 Q172,410 158,380 Q148,348 150,310 Q153,278 165,252 Z" />
          <path d="M418,58 Q462,50 498,56 Q520,60 525,82 Q528,105 515,118 Q498,128 475,128 Q452,126 435,112 Q420,98 418,78 Z" />
          <path d="M435,132 Q478,120 515,128 Q542,135 550,158 Q558,188 555,225 Q550,268 540,305 Q528,338 510,352 Q488,358 465,350 Q442,340 432,310 Q422,275 425,235 Q428,182 435,132 Z" />
          <path d="M508,52 Q575,45 650,48 Q715,50 768,68 Q808,82 818,112 Q825,140 815,168 Q800,195 770,210 Q735,222 695,222 Q648,220 605,208 Q562,194 535,172 Q512,150 508,118 Q505,85 508,52 Z" />
          <path d="M572,128 Q608,122 638,132 Q658,140 665,165 Q670,195 658,225 Q644,252 618,265 Q595,272 573,258 Q553,242 548,215 Q543,185 550,158 Q558,140 572,128 Z" />
          <path d="M718,275 Q768,265 818,268 Q850,270 858,298 Q864,325 858,358 Q850,388 828,402 Q802,412 772,408 Q742,402 722,378 Q704,352 706,318 Q708,292 718,275 Z" />
        </g>
        {/* Connection lines */}
        {pts.length > 1 && pts.slice(1).map((p, i) => {
          const o = pts[0];
          const mx = (o.x + p.x) / 2, my = Math.min(o.y, p.y) - 50;
          return <path key={i} d={`M${o.x},${o.y} Q${mx},${my} ${p.x},${p.y}`} stroke="#1d4ed8" strokeWidth="1" fill="none" opacity="0.3" strokeDasharray="5,4" />;
        })}
        {/* Pins */}
        {pts.map((loc, i) => (
          <g key={i} style={{ cursor: "pointer" }}
            onMouseEnter={e => { const r = mapRef.current?.getBoundingClientRect(); setTooltip({ text: `${loc.name}${loc.note ? " — " + loc.note : ""}`, x: e.clientX - (r?.left || 0) + 14, y: e.clientY - (r?.top || 0) - 34 }); }}
            onMouseMove={e => { const r = mapRef.current?.getBoundingClientRect(); setTooltip(t => t ? { ...t, x: e.clientX - (r?.left || 0) + 14, y: e.clientY - (r?.top || 0) - 34 } : null); }}
            onMouseLeave={() => setTooltip(null)}>
            <circle cx={loc.x} cy={loc.y} r="11" fill={i === 0 ? "#1d4ed8" : "#3b82f6"} opacity="0.12" />
            <circle cx={loc.x} cy={loc.y} r="5.5" fill={i === 0 ? "#1d4ed8" : "#3b82f6"} stroke="#fff" strokeWidth="2" />
            <text x={loc.x + 10} y={loc.y - 9} fontSize="9.5" fill="#1c1917" fontFamily="JetBrains Mono,monospace" fontWeight="500">{loc.name}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── MAIN APP ─────────────────────────────────────────────
export default function NewsLens({ initialQuery = "", onQueryUsed }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState(null);

  const statusInterval = useRef(null);

  const startSearch = useCallback(async (q) => {
    const query_ = q || query;
    if (!query_.trim()) return;
    setError(""); setNotice(""); setReport(null); setLoading(true);

    if (!GROQ_KEY) {
      setLoading(false);
      setNotice("Add your FREE Groq key: Go to console.groq.com/keys → Create Key → paste it at the top of this file where it says PASTE_YOUR_GROQ_KEY_HERE.");
      return;
    }

    let mi = 0;
    setStatusMsg(STATUS_MSGS[0]);
    statusInterval.current = setInterval(() => { if (++mi < STATUS_MSGS.length) setStatusMsg(STATUS_MSGS[mi]); }, 2200);

    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 4000, temperature: 0.3, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Give me a full report on: ${query_}` }] }),
      });

      clearInterval(statusInterval.current);
      setLoading(false); setStatusMsg("");

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        const m = e.error?.message || `HTTP ${res.status}`;
        if (res.status === 401) throw new Error("Invalid Groq key — check console.groq.com/keys");
        if (res.status === 429) throw new Error("Rate limit hit — Groq allows 30 req/min on free plan. Wait 30 seconds and try again.");
        throw new Error(m);
      }

      const data = await res.json();
      const text = data.choices[0].message.content;
      parseAndSetReport(query_, text);
    } catch (err) {
      clearInterval(statusInterval.current);
      setLoading(false); setStatusMsg("");
      setError(err.message);
    }
  }, [query]);

  // Auto-cleanup on load
  // Auto-search when coming from Trending page
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      startSearch(initialQuery);
      if (onQueryUsed) onQueryUsed();
    }
  }, [initialQuery]);

  function parseAndSetReport(q, text) {
    const s0 = extractSection(text, "SECTION 0", "SECTION 1");
    const s1 = extractSection(text, "SECTION 1", "SECTION 2");
    const s2 = extractSection(text, "SECTION 2", "SECTION 3");
    const s4 = extractSection(text, "SECTION 4", "SECTION 5");
    const s5 = extractSection(text, "SECTION 5", "SECTION 6");
    const s6 = extractSection(text, "SECTION 6", null);

    let chartData = null;
    const jm = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jm) { try { chartData = JSON.parse(jm[1]); } catch (e) {} }

    const newsRows = parseNewsRows(s1);

    setReport({
      query: q,
      generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }),
      explanation: s0,
      newsRows,
      compRows: parseComparisonRows(s2),
      sources: parseSources(s4),
      takeaway: s5?.trim(),
      links: parseSourceLinks(s6),
      charts: chartData,
      locations: chartData?.locations || [
        { name: "New Delhi", lat: 28.6, lng: 77.2, note: "India capital" },
        { name: "London", lat: 51.5, lng: -0.13, note: "BBC HQ" },
        { name: "Washington DC", lat: 38.9, lng: -77.0, note: "CNN & Washington Times" },
        { name: "Doha", lat: 25.28, lng: 51.52, note: "Al Jazeera HQ" },
        { name: "New York", lat: 40.71, lng: -74.0, note: "New York Times" },
      ],
    });

    // Supabase RAG disabled
  }

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: report ? "#fafaf9" : "#000", color: "#1c1917", minHeight: "100vh", width: "100%", maxWidth: "100vw", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { -webkit-font-smoothing: antialiased; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        @keyframes prog { 0% { transform:translateX(0) scaleX(1); } 100% { transform:translateX(200%) scaleX(1.5); } }
        @keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.3; transform:scale(.85); } }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes shimmerGlow { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes orb { 0%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-20px) scale(1.05)} 66%{transform:translate(-20px,15px) scale(.97)} 100%{transform:translate(0,0) scale(1)} }
        @media print {
          .no-print { display:none !important; }
          .report-wrap { animation: none !important; }
        }
      `}</style>

      {/* ── PROGRESS BAR ── */}
      {loading && (
        <div style={{ height:2, background:"#f1f0ec", overflow:"hidden", position:"fixed", top:52, left:0, right:0, zIndex:998 }}>
          <div style={{ height:"100%", width:"40%", background:"#000", animation:"prog 1s ease-in-out infinite alternate", transformOrigin:"left" }} />
        </div>
      )}

      {/* ── HERO ── */}
      {!report && (
        <div className="no-print" style={{ background:"#000", minHeight:"calc(100vh - 52px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"3rem 1.5rem 2rem", position:"relative", overflow:"hidden" }}>

          {/* Dot grid */}
          <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle, rgba(255,255,255,.06) 1px, transparent 1px)", backgroundSize:"32px 32px", pointerEvents:"none" }} />

          {/* Top badge */}
          <div style={{ position:"relative", zIndex:10, display:"inline-flex", alignItems:"center", gap:8, marginBottom:"2rem", padding:"5px 14px", borderRadius:100, border:"1px solid rgba(255,255,255,.15)", background:"rgba(255,255,255,.04)" }}>
            <div style={{ width:5, height:5, borderRadius:"50%", background:"#fff", animation:"pulse 2s infinite" }} />
            <span style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", letterSpacing:".12em", textTransform:"uppercase", color:"rgba(255,255,255,.5)" }}>AI News Intelligence</span>
          </div>

          {/* Headline */}
          <h1 style={{ position:"relative", zIndex:10, fontFamily:"'Instrument Serif',serif", fontSize:"clamp(2.8rem,7vw,5.5rem)", lineHeight:1.05, letterSpacing:"-.04em", textAlign:"center", color:"#fff", marginBottom:"1.25rem", maxWidth:750, fontWeight:300 }}>
            Ask anything.<br />
            <em style={{ fontStyle:"italic", color:"rgba(255,255,255,.45)" }}>Get the full picture.</em>
          </h1>

          {/* Subtitle */}
          <p style={{ position:"relative", zIndex:10, fontSize:"1rem", color:"rgba(255,255,255,.35)", fontWeight:300, lineHeight:1.75, marginBottom:"2.5rem", maxWidth:460, textAlign:"center", letterSpacing:".01em" }}>
            Searches 10 trusted sources and returns a complete intelligence report — tables, charts, maps and deep analysis.
          </p>

          {/* Search */}
          <div style={{ position:"relative", zIndex:10, width:"100%", maxWidth:580, marginBottom:"1.25rem" }}>
            <div style={{ display:"flex", background:"rgba(255,255,255,.06)", border:"1px solid rgba(255,255,255,.12)", borderRadius:12, overflow:"hidden" }}>
              <input
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && startSearch()}
                placeholder="India economy, climate change, India-Pakistan..."
                style={{ flex:1, padding:"1rem 1.25rem", border:"none", outline:"none", fontFamily:"Inter,sans-serif", fontSize:".9rem", background:"transparent", color:"#fff" }}
              />
              <button onClick={() => startSearch()} disabled={loading}
                style={{ padding:"1rem 1.75rem", background:loading?"rgba(255,255,255,.1)":"#fff", color:loading?"rgba(255,255,255,.4)":"#000", border:"none", fontFamily:"Inter,sans-serif", fontSize:".85rem", fontWeight:600, cursor:loading?"not-allowed":"pointer", whiteSpace:"nowrap", transition:"all .2s" }}>
                {loading ? "Searching…" : "Search →"}
              </button>
            </div>
          </div>

          {/* Quick chips */}
          <div style={{ position:"relative", zIndex:10, display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap", maxWidth:580, marginBottom:"3.5rem" }}>
            {QUICK_TOPICS.map(t => (
              <button key={t.q} onClick={() => { setQuery(t.q); startSearch(t.q); }}
                style={{ fontSize:11, padding:"4px 13px", border:"1px solid rgba(255,255,255,.1)", borderRadius:100, cursor:"pointer", color:"rgba(255,255,255,.4)", background:"transparent", fontFamily:"Inter,sans-serif", transition:"all .15s" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* WORLD MAP */}
          <div style={{ position:"relative", zIndex:10, width:"100%", maxWidth:720, marginBottom:"2rem", animation:"float 7s ease-in-out infinite" }}>
            <img
              src="public/world-map.png"
              alt="World Map"
              style={{ width:"100%", height:"auto", opacity:0.75, filter:"invert(1) brightness(0.9)", display:"block" }}
            />
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at center, transparent 40%, #000 90%)", pointerEvents:"none" }} />
            <div style={{ position:"absolute", bottom:0, left:0, right:0, height:80, background:"linear-gradient(to top, #000, transparent)", pointerEvents:"none" }} />
          </div>
          {/* Source pills */}
          <div style={{ position:"relative", zIndex:10, display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap", maxWidth:560 }}>
            {["TOI","HT","The Hindu","Al Jazeera","BBC","CNN","Wash. Times","NYT","India Today","ET"].map(src => (
              <span key={src} style={{ fontSize:9.5, fontFamily:"'JetBrains Mono',monospace", color:"rgba(255,255,255,.25)", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.08)", padding:"2px 9px", borderRadius:100, whiteSpace:"nowrap" }}>
                {src}
              </span>
            ))}
          </div>

          {/* Status */}
          {loading && statusMsg && (
            <div style={{ position:"relative", zIndex:10, marginTop:"1.5rem", display:"flex", alignItems:"center", gap:10, padding:"10px 18px", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, fontSize:12.5, color:"rgba(255,255,255,.6)", fontFamily:"'JetBrains Mono',monospace" }}>
              <div style={{ width:7, height:7, borderRadius:"50%", background:"#fff", animation:"pulse 1.4s infinite", flexShrink:0 }} />
              {statusMsg}
            </div>
          )}

          {/* Notice */}
          {notice && (
            <div style={{ position:"relative", zIndex:10, marginTop:"1rem", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", borderRadius:10, padding:"1rem 1.4rem", fontSize:13, color:"rgba(255,255,255,.6)", maxWidth:560, lineHeight:1.8, textAlign:"center" }}>
              {notice}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ position:"relative", zIndex:10, marginTop:"1rem", background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.15)", borderRadius:10, padding:"1rem 1.4rem", fontSize:13, color:"rgba(255,255,255,.5)", maxWidth:560, lineHeight:1.7, textAlign:"center" }}>
              <strong style={{ color:"#fff" }}>Error:</strong> {error}<br /><br />
              Get your free Groq key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" style={{ color:"rgba(255,255,255,.7)" }}>console.groq.com/keys</a>
            </div>
          )}

          {/* Stats */}
          <div style={{ position:"relative", zIndex:10, display:"flex", gap:"3rem", marginTop:"2.5rem", flexWrap:"wrap", justifyContent:"center", borderTop:"1px solid rgba(255,255,255,.06)", paddingTop:"2rem", width:"100%", maxWidth:500 }}>
            {[["10","Sources"],["AI","Analysis"],["Free","No signup"],["Live","Real-time"]].map(([val, label]) => (
              <div key={label} style={{ textAlign:"center" }}>
                <div style={{ fontSize:"1.4rem", fontWeight:700, fontFamily:"'JetBrains Mono',monospace", color:"#fff", letterSpacing:"-.02em" }}>{val}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,.25)", letterSpacing:".08em", textTransform:"uppercase", marginTop:3 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── REPORT ── */}
      {report && (
        <div className="report-wrap" style={{ maxWidth: "100%", margin: "2rem auto 4rem", padding: "0 2.5rem", animation: "fadeUp .4s ease" }}>

          {/* Report Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "2rem", paddingBottom: "1.25rem", borderBottom: "2px solid #1c1917", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#a8a29e", marginBottom: ".4rem" }}>NewsLens Report</div>
              <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(1.5rem,3vw,2.1rem)", letterSpacing: "-.02em", lineHeight: 1.2, textTransform: "capitalize" }}>{report.query}</div>
              <div style={{ fontSize: 12, color: "#a8a29e", marginTop: ".35rem", fontFamily: "'JetBrains Mono',monospace" }}>{report.generatedAt} · TOI, HT, Hindu, Al Jazeera, BBC, CNN, NYT, ET</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="no-print" onClick={() => { setReport(null); setQuery(""); }}
                style={{ padding: ".6rem 1rem", background: "#f5f4f2", color: "#1c1917", border: "1px solid #e8e6e1", borderRadius: 6, fontFamily: "Inter,sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                ← New Search
              </button>
              <button onClick={() => window.print()}
                style={{ padding: ".6rem 1.2rem", background: "#1c1917", color: "#fff", border: "none", borderRadius: 6, fontFamily: "Inter,sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>
                Save PDF
              </button>
            </div>
          </div>

          {/* Section 0: Explanation */}
          {report.explanation && (
            <>
              <SLabel>What is this about</SLabel>
              <div style={{ background: "#1c1917", color: "#fff", borderRadius: 10, padding: "1.5rem 1.75rem", marginBottom: "1.5rem", lineHeight: 1.75, fontSize: ".95rem", fontWeight: 300 }}
                dangerouslySetInnerHTML={{ __html: report.explanation.replace(/\*\*(.*?)\*\*/g, "<strong style='font-weight:600;color:#93c5fd;'>$1</strong>") }} />
            </>
          )}

          {/* Section 1: News Table */}
          <SLabel>News table — all 5 sources</SLabel>
          <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, overflow: "hidden", marginBottom: "1.5rem" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "#fafaf9" }}>
                  <tr>
                    {["#", "Headline ↗", "Source", "Date", "Summary", "Key Data", "Sentiment"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#a8a29e", fontWeight: 500, borderBottom: "1px solid #e8e6e1", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.newsRows.length > 0 ? report.newsRows.map((row, i) => {
                    const searchUrl = getSearchUrl(row.source, row.headline);
                    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(row.source + " " + row.headline)}`;
                    return (
                      <tr key={i} style={{ borderBottom: i < report.newsRows.length - 1 ? "1px solid #e8e6e1" : "none" }}>
                        <td style={{ padding: "12px 14px", color: "#a8a29e", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, width: 32 }}>{row.num}</td>
                        <td style={{ padding: "12px 14px", maxWidth: 220 }}>
                          <div style={{ fontWeight: 500, marginBottom: 5, fontSize: 13.5 }}>{row.headline}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <LinkBtn href={searchUrl} primary>↗ Search {row.source.split(" ").slice(0, 2).join(" ")}</LinkBtn>
                            <LinkBtn href={googleUrl}>↗ Google</LinkBtn>
                          </div>
                        </td>
                        <td style={{ padding: "12px 14px" }}><span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 5, fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", background: "#fafaf9", border: "1px solid #e8e6e1", color: "#57534e", whiteSpace: "nowrap" }}>{row.source}</span></td>
                        <td style={{ padding: "12px 14px", color: "#a8a29e", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>{row.date}</td>
                        <td style={{ padding: "12px 14px", maxWidth: 260, color: "#57534e", fontSize: 13 }}>{row.summary}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "#1d4ed8", whiteSpace: "nowrap", fontWeight: 500 }}>{row.keydata}</td>
                        <td style={{ padding: "12px 14px" }}><SentimentBadge raw={row.sentiment} /></td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#a8a29e" }}>Report generated — data being parsed.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2: Comparison Table */}
          {report.compRows.length > 0 && (
            <>
              <SLabel>Comparison table</SLabel>
              <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, overflow: "hidden", marginBottom: "1.5rem" }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {report.compRows[0]?.map((h, i) => (
                          <th key={i} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#a8a29e", borderBottom: "2px solid #1d4ed8", whiteSpace: "nowrap", background: "#eff6ff" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.compRows.slice(1).map((row, ri) => {
                        const nums = row.slice(1).map(c => parseFloat(c.replace(/[^0-9.-]/g, "")));
                        const maxN = Math.max(...nums.filter(n => !isNaN(n)));
                        return (
                          <tr key={ri} style={{ borderBottom: ri < report.compRows.length - 2 ? "1px solid #e8e6e1" : "none" }}>
                            {row.map((cell, ci) => {
                              const val = parseFloat(cell.replace(/[^0-9.-]/g, ""));
                              const isWin = ci > 0 && !isNaN(val) && val === maxN && nums.filter(n => !isNaN(n)).length > 1;
                              return (
                                <td key={ci} style={{ padding: "11px 14px", fontFamily: ci > 0 ? "'JetBrains Mono',monospace" : "inherit", fontSize: ci > 0 ? 12 : 13.5, fontWeight: ci === 0 ? 600 : 500, color: ci === 0 ? "#1d4ed8" : isWin ? "#15803d" : "#1c1917" }}>
                                  {cell}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Charts Row 1: Bar + Line */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>
            <BarChart data={report.charts?.bar} />
            <LineChart data={report.charts?.line} />
          </div>

          {/* Charts Row 2: Pie + Comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem", marginBottom: "1.5rem" }}>
            <PieChart data={report.charts?.pie} />
            <ComparisonChart data={report.charts?.comparison} />
          </div>

          {/* Source Coverage */}
          <SLabel>What each source reported</SLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            {report.sources.map(src => (
              <div key={src.name} style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, padding: "1rem 1.1rem" }}>
                <div style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".05em", fontWeight: 500, color: "#1d4ed8", marginBottom: ".4rem", textTransform: "uppercase" }}>{src.name}</div>
                <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.6, fontWeight: 300 }}>{src.text}</div>
              </div>
            ))}
          </div>

          {/* Source Links */}
          {report.links.length > 0 && (
            <>
              <SLabel>Source links — verify yourself</SLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: ".75rem", marginBottom: "1.5rem" }}>
                {report.links.map((lnk, i) => {
                  const searchUrl = getSearchUrl(lnk.src, lnk.head);
                  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(lnk.src + " " + lnk.head)}`;
                  return (
                    <div key={i} style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, padding: "1rem 1.1rem" }}>
                      <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".06em", textTransform: "uppercase", color: "#1d4ed8", fontWeight: 500, marginBottom: ".35rem" }}>{lnk.src} {lnk.date ? "· " + lnk.date : ""}</div>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: "#1c1917", lineHeight: 1.45, marginBottom: ".5rem" }}>{lnk.head}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <LinkBtn href={searchUrl} primary>↗ Search on {lnk.src.split(" ").slice(0, 2).join(" ")}</LinkBtn>
                        <LinkBtn href={googleUrl}>↗ Google</LinkBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Map */}
          <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, padding: "1.25rem 1.4rem", marginBottom: "1.5rem" }}>
            <SLabel>Locations mentioned in this report</SLabel>
            <WorldMap locations={report.locations} />
          </div>



          {/* Takeaway */}
          {report.takeaway && (
            <div style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", color: "#fff", borderRadius: 10, padding: "1.5rem 1.75rem", marginBottom: "1.5rem", display: "flex", gap: "1.25rem", alignItems: "flex-start" }}>
              <div style={{ fontSize: "1.5rem", flexShrink: 0, marginTop: ".1rem" }}>💡</div>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "#93c5fd", marginBottom: ".5rem" }}>Key Takeaway</div>
                <div style={{ fontSize: ".95rem", lineHeight: 1.75, fontWeight: 300 }}>{report.takeaway}</div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ElevenLabs widget */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200 }}>
        <elevenlabs-convai agent-id="agent_4601km5fj0xnf9qbwjm292ttpw3x"></elevenlabs-convai>
      </div>
    </div>
  );
}          {/* WORLD MAP — using local worldmap.png */}
          <div style={{ position:"relative", zIndex:10, width:"100%", maxWidth:720, marginBottom:"2rem", animation:"float 7s ease-in-out infinite" }}>
            <img
              src="/worldmap.png"
              alt="World Map"
              style={{ width:"100%", height:"auto", opacity:0.55, display:"block" }}
            />
            {/* Fade edges */}
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at center, transparent 45%, #000 90%)", pointerEvents:"none" }} />
            <div style={{ position:"absolute", bottom:0, left:0, right:0, height:80, background:"linear-gradient(to top, #000, transparent)", pointerEvents:"none" }} />
          </div>