import { useState, useEffect, useRef, useCallback } from "react";

const GROQ_KEY     = import.meta.env.VITE_GROQ_KEY;
const NEWS_API_KEY = import.meta.env.VITE_NEWS_API_KEY;

// ── CORS PROXY (needed because NewsAPI blocks browsers) ───
// We use allorigins.win — free, no signup needed
function newsApiUrl(endpoint, params) {
  const base = `https://newsapi.org/v2/${endpoint}?${params}&apiKey=${NEWS_API_KEY}`;
  return `https://api.allorigins.win/get?url=${encodeURIComponent(base)}`;
}

// ── DATE HELPERS ──────────────────────────────────────────
function getFromDate(timePeriod) {
  const d = new Date();
  const map = { today: 1, week: 7, month: 30, quarter: 90, year: 365 };
  d.setDate(d.getDate() - (map[timePeriod] || 1));
  return d.toISOString().split("T")[0];
}

// ── CATEGORY QUERY MAP ────────────────────────────────────
const CAT_QUERIES = {
  all:        "India",
  politics:   "India politics government parliament",
  economy:    "India economy GDP finance RBI budget",
  sports:     "India cricket IPL sports",
  technology: "India technology AI startup digital",
  world:      "India international world affairs",
};

const CATEGORIES = [
  { id: "all",        label: "All",        icon: "🌐" },
  { id: "politics",   label: "Politics",   icon: "🏛️" },
  { id: "economy",    label: "Economy",    icon: "📈" },
  { id: "sports",     label: "Sports",     icon: "🏏" },
  { id: "technology", label: "Technology", icon: "💻" },
  { id: "world",      label: "World",      icon: "🌍" },
];

const TIME_PERIODS = [
  { id: "today",   label: "Today",       days: 1  },
  { id: "week",    label: "Last 7 days", days: 7  },
  { id: "month",   label: "Last 30 days",days: 30 },
  { id: "quarter", label: "Last 3 months",days:90 },
  { id: "year",    label: "This year",   days: 365},
];

const SENT_STYLE = {
  positive: { bg:"#f0fdf4", color:"#15803d", dot:"#22c55e" },
  negative: { bg:"#fef2f2", color:"#b91c1c", dot:"#ef4444" },
  neutral:  { bg:"#f5f4f2", color:"#57534e", dot:"#a8a29e" },
};

// ── GROQ — ANALYSE REAL HEADLINES ────────────────────────
async function analyseWithGroq(articles) {
  const headlines = articles.slice(0, 10).map((a, i) =>
    `${i+1}. [${a.source}] ${a.title} — ${a.description || ""}`
  ).join("\n");

  const prompt = `You are a news analyst. These are REAL headlines fetched right now from NewsAPI.

${headlines}

For each headline, output EXACTLY this format (one per line, no extra text):

NUM: [1-10] | CATEGORY: [Politics/Economy/Sports/Technology/World/Health/Entertainment] | HEAT: [1-100 trending score] | SENTIMENT: [Positive/Negative/Neutral] | UPSC: [GS1/GS2/GS3/GS4/Prelims/Not relevant] | SIMPLE: [one sentence explaining this news in simple language for a layman]

Output exactly ${articles.slice(0,10).length} lines. No preamble.`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1500,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.choices[0].message.content;
}

function parseGroqAnalysis(text) {
  const lines = text.split("\n").filter(l => l.includes("NUM:"));
  const map = {};
  lines.forEach(line => {
    const get = key => {
      const m = line.match(new RegExp(key + ":\\s*([^|]+)"));
      return m ? m[1].trim() : "";
    };
    const num = parseInt(get("NUM"));
    if (num) map[num] = {
      category: get("CATEGORY"),
      heat:     Math.min(100, Math.max(1, parseInt(get("HEAT")) || 50)),
      sentiment:get("SENTIMENT"),
      upsc:     get("UPSC"),
      simple:   get("SIMPLE"),
    };
  });
  return map;
}

