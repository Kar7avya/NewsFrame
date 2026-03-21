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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── EMBEDDING ──────────────────────────────────────────────
// Strategy:
//   1. If VITE_HF_TOKEN is set → use HuggingFace (best quality, free token needed)
//   2. Fallback → pure math embedding (always works, no API needed)

export function getEmbedding(text) {
  // Pure math embedding — no external API, no CORS, no rate limits
  // Works on any domain including Vercel production
  return Promise.resolve(getMathEmbedding(text.slice(0, 512)));
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
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

// ── SAVE REPORT ────────────────────────────────────────────
// Call this after every report is generated
export async function saveReport(topic, reportText) {
  try {
    const embedding = await getEmbedding(topic + " " + reportText.slice(0, 500));
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

// ── SAVE ARTICLES ──────────────────────────────────────────
// Call this with the parsed news rows from a report
export async function saveArticles(topic, newsRows) {
  try {
    const rows = await Promise.all(
      newsRows.map(async (row) => {
        const text = `${row.headline} ${row.summary} ${row.keydata}`;
        const embedding = await getEmbedding(text);
        return {
          topic,
          headline:   row.headline,
          source:     row.source,
          summary:    row.summary,
          key_data:   row.keydata,
          sentiment:  row.sentiment,
          date_str:   row.date,
          search_url: row.searchUrl || "",
          embedding,
        };
      })
    );
    const { error } = await supabase.from("news_articles").insert(rows);
    if (error) console.error("Save articles error:", error);
    else console.log(`${rows.length} articles saved to Supabase ✓`);
  } catch (e) {
    console.error("saveArticles failed:", e.message);
  }
}

// ── SEARCH SIMILAR ARTICLES ────────────────────────────────
export async function searchSimilarArticles(query, limit = 5) {
  try {
    const embedding = await getEmbedding(query);

    // Try with very low threshold first — math embeddings have lower cosine similarity
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

    // 2. Build context from retrieved content
    const context = [
      ...articles.map(a => `[${a.source} — ${a.date_str}]\nHeadline: ${a.headline}\nSummary: ${a.summary}\nData: ${a.key_data}`),
      ...reports.map(r => `[Past report on: ${r.topic}]\n${r.report_text.slice(0, 800)}`),
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