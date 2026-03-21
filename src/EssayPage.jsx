import { useState, useRef } from "react";
 
const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;
 
// ── SAMPLE TOPICS ─────────────────────────────────────────
const SAMPLE_TOPICS = [
  "Climate change and India's development dilemma",
  "Artificial intelligence — threat or opportunity for India",
  "Women empowerment — beyond tokenism",
  "India's neighbourhood first policy",
  "Corruption — a hydra-headed monster",
  "Education system in India — challenges and reforms",
  "Urbanisation — challenges and opportunities",
  "Media and democracy — frenemies forever",
];
 
// ── ESSAY PROMPT ──────────────────────────────────────────
const ESSAY_PROMPT = `You are an expert UPSC Mains essay coach with 20 years of experience. Generate a complete, exam-ready essay outline for IAS Mains (GS Essay Paper) on the given topic.
 
Produce this EXACT structure — no deviations:
 
ESSAY_TITLE: [Refined essay title — may differ slightly from topic for better framing]
 
UPSC_RELEVANCE: [Which GS papers this connects to — e.g. GS1, GS2, GS3, GS4 with specific syllabus points]
 
WORD_TARGET: [Suggested word count — 1000/1200/1500 words]
 
APPROACH: [Balanced/Critical/Descriptive/Analytical — which approach works best and why in one sentence]
 
---SECTION 1: HOOK & INTRODUCTION---
HEADING: [Section heading]
WORD_COUNT: [Suggested words for this section]
QUOTE: [One powerful opening quote — real quote with attribution, relevant to topic]
KEY_POINTS:
- [Point 1 — specific, not generic]
- [Point 2]
- [Point 3]
SAMPLE_LINE: [One model opening sentence to start the essay]
 
---SECTION 2: HISTORICAL & CONTEXTUAL BACKGROUND---
HEADING: [Section heading]
WORD_COUNT: [Suggested words]
KEY_POINTS:
- [Historical fact or context point 1]
- [Historical fact or context point 2]
- [Historical fact or context point 3]
- [Historical fact or context point 4]
DATA_POINTS:
- [Statistic or data point 1 with source]
- [Statistic or data point 2 with source]
SAMPLE_LINE: [One model sentence for this section]
 
---SECTION 3: CURRENT STATE & CHALLENGES---
HEADING: [Section heading]
WORD_COUNT: [Suggested words]
KEY_POINTS:
- [Current challenge or issue 1]
- [Current challenge or issue 2]
- [Current challenge or issue 3]
- [Current challenge or issue 4]
DATA_POINTS:
- [Recent data point 1]
- [Recent data point 2]
CASE_STUDY: [One relevant case study or example — Indian or international]
SAMPLE_LINE: [One model sentence]
 
---SECTION 4: WAY FORWARD & SOLUTIONS---
HEADING: [Section heading]
WORD_COUNT: [Suggested words]
KEY_POINTS:
- [Solution or recommendation 1]
- [Solution or recommendation 2]
- [Solution or recommendation 3]
- [Solution or recommendation 4]
INTERNATIONAL_EXAMPLE: [One international best practice example]
GOVERNMENT_INITIATIVE: [One relevant government scheme or policy]
SAMPLE_LINE: [One model sentence]
 
---SECTION 5: CONCLUSION---
HEADING: [Section heading]
WORD_COUNT: [Suggested words]
KEY_POINTS:
- [Concluding point 1 — balanced view]
- [Concluding point 2 — future outlook]
CLOSING_QUOTE: [One powerful closing quote with attribution]
SAMPLE_LINE: [One model closing sentence]
 
KEYWORDS: [10 important keywords/phrases to include in the essay for scoring well]
AVOID: [3 common mistakes aspirants make on this topic]
EXAMINER_TIP: [One specific tip on what examiners look for on this topic]
 
Rules:
- All data points must be real and accurate
- Quotes must be genuine with correct attribution
- Content must be India-centric where relevant
- Language must be sophisticated but clear
- Follow UPSC essay paper expectations strictly`;
 