// ── NEWS CARD ─────────────────────────────────────────────
function NewsCard({ article, index, analysis, onSearch }) {
  const [open, setOpen] = useState(false);
  const sent = SENT_STYLE[(analysis?.sentiment || "neutral").toLowerCase()] || SENT_STYLE.neutral;
  const heat = analysis?.heat || 50;
  const isUpsc = analysis?.upsc && !analysis.upsc.toLowerCase().includes("not");
  const pubDate = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "";

  return (
    <div style={{
      background:"#fff", border:`1.5px solid ${open?"#1c1917":"#e8e6e1"}`,
      borderRadius:14, overflow:"hidden", transition:"border-color .2s",
      animation:`fadeUp .3s ease ${index*0.04}s both`,
    }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding:"14px 16px", cursor:"pointer" }}>
        <div style={{ display:"flex", gap:7, alignItems:"center", marginBottom:8, flexWrap:"wrap" }}>
          {/* Rank */}
          <div style={{ width:26, height:26, borderRadius:7, background:index<3?"#1c1917":"#f1f0ec", color:index<3?"#fff":"#57534e", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>{index+1}</div>
          {/* Source */}
          <span style={{ fontSize:11, fontWeight:600, padding:"2px 9px", borderRadius:100, background:"#f1f0ec", color:"#1c1917", border:"1px solid #e8e6e1" }}>{article.source}</span>
          {/* Category */}
          {analysis?.category && <span style={{ fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:100, background:sent.bg, color:sent.color }}>{analysis.category}</span>}
          {/* Heat bar */}
          <div style={{ display:"flex", alignItems:"center", gap:5, marginLeft:"auto" }}>
            <div style={{ width:50, height:4, background:"#f1f0ec", borderRadius:100, overflow:"hidden" }}>
              <div style={{ width:`${heat}%`, height:"100%", background: heat>70?"#ef4444":heat>40?"#f97316":"#22c55e", borderRadius:100 }} />
            </div>
            <span style={{ fontSize:9, fontFamily:"'JetBrains Mono',monospace", color:"#a8a29e" }}>{heat}</span>
          </div>
          {/* UPSC */}
          {isUpsc && <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:100, background:"#eff6ff", color:"#1d4ed8", border:"1px solid #bfdbfe" }}>🎯 {analysis.upsc}</span>}
          {/* Sentiment dot */}
          <span style={{ width:7, height:7, borderRadius:"50%", background:sent.dot, flexShrink:0 }} />
        </div>

        {/* Headline — REAL from API */}
        <div style={{ fontSize:14.5, fontWeight:600, color:"#1c1917", lineHeight:1.35, marginBottom:6 }}>{article.title}</div>

        {/* Simple explanation from Groq */}
        {analysis?.simple && (
          <div style={{ fontSize:12.5, color:"#374151", lineHeight:1.6, padding:"7px 11px", background:"#f8f7f5", borderRadius:8, borderLeft:"3px solid #1d4ed8", marginBottom:6 }}>
            💡 {analysis.simple}
          </div>
        )}

        {/* Date + source */}
        <div style={{ fontSize:11, color:"#a8a29e", fontFamily:"'JetBrains Mono',monospace" }}>{pubDate}</div>
      </div>

      {/* Expanded */}
      {open && (
        <div style={{ borderTop:"1px solid #f1f0ec", padding:"13px 16px", background:"#fafaf9" }}>
          {article.description && (
            <div style={{ fontSize:13.5, color:"#374151", lineHeight:1.75, marginBottom:12 }}>{article.description}</div>
          )}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {/* REAL article link */}
            <a href={article.url} target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, color:"#fff", textDecoration:"none", fontWeight:600, padding:"7px 14px", borderRadius:100, background:"#1c1917" }}>
              Read full article ↗
            </a>
            {/* Get deep report */}
            <button onClick={() => onSearch(article.title)}
              style={{ fontSize:12, padding:"7px 14px", borderRadius:100, border:"1px solid #e8e6e1", background:"#fff", color:"#57534e", cursor:"pointer", fontWeight:500 }}>
              🔍 Get full report
            </button>
            {/* Google News search */}
            <a href={`https://news.google.com/search?q=${encodeURIComponent(article.title)}`} target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, color:"#1d4ed8", textDecoration:"none", padding:"7px 14px", borderRadius:100, border:"1px solid #bfdbfe", background:"#eff6ff" }}>
              🌐 Google News
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SKELETON ──────────────────────────────────────────────
function Skeleton() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {Array(6).fill(0).map((_,i) => (
        <div key={i} style={{ background:"#fff", border:"1px solid #e8e6e1", borderRadius:14, padding:16, animation:"shimmer 1.5s infinite" }}>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {[26,80,60].map((w,j) => <div key={j} style={{ height:22, width:w, background:"#f1f0ec", borderRadius:j===0?7:100 }} />)}
          </div>
          <div style={{ height:18, background:"#f1f0ec", borderRadius:6, width:"85%", marginBottom:8 }} />
          <div style={{ height:40, background:"#f1f0ec", borderRadius:8, width:"100%" }} />
        </div>
      ))}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────
