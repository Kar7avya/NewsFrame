import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GROQ_KEY     = import.meta.env.VITE_GROQ_KEY;

export const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ── MATH EMBEDDING ────────────────────────────────────────
function getMathEmbedding(text) {
  const dim = 384;
  const vec = new Array(dim).fill(0);
  const clean = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  words.forEach((word, wi) => {
    const weight = 1 / Math.log2(wi + 2);
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    vec[h % dim] += weight * 2;
    for (let i = 0; i < word.length - 1; i++) {
      const bh = (word.charCodeAt(i) * 31 + word.charCodeAt(i + 1)) >>> 0;
      vec[bh % dim] += weight;
    }
  });
  const mag = Math.sqrt(vec.reduce((total, v) => total + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

export async function getEmbedding(text) {
  const input = (text || "").slice(0, 512);
  try {
    if (SUPABASE_URL) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ text: input }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.embedding && Array.isArray(data.embedding)) return data.embedding;
      }
    }
  } catch (e) {}
  return getMathEmbedding(input);
}

export async function saveReport(topic, reportText) {
  if (!supabase) return;
  try {
    const embedding = await getEmbedding(topic + " " + reportText.slice(0, 500));
    const { error } = await supabase.from("news_reports").insert({ topic, report_text: reportText, embedding });
    if (error) console.error("saveReport error:", error);
    else console.log("Report saved ✓");
  } catch (e) { console.error("saveReport failed:", e.message); }
}

export async function saveArticles(topic, newsRows) {
  if (!supabase || !newsRows?.length) return;
  try {
    const rows = await Promise.all(newsRows.map(async row => ({
      topic,
      headline:  row.headline,
      source:    row.source,
      summary:   row.summary,
      key_data:  row.keydata,
      sentiment: row.sentiment,
      date_str:  row.date,
      embedding: await getEmbedding(`${row.headline} ${row.summary}`),
    })));
    const { error } = await supabase.from("news_articles").insert(rows);
    if (error) console.error("saveArticles error:", error);
    else console.log(`${rows.length} articles saved ✓`);
  } catch (e) { console.error("saveArticles failed:", e.message); }
}

export async function searchSimilarArticles(query, limit = 5) {
  if (!supabase) return [];
  try {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("search_articles", {
      query_embedding: embedding, match_threshold: 0.0, match_count: limit,
    });
    if (error || !data?.length) {
      const { data: latest } = await supabase.from("news_articles")
        .select("*").order("created_at", { ascending: false }).limit(limit);
      return (latest || []).map(a => ({ ...a, similarity: 0.5 }));
    }
    return data;
  } catch (e) { return []; }
}

export async function searchSimilarReports(query, limit = 3) {
  if (!supabase) return [];
  try {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("search_reports", {
      query_embedding: embedding, match_threshold: 0.0, match_count: limit,
    });
    if (error || !data?.length) return [];
    return data;
  } catch (e) { return []; }
}

export async function ragAnswer(question, topic = "") {
  if (!supabase) return { answer: "RAG not configured. Add Supabase keys to .env", sources: [] };
  try {
    const articles = await searchSimilarArticles(question + " " + topic, 5);
    const reports  = await searchSimilarReports(question + " " + topic, 2);
    if (!articles.length && !reports.length) {
      return { answer: "No articles found. Search a topic first to build the knowledge base.", sources: [] };
    }
    const context = [
      ...articles.map(a => `[${a.source} — ${a.date_str}]\nHeadline: ${a.headline}\nSummary: ${a.summary}`),
      ...reports.map(r => `[Report: ${r.topic}]\n${r.report_text?.slice(0, 600)}`),
    ].join("\n\n---\n\n");

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", max_tokens: 800, temperature: 0.2,
        messages: [
          { role: "system", content: `Answer using ONLY this context:\n\n${context}` },
          { role: "user", content: question },
        ],
      }),
    });
    if (!res.ok) throw new Error("Groq error " + res.status);
    const data = await res.json();
    return {
      answer: data.choices[0].message.content,
      sources: articles.map(a => ({ headline: a.headline, source: a.source, similarity: Math.round((a.similarity || 0.5) * 100) })),
    };
  } catch (e) { return { answer: "Error: " + e.message, sources: [] }; }
}

export async function getRAGStats() {
  if (!supabase) return { total_articles: 0, total_reports: 0, unique_topics: 0, oldest_article: null, newest_article: null };
  try {
    const { count: total_articles } = await supabase.from("news_articles").select("*", { count: "exact", head: true });
    const { count: total_reports }  = await supabase.from("news_reports").select("*", { count: "exact", head: true });
    return { total_articles: total_articles || 0, total_reports: total_reports || 0, unique_topics: "—", oldest_article: null, newest_article: null };
  } catch (e) { return { total_articles: 0, total_reports: 0, unique_topics: 0 }; }
}

export async function cleanupOldArticles(daysToKeep = 90) {
  if (!supabase) return null;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const { error: e1 } = await supabase.from("news_articles").delete().lt("created_at", cutoff.toISOString());
    const { error: e2 } = await supabase.from("news_reports").delete().lt("created_at", cutoff.toISOString());
    if (e1 || e2) throw e1 || e2;
    return { articles_deleted: "some", reports_deleted: "some", ran_at: new Date().toISOString() };
  } catch (e) { console.error("cleanup failed:", e.message); return null; }
}

export async function autoCleanupIfNeeded(daysToKeep = 90) {
  try { await cleanupOldArticles(daysToKeep); } catch (e) {}
}