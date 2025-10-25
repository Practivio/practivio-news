// /scripts/generateNews.js
// STEP 1: Collect article metadata from NewsAPI + GNews only.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import makeDir from "make-dir";

// ── Paths ───────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");
const RAW_FILE = path.join(CONTENT_DIR, "raw-links.json");

// ── Config ──────────────────────────────────────────────
const NEWS_API_KEY = "c4d0aeeb7f064142a6114cf02d8f1a2f";
const GNEWS_API_KEY = "6fd3254f00f88459e0b321c77b8f42c1";
const MAX_ITEMS = 7;
const CATEGORIES = [
  "general", "politics", "business", "science",
  "technology", "sports", "entertainment"
];

// ── Setup ───────────────────────────────────────────────
await makeDir(CONTENT_DIR);

// ── Fetch from NewsAPI ─────────────────────────────────
async function fetchNews(category) {
  try {
    const url = `https://newsapi.org/v2/top-headlines?country=us&category=${category}&pageSize=${MAX_ITEMS}&apiKey=${NEWS_API_KEY}`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d.articles?.length) throw new Error("No results");
    return d.articles.map(a => ({
      title: a.title,
      link: a.url,
      image: a.urlToImage,
      source: a.source?.name,
      category,
      pubDate: a.publishedAt,
      api: "NewsAPI"
    }));
  } catch (e) {
    console.log(`⚠️ NewsAPI failed for ${category}: ${e.message}`);
    return [];
  }
}

// ── Fetch from GNews (fallback) ────────────────────────
async function fetchGNews(category) {
  try {
    const url = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=us&max=${MAX_ITEMS}&apikey=${GNEWS_API_KEY}`;
    const r = await fetch(url);
    const d = await r.json();
    return (d.articles || []).map(a => ({
      title: a.title,
      link: a.url,
      image: a.image,
      source: a.source?.name,
      category,
      pubDate: a.publishedAt,
      api: "GNews"
    }));
  } catch (e) {
    console.log(`⚠️ GNews failed for ${category}: ${e.message}`);
    return [];
  }
}

// ── Main runner ────────────────────────────────────────
async function main() {
  let all = [];

  for (const cat of CATEGORIES) {
    const newsA = await fetchNews(cat);
    const newsB = await fetchGNews(cat);
    all.push(...newsA, ...newsB);
  }

  // De-duplicate by link
  const seen = new Set();
  const unique = all.filter(a => {
    const key = a.link || a.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Save
  fs.writeFileSync(RAW_FILE, JSON.stringify(unique, null, 2));
  console.log(`✅ Saved ${unique.length} articles to ${RAW_FILE}`);
}

main().catch(err => console.error("❌ Error:", err));