export default function TrendingPage({ onSearchTopic }) {
  const [category,   setCategory]   = useState("all");
  const [timePeriod, setTimePeriod] = useState("today");
  const [articles,   setArticles]   = useState([]);
  const [analysis,   setAnalysis]   = useState({});
  const [loading,    setLoading]    = useState(false);
  const [analysing,  setAnalysing]  = useState(false);
  const [error,      setError]      = useState("");
  const [statusMsg,  setStatusMsg]  = useState("");
  const [lastFetched,setLastFetched]= useState(null);
  const cache = useRef({});

  const fetchNews = useCallback(async (cat, period) => {
    const cacheKey = `${cat}_${period}`;
    if (cache.current[cacheKey]) {
      setArticles(cache.current[cacheKey].articles);
      setAnalysis(cache.current[cacheKey].analysis);
      return;
    }

    setLoading(true); setError(""); setArticles([]); setAnalysis({});
    setStatusMsg("Fetching live news...");

    try {
      const fromDate = getFromDate(period);
      const query    = CAT_QUERIES[cat] || "India";

      // Try NewsAPI first
      if (NEWS_API_KEY) {
        const proxyUrl = newsApiUrl("everything", `q=${encodeURIComponent(query)}&from=${fromDate}&sortBy=publishedAt&language=en&pageSize=15`);
        const res = await fetch(proxyUrl);
        const raw = await res.json();
        const data = JSON.parse(raw.contents);

        if (data.status === "ok" && data.articles?.length > 0) {
          const cleaned = data.articles
            .filter(a => a.title && a.title !== "[Removed]" && a.url)
            .slice(0, 10)
            .map(a => ({
              title:       a.title,
              description: a.description,
              url:         a.url,
              source:      a.source?.name || "News",
              publishedAt: a.publishedAt,
              urlToImage:  a.urlToImage,
            }));

          setArticles(cleaned);
          setLoading(false);
          setLastFetched(new Date());

          // Now use Groq to analyse these real headlines
          setAnalysing(true);
          setStatusMsg("Analysing with AI...");
          try {
            const analysisText = await analyseWithGroq(cleaned);
            if (analysisText) {
              const parsed = parseGroqAnalysis(analysisText);
              setAnalysis(parsed);
              cache.current[cacheKey] = { articles: cleaned, analysis: parsed };
            }
          } catch (e) {
            console.warn("Groq analysis failed:", e.message);
          }
          setAnalysing(false);
          setStatusMsg("");
          return;
        }
      }

      // Fallback: RSS via allorigins
      setStatusMsg("Loading from RSS feeds...");
      const rssFeeds = [
        "https://feeds.feedburner.com/ndtvnews-top-stories",
        "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
        "https://www.thehindu.com/feeder/default.rss",
      ];

      let rssArticles = [];
      for (const feed of rssFeeds) {
        try {
          const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(feed)}`);
          const d = await r.json();
          const parser = new DOMParser();
          const xml = parser.parseFromString(d.contents, "text/xml");
          const items = Array.from(xml.querySelectorAll("item")).slice(0, 5);
          items.forEach(item => {
            const title = item.querySelector("title")?.textContent?.trim();
            const link  = item.querySelector("link")?.textContent?.trim();
            const desc  = item.querySelector("description")?.textContent?.replace(/<[^>]+>/g,"").trim();
            const pubDate = item.querySelector("pubDate")?.textContent?.trim();
            if (title && link) rssArticles.push({ title, url: link, description: desc, source: new URL(feed).hostname.replace("www.",""), publishedAt: pubDate });
          });
        } catch (e) { console.warn("RSS feed failed:", e.message); }
        if (rssArticles.length >= 10) break;
      }

      if (rssArticles.length > 0) {
        setArticles(rssArticles.slice(0, 10));
        setLoading(false);
        setLastFetched(new Date());
        setAnalysing(true);
        setStatusMsg("Analysing with AI...");
        try {
          const analysisText = await analyseWithGroq(rssArticles.slice(0, 10));
          if (analysisText) {
            const parsed = parseGroqAnalysis(analysisText);
            setAnalysis(parsed);
            cache.current[cacheKey] = { articles: rssArticles.slice(0,10), analysis: parsed };
          }
        } catch(e) {}
        setAnalysing(false);
        setStatusMsg("");
        return;
      }

      throw new Error("Could not fetch live news. Add VITE_NEWS_API_KEY to your .env file from newsapi.org");

    } catch (e) {
      setLoading(false); setAnalysing(false); setStatusMsg("");
      setError(e.message);
    }
  }, []);

  useEffect(() => { fetchNews(category, timePeriod); }, [category, timePeriod]);

  const today = new Date().toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

  return (
    <div style={{ fontFamily:"'Inter',sans-serif", background:"#fafaf9", minHeight:"100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes prog{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
      `}</style>

      {/* Header */}
      <div style={{ background:"#1c1917", color:"#fff", padding:"2rem 2rem 1.75rem" }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:"#ef4444", animation:"pulse 1.5s infinite" }} />
            <span style={{ fontSize:10, fontFamily:"'JetBrains Mono',monospace", letterSpacing:".1em", textTransform:"uppercase", color:"#a8a29e" }}>Live News</span>
            <span style={{ fontSize:10, color:"#60a5fa", fontFamily:"'JetBrains Mono',monospace" }}>{today}</span>
          </div>
          <h1 style={{ fontFamily:"'Instrument Serif',serif", fontSize:"clamp(1.75rem,4vw,2.4rem)", lineHeight:1.1, letterSpacing:"-.025em", marginBottom:8 }}>
            Trending <em style={{ fontStyle:"italic", color:"#ef4444" }}>Right Now</em>
          </h1>
          <p style={{ fontSize:13, color:"#a8a29e", fontWeight:300, marginBottom:"1.25rem" }}>
            Real headlines from NewsAPI + RSS — explained by AI. Every link goes to the actual article.
          </p>

          {/* Time filter */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
            {TIME_PERIODS.map(t => (
              <button key={t.id} onClick={() => setTimePeriod(t.id)}
                style={{ padding:"6px 14px", borderRadius:100, border:`1px solid ${timePeriod===t.id?"#fff":"rgba(255,255,255,.2)"}`, background:timePeriod===t.id?"#fff":"transparent", color:timePeriod===t.id?"#1c1917":"#a8a29e", fontSize:12.5, fontWeight:500, cursor:"pointer", transition:"all .15s" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Category filter */}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setCategory(c.id)}
                style={{ padding:"5px 12px", borderRadius:100, border:`1px solid ${category===c.id?"#60a5fa":"rgba(255,255,255,.15)"}`, background:category===c.id?"#1d4ed8":"transparent", color:category===c.id?"#fff":"#a8a29e", fontSize:12, fontWeight:500, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress */}
      {(loading || analysing) && (
        <div style={{ height:3, background:"#e8e6e1", overflow:"hidden" }}>
          <div style={{ height:"100%", width:"40%", background: analysing?"#60a5fa":"#ef4444", animation:"prog 1s ease-in-out infinite" }} />
        </div>
      )}

      <div style={{ maxWidth:900, margin:"0 auto", padding:"1.5rem 1.5rem 4rem" }}>

        {/* Status */}
        {(loading || analysing) && statusMsg && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 15px", background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:10, fontSize:13, color:"#1d4ed8", marginBottom:"1rem" }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:"#1d4ed8", animation:"pulse 1.4s infinite", flexShrink:0 }} />
            {statusMsg}
            {analysing && <span style={{ fontSize:11, color:"#60a5fa", marginLeft:4 }}>— real headlines loaded, adding AI analysis...</span>}
          </div>
        )}

        {loading && <Skeleton />}

        {/* Error */}
        {error && !loading && (
          <div style={{ background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:12, padding:"1.25rem 1.5rem", fontSize:13, color:"#b91c1c", lineHeight:1.8 }}>
            <strong>Could not load live news.</strong><br/>
            {error}<br/><br/>
            <strong>To fix:</strong> Add <code style={{ fontFamily:"monospace", background:"#fecaca", padding:"1px 5px", borderRadius:4 }}>VITE_NEWS_API_KEY=your_key</code> to your .env file.<br/>
            Get a free key at <a href="https://newsapi.org" target="_blank" rel="noopener noreferrer" style={{ color:"#1d4ed8" }}>newsapi.org</a> — takes 30 seconds.
            <div style={{ marginTop:10 }}>
              <button onClick={() => fetchNews(category, timePeriod)} style={{ padding:"7px 16px", borderRadius:100, border:"none", background:"#b91c1c", color:"#fff", fontSize:12, fontWeight:600, cursor:"pointer" }}>Retry</button>
            </div>
          </div>
        )}

        {/* Last fetched */}
        {lastFetched && !loading && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"1rem", flexWrap:"wrap", gap:8 }}>
            <div style={{ fontSize:12, color:"#a8a29e", fontFamily:"'JetBrains Mono',monospace" }}>
              ✅ Live data · fetched at {lastFetched.toLocaleTimeString("en-IN")} · {articles.length} real articles
              {analysing && <span style={{ color:"#1d4ed8", marginLeft:8 }}>⏳ AI analysing...</span>}
            </div>
            <button onClick={() => { cache.current = {}; fetchNews(category, timePeriod); }}
              style={{ fontSize:11.5, padding:"5px 13px", borderRadius:100, border:"1px solid #e8e6e1", background:"#fff", color:"#57534e", cursor:"pointer" }}>
              🔄 Refresh
            </button>
          </div>
        )}

        {/* Articles */}
        {!loading && articles.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {articles.map((article, i) => (
              <NewsCard
                key={i}
                article={article}
                index={i}
                analysis={analysis[i+1]}
                onSearch={onSearchTopic}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}