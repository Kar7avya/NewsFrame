import { useState, useRef, useEffect } from "react";
import { ragAnswer, searchSimilarArticles } from "./supabase";
 
// ============================================================
// RAGChat.jsx — Drop this anywhere in your report page
// Usage: <RAGChat topic={report.query} />
// ============================================================
 
function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      <div style={{
        maxWidth: "82%", padding: "10px 14px", borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
        background: isUser ? "#1d4ed8" : "var(--color-background-secondary, #f5f4f2)",
        color: isUser ? "#fff" : "var(--color-text-primary, #1c1917)",
        fontSize: 13.5, lineHeight: 1.65, fontFamily: "'Inter',sans-serif",
      }}>
        {msg.content}
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.2)" }}>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: ".05em", textTransform: "uppercase", color: isUser ? "rgba(255,255,255,.7)" : "#a8a29e", marginBottom: 5 }}>Sources used</div>
            {msg.sources.map((s, i) => (
              <div key={i} style={{ fontSize: 11, color: isUser ? "rgba(255,255,255,.85)" : "#57534e", marginBottom: 2 }}>
                <span style={{ background: isUser ? "rgba(255,255,255,.2)" : "#e8e6e1", padding: "1px 5px", borderRadius: 4, marginRight: 5 }}>{s.similarity}% match</span>
                {s.source} — {s.headline.slice(0, 50)}{s.headline.length > 50 ? "…" : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
 
function TypingIndicator() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
      <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "var(--color-background-secondary, #f5f4f2)", display: "flex", gap: 5, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#a8a29e", animation: `bounce 1.2s ${i * 0.2}s infinite` }} />
        ))}
      </div>
    </div>
  );
}
 
export default function RAGChat({ topic }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Hi! I can answer questions about news articles stored in the database${topic ? ` related to "${topic}"` : ""}. Try asking:\n\n• "Which source was most negative?"\n• "What data was mentioned about prices?"\n• "Summarise the key findings"`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [articleCount, setArticleCount] = useState(0);
  const bottomRef = useRef(null);
 
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);
 
  useEffect(() => {
    if (topic) {
      searchSimilarArticles(topic, 20).then(articles => setArticleCount(articles.length));
    }
  }, [topic]);
 
  async function send() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: q }]);
    setLoading(true);
    const { answer, sources } = await ragAnswer(q, topic);
    setLoading(false);
    setMessages(m => [...m, { role: "assistant", content: answer, sources }]);
  }
 
  return (
    <>
      <style>{`
        @keyframes bounce { 0%,60%,100% { transform:translateY(0); } 30% { transform:translateY(-6px); } }
        @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
 
      {/* ── TOGGLE BUTTON ── */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 18px", background: isOpen ? "#374151" : "#1d4ed8",
          color: "#fff", border: "none", borderRadius: 100,
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          fontFamily: "'Inter',sans-serif", transition: "background .15s",
          boxShadow: "0 4px 12px rgba(29,78,216,.25)",
        }}>
        <span style={{ fontSize: 15 }}>💬</span>
        {isOpen ? "Close chat" : "Ask AI about this report"}
        {!isOpen && articleCount > 0 && (
          <span style={{ background: "rgba(255,255,255,.25)", padding: "1px 7px", borderRadius: 100, fontSize: 11 }}>
            {articleCount} articles
          </span>
        )}
      </button>
 
      {/* ── CHAT PANEL ── */}
      {isOpen && (
        <div style={{
          marginTop: 12, border: "1px solid #e8e6e1", borderRadius: 14,
          background: "#fff", overflow: "hidden",
          animation: "slideUp .25s ease",
          boxShadow: "0 8px 32px rgba(0,0,0,.08)",
        }}>
          {/* Header */}
          <div style={{ padding: "12px 16px", background: "#1c1917", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: 7 }}>
                <span>🧠</span> RAG Chat
                <span style={{ fontSize: 10, background: "#22c55e", color: "#fff", padding: "1px 6px", borderRadius: 100, fontWeight: 700 }}>LIVE</span>
              </div>
              <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>
                Answers from {articleCount} stored articles · Powered by Supabase pgvector
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} style={{ background: "none", border: "none", color: "#a8a29e", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
 
          {/* Messages */}
          <div style={{ height: 340, overflowY: "auto", padding: "16px 16px 8px" }}>
            {messages.map((m, i) => <Message key={i} msg={m} />)}
            {loading && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
 
          {/* Suggestions */}
          <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Which source was most critical?", "What key data was mentioned?", "Summarise in 2 sentences"].map(s => (
              <button key={s} onClick={() => { setInput(s); }}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 100, border: "1px solid #e8e6e1", background: "#f5f4f2", color: "#57534e", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                {s}
              </button>
            ))}
          </div>
 
          {/* Input */}
          <div style={{ padding: "8px 12px 12px", display: "flex", gap: 8, borderTop: "1px solid #f1f0ec" }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask anything about stored news articles..."
              style={{ flex: 1, padding: "10px 14px", border: "1px solid #e8e6e1", borderRadius: 100, fontSize: 13, outline: "none", fontFamily: "'Inter',sans-serif", background: "#fafaf9" }}
            />
            <button
              onClick={send} disabled={loading || !input.trim()}
              style={{ padding: "10px 18px", background: loading || !input.trim() ? "#a8a29e" : "#1d4ed8", color: "#fff", border: "none", borderRadius: 100, fontSize: 13, fontWeight: 500, cursor: loading || !input.trim() ? "not-allowed" : "pointer", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
              {loading ? "…" : "Ask →"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}