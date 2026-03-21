// ============================================================
// src/supabase.js
// Supabase client + RAG utilities for NewsLens
// ============================================================
// Add these to your .env file:
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=your_anon_key_here
//
// Get both from: supabase.com → project → Settings → API
// ============================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GROQ_KEY     = import.meta.env.VITE_GROQ_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── EMBEDDING ──────────────────────────────────────────────
// We use Groq to generate embeddings (turn text into numbers)
// This uses the free nomic-embed-text model via Groq
// ── EMBEDDING ──────────────────────────────────────────────
// Uses HuggingFace Inference API (free, no signup needed)
// Model: all-MiniLM-L6-v2 produces 384-dim embeddings
// Fallback: deterministic math embedding if HF is slow/down

export async function getEmbedding(text) {
  const input = text.slice(0, 512);

  try {
    const res = await fetch(
      "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: input, options: { wait_for_model: true } }),
      }
    );

    if (!res.ok) throw new Error("HF status " + res.status);
    const data = await res.json();

    // HF returns [[...embedding...]] or [...embedding...]
    const raw = Array.isArray(data[0]) ? data[0] : data;
    if (Array.isArray(raw) && raw.length > 0) {
      // Normalize to unit vector
      const mag = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) || 1;
      return raw.map(v => v / mag);
    }
    throw new Error("Bad HF response shape");
  } catch (e) {
    console.warn("HF embedding failed, using math fallback:", e.message);
    return getMathEmbedding(input);
  }
}

// Deterministic math embedding — always works, no API needed
// Less semantic but consistent — same text always gives same vector
function getMathEmbedding(text) {
  const dim = 384;
  const vec = new Array(dim).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

  words.forEach((word, wi) => {
    // Word-level signal
    let wHash = 0;
    for (let i = 0; i < word.length; i++) {
      wHash = (wHash * 31 + word.charCodeAt(i)) >>> 0;
    }
    vec[wHash % dim] += 2 / (wi + 1);

    // Character n-gram signal
    for (let i = 0; i < word.length - 1; i++) {
      const bi = word.charCodeAt(i) * 256 + word.charCodeAt(i + 1);
      vec[bi % dim] += 1 / (wi + 1);
    }
  });

  // Normalize to unit vector
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
// Find articles in the database that match a query by meaning
export async function searchSimilarArticles(query, limit = 5) {
  try {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("search_articles", {
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count: limit,
    });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error("searchSimilarArticles failed:", e.message);
    return [];
  }
}

// ── SEARCH SIMILAR REPORTS ────────────────────────────────
// Find past reports that match a query by meaning
export async function searchSimilarReports(query, limit = 3) {
  try {
    const embedding = await getEmbedding(query);
    const { data, error } = await supabase.rpc("search_reports", {
      query_embedding: embedding,
      match_threshold: 0.45,
      match_count: limit,
    });
    if (error) throw error;
    return data || [];
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
        answer: "No relevant past articles found in the database. Try searching for a topic first to build up the knowledge base.",
        sources: [],
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