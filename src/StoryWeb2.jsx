import { useState, useRef, useCallback, useEffect } from "react";

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;

// ── GROQ CALL ─────────────────────────────────────────────
async function groqCall(messages, maxTokens = 3000) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: maxTokens, temperature: 0.4, messages }),
    });
    if (res.status === 429 && attempt < delays.length) {
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }
}

// ── PROMPT ────────────────────────────────────────────────
const buildPrompt = (topic) => `You are a brilliant news analyst. For the topic "${topic}", generate a Story Web — a map of how this news story connects to other events, causes, consequences, and related issues.

Output EXACTLY this format:

CENTRAL_TOPIC: [the main topic — 3-5 words]
CENTRAL_DESCRIPTION: [2 sentences explaining the core story simply]

Then generate 8-12 connected nodes. Each node is a related story, cause, effect, or context. Use EXACTLY this format for each:

===NODE_START===
NODE_ID: [N1, N2, N3...]
NODE_LABEL: [3-5 words — the connected topic]
NODE_TYPE: [CAUSE/EFFECT/RELATED/CONTEXT/PERSON/POLICY]
NODE_DESCRIPTION: [2 sentences explaining this node simply]
STRENGTH: [1-10 — how strongly connected to central topic]
DIRECTION: [INWARD/OUTWARD/BIDIRECTIONAL — does it cause the central topic, result from it, or both]
SIMPLE_LINK: [1 sentence — exactly how this connects to "${topic}"]
===NODE_END===

Then generate connections between nodes (not just to center):

===LINK_START===
FROM: [N1/N2/etc or CENTER]
TO: [N1/N2/etc or CENTER]
LABEL: [2-3 word relationship label]
===LINK_END===

[Generate 8-15 links total — most connect to CENTER, some connect nodes to each other]

INSIGHT: [The most surprising or non-obvious connection in this web — 2 sentences]
KEY_DOMINO: [Which node, if changed, would most affect everything else? — 1 sentence]

RULES:
- Every node must be real and factually connected
- Mix causes (what led to this), effects (what this causes), people, policies, global connections
- Include at least 2 India-specific nodes
- Include at least 1 global/international connection
- CAUSE nodes come BEFORE the central topic, EFFECT nodes come AFTER`;

// ── PARSER ────────────────────────────────────────────────
function parseWeb(text) {
  const get = key => {
    const m = text.match(new RegExp(key + ":\\s*(.+)"));
    return m ? m[1].trim().replace(/\*\*/g, "") : "";
  };

  const nodes = text.split("===NODE_START===").slice(1).map(block => {
    const b = block.split("===NODE_END===")[0];
    const g = key => { const m = b.match(new RegExp(key + ":\\s*(.+)")); return m ? m[1].trim() : ""; };
    return {
      id:          g("NODE_ID"),
      label:       g("NODE_LABEL"),
      type:        g("NODE_TYPE"),
      description: g("NODE_DESCRIPTION"),
      strength:    Math.min(10, Math.max(1, parseInt(g("STRENGTH")) || 5)),
      direction:   g("DIRECTION"),
      simpleLink:  g("SIMPLE_LINK"),
    };
  }).filter(n => n.id && n.label);

  const links = text.split("===LINK_START===").slice(1).map(block => {
    const b = block.split("===LINK_END===")[0];
    const g = key => { const m = b.match(new RegExp(key + ":\\s*(.+)")); return m ? m[1].trim() : ""; };
    return { from: g("FROM"), to: g("TO"), label: g("LABEL") };
  }).filter(l => l.from && l.to);

  return {
    centralTopic:       get("CENTRAL_TOPIC"),
    centralDescription: get("CENTRAL_DESCRIPTION"),
    nodes,
    links,
    insight:            get("INSIGHT"),
    keyDomino:          get("KEY_DOMINO"),
  };
}

// ── NODE TYPE STYLES ──────────────────────────────────────
const TYPE_STYLE = {
  CAUSE:   { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", dot: "#ef4444", label: "Cause" },
  EFFECT:  { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", dot: "#22c55e", label: "Effect" },
  RELATED: { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af", dot: "#3b82f6", label: "Related" },
  CONTEXT: { bg: "#fefce8", border: "#fde68a", text: "#92400e", dot: "#eab308", label: "Context" },
  PERSON:  { bg: "#fdf4ff", border: "#e9d5ff", text: "#7e22ce", dot: "#a855f7", label: "Person" },
  POLICY:  { bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1", dot: "#0ea5e9", label: "Policy" },
};

function getTypeStyle(type) {
  return TYPE_STYLE[type?.toUpperCase()] || TYPE_STYLE.RELATED;
}

// ── LAYOUT ENGINE ─────────────────────────────────────────
function computeLayout(nodes, width = 560, height = 420) {
  const cx = width / 2, cy = height / 2;
  const positions = { CENTER: { x: cx, y: cy } };

  const total = nodes.length;
  nodes.forEach((node, i) => {
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
    const radius = 110 + (10 - node.strength) * 5;
    positions[node.id] = {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return positions;
}

// ── WEB CANVAS ────────────────────────────────────────────
function WebCanvas({ webData, selectedNode, onSelectNode }) {
  const W = 560, H = 420;
  const positions = computeLayout(webData.nodes, W, H);
  const cx = W / 2, cy = H / 2;

  return (
    <div style={{ overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch" }}>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 340, height: "auto", display: "block" }}>
      <defs>
        <marker id="arrowW" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </marker>
      </defs>

      {/* Draw links */}
      {webData.links.map((link, i) => {
        const from = positions[link.from] || positions["CENTER"];
        const to   = positions[link.to]   || positions["CENTER"];
        if (!from || !to) return null;

        const isSelected = selectedNode &&
          (link.from === selectedNode || link.to === selectedNode ||
           link.from === "CENTER" && selectedNode === "CENTER" ||
           link.to === "CENTER" && selectedNode === "CENTER");

        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        return (
          <g key={i}>
            <line
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              stroke={isSelected ? "#1c1917" : "#d1cec8"}
              strokeWidth={isSelected ? 1.5 : 0.75}
              strokeDasharray={link.from !== "CENTER" && link.to !== "CENTER" ? "4 3" : "none"}
              markerEnd="url(#arrowW)"
              opacity={selectedNode && !isSelected ? 0.2 : 1}
            />
            {isSelected && link.label && (
              <text
                x={midX} y={midY - 5}
                textAnchor="middle"
                style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", fill: "#57534e" }}>
                {link.label}
              </text>
            )}
          </g>
        );
      })}

      {/* Central node */}
      <g
        onClick={() => onSelectNode(selectedNode === "CENTER" ? null : "CENTER")}
        style={{ cursor: "pointer" }}>
        <circle cx={cx} cy={cy} r={34}
          fill={selectedNode === "CENTER" ? "#1c1917" : "#fff"}
          stroke="#1c1917" strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={40} fill="none" stroke="#1c1917" strokeWidth={0.5} opacity={0.3} />
        <text
          x={cx} y={cy - 6} textAnchor="middle"
          style={{ fontSize: 10, fontWeight: 600, fill: selectedNode === "CENTER" ? "#fff" : "#1c1917", fontFamily: "'Inter',sans-serif" }}>
          {webData.centralTopic.split(" ").slice(0, 2).join(" ")}
        </text>
        <text
          x={cx} y={cy + 8} textAnchor="middle"
          style={{ fontSize: 11, fontWeight: 600, fill: selectedNode === "CENTER" ? "#fff" : "#1c1917", fontFamily: "'Inter',sans-serif" }}>
          {webData.centralTopic.split(" ").slice(2).join(" ")}
        </text>
        <text
          x={cx} y={cy + 22} textAnchor="middle"
          style={{ fontSize: 9, fill: selectedNode === "CENTER" ? "rgba(255,255,255,.6)" : "#a8a29e", fontFamily: "'JetBrains Mono',monospace" }}>
          CENTRAL
        </text>
      </g>

      {/* Node circles */}
      {webData.nodes.map(node => {
        const pos = positions[node.id];
        if (!pos) return null;
        const ts = getTypeStyle(node.type);
        const isSel = selectedNode === node.id;
        const isLinked = selectedNode && webData.links.some(l =>
          (l.from === node.id && (l.to === selectedNode || l.to === "CENTER" && selectedNode === "CENTER")) ||
          (l.to === node.id && (l.from === selectedNode || l.from === "CENTER" && selectedNode === "CENTER"))
        );
        const r = 22 + node.strength * 1.0;
        const opacity = selectedNode && !isSel && !isLinked ? 0.3 : 1;

        return (
          <g key={node.id} onClick={() => onSelectNode(isSel ? null : node.id)}
            style={{ cursor: "pointer", opacity, transition: "opacity .2s" }}>
            <circle cx={pos.x} cy={pos.y} r={r}
              fill={isSel ? ts.dot : ts.bg}
              stroke={ts.border} strokeWidth={isSel ? 2 : 1} />
            {/* Type dot */}
            <circle cx={pos.x + r - 7} cy={pos.y - r + 7} r={4}
              fill={ts.dot} opacity={isSel ? 0 : 1} />
            <text x={pos.x} y={pos.y - 4} textAnchor="middle"
              style={{ fontSize: 8.5, fontWeight: 600, fill: isSel ? "#fff" : ts.text, fontFamily: "'Inter',sans-serif" }}>
              {node.label.split(" ").slice(0, 2).join(" ")}
            </text>
            <text x={pos.x} y={pos.y + 7} textAnchor="middle"
              style={{ fontSize: 8.5, fontWeight: 600, fill: isSel ? "#fff" : ts.text, fontFamily: "'Inter',sans-serif" }}>
              {node.label.split(" ").slice(2, 4).join(" ")}
            </text>
            <text x={pos.x} y={pos.y + 19} textAnchor="middle"
              style={{ fontSize: 8, fill: isSel ? "rgba(255,255,255,.65)" : "#a8a29e", fontFamily: "'JetBrains Mono',monospace" }}>
              {ts.label}
            </text>
          </g>
        );
      })}
    </svg>
    </div>
  );
}

// ── NODE DETAIL PANEL ─────────────────────────────────────
function NodeDetail({ node, webData, isCenter }) {
  if (isCenter) {
    return (
      <div style={{ background: "#1c1917", color: "#fff", borderRadius: 12, padding: "1.25rem 1.4rem" }}>
        <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>Central topic</div>
        <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.3rem", marginBottom: 10, lineHeight: 1.3 }}>{webData.centralTopic}</div>
        <div style={{ fontSize: 13.5, color: "#d1d5db", lineHeight: 1.75 }}>{webData.centralDescription}</div>
        <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{webData.nodes.length}</div>
            <div style={{ fontSize: 10, color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em" }}>Connections</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{webData.nodes.filter(n => n.type === "CAUSE").length}</div>
            <div style={{ fontSize: 10, color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em" }}>Causes</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{webData.nodes.filter(n => n.type === "EFFECT").length}</div>
            <div style={{ fontSize: 10, color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em" }}>Effects</div>
          </div>
        </div>
      </div>
    );
  }

  if (!node) return (
    <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>👆</div>
      <div style={{ fontSize: 13.5, color: "#a8a29e", lineHeight: 1.7 }}>Click any node on the web to see how it connects to the story</div>
    </div>
  );

  const ts = getTypeStyle(node.type);
  const connectedLinks = webData.links.filter(l => l.from === node.id || l.to === node.id);

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${ts.border}`, borderRadius: 12, padding: "1.25rem 1.4rem", animation: "fadeUp .25s ease" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: ts.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}`, textTransform: "uppercase", letterSpacing: ".04em" }}>{ts.label}</span>
        <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", marginLeft: "auto" }}>Strength: {node.strength}/10</span>
      </div>

      <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.15rem", color: "#1c1917", lineHeight: 1.3, marginBottom: 8 }}>{node.label}</div>

      {/* Simple link */}
      <div style={{ fontSize: 13, color: ts.text, lineHeight: 1.6, padding: "8px 12px", background: ts.bg, borderRadius: 8, marginBottom: 10, borderLeft: `3px solid ${ts.dot}` }}>
        🔗 {node.simpleLink}
      </div>

      <div style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.75, marginBottom: 12 }}>{node.description}</div>

      {/* Direction badge */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "#f5f4f2", color: "#57534e", border: "1px solid #e8e6e1", fontFamily: "'JetBrains Mono',monospace" }}>
          {node.direction === "INWARD" ? "→ leads to story" : node.direction === "OUTWARD" ? "← results from story" : "⇄ bidirectional"}
        </span>
        {connectedLinks.length > 0 && (
          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, background: "#f5f4f2", color: "#57534e", border: "1px solid #e8e6e1" }}>
            {connectedLinks.length} connections
          </span>
        )}
      </div>
    </div>
  );
}

// ── SAMPLE TOPICS ─────────────────────────────────────────
const SAMPLES = [
  "India inflation",
  "Ukraine Russia war",
  "India China border",
  "Climate change India",
  "AI replacing jobs",
  "RBI interest rates",
  "Uniform Civil Code",
  "US tariffs on India",
];

// ── MAIN PAGE ─────────────────────────────────────────────
export default function StoryWeb() {
  const [topic,        setTopic]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [webData,      setWebData]      = useState(null);
  const [error,        setError]        = useState("");
  const [statusMsg,    setStatusMsg]    = useState("");
  const [selectedNode, setSelectedNode] = useState(null);
  const [filterType,   setFilterType]   = useState("ALL");
  const statusRef = useRef(null);

  const STATUS = [
    "Mapping the story...",
    "Finding causes and effects...",
    "Discovering hidden connections...",
    "Building the web...",
    "Almost ready...",
  ];

  const generate = useCallback(async (q) => {
    const query = q || topic;
    if (!query.trim()) return;
    setLoading(true); setWebData(null); setError(""); setSelectedNode(null);
    let mi = 0; setStatusMsg(STATUS[0]);
    statusRef.current = setInterval(() => { if (++mi < STATUS.length) setStatusMsg(STATUS[mi]); }, 2200);
    try {
      const text = await groqCall([
        { role: "system", content: buildPrompt(query) },
        { role: "user", content: `Build the complete Story Web for: "${query}"` },
      ], 3500);
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      const parsed = parseWeb(text);
      setWebData(parsed);
    } catch (e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setError(e.message);
    }
  }, [topic]);

  const selectedNodeData = webData?.nodes.find(n => n.id === selectedNode);
  const isCenter = selectedNode === "CENTER";

  const filteredWeb = webData ? {
    ...webData,
    nodes: filterType === "ALL" ? webData.nodes : webData.nodes.filter(n => n.type === filterType),
  } : null;

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "#fafaf9", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
        @keyframes prog{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .web-main-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem;}
        @media(min-width:700px){.web-main-grid{grid-template-columns:1fr 300px;}}
        .web-node-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
      `}</style>

      {/* Header */}
      <div style={{ background: "#1c1917", color: "#fff", padding: "2rem 2rem 1.75rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#60a5fa", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".1em", textTransform: "uppercase", color: "#a8a29e" }}>Story Web · Connect the Dots</span>
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(1.75rem,4vw,2.5rem)", lineHeight: 1.1, letterSpacing: "-.025em", marginBottom: 8 }}>
            See how stories <em style={{ fontStyle: "italic", color: "#60a5fa" }}>connect.</em>
          </h1>
          <p style={{ fontSize: 13, color: "#a8a29e", fontWeight: 300, lineHeight: 1.65, maxWidth: 520, marginBottom: "1.5rem" }}>
            Enter any news topic — get a visual web showing causes, effects, people, policies and global connections. Real news intelligence is seeing the full picture.
          </p>

          {/* Search */}
          <div style={{ display: "flex", gap: 0, width: "100%", maxWidth: 620, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generate()}
              placeholder="e.g. India inflation, Ukraine war, AI jobs, RBI rates..."
              style={{ flex: 1, padding: ".85rem 1.1rem", background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: "'Inter',sans-serif" }}
            />
            <button onClick={() => generate()} disabled={loading}
              style={{ padding: ".85rem 1.5rem", background: loading ? "rgba(255,255,255,.1)" : "#fff", color: loading ? "rgba(255,255,255,.4)" : "#1c1917", border: "none", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
              {loading ? "Mapping..." : "Map It →"}
            </button>
          </div>

          {/* Sample chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SAMPLES.map(s => (
              <button key={s} onClick={() => { setTopic(s); generate(s); }}
                style={{ fontSize: 11, padding: "4px 12px", borderRadius: 100, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.06)", color: "#a8a29e", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Progress */}
      {loading && (
        <div style={{ height: 3, background: "#e8e6e1", overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "#60a5fa", animation: "prog 1.2s ease-in-out infinite" }} />
        </div>
      )}

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.5rem 1.5rem 4rem" }}>

        {/* Status */}
        {loading && statusMsg && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 13, color: "#1d4ed8", marginBottom: "1rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1d4ed8", animation: "pulse 1.4s infinite", flexShrink: 0 }} />
            {statusMsg}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14, height: 520, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 40, height: 40, border: "3px solid #e8e6e1", borderTop: "3px solid #1c1917", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
              <div style={{ fontSize: 13, color: "#a8a29e" }}>{statusMsg}</div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "1rem 1.4rem", fontSize: 13, color: "#b91c1c", lineHeight: 1.7 }}>
            <strong>Error:</strong> {error}
            <button onClick={() => generate()} style={{ marginLeft: 12, fontSize: 12, padding: "3px 12px", borderRadius: 100, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* Web */}
        {webData && !loading && (
          <div style={{ animation: "fadeUp .4s ease" }}>

            {/* Top bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1c1917" }}>{webData.centralTopic}</div>
                <div style={{ fontSize: 12, color: "#a8a29e" }}>{webData.nodes.length} connected nodes · click any to explore</div>
              </div>
              {/* Filter */}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", maxWidth: "100%" }}>
                {["ALL", "CAUSE", "EFFECT", "RELATED", "CONTEXT", "PERSON", "POLICY"].map(type => {
                  const ts = type === "ALL" ? { dot: "#1c1917", bg: "#f5f4f2", text: "#1c1917", border: "#e8e6e1" } : getTypeStyle(type);
                  return (
                    <button key={type} onClick={() => setFilterType(type)}
                      style={{ fontSize: 10.5, padding: "3px 10px", borderRadius: 100, border: `1px solid ${filterType === type ? ts.dot : "#e8e6e1"}`, background: filterType === type ? ts.dot : "#fff", color: filterType === type ? "#fff" : ts.text || "#57534e", cursor: "pointer", fontWeight: 500 }}>
                      {type === "ALL" ? "All" : TYPE_STYLE[type]?.label || type}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main grid — responsive */}
            <div className="web-main-grid" style={{ alignItems: "start" }}>

              {/* Canvas */}
              <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14, overflow: "hidden" }}>
                <WebCanvas
                  webData={filteredWeb}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                />
                {/* Legend */}
                <div style={{ padding: "10px 16px", borderTop: "1px solid #f1f0ec", display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {Object.entries(TYPE_STYLE).map(([type, style]) => (
                    <div key={type} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#57534e" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot }} />
                      {style.label}
                    </div>
                  ))}
                  <div style={{ fontSize: 10.5, color: "#a8a29e", marginLeft: "auto" }}>Node size = connection strength</div>
                </div>
              </div>

              {/* Side panel — full width on mobile */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <NodeDetail
                  node={selectedNodeData}
                  webData={webData}
                  isCenter={isCenter}
                />

                {/* Insight card */}
                {webData.insight && (
                  <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1rem 1.1rem" }}>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>💡 Hidden insight</div>
                    <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>{webData.insight}</div>
                  </div>
                )}

                {/* Key domino */}
                {webData.keyDomino && (
                  <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 12, padding: "1rem 1.1rem" }}>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#92400e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>🎯 Key domino</div>
                    <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>{webData.keyDomino}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Node list below */}
            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1c1917", marginBottom: "0.75rem" }}>All connected nodes</div>
              <div className="web-node-grid">
                {filteredWeb.nodes.map(node => {
                  const ts = getTypeStyle(node.type);
                  return (
                    <div key={node.id}
                      onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                      style={{ background: selectedNode === node.id ? "#1c1917" : "#fff", border: `1px solid ${selectedNode === node.id ? "#1c1917" : ts.border}`, borderRadius: 10, padding: "10px 13px", cursor: "pointer", transition: "all .15s" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: ts.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: selectedNode === node.id ? "rgba(255,255,255,.6)" : ts.text, textTransform: "uppercase", letterSpacing: ".04em" }}>{ts.label}</span>
                        <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: selectedNode === node.id ? "rgba(255,255,255,.4)" : "#a8a29e", marginLeft: "auto" }}>{node.strength}/10</span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: selectedNode === node.id ? "#fff" : "#1c1917", lineHeight: 1.35 }}>{node.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* Empty state */}
        {!webData && !loading && !error && (
          <div style={{ textAlign: "center", padding: "4rem 2rem", background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14 }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🕸️</div>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.5rem", color: "#1c1917", marginBottom: 10 }}>Enter a topic to build its web</div>
            <div style={{ fontSize: 13.5, color: "#a8a29e", lineHeight: 1.8, maxWidth: 400, margin: "0 auto 20px" }}>
              Every story has causes before it, effects after it, people driving it, and policies shaping it. The Story Web shows them all at once.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", fontSize: 12.5, color: "#57534e" }}>
              {["🔴 Causes", "🟢 Effects", "🔵 Related", "🟡 Context", "🟣 People", "🩵 Policies"].map(f => (
                <span key={f} style={{ padding: "5px 12px", borderRadius: 100, background: "#f5f4f2", border: "1px solid #e8e6e1" }}>{f}</span>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}