// ── PARSER ────────────────────────────────────────────────
function parseOutline(text) {
  const get = (key) => {
    const re = new RegExp(`${key}:\\s*(.+)`);
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
 
  const getList = (key) => {
    const idx = text.indexOf(key + ":");
    if (idx === -1) return [];
    const after = text.slice(idx + key.length + 1);
    const end = after.search(/\n[A-Z_]+:/);
    const block = end === -1 ? after : after.slice(0, end);
    return block.split("\n")
      .map(l => l.replace(/^[-•*]\s*/, "").trim())
      .filter(l => l.length > 5 && !l.includes(":"));
  };
 
  const parseSection = (num) => {
    const startTag = `---SECTION ${num}:`;
    const endTag = num < 5 ? `---SECTION ${num + 1}:` : "KEYWORDS:";
    const si = text.indexOf(startTag);
    if (si === -1) return null;
    const ei = text.indexOf(endTag);
    const block = ei === -1 ? text.slice(si) : text.slice(si, ei);
 
    const getIn = (key) => {
      const re = new RegExp(`${key}:\\s*(.+)`);
      const m = block.match(re);
      return m ? m[1].trim() : "";
    };
 
    const getListIn = (key) => {
      const idx = block.indexOf(key + ":");
      if (idx === -1) return [];
      const after = block.slice(idx + key.length + 1);
      const end = after.search(/\n[A-Z_]+:/);
      const chunk = end === -1 ? after : after.slice(0, end);
      return chunk.split("\n")
        .map(l => l.replace(/^[-•*]\s*/, "").trim())
        .filter(l => l.length > 5);
    };
 
    const titleMatch = startTag && block.match(/---SECTION \d+:\s*([^-\n]+)/);
 
    return {
      title: titleMatch ? titleMatch[1].trim() : `Section ${num}`,
      heading: getIn("HEADING"),
      wordCount: getIn("WORD_COUNT"),
      quote: getIn("QUOTE"),
      closingQuote: getIn("CLOSING_QUOTE"),
      keyPoints: getListIn("KEY_POINTS"),
      dataPoints: getListIn("DATA_POINTS"),
      caseStudy: getIn("CASE_STUDY"),
      intlExample: getIn("INTERNATIONAL_EXAMPLE"),
      govtInit: getIn("GOVERNMENT_INITIATIVE"),
      sampleLine: getIn("SAMPLE_LINE"),
    };
  };
 
  return {
    title: get("ESSAY_TITLE"),
    relevance: get("UPSC_RELEVANCE"),
    wordTarget: get("WORD_TARGET"),
    approach: get("APPROACH"),
    sections: [1, 2, 3, 4, 5].map(parseSection).filter(Boolean),
    keywords: getList("KEYWORDS"),
    avoid: getList("AVOID"),
    examinerTip: get("EXAMINER_TIP"),
  };
}
 
// ── SECTION COLORS ────────────────────────────────────────
const SECTION_STYLES = [
  { bg: "#1c1917", text: "#fff", accent: "#60a5fa", label: "01" },
  { bg: "#1e3a5f", text: "#fff", accent: "#93c5fd", label: "02" },
  { bg: "#1a3a2a", text: "#fff", accent: "#86efac", label: "03" },
  { bg: "#3b1f0a", text: "#fff", accent: "#fcd34d", label: "04" },
  { bg: "#2d1b69", text: "#fff", accent: "#c4b5fd", label: "05" },
];
 
// ── COPY BUTTON ───────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, border: "1px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.1)", color: "rgba(255,255,255,.8)", cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all .15s" }}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
 
// ── SECTION CARD ──────────────────────────────────────────
function SectionCard({ section, index, isOpen, onToggle }) {
  const style = SECTION_STYLES[index] || SECTION_STYLES[0];
 
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 10, boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
      {/* Header */}
      <div
        onClick={onToggle}
        style={{ background: style.bg, color: style.text, padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, color: style.accent, flexShrink: 0 }}>
            {style.label}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{section.heading || section.title}</div>
            <div style={{ fontSize: 11, color: style.accent, fontFamily: "'JetBrains Mono',monospace" }}>{section.wordCount} words</div>
          </div>
        </div>
        <div style={{ fontSize: 18, color: "rgba(255,255,255,.5)", transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "none" }}>⌄</div>
      </div>
 
      {/* Body */}
      {isOpen && (
        <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderTop: "none", padding: "16px 18px" }}>
 
          {/* Quote */}
          {(section.quote || section.closingQuote) && (
            <div style={{ background: "#f8f7f5", borderLeft: "3px solid #1d4ed8", borderRadius: "0 8px 8px 0", padding: "10px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Opening quote</div>
              <div style={{ fontSize: 13, color: "#1c1917", fontStyle: "italic", lineHeight: 1.65 }}>"{section.quote || section.closingQuote}"</div>
            </div>
          )}
 
          {/* Key Points */}
          {section.keyPoints?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Key points to cover</div>
              {section.keyPoints.map((pt, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, background: "#eff6ff", color: "#1d4ed8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{pt}</div>
                </div>
              ))}
            </div>
          )}
 
          {/* Data Points */}
          {section.dataPoints?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Data & statistics</div>
              {section.dataPoints.map((pt, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 5 }}>
                  <span style={{ color: "#1d4ed8", fontSize: 13, flexShrink: 0, marginTop: 2 }}>📊</span>
                  <div style={{ fontSize: 12.5, color: "#374151", lineHeight: 1.6, fontFamily: "'JetBrains Mono',monospace" }}>{pt}</div>
                </div>
              ))}
            </div>
          )}
 
          {/* Case Study */}
          {section.caseStudy && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#15803d", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Case study</div>
              <div style={{ fontSize: 12.5, color: "#166534", lineHeight: 1.6 }}>{section.caseStudy}</div>
            </div>
          )}
 
          {/* International Example */}
          {section.intlExample && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>International example</div>
              <div style={{ fontSize: 12.5, color: "#1e40af", lineHeight: 1.6 }}>{section.intlExample}</div>
            </div>
          )}
 
          {/* Govt Initiative */}
          {section.govtInit && (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 13px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#92400e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Government initiative</div>
              <div style={{ fontSize: 12.5, color: "#78350f", lineHeight: 1.6 }}>{section.govtInit}</div>
            </div>
          )}
 
          {/* Sample Line */}
          {section.sampleLine && (
            <div style={{ background: "#1c1917", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#60a5fa", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Model sentence</div>
                <div style={{ fontSize: 13, color: "#e5e7eb", lineHeight: 1.65, fontStyle: "italic" }}>{section.sampleLine}</div>
              </div>
              <CopyBtn text={section.sampleLine} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
 
// ── MAIN PAGE ─────────────────────────────────────────────
export default function EssayPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [outline, setOutline] = useState(null);
  const [error, setError] = useState("");
  const [openSections, setOpenSections] = useState([0, 1, 2, 3, 4]);
  const [statusMsg, setStatusMsg] = useState("");
  const statusRef = useRef(null);
 
  const STATUS_MSGS = [
    "Analysing topic for UPSC relevance...",
    "Mapping to GS syllabus...",
    "Generating section-wise outline...",
    "Adding data points, quotes and examples...",
    "Finalising your essay outline...",
  ];
 
  async function generate(t) {
    const q = t || topic;
    if (!q.trim()) return;
    setLoading(true); setOutline(null); setError("");
    let mi = 0;
    setStatusMsg(STATUS_MSGS[0]);
    statusRef.current = setInterval(() => { if (++mi < STATUS_MSGS.length) setStatusMsg(STATUS_MSGS[mi]); }, 2000);
 
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: 4000,
          temperature: 0.4,
          messages: [
            { role: "system", content: ESSAY_PROMPT },
            { role: "user", content: `Generate a complete IAS Mains essay outline for: "${q}"` },
          ],
        }),
      });
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      if (!res.ok) throw new Error("API error " + res.status);
      const data = await res.json();
      const text = data.choices[0].message.content;
      setOutline(parseOutline(text));
      setOpenSections([0]);
    } catch (e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setError(e.message);
    }
  }
 
  function toggleSection(i) {
    setOpenSections(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  }
 
  function copyFullOutline() {
    if (!outline) return;
    const text = [
      `ESSAY: ${outline.title}`,
      `UPSC: ${outline.relevance}`,
      `Words: ${outline.wordTarget} | Approach: ${outline.approach}`,
      "",
      ...outline.sections.map((s, i) => [
        `--- SECTION ${i + 1}: ${s.heading} (${s.wordCount}) ---`,
        s.quote ? `Quote: "${s.quote}"` : "",
        "Key Points:", ...s.keyPoints.map(p => `• ${p}`),
        s.dataPoints?.length ? ["Data:", ...s.dataPoints.map(p => `📊 ${p}`)].join("\n") : "",
        s.caseStudy ? `Case Study: ${s.caseStudy}` : "",
        s.sampleLine ? `Model Line: ${s.sampleLine}` : "",
      ].filter(Boolean).join("\n")),
      "",
      `Keywords: ${outline.keywords?.join(", ")}`,
      `Avoid: ${outline.avoid?.join(" | ")}`,
      `Examiner Tip: ${outline.examinerTip}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
  }
 
  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "#fafaf9", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)} }
        @keyframes prog { 0%{transform:translateX(-100%)}100%{transform:translateX(200%)} }
      `}</style>
 
      {/* ── HEADER ── */}
      <div style={{ background: "#1c1917", color: "#fff", padding: "2rem 2rem 1.75rem" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".12em", textTransform: "uppercase", color: "#a8a29e" }}>IAS Mains</span>
            <span style={{ fontSize: 10, color: "#a8a29e" }}>·</span>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".12em", textTransform: "uppercase", color: "#60a5fa" }}>Essay Paper</span>
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(1.75rem,4vw,2.5rem)", lineHeight: 1.1, letterSpacing: "-.025em", marginBottom: 8 }}>
            Essay Outline <em style={{ fontStyle: "italic", color: "#60a5fa" }}>Generator</em>
          </h1>
          <p style={{ fontSize: 13, color: "#a8a29e", fontWeight: 300, lineHeight: 1.65, maxWidth: 580 }}>
            Type any essay topic → get a complete 5-section outline with quotes, data points, case studies, model sentences and examiner tips.
          </p>
 
          {/* Search bar */}
          <div style={{ marginTop: "1.5rem", display: "flex", gap: 0, maxWidth: 680, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, overflow: "hidden" }}>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && generate()}
              placeholder="e.g. Artificial intelligence — boon or bane for India"
              style={{ flex: 1, padding: ".85rem 1.1rem", background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: "'Inter',sans-serif" }}
            />
            <button onClick={() => generate()} disabled={loading}
              style={{ padding: ".85rem 1.5rem", background: loading ? "#374151" : "#1d4ed8", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", whiteSpace: "nowrap", fontFamily: "'Inter',sans-serif", transition: "background .15s" }}>
              {loading ? "Generating..." : "Generate →"}
            </button>
          </div>
 
          {/* Sample topics */}
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SAMPLE_TOPICS.slice(0, 4).map(t => (
              <button key={t} onClick={() => { setTopic(t); generate(t); }}
                style={{ fontSize: 11, padding: "4px 11px", borderRadius: 100, border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.06)", color: "#a8a29e", cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all .15s" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
 
      {/* Progress bar */}
      {loading && (
        <div style={{ height: 3, background: "#e8e6e1", overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "#1d4ed8", animation: "prog 1.2s ease-in-out infinite", transformOrigin: "left" }} />
        </div>
      )}
 
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1.5rem 4rem" }}>
 
        {/* Status */}
        {loading && statusMsg && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 13, color: "#1d4ed8", marginBottom: "1.5rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1d4ed8", animation: "pulse 1.4s infinite", flexShrink: 0 }} />
            {statusMsg}
          </div>
        )}
 
        {/* Error */}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "1rem 1.4rem", fontSize: 13, color: "#b91c1c", marginBottom: "1.5rem" }}>
            <strong>Error:</strong> {error}
          </div>
        )}
 
        {/* Outline */}
        {outline && (
          <div style={{ animation: "fadeUp .4s ease" }}>
 
            {/* Meta header */}
            <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 5 }}>Essay topic</div>
                  <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.4rem", lineHeight: 1.2, color: "#1c1917", letterSpacing: "-.01em" }}>{outline.title}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={copyFullOutline}
                    style={{ padding: "7px 14px", background: "#f5f4f2", color: "#1c1917", border: "1px solid #e8e6e1", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                    📋 Copy outline
                  </button>
                  <button onClick={() => window.print()}
                    style={{ padding: "7px 14px", background: "#1c1917", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
                    🖨️ Print / PDF
                  </button>
                </div>
              </div>
 
              {/* Meta pills */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 12px" }}>
                  <div style={{ fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>UPSC Relevance</div>
                  <div style={{ fontSize: 12, color: "#1e40af", fontWeight: 500 }}>{outline.relevance}</div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 12px" }}>
                  <div style={{ fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", color: "#15803d", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>Word Target</div>
                  <div style={{ fontSize: 12, color: "#166534", fontWeight: 500 }}>{outline.wordTarget}</div>
                </div>
                <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 12px" }}>
                  <div style={{ fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", color: "#92400e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>Approach</div>
                  <div style={{ fontSize: 12, color: "#78350f", fontWeight: 500 }}>{outline.approach}</div>
                </div>
              </div>
            </div>
 
            {/* Expand/collapse all */}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button onClick={() => setOpenSections([0,1,2,3,4])}
                style={{ fontSize: 12, padding: "5px 12px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#fff", color: "#57534e", cursor: "pointer" }}>
                Expand all
              </button>
              <button onClick={() => setOpenSections([])}
                style={{ fontSize: 12, padding: "5px 12px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#fff", color: "#57534e", cursor: "pointer" }}>
                Collapse all
              </button>
            </div>
 
            {/* Sections */}
            {outline.sections.map((section, i) => (
              <SectionCard key={i} section={section} index={i} isOpen={openSections.includes(i)} onToggle={() => toggleSection(i)} />
            ))}
 
            {/* Keywords */}
            {outline.keywords?.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1.25rem 1.5rem", marginTop: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>Must-use keywords</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {outline.keywords.map((k, i) => (
                    <span key={i} style={{ fontSize: 12, padding: "4px 11px", borderRadius: 100, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontWeight: 500 }}>{k}</span>
                  ))}
                </div>
              </div>
            )}
 
            {/* Avoid + Examiner Tip */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              {outline.avoid?.length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "1.1rem 1.25rem" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Common mistakes — avoid these</div>
                  {outline.avoid.map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 7, marginBottom: 5, fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.55 }}>
                      <span style={{ flexShrink: 0 }}>⚠️</span>{a}
                    </div>
                  ))}
                </div>
              )}
              {outline.examinerTip && (
                <div style={{ background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", borderRadius: 12, padding: "1.1rem 1.25rem", color: "#fff" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#93c5fd", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Examiner tip</div>
                  <div style={{ fontSize: 13, lineHeight: 1.65, fontWeight: 300 }}>💡 {outline.examinerTip}</div>
                </div>
              )}
            </div>
 
          </div>
        )}
 
        {/* Empty state */}
        {!outline && !loading && !error && (
          <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✍️</div>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.5rem", color: "#1c1917", marginBottom: 8 }}>Ready to write your essay?</div>
            <div style={{ fontSize: 14, color: "#a8a29e", marginBottom: 24 }}>Type any topic above or pick from these popular essay topics:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 600, margin: "0 auto" }}>
              {SAMPLE_TOPICS.map(t => (
                <button key={t} onClick={() => { setTopic(t); generate(t); }}
                  style={{ fontSize: 12.5, padding: "8px 16px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#fff", color: "#57534e", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
 
      </div>
    </div>
  );
}