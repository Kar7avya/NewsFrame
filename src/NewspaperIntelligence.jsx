import { useState, useRef, useCallback } from "react";

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;

// ── GROQ HELPER WITH RETRY ────────────────────────────────
async function groqCall(messages, maxTokens = 3000, temp = 0.4) {
  const delays = [3000, 6000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: maxTokens, temperature: temp, messages }),
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

// ═══════════════════════════════════════════════════════════
// FEATURE 1 — STORY EVOLUTION TIMELINE
// ═══════════════════════════════════════════════════════════

const TIMELINE_PROMPT = `You are a media analyst tracking how a news story evolves across newspapers over time.

For the topic provided, generate a Story Evolution Timeline showing how different newspapers covered it across different time phases.

Use EXACTLY this format:

TOPIC_TITLE: [Clean topic name]
STORY_SUMMARY: [2 sentences — what this story is fundamentally about]
STORY_STATUS: [Ongoing/Concluded/Developing]
PEAK_MOMENT: [The single most important turning point in this story]

===PHASE_START===
PHASE_NUM: 1
PHASE_LABEL: [e.g. "Initial Breaking" / "Government Response" / "International Reaction"]
PHASE_TIMEFRAME: [e.g. "Early 2024" / "March 2025" / "Last month"]
PHASE_SENTIMENT: [Positive/Negative/Neutral/Mixed]
PHASE_INTENSITY: [1-10 — how much coverage this phase got]
WHAT_CHANGED: [1-2 sentences — what new development happened in this phase]
TOI_ANGLE: [How Times of India covered it — specific angle, not generic]
HINDU_ANGLE: [How The Hindu covered it]
BBC_ANGLE: [How BBC covered it]
ALJAZEERA_ANGLE: [How Al Jazeera covered it]
KEY_FACT: [The most important fact or data point from this phase]
SENTIMENT_SHIFT: [Did sentiment change from previous phase? How?]
===PHASE_END===

[Repeat for 5-6 phases total]

OVERALL_ARC: [How did the story change from start to current? 2 sentences]
MISSING_ANGLE: [What important angle did most newspapers miss?]
FUTURE_WATCH: [What should readers watch for next?]

RULES:
- All phases must be real — based on actual news developments
- Each newspaper angle must be genuinely different
- Phases must be in chronological order
- Intensity scores must vary (not all 8/10)`;

function parseTimeline(text) {
  const get = key => {
    const m = text.match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : "";
  };

  const phases = text.split("===PHASE_START===").slice(1).map(block => {
    const b = block.split("===PHASE_END===")[0];
    const g = key => {
      const m = b.match(new RegExp(`${key}:\\s*(.+)`));
      return m ? m[1].trim() : "";
    };
    const getBlock = key => {
      const idx = b.indexOf(key + ":");
      if (idx === -1) return "";
      const after = b.slice(idx + key.length + 1);
      const end = after.search(/\n[A-Z_]+:/);
      return (end === -1 ? after : after.slice(0, end)).trim();
    };
    return {
      num: parseInt(g("PHASE_NUM")) || 0,
      label: g("PHASE_LABEL"),
      timeframe: g("PHASE_TIMEFRAME"),
      sentiment: g("PHASE_SENTIMENT"),
      intensity: Math.min(10, Math.max(1, parseInt(g("PHASE_INTENSITY")) || 5)),
      whatChanged: getBlock("WHAT_CHANGED"),
      toiAngle: g("TOI_ANGLE"),
      hinduAngle: g("HINDU_ANGLE"),
      bbcAngle: g("BBC_ANGLE"),
      alJazeeraAngle: g("ALJAZEERA_ANGLE"),
      keyFact: g("KEY_FACT"),
      sentimentShift: g("SENTIMENT_SHIFT"),
    };
  }).filter(p => p.label);

  return {
    title: get("TOPIC_TITLE"),
    summary: get("STORY_SUMMARY"),
    status: get("STORY_STATUS"),
    peakMoment: get("PEAK_MOMENT"),
    phases,
    overallArc: get("OVERALL_ARC"),
    missingAngle: get("MISSING_ANGLE"),
    futureWatch: get("FUTURE_WATCH"),
  };
}

const SENTIMENT_COLORS = {
  positive: { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0", dot: "#22c55e" },
  negative: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca", dot: "#ef4444" },
  neutral:  { bg: "#f5f4f2", text: "#57534e", border: "#e8e6e1", dot: "#a8a29e" },
  mixed:    { bg: "#fefce8", text: "#92400e", border: "#fde68a", dot: "#eab308" },
};

function getSentColor(s) {
  return SENTIMENT_COLORS[(s||"neutral").toLowerCase()] || SENTIMENT_COLORS.neutral;
}

function PhaseCard({ phase, index, isActive, onClick, isLast }) {
  const sc = getSentColor(phase.sentiment);
  const barH = Math.round((phase.intensity / 10) * 80);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, position: "relative" }}>
      {/* Connecting line */}
      {!isLast && (
        <div style={{ position: "absolute", top: 40, left: "50%", width: 2, height: "calc(100% + 16px)", background: "#e8e6e1", zIndex: 0, transform: "translateX(-50%)" }} />
      )}

      {/* Timeline node */}
      <div onClick={onClick} style={{ position: "relative", zIndex: 1, width: "100%", cursor: "pointer" }}>
        <div style={{
          background: isActive ? "#1c1917" : "#fff",
          border: `2px solid ${isActive ? "#1c1917" : "#e8e6e1"}`,
          borderRadius: 14, padding: "14px 16px",
          transition: "all .2s",
          boxShadow: isActive ? "0 4px 20px rgba(0,0,0,.15)" : "0 1px 4px rgba(0,0,0,.04)",
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {/* Intensity bar */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
              <div style={{ width: 28, height: 80, background: "#f1f0ec", borderRadius: 4, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                <div style={{ width: "100%", height: barH, background: isActive ? "#60a5fa" : "#1d4ed8", borderRadius: 4, transition: "height .4s ease" }} />
              </div>
              <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", color: isActive ? "#a8a29e" : "#a8a29e" }}>{phase.intensity}/10</div>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: isActive ? "#374151" : "#1c1917", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{phase.num}</div>
                <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: isActive ? "#9ca3af" : "#a8a29e" }}>{phase.timeframe}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 100, background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>{phase.sentiment}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: isActive ? "#fff" : "#1c1917", lineHeight: 1.3, marginBottom: 4 }}>{phase.label}</div>
              <div style={{ fontSize: 12.5, color: isActive ? "#d1d5db" : "#57534e", lineHeight: 1.6 }}>{phase.whatChanged}</div>
              {phase.keyFact && (
                <div style={{ marginTop: 7, fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", color: isActive ? "#60a5fa" : "#1d4ed8", background: isActive ? "rgba(96,165,250,.1)" : "#eff6ff", padding: "4px 9px", borderRadius: 6, display: "inline-block" }}>
                  📊 {phase.keyFact}
                </div>
              )}
            </div>
          </div>

          {/* Source angles — shown when active */}
          {isActive && (
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { name: "Times of India", angle: phase.toiAngle, color: "#dc2626" },
                { name: "The Hindu", angle: phase.hinduAngle, color: "#2563eb" },
                { name: "BBC", angle: phase.bbcAngle, color: "#b91c1c" },
                { name: "Al Jazeera", angle: phase.alJazeeraAngle, color: "#92400e" },
              ].filter(s => s.angle).map((s, i) => (
                <div key={i} style={{ background: "rgba(255,255,255,.07)", borderRadius: 8, padding: "9px 11px", border: "1px solid rgba(255,255,255,.1)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", marginBottom: 4, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", letterSpacing: ".04em" }}>{s.name}</div>
                  <div style={{ fontSize: 12.5, color: "#e5e7eb", lineHeight: 1.55 }}>{s.angle}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineView({ topic }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activePhase, setActivePhase] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const statusRef = useRef(null);

  const generate = useCallback(async () => {
    setLoading(true); setData(null); setError("");
    const msgs = ["Mapping the story's history...", "Analysing each newspaper's angle...", "Building the evolution timeline...", "Adding sentiment analysis..."];
    let mi = 0; setStatusMsg(msgs[0]);
    statusRef.current = setInterval(() => { if (++mi < msgs.length) setStatusMsg(msgs[mi]); }, 2500);
    try {
      const text = await groqCall([
        { role: "system", content: TIMELINE_PROMPT },
        { role: "user", content: `Generate the complete Story Evolution Timeline for: "${topic}"` },
      ], 3500, 0.4);
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setData(parseTimeline(text)); setActivePhase(0);
    } catch (e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setError(e.message);
    }
  }, [topic]);

  const intensityData = data?.phases.map(p => p.intensity) || [];
  const maxIntensity = Math.max(...intensityData, 1);

  return (
    <div>
      {!data && !loading && (
        <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
          <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.4rem", color: "#1c1917", marginBottom: 8 }}>How did this story evolve?</div>
          <div style={{ fontSize: 13.5, color: "#a8a29e", marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>See how different newspapers covered this story at different points in time — and how coverage changed</div>
          <button onClick={generate} style={{ padding: "11px 28px", background: "#1c1917", color: "#fff", border: "none", borderRadius: 100, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            📅 Build Timeline →
          </button>
        </div>
      )}

      {loading && (
        <div style={{ padding: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 13, color: "#1d4ed8", marginBottom: "1rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1d4ed8", animation: "pulse 1.4s infinite", flexShrink: 0 }} />
            {statusMsg}
          </div>
          {Array(4).fill(0).map((_, i) => (
            <div key={i} style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14, padding: 18, marginBottom: 12, animation: "shimmer 1.5s infinite" }}>
              <div style={{ height: 14, background: "#f1f0ec", borderRadius: 6, width: "30%", marginBottom: 10 }} />
              <div style={{ height: 18, background: "#f1f0ec", borderRadius: 6, width: "70%", marginBottom: 8 }} />
              <div style={{ height: 14, background: "#f1f0ec", borderRadius: 6, width: "90%" }} />
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "1rem", fontSize: 13, color: "#b91c1c", margin: "1rem" }}>{error} <button onClick={generate} style={{ marginLeft: 10, fontSize: 12, padding: "2px 10px", borderRadius: 100, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", cursor: "pointer" }}>Retry</button></div>}

      {data && (
        <div style={{ padding: "0 0 2rem" }}>
          {/* Story header */}
          <div style={{ background: "#1c1917", color: "#fff", borderRadius: 14, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".08em", textTransform: "uppercase", color: "#60a5fa" }}>Story Evolution</span>
              <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 100, background: data.status === "Ongoing" ? "#ef4444" : "#22c55e", color: "#fff", fontWeight: 700 }}>{data.status}</span>
            </div>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.4rem", lineHeight: 1.2, marginBottom: 8 }}>{data.title}</div>
            <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.7, marginBottom: 10 }}>{data.summary}</div>
            {data.peakMoment && (
              <div style={{ background: "rgba(255,255,255,.07)", borderRadius: 8, padding: "9px 13px", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>⚡</span>
                <div>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#60a5fa", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 3 }}>Peak moment</div>
                  <div style={{ fontSize: 13, color: "#e5e7eb", lineHeight: 1.6 }}>{data.peakMoment}</div>
                </div>
              </div>
            )}
          </div>

          {/* Coverage intensity chart */}
          <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>Coverage intensity across phases</div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 60 }}>
              {data.phases.map((p, i) => {
                const sc = getSentColor(p.sentiment);
                return (
                  <div key={i} onClick={() => setActivePhase(i)} style={{ flex: 1, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <div style={{ width: "100%", height: Math.round((p.intensity / maxIntensity) * 50) + 4, background: activePhase === i ? "#1c1917" : sc.dot, borderRadius: "4px 4px 0 0", transition: "all .2s", minHeight: 4 }} />
                    <div style={{ fontSize: 9, color: "#a8a29e", fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>{p.num}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
              {Object.entries(SENTIMENT_COLORS).map(([key, val]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "#57534e" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: val.dot }} />
                  {key}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline phases */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.phases.map((phase, i) => (
              <PhaseCard key={i} phase={phase} index={i} isActive={activePhase === i} onClick={() => setActivePhase(activePhase === i ? -1 : i)} isLast={i === data.phases.length - 1} />
            ))}
          </div>

          {/* Bottom insights */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: "1.25rem" }}>
            {data.overallArc && (
              <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Overall arc</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>{data.overallArc}</div>
              </div>
            )}
            {data.missingAngle && (
              <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#92400e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>⚠️ What media missed</div>
                <div style={{ fontSize: 13, color: "#78350f", lineHeight: 1.7 }}>{data.missingAngle}</div>
              </div>
            )}
          </div>
          {data.futureWatch && (
            <div style={{ marginTop: 10, background: "linear-gradient(135deg,#1e3a8a,#1d4ed8)", color: "#fff", borderRadius: 10, padding: "12px 14px", display: "flex", gap: 10 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>👁️</span>
              <div>
                <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#93c5fd", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Watch next</div>
                <div style={{ fontSize: 13, lineHeight: 1.65, fontWeight: 300 }}>{data.futureWatch}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FEATURE 2 — DEBATE ARENA
// ═══════════════════════════════════════════════════════════

const DEBATE_PROMPT = `You are a master debate coach and media analyst. Generate a structured, sourced DEBATE on the given topic using real newspaper perspectives.

Use EXACTLY this format:

DEBATE_TOPIC: [The motion/statement being debated — make it specific and debatable]
DEBATE_CONTEXT: [2 sentences — why this is being debated right now]
STAKES: [What is at stake in this debate — who wins/loses]

PRO_TITLE: [Name for the Pro side — e.g. "The Development Argument"]
CON_TITLE: [Name for the Con side — e.g. "The Rights Argument"]

===ARG_START===
SIDE: PRO
ARG_NUM: 1
ARG_TITLE: [Short punchy title for this argument]
ARG_STRENGTH: [1-10]
SOURCE: [Which newspaper holds this view — TOI/Hindu/ET/IndiaToday/BBC/CNN/NYT/AlJazeera]
SOURCE_STANCE: [One sentence — what exactly this newspaper argued]
ARGUMENT: [3-4 sentences making this argument with specific facts, data, examples]
EVIDENCE: [Specific data point or example supporting this argument]
COUNTER_WEAK: [The weakest point of this argument — be honest]
===ARG_END===

[Generate 4 PRO arguments and 4 CON arguments — 8 total, alternating PRO/CON]

VERDICT_POSSIBLE: [Yes/No — can a clear winner be determined?]
MIDDLE_GROUND: [2 sentences — where do both sides actually agree?]
UPSC_ANGLE: [How would UPSC examiners want this debated in an essay?]
GD_OPENER: [Best opening line for a GD on this topic]
GD_CLOSER: [Best closing line that shows balance]

RULES:
- Each argument must have REAL data or examples
- Source attribution must be plausible — assign arguments to newspapers that genuinely hold those views
- Arguments must be genuinely different — no repetition
- PRO and CON must be equally strong`;

function parseDebate(text) {
  const get = key => { const m = text.match(new RegExp(`${key}:\\s*(.+)`)); return m ? m[1].trim() : ""; };

  const args = text.split("===ARG_START===").slice(1).map(block => {
    const b = block.split("===ARG_END===")[0];
    const g = key => { const m = b.match(new RegExp(`${key}:\\s*(.+)`)); return m ? m[1].trim() : ""; };
    const getBlock = key => {
      const idx = b.indexOf(key + ":"); if (idx === -1) return "";
      const after = b.slice(idx + key.length + 1);
      const end = after.search(/\n[A-Z_]+:/);
      return (end === -1 ? after : after.slice(0, end)).trim();
    };
    return {
      side: g("SIDE"),
      num: parseInt(g("ARG_NUM")) || 0,
      title: g("ARG_TITLE"),
      strength: Math.min(10, Math.max(1, parseInt(g("ARG_STRENGTH")) || 7)),
      source: g("SOURCE"),
      sourceStance: g("SOURCE_STANCE"),
      argument: getBlock("ARGUMENT"),
      evidence: g("EVIDENCE"),
      counterWeak: g("COUNTER_WEAK"),
    };
  }).filter(a => a.title);

  return {
    topic: get("DEBATE_TOPIC"), context: get("DEBATE_CONTEXT"),
    stakes: get("STAKES"), proTitle: get("PRO_TITLE"), conTitle: get("CON_TITLE"),
    args,
    pro: args.filter(a => a.side === "PRO"),
    con: args.filter(a => a.side === "CON"),
    verdictPossible: get("VERDICT_POSSIBLE"),
    middleGround: get("MIDDLE_GROUND"),
    upscAngle: get("UPSC_ANGLE"),
    gdOpener: get("GD_OPENER"),
    gdCloser: get("GD_CLOSER"),
  };
}

function ArgCard({ arg, side }) {
  const [open, setOpen] = useState(false);
  const isPro = side === "PRO";
  const strengthPct = (arg.strength / 10) * 100;

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${open ? (isPro ? "#22c55e" : "#ef4444") : "#e8e6e1"}`, borderRadius: 12, overflow: "hidden", transition: "all .2s" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "13px 15px", cursor: "pointer" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 7, flexWrap: "wrap" }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: isPro ? "#f0fdf4" : "#fef2f2", color: isPro ? "#15803d" : "#b91c1c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, border: `1px solid ${isPro ? "#bbf7d0" : "#fecaca"}` }}>
            {arg.num}
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 100, background: isPro ? "#f0fdf4" : "#fef2f2", color: isPro ? "#15803d" : "#b91c1c", border: `1px solid ${isPro ? "#bbf7d0" : "#fecaca"}` }}>
            {arg.source}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#a8a29e" }}>Strength: {arg.strength}/10</span>
          <span style={{ fontSize: 16, color: "#a8a29e", transition: "transform .2s", transform: open ? "rotate(180deg)" : "none", display: "inline-block" }}>⌄</span>
        </div>

        {/* Strength bar */}
        <div style={{ height: 3, background: "#f1f0ec", borderRadius: 100, marginBottom: 9, overflow: "hidden" }}>
          <div style={{ width: `${strengthPct}%`, height: "100%", background: isPro ? "#22c55e" : "#ef4444", borderRadius: 100, transition: "width .6s ease" }} />
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: "#1c1917", lineHeight: 1.3, marginBottom: 5 }}>{arg.title}</div>
        <div style={{ fontSize: 12.5, color: "#57534e", lineHeight: 1.6, fontStyle: "italic" }}>"{arg.sourceStance}"</div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid #f1f0ec", padding: "13px 15px", background: "#fafaf9" }}>
          <div style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.8, marginBottom: 12 }}>{arg.argument}</div>
          {arg.evidence && (
            <div style={{ background: isPro ? "#f0fdf4" : "#fef2f2", border: `1px solid ${isPro ? "#bbf7d0" : "#fecaca"}`, borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 12.5, color: isPro ? "#166534" : "#7f1d1d", display: "flex", gap: 7 }}>
              <span>📊</span><span>{arg.evidence}</span>
            </div>
          )}
          {arg.counterWeak && (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#78350f", display: "flex", gap: 7 }}>
              <span>⚠️</span><div><strong style={{ fontWeight: 600 }}>Weakness:</strong> {arg.counterWeak}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DebateView({ topic }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("arena"); // arena | gd
  const [statusMsg, setStatusMsg] = useState("");
  const statusRef = useRef(null);

  const generate = useCallback(async () => {
    setLoading(true); setData(null); setError("");
    const msgs = ["Setting up the debate...", "Gathering newspaper perspectives...", "Building pro arguments...", "Building con arguments...", "Adding UPSC angles..."];
    let mi = 0; setStatusMsg(msgs[0]);
    statusRef.current = setInterval(() => { if (++mi < msgs.length) setStatusMsg(msgs[mi]); }, 2000);
    try {
      const text = await groqCall([
        { role: "system", content: DEBATE_PROMPT },
        { role: "user", content: `Generate a complete newspaper-sourced debate on: "${topic}"` },
      ], 3500, 0.5);
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setData(parseDebate(text));
    } catch (e) {
      clearInterval(statusRef.current); setLoading(false); setStatusMsg("");
      setError(e.message);
    }
  }, [topic]);

  const proScore = data ? data.pro.reduce((sum, a) => sum + a.strength, 0) : 0;
  const conScore = data ? data.con.reduce((sum, a) => sum + a.strength, 0) : 0;
  const total = proScore + conScore || 1;

  return (
    <div>
      {!data && !loading && (
        <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚔️</div>
          <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.4rem", color: "#1c1917", marginBottom: 8 }}>What do newspapers actually argue?</div>
          <div style={{ fontSize: 13.5, color: "#a8a29e", marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>See the real debate — pro and con arguments sourced from actual newspaper positions. Perfect for GD and essay prep.</div>
          <button onClick={generate} style={{ padding: "11px 28px", background: "#1c1917", color: "#fff", border: "none", borderRadius: 100, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            ⚔️ Start Debate →
          </button>
        </div>
      )}

      {loading && (
        <div style={{ padding: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, fontSize: 13, color: "#1d4ed8", marginBottom: "1rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1d4ed8", animation: "pulse 1.4s infinite", flexShrink: 0 }} />
            {statusMsg}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {Array(4).fill(0).map((_, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 12, padding: 16, animation: "shimmer 1.5s infinite" }}>
                <div style={{ height: 14, background: "#f1f0ec", borderRadius: 6, width: "40%", marginBottom: 10 }} />
                <div style={{ height: 18, background: "#f1f0ec", borderRadius: 6, width: "80%", marginBottom: 8 }} />
                <div style={{ height: 14, background: "#f1f0ec", borderRadius: 6, width: "95%" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "1rem", fontSize: 13, color: "#b91c1c", margin: "1rem" }}>{error} <button onClick={generate} style={{ marginLeft: 10, fontSize: 12, padding: "2px 10px", borderRadius: 100, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", cursor: "pointer" }}>Retry</button></div>}

      {data && (
        <div>
          {/* Debate header */}
          <div style={{ background: "#1c1917", color: "#fff", borderRadius: 14, padding: "1.25rem 1.5rem", marginBottom: "1.25rem" }}>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#60a5fa", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>The Motion</div>
            <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.3rem", lineHeight: 1.25, marginBottom: 8 }}>"{data.topic}"</div>
            <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.7, marginBottom: 12 }}>{data.context}</div>

            {/* Score bar */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#4ade80" }}>PRO {Math.round((proScore / total) * 100)}%</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#f87171" }}>CON {Math.round((conScore / total) * 100)}%</span>
              </div>
              <div style={{ height: 8, background: "rgba(255,255,255,.1)", borderRadius: 100, overflow: "hidden" }}>
                <div style={{ width: `${(proScore / total) * 100}%`, height: "100%", background: "linear-gradient(90deg,#4ade80,#22c55e)", borderRadius: 100, transition: "width .6s ease" }} />
              </div>
            </div>
            {data.stakes && <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>Stakes: {data.stakes}</div>}
          </div>

          {/* View switcher */}
          <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem" }}>
            {[{id: "arena", label: "⚔️ Debate Arena"}, {id: "gd", label: "🎤 GD Prep"}].map(v => (
              <button key={v.id} onClick={() => setView(v.id)}
                style={{ padding: "7px 16px", borderRadius: 100, border: `1px solid ${view === v.id ? "#1c1917" : "#e8e6e1"}`, background: view === v.id ? "#1c1917" : "#fff", color: view === v.id ? "#fff" : "#57534e", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Arena view */}
          {view === "arena" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>✅</span>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#15803d", textTransform: "uppercase", letterSpacing: ".06em" }}>Pro side</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#166534" }}>{data.proTitle}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.pro.map((arg, i) => <ArgCard key={i} arg={arg} side="PRO" />)}
                </div>
              </div>
              <div>
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>❌</span>
                  <div>
                    <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".06em" }}>Con side</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#7f1d1d" }}>{data.conTitle}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.con.map((arg, i) => <ArgCard key={i} arg={arg} side="CON" />)}
                </div>
              </div>
            </div>
          )}

          {/* GD prep view */}
          {view === "gd" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.gdOpener && (
                <div style={{ background: "#1c1917", color: "#fff", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#60a5fa", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>🎤 Best GD opening line</div>
                  <div style={{ fontSize: 15, fontStyle: "italic", lineHeight: 1.6 }}>"{data.gdOpener}"</div>
                </div>
              )}
              {data.upscAngle && (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>🎯 UPSC essay angle</div>
                  <div style={{ fontSize: 13.5, color: "#1e40af", lineHeight: 1.75 }}>{data.upscAngle}</div>
                </div>
              )}
              {data.middleGround && (
                <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#92400e", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>🤝 Common ground</div>
                  <div style={{ fontSize: 13.5, color: "#78350f", lineHeight: 1.75 }}>{data.middleGround}</div>
                </div>
              )}
              {data.gdCloser && (
                <div style={{ background: "#1c1917", color: "#fff", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#60a5fa", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>🎤 Best GD closing line</div>
                  <div style={{ fontSize: 15, fontStyle: "italic", lineHeight: 1.6 }}>"{data.gdCloser}"</div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {data.pro.slice(0, 3).map((arg, i) => (
                  <div key={i} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 13px" }}>
                    <div style={{ fontSize: 10, color: "#15803d", fontWeight: 700, marginBottom: 4 }}>✅ PRO: {arg.source}</div>
                    <div style={{ fontSize: 12.5, color: "#166534", lineHeight: 1.55 }}>{arg.title}</div>
                  </div>
                ))}
                {data.con.slice(0, 3).map((arg, i) => (
                  <div key={i} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 13px" }}>
                    <div style={{ fontSize: 10, color: "#b91c1c", fontWeight: 700, marginBottom: 4 }}>❌ CON: {arg.source}</div>
                    <div style={{ fontSize: 12.5, color: "#7f1d1d", lineHeight: 1.55 }}>{arg.title}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════

const SAMPLE_TOPICS = [
  "Uniform Civil Code in India",
  "India-China border dispute",
  "AI replacing jobs in India",
  "Caste reservation system",
  "India's nuclear energy expansion",
  "Social media regulation in India",
  "India-Pakistan relations 2025",
  "Climate change vs India's development",
];

export default function NewspaperIntelligence() {
  const [topic, setTopic] = useState("");
  const [activeFeature, setActiveFeature] = useState("timeline");
  const [submittedTopic, setSubmittedTopic] = useState("");

  function submit(t) {
    const q = t || topic;
    if (!q.trim()) return;
    setSubmittedTopic(q);
    setTopic(q);
  }

  return (
    <div style={{ fontFamily: "'Inter',sans-serif", background: "#fafaf9", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#1c1917", color: "#fff", padding: "2rem 2rem 1.75rem" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".1em", textTransform: "uppercase", color: "#a8a29e" }}>Newspaper Intelligence</span>
          </div>
          <h1 style={{ fontFamily: "'Instrument Serif',serif", fontSize: "clamp(1.75rem,4vw,2.5rem)", lineHeight: 1.1, letterSpacing: "-.025em", marginBottom: 8 }}>
            Beyond the <em style={{ fontStyle: "italic", color: "#60a5fa" }}>headline.</em>
          </h1>
          <p style={{ fontSize: 13, color: "#a8a29e", fontWeight: 300, lineHeight: 1.65, maxWidth: 520, marginBottom: "1.5rem" }}>
            See how stories evolve across newspapers over time. Watch real newspaper perspectives debate each other. Not summaries — intelligence.
          </p>

          {/* Search */}
          <div style={{ display: "flex", gap: 0, maxWidth: 640, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="Enter any news topic — e.g. Uniform Civil Code, India-China, AI jobs..."
              style={{ flex: 1, padding: ".85rem 1.1rem", background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: 14, fontFamily: "'Inter',sans-serif" }}
            />
            <button onClick={() => submit()} style={{ padding: ".85rem 1.5rem", background: "#1d4ed8", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Analyse →
            </button>
          </div>

          {/* Sample chips */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SAMPLE_TOPICS.slice(0, 5).map(t => (
              <button key={t} onClick={() => submit(t)}
                style={{ fontSize: 11, padding: "4px 11px", borderRadius: 100, border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.06)", color: "#a8a29e", cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all .15s" }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.5rem 1.5rem 4rem" }}>

        {/* Feature switcher */}
        {submittedTopic && (
          <div style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
            <button onClick={() => setActiveFeature("timeline")}
              style={{ padding: "10px 20px", borderRadius: 100, border: `1.5px solid ${activeFeature === "timeline" ? "#1c1917" : "#e8e6e1"}`, background: activeFeature === "timeline" ? "#1c1917" : "#fff", color: activeFeature === "timeline" ? "#fff" : "#57534e", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              📅 Story Evolution Timeline
            </button>
            <button onClick={() => setActiveFeature("debate")}
              style={{ padding: "10px 20px", borderRadius: 100, border: `1.5px solid ${activeFeature === "debate" ? "#1c1917" : "#e8e6e1"}`, background: activeFeature === "debate" ? "#1c1917" : "#fff", color: activeFeature === "debate" ? "#fff" : "#57534e", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
              ⚔️ Debate Arena
            </button>
          </div>
        )}

        {/* Topic pill */}
        {submittedTopic && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" }}>
            <span style={{ fontSize: 12, color: "#a8a29e" }}>Topic:</span>
            <span style={{ fontSize: 13, fontWeight: 600, padding: "4px 13px", background: "#1c1917", color: "#fff", borderRadius: 100 }}>{submittedTopic}</span>
            <button onClick={() => { setSubmittedTopic(""); setTopic(""); }} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#fff", color: "#57534e", cursor: "pointer" }}>✕ Change</button>
          </div>
        )}

        {/* Feature content */}
        {submittedTopic && activeFeature === "timeline" && (
          <div style={{ animation: "fadeUp .3s ease" }}>
            <TimelineView key={`timeline-${submittedTopic}`} topic={submittedTopic} />
          </div>
        )}
        {submittedTopic && activeFeature === "debate" && (
          <div style={{ animation: "fadeUp .3s ease" }}>
            <DebateView key={`debate-${submittedTopic}`} topic={submittedTopic} />
          </div>
        )}

        {/* Empty state */}
        {!submittedTopic && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
            <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14, padding: "1.5rem" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📅</div>
              <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.2rem", color: "#1c1917", marginBottom: 8 }}>Story Evolution Timeline</div>
              <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.75, marginBottom: 14 }}>
                See how any story evolved over time across newspapers. Each phase shows what changed, which newspaper led coverage, how sentiment shifted, and what each source emphasised differently.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {["Visual coverage intensity chart per phase", "TOI vs Hindu vs BBC vs Al Jazeera angles", "Sentiment shift tracking", "What the media missed", "What to watch next"].map(f => (
                  <div key={f} style={{ fontSize: 12.5, color: "#57534e", display: "flex", gap: 7 }}><span style={{ color: "#1d4ed8" }}>→</span>{f}</div>
                ))}
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e8e6e1", borderRadius: 14, padding: "1.5rem" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚔️</div>
              <div style={{ fontFamily: "'Instrument Serif',serif", fontSize: "1.2rem", color: "#1c1917", marginBottom: 8 }}>Debate Arena</div>
              <div style={{ fontSize: 13, color: "#57534e", lineHeight: 1.75, marginBottom: 14 }}>
                4 pro arguments vs 4 con arguments — each sourced from a real newspaper's known position. Includes argument strength scores, weaknesses, and a GD prep mode with opening and closing lines.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {["8 sourced arguments — pro and con", "Argument strength scoring", "Each argument's weakness shown", "GD opening and closing lines", "UPSC essay angle included"].map(f => (
                  <div key={f} style={{ fontSize: 12.5, color: "#57534e", display: "flex", gap: 7 }}><span style={{ color: "#1d4ed8" }}>→</span>{f}</div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}