// ============================================================
// src/supabase.js
// Supabase client + RAG utilities for NewsLens
// ============================================================
// Add these to your .env file:
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=your_anon_key_here
//   VITE_HF_TOKEN=hf_xxxx  ← optional but recommended for better RAG quality
//
// Supabase keys: supabase.com → project → Settings → API
// HuggingFace token: huggingface.co → Settings → Access Tokens → New token (free)
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GROQ_KEY     = import.meta.env.VITE_GROQ_KEY;

export const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// ── EMBEDDING ──────────────────────────────────────────────
// Strategy:
//   1. If VITE_HF_TOKEN is set → use HuggingFace (best quality, free token needed)
//   2. Fallback → pure math embedding (always works, no API needed)

// Edge Function URL — set this after deploying
// Format: https://YOUR_PROJECT_REF.supabase.co/functions/v1/embed
const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_EMBED_URL || "";

export async function getEmbedding(text) {
  const input = text.slice(0, 512);

  // Try Supabase Edge Function first (server-side HuggingFace — no CORS)
  try {
    if (SUPABASE_URL) {
      const edgeUrl = `${SUPABASE_URL}/functions/v1/embed`;
      const res = await fetch(edgeUrl, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ text: input }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.embedding && Array.isArray(data.embedding) && data.embedding.length > 0) {
          if (data.source === "huggingface") {
            console.log("Embedding: HuggingFace ✓ high accuracy");
          } else {
            console.log("Embedding: math fallback via Edge Function");
          }
          return data.embedding;
        }
      } else {
        console.warn("Edge Function returned", res.status, "— using local math fallback");
      }
    }
  } catch (e) {
    console.warn("Edge Function unreachable:", e.message, "— using local math");
  }

  // Local math fallback — always works, no external API needed
  return getMathEmbedding(input);
}

function getMathEmbedding(text) {
  const dim = 384;
  const vec = new Array(dim).fill(0);

  // Normalize text
  const clean = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(" ").filter(Boolean);

  words.forEach((word, wi) => {
    const weight = 1 / Math.log2(wi + 2); // TF-IDF inspired: earlier words weighted more

    // 1. Whole word hash
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    vec[h % dim] += weight * 2;

    // 2. Character bigrams (captures partial word matches)
    for (let i = 0; i < word.length - 1; i++) {
      let bh = (word.charCodeAt(i) * 31 + word.charCodeAt(i + 1)) >>> 0;
      vec[bh % dim] += weight;
    }

    // 3. Character trigrams (captures word stems)
    for (let i = 0; i < word.length - 2; i++) {
      let th = (word.charCodeAt(i) * 961 + word.charCodeAt(i+1) * 31 + word.charCodeAt(i+2)) >>> 0;
      vec[th % dim] += weight * 0.5;
    }
  });

  // L2 normalize to unit vector (required for cosine similarity)
  const mag = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

// ── SAVE REPORT ────────────────────────────────────────────
// Call this after every report is generated
export async function saveReport(topic, reportText) {
  try {
    const embedding = await getEmbedding(topic + " " + reportText.slice(0, 500));
    if (!supabase) return;
    const { error } = await supabase.from("news_reports").insert({
      topic,
      report_text: reportText,
      embedding,
    });
    if (error) console.error("Save report error:", error);
    else console.log("Report saved to Supabase ✓");
  } catch (e) {
    console.error("saveReport failed:", e.message);
  }
}

// ── HELPERS FOR ENRICHING ARTICLES ───────────────────────

function inferSourceCountry(source) {
  const s = source.toLowerCase();
  if (s.includes("times of india") || s.includes("hindustan times") ||
      s.includes("the hindu") || s.includes("india today") ||
      s.includes("economic times")) return "India";
  if (s.includes("bbc")) return "UK";
  if (s.includes("cnn") || s.includes("washington times") ||
      s.includes("new york times")) return "USA";
  if (s.includes("al jazeera")) return "Qatar";
  return "International";
}

function inferCategory(headline, summary) {
  const text = (headline + " " + summary).toLowerCase();
  if (text.match(/election|parliament|minister|government|policy|BJP|congress|modi|political/))
    return "Politics";
  if (text.match(/GDP|economy|inflation|budget|market|stock|rupee|trade|fiscal/))
    return "Economy";
  if (text.match(/cricket|IPL|football|sports|olympic|tournament|match|player/))
    return "Sports";
  if (text.match(/AI|tech|startup|digital|cyber|app|software|space|science/))
    return "Technology";
  if (text.match(/army|war|border|defence|security|military|attack|terror/))
    return "Defence";
  if (text.match(/climate|environment|pollution|flood|drought|disaster|weather/))
    return "Environment";
  if (text.match(/health|covid|disease|hospital|medicine|vaccine|doctor/))
    return "Health";
  if (text.match(/court|law|constitution|rights|justice|verdict|judge/))
    return "Legal";
  if (text.match(/china|pakistan|usa|russia|UN|international|global|world/))
    return "International";
  return "General";
}

function inferGSPaper(headline, summary, category) {
  const text = (headline + " " + summary).toLowerCase();
  const papers = [];
  if (text.match(/history|culture|heritage|art|society|tradition/)) papers.push("GS1");
  if (text.match(/government|polity|constitution|parliament|policy|governance|international|UN|treaty/))
    papers.push("GS2");
  if (text.match(/economy|agriculture|infrastructure|environment|technology|disaster|security|defence/))
    papers.push("GS3");
  if (text.match(/ethics|integrity|corruption|attitude|moral|value|civil service/))
    papers.push("GS4");
  return papers.length > 0 ? papers.join(", ") : "GS2, GS3";
}

function inferImportance(headline, summary, source) {
  let score = 5;
  const text = (headline + " " + summary).toLowerCase();
  // Boost for major topics
  if (text.match(/supreme court|parliament|prime minister|president|RBI|budget/)) score += 2;
  if (text.match(/war|crisis|emergency|major|landmark|historic/)) score += 2;
  if (text.match(/india|national|government/)) score += 1;
  // Boost for reliable sources
  if (source.toLowerCase().match(/bbc|new york times|the hindu|al jazeera/)) score += 1;
  // Clamp 1-10
  return Math.min(10, Math.max(1, score));
}

function extractTags(headline, summary, category, gsPaper) {
  const text = (headline + " " + summary).toLowerCase();
  const tags = [category];
  if (gsPaper) gsPaper.split(",").forEach(p => tags.push(p.trim()));
  // Extract key entities as tags
  const entities = [
    "India", "China", "Pakistan", "USA", "Russia", "Modi", "BJP", "Congress",
    "RBI", "Supreme Court", "Parliament", "Budget", "GDP", "Climate",
  ];
  entities.forEach(e => { if (text.includes(e.toLowerCase())) tags.push(e); });
  return [...new Set(tags)].slice(0, 8); // max 8 unique tags
}

// ── SAVE ARTICLES ──────────────────────────────────────────
// Saves enriched articles with all metadata fields
export async function saveArticles(topic, newsRows) {
  try {
    // Process one at a time to avoid rate limits on embedding
    const rows = [];
    for (const row of newsRows) {
      const fullText = [row.headline, row.summary, row.keydata].filter(Boolean).join(". ");
      const embedding = await getEmbedding(fullText);

      const category      = inferCategory(row.headline, row.summary);
      const sourceCountry = inferSourceCountry(row.source);
      const gsPaper       = inferGSPaper(row.headline, row.summary, category);
      const importance    = inferImportance(row.headline, row.summary, row.source);
      const tags          = extractTags(row.headline, row.summary, category, gsPaper);
      const wordCount     = fullText.split(" ").length;

      rows.push({
        topic,
        headline:       row.headline,
        source:         row.source,
        source_country: sourceCountry,
        summary:        row.summary,
        full_text:      fullText,
        key_data:       row.keydata,
        sentiment:      row.sentiment,
        date_str:       row.date,
        search_url:     row.searchUrl || "",
        category,
        gs_paper:       gsPaper,
        importance,
        tags,
        word_count:     wordCount,
        reading_time:   Math.ceil(wordCount / 200), // avg reading speed
        embedding,
      });
    }

    if (!supabase) return;
    const { error } = await supabase.from("news_articles").insert(rows);
    if (error) console.error("Save articles error:", error);
    else console.log(`${rows.length} enriched articles saved to Supabase ✓`);
  } catch (e) {
    console.error("saveArticles failed:", e.message);
  }
}


// ── SEARCH SIMILAR ARTICLES ────────────────────────────────
export async function searchSimilarArticles(query, limit = 5) {
  try {
    const embedding = await getEmbedding(query);

    // Try with very low threshold first — math embeddings have lower cosine similarity
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("search_articles", {
      query_embedding: embedding,
      match_threshold: 0.0,   // 0.0 = return everything, sorted by similarity
      match_count: limit,
    });

    if (error) {
      console.error("search_articles RPC error:", error);
      // Fallback: just get latest articles directly
      return await getLatestArticles(limit);
    }

    console.log("searchSimilarArticles found:", data?.length, "results");
    if (!data || data.length === 0) {
      // No similarity results — fall back to latest articles
      return await getLatestArticles(limit);
    }
    return data;
  } catch (e) {
    console.error("searchSimilarArticles failed:", e.message);
    return await getLatestArticles(limit);
  }
}

// ── GET LATEST ARTICLES (fallback when similarity search returns nothing) ──
export async function getLatestArticles(limit = 5) {
  try {
    const { data, error } = await supabase
      .from("news_articles")
      .select("id, topic, headline, source, summary, key_data, sentiment, date_str, search_url")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    console.log("getLatestArticles found:", data?.length);
    return (data || []).map(a => ({ ...a, similarity: 0.5 }));
  } catch (e) {
    console.error("getLatestArticles failed:", e.message);
    return [];
  }
}

// ── SEARCH SIMILAR REPORTS ────────────────────────────────
export async function searchSimilarReports(query, limit = 3) {
  try {
    const embedding = await getEmbedding(query);
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("search_reports", {
      query_embedding: embedding,
      match_threshold: 0.0,
      match_count: limit,
    });

    if (error || !data || data.length === 0) {
      // Fallback: get latest reports
      const { data: latest } = await supabase
        .from("news_reports")
        .select("id, topic, report_text, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      return (latest || []).map(r => ({ ...r, similarity: 0.5 }));
    }
    return data;
  } catch (e) {
    console.error("searchSimilarReports failed:", e.message);
    return [];
  }
}

// ── ASK QUESTION ON STORED CONTENT (RAG CHAT) ─────────────
// Given a user question, find relevant stored content and answer from it
export async function ragAnswer(question, topic = "") {
  try {
    // 1. Search stored articles for relevant content
    const articles = await searchSimilarArticles(question + " " + topic, 5);
    const reports  = await searchSimilarReports(question + " " + topic, 2);

    if (articles.length === 0 && reports.length === 0) {
      return {
        answer: "I could not find any stored articles in the database yet. Please note: articles are saved automatically after each search. Try searching a topic in NewsLens first, then come back and ask your question here.",
        sources: [],
        empty: true,
      };
    }

    // 2. Build rich context from retrieved content
    const context = [
      ...articles.map(a => [
        `[${a.source} (${a.source_country || "Intl"}) — ${a.date_str}]`,
        `Headline: ${a.headline}`,
        a.summary    ? `Summary: ${a.summary}` : "",
        a.key_data   ? `Key Data: ${a.key_data}` : "",
        a.full_text  ? `Context: ${a.full_text.slice(0, 300)}` : "",
        a.gs_paper   ? `GS Paper: ${a.gs_paper}` : "",
        a.tags?.length ? `Tags: ${a.tags.join(", ")}` : "",
        `Importance: ${a.importance || 5}/10 | Sentiment: ${a.sentiment || "Neutral"}`,
      ].filter(Boolean).join("\n")),
      ...reports.map(r => `[Past report: ${r.topic}]\n${r.report_text.slice(0, 600)}`),
    ].join("\n\n---\n\n");

    // 3. Ask Groq to answer using only this context
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 800,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `You are a helpful news assistant. Answer the user's question using ONLY the news articles and reports provided below as context. Do not use outside knowledge. If the context doesn't contain enough information, say so clearly. Always mention which source the information came from.

CONTEXT:
${context}`,
          },
          { role: "user", content: question },
        ],
      }),
    });

    if (!res.ok) throw new Error("Groq RAG call failed");
    const data = await res.json();

    return {
      answer: data.choices[0].message.content,
      sources: articles.map(a => ({ headline: a.headline, source: a.source, similarity: Math.round(a.similarity * 100) })),
    };
  } catch (e) {
    return { answer: "Error: " + e.message, sources: [] };
  }
}

// ── ARTICLE EXPIRY & DB STATS ─────────────────────────────

// Get database stats — how many articles, topics, oldest/newest
export async function getRAGStats() {
  try {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("get_rag_stats");
    if (error) throw error;
    return data;
  } catch (e) {
    // Fallback — manual count if RPC not set up yet
    try {
      if (!supabase) return null;
      const { count: articleCount } = await supabase
        .from("news_articles")
        .select("*", { count: "exact", head: true });

      const { count: reportCount } = await supabase
        .from("news_reports")
        .select("*", { count: "exact", head: true });

      const { data: oldest } = await supabase
        .from("news_articles")
        .select("created_at, topic")
        .order("created_at", { ascending: true })
        .limit(1);

      const { data: newest } = await supabase
        .from("news_articles")
        .select("created_at, topic")
        .order("created_at", { ascending: false })
        .limit(1);

      return {
        total_articles:  articleCount || 0,
        total_reports:   reportCount || 0,
        oldest_article:  oldest?.[0]?.created_at || null,
        newest_article:  newest?.[0]?.created_at || null,
        unique_topics:   "—",
      };
    } catch (e2) {
      console.error("getRAGStats failed:", e2.message);
      return null;
    }
  }
}

// Manually trigger cleanup of old articles
// daysToKeep: how many days of articles to keep (default 90)
export async function cleanupOldArticles(daysToKeep = 90) {
  try {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc("cleanup_old_articles", {
      days_to_keep: daysToKeep,
    });
    if (error) throw error;
    console.log("Cleanup result:", data);
    return data;
  } catch (e) {
    // Fallback — direct delete if RPC not available
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysToKeep);
      const cutoffStr = cutoff.toISOString();

      const { count: artCount, error: e1 } = await supabase
        .from("news_articles")
        .delete()
        .lt("created_at", cutoffStr);

      const { count: repCount, error: e2 } = await supabase
        .from("news_reports")
        .delete()
        .lt("created_at", cutoffStr);

      if (e1 || e2) throw e1 || e2;

      const result = {
        articles_deleted: artCount || 0,
        reports_deleted:  repCount || 0,
        cutoff_date:      cutoffStr,
        ran_at:           new Date().toISOString(),
      };
      console.log("Cleanup done:", result);
      return result;
    } catch (e2) {
      console.error("cleanupOldArticles failed:", e2.message);
      return null;
    }
  }
}

// Auto-cleanup — call this on app startup once per day
// Stores last cleanup time in localStorage to avoid running too often
// In-memory cleanup tracker — resets on page reload (safe alternative to localStorage)
let _lastCleanupTime = 0;

export async function autoCleanupIfNeeded(daysToKeep = 90) {
  try {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (_lastCleanupTime && now - _lastCleanupTime < ONE_DAY) {
      return null; // Already ran cleanup this session
    }
    const result = await cleanupOldArticles(daysToKeep);
    if (result) {
      _lastCleanupTime = now;
      if (result.articles_deleted > 0 || result.reports_deleted > 0) {
        console.log(`Auto-cleanup: removed ${result.articles_deleted} articles older than ${daysToKeep} days`);
      }
    }
    return result;
  } catch (e) {
    console.error("autoCleanupIfNeeded failed:", e.message);
    return null;
  }
}