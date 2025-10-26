// scripts/fetchNewsVideos.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

import { execSync } from "child_process";

const OUT_JSON = "./content/videos.json";
const INDEX_PAGE = "./index.html";

// List of major outlets to scan for new videos
const SOURCES = [
  "https://www.cnn.com/videos",
  "https://www.bbc.com/news/av",
  "https://www.reuters.com/video",
  "https://apnews.com/video",
  "https://www.espn.com/video",
  "https://www.foxnews.com/video",
  "https://www.cbsnews.com/latest/video/",
  "https://sports.yahoo.com/video/"
];

// Fetch HTML safely
async function fetchHTML(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(res.statusText);
    return await res.text();
  } catch (e) {
    console.log(`⚠️ Failed to fetch ${url}: ${e.message}`);
    return "";
  }
}

// Parse out video links and titles from each page
function parseVideos(html, site) {
  const $ = cheerio.load(html);
  const videos = [];

  $("video, iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src || !src.includes("http")) return;

    let title =
      $(el).attr("title") ||
      $(el).attr("alt") ||
      $(el).parent("article").find("h3, h2").text() ||
      "Untitled Clip";

    title = title.trim().slice(0, 120);

    videos.push({
      title,
      src,
      site,
      fetched: new Date().toISOString()
    });
  });

  return videos;
}

// Main runner
async function main() {
  let allVideos = [];

  for (const url of SOURCES) {
    console.log(`🎥 Scanning ${url}`);
    const html = await fetchHTML(url);
    if (!html) continue;
    const videos = parseVideos(html, new URL(url).hostname);
    allVideos = allVideos.concat(videos);
  }

  // Deduplicate by src
  const unique = [];
  const seen = new Set();
  for (const v of allVideos) {
    if (!seen.has(v.src)) {
      seen.add(v.src);
      unique.push(v);
    }
  }

  // Save JSON
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(unique, null, 2));
  console.log(`✅ Saved ${unique.length} videos → ${OUT_JSON}`);

  // Update homepage
  const videoBlocks = unique
    .map(
      (v) => `
      <div style="margin-bottom:2rem">
        <h3>${v.title}</h3>
        <video src="${v.src}" controls preload="metadata" width="100%"></video><br/>
        <a href="${v.src}" download style="display:inline-block;margin-top:6px;">⬇️ Download</a>
        <p style="font-size:0.8em;color:#666">${v.site}</p>
      </div>`
    )
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Latest News Videos — Practivio</title>
  <style>
    body { font-family: Inter, sans-serif; margin: 2rem; background:#f8f8f8; color:#111; }
    h1 { margin-bottom:1.5rem; }
    video { border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
    a { color:#0059ff; text-decoration:none; }
    a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <h1>🎬 Latest News & Sports Videos (24h)</h1>
  ${videoBlocks}
  <footer style="margin-top:3rem;font-size:0.9em;color:#666">
    © ${new Date().getFullYear()} Practivio News — Video feed auto-collected from public sources.
  </footer>
</body>
</html>`;

  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage updated with ${unique.length} playable videos`);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: refresh video feed"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log("🚀 Changes pushed to GitHub!");
  } catch {
    console.log("⚠️ No Git push or remote not configured.");
  }
}

main().catch((e) => console.error("❌ Fatal:", e));
