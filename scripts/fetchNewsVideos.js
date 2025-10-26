// scripts/fetchNewsVideos.js
import fs from "fs-extra";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import { execSync } from "child_process";

const OUT_PATH = "./content/videos.json";
const INDEX_PAGE = "./index.html";

const CHANNELS = [
  ["CNN", "https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw"],
  ["BBC News", "https://www.youtube.com/feeds/videos.xml?channel_id=UC16niRr50-MSBwiO3YDb3RA"],
  ["AP", "https://www.youtube.com/feeds/videos.xml?channel_id=UCBi2mrWuNuyYy4gbM6fU18Q"],
  ["Fox News", "https://www.youtube.com/feeds/videos.xml?channel_id=UCaXkIU1QidjPwiAYu6GcHjg"],
  ["Reuters", "https://www.youtube.com/feeds/videos.xml?channel_id=UCB1o7_gbFp2PLsamWxFenBg"],
  ["ESPN", "https://www.youtube.com/feeds/videos.xml?channel_id=UCiWLfSweyRNmLpgEHekhoAg"],
  ["NASA", "https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ"]
];

async function fetchYouTubeFeed(name, url) {
  try {
    console.log(`📡 Fetching ${name}...`);
    const res = await fetch(url);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xml);
    const entries = data.feed?.entry || [];
    const now = Date.now();

    return entries
      .filter((e) => {
        const published = new Date(e.published).getTime();
        return now - published < 24 * 60 * 60 * 1000; // last 24h
      })
      .map((e) => ({
        title: e.title,
        link: e.link?.["@_href"] || "",
        src: e.link?.["@_href"] || "",
        channel: name,
        published: e.published
      }));
  } catch (err) {
    console.log(`⚠️ Failed ${name}: ${err.message}`);
    return [];
  }
}

async function buildHomePage(videos) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>🎥 Practivio News — YouTube Feeds</title>
<style>
  body { font-family: Inter, sans-serif; margin: 2rem; background: #f8f8f8; color:#111; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:1.5rem; }
  .card { background:#fff; border-radius:12px; padding:1rem; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
  iframe { width:100%; aspect-ratio:16/9; border-radius:8px; }
  small { color:#555; }
</style>
</head>
<body>
<h1>🎬 Latest News & Sports Videos (Last 24 h)</h1>
<div class="grid">
${videos
  .map((v) => {
    const vidId = new URL(v.src).searchParams.get("v");
    const embed = vidId
      ? `https://www.youtube.com/embed/${vidId}`
      : v.src.replace("watch?v=", "embed/");
    return `
    <div class="card">
      <iframe src="${embed}" allowfullscreen></iframe>
      <p><strong>${v.title}</strong><br>
      <small>${v.channel} — ${new Date(v.published).toLocaleString()}</small></p>
      <a href="${v.src}" target="_blank">▶️ Watch on YouTube</a>
    </div>`;
  })
  .join("")}
</div>
<footer style="margin-top:2rem;font-size:0.9em;color:#555">
© ${new Date().getFullYear()} Practivio News — Auto-fetched YouTube videos
</footer>
</body></html>`;
  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage updated with ${videos.length} videos`);
}

async function main() {
  let all = [];
  for (const [name, url] of CHANNELS) {
    const vids = await fetchYouTubeFeed(name, url);
    console.log(`✅ ${name}: ${vids.length} new videos`);
    all.push(...vids);
  }

  fs.writeJsonSync(OUT_PATH, all, { spaces: 2 });
  await buildHomePage(all);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: update YouTube video homepage"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
  } catch {
    console.log("⚠️ Git push skipped or remote not configured.");
  }
  console.log("🎉 Done!");
}

main().catch((e) => console.error("❌ Fatal:", e));
