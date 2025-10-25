// /scripts/extractFullArticles.js
// Improved version: hard timeout, paywall skip, progress logging.

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import makeDir from "make-dir";
import slugify from "slugify";
import { JSDOM } from "jsdom";

const RAW_FILE = "./content/raw-links.json";
const OUT_DIR = "./content/full";
await makeDir(OUT_DIR);

// Domains to skip (paywalled or very slow)
const SKIP_DOMAINS = [
  "washingtonpost.com",
  "nytimes.com",
  "bloomberg.com",
  "wsj.com",
  "latimes.com",
  "theatlantic.com",
  "economist.com",
];

// ── HTML cleanup ─────────────────────────────
function cleanHTML(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<noscript>[\s\S]*?<\/noscript>/gi, "");
}

// ── Extract text + images from article ───────
function extractTextAndImages(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // collect all readable paragraph text
  const paragraphs = [...doc.querySelectorAll("p")]
    .map((p) => p.textContent.trim())
    .filter((t) => t.length > 0);
  const text = paragraphs.join("\n\n");

  // collect main article images
  const imgElements = [...doc.querySelectorAll("img")];
  const images = imgElements
    .map((img) => {
      let src = img.getAttribute("src") || "";
      if (src.startsWith("//")) src = "https:" + src;
      if (src && !src.startsWith("http")) {
        try {
          const base = new URL(url);
          src = new URL(src, base).href;
        } catch {}
      }
      return src;
    })
    .filter((u) => u && (u.includes(".jpg") || u.includes(".png")))
    .slice(0, 5);

  return { text, images };
}

// ── Fetch with hard timeout ──────────────────
async function fetchArticle(link) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // 8s limit

  try {
    const res = await fetch(link, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; M1) PractivioBot" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return cleanHTML(html);
  } catch (err) {
    clearTimeout(timer);
    console.log(`⚠️  Timeout or fetch failed: ${link} (${err.message})`);
    return "";
  }
}

// ── Main Runner ──────────────────────────────
async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW_FILE, "utf8"));
  let count = 0;
  const total = raw.length;

  for (const [i, art] of raw.entries()) {
    const slug = slugify(art.title, { lower: true, strict: true }).slice(0, 80);
    const outFile = path.join(OUT_DIR, `${slug}.json`);
    if (fs.existsSync(outFile)) continue;

    const domain = new URL(art.link).hostname;
    if (SKIP_DOMAINS.some((d) => domain.includes(d))) {
      console.log(`(${i + 1}/${total}) ⏭️  Skipping paywalled: ${domain}`);
      continue;
    }

    console.log(`(${i + 1}/${total}) 📰 Fetching: ${art.title}`);
    const html = await fetchArticle(art.link);
    if (!html) continue;

    const { text, images } = extractTextAndImages(html, art.link);
    if (text.length < 1000) {
      console.log("⚠️  Too little text, skipping.");
      continue;
    }

    const record = { ...art, full_text: text, images };
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
    count++;
    console.log(`✅ Saved full article → ${outFile}`);
  }

  console.log(`\n✅ Finished capturing ${count} full articles.`);
}

main().catch((e) => console.error("❌ Error:", e));
