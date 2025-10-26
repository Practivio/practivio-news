// scripts/fetchNewsVideos.js
import fs from "fs-extra";
import fetch from "node-fetch";
import { execSync } from "child_process";
import { XMLParser } from "fast-xml-parser";

const OUT_PATH = "./content/videos.json";
const INDEX_PAGE = "./index.html";

const FEEDS = [
  "https://www.reutersagency.com/feed/?best-topics=video&post_type=best",
  "https://apnews.com/hub/ap-top-news?format=xml",
  "https://news.yahoo.com/rss/videos",
  "https://www.pbs.org/newshour/feeds/rss/videos",
  "https://www.nasa.gov/rss/dyn/NASAImageOfTheDay.rss",
  "https://rss.dw.com/rdf/rss-en-top"
];

async function fetchRSS(url) {
  try {
    console.log(`📰 Fetching ${url}`);
    const res = await fetch(url);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xml);

    // Extract items from feed
    const items =
      data?.rss?.channel?.item ||
      data?.feed?.entry ||
      data?.RDF?.item ||
      [];

    const videos = [];
    for (const item of items) {
      const title = item.title || "Untitled";
      const link = item.link?.["@_href"] || item.link || "";
      const media = item["media:content"] || item.enclosure || {};
      const src =
        media?.["@_url"] ||
        media?.["@_href"] ||
        media?.["@_link"] ||
        (Array.isArray(media) ? media[0]?.["@_url"] : "") ||
        "";
      const site = new URL(url).hostname;
      if (src && src.endsWith(".mp4")) videos.push({ title, src, site, link });
    }
    console.log(`✅ Found ${videos.length} videos from ${url}`);
    return videos;
  } catch (err) {
    console.log(`⚠️ Failed ${url}: ${err.message}`);
    return [];
  }
}

async function buildHomePage(videos) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>🎥 Practivio News Video Feed</title>
<style>
  body { font-family: Inter, sans-serif; margin: 2rem; background: #f8f8f8; color: #111; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; }
  .card { background: #fff; border-radius: 12px; padding: 1rem; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  video { width: 100%; border-radius: 8px; }
  button { margin-top: 0.5rem; padding: 0.4rem 0.8rem; background: #0059ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  button:hover { background: #0040cc; }
</style>
</head>
<body>
<h1>🎬 Latest Public News & Science Videos</h1>
<div class="grid">
${videos
  .map(
    (v) => `
  <div class="card">
    <video controls src="${v.src}"></video>
    <p><strong>${v.title}</strong><br><small>${v.site}</small></p>
    <button onclick="downloadVideo('${v.src}')">⬇️ Download</button>
  </div>`
  )
  .join("")}
</div>
<script>
  function downloadVideo(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = url.split("/").pop().split("?")[0];
    a.click();
  }
</script>
<footer style="margin-top:2rem;font-size:0.9em;color:#555">
© ${new Date().getFullYear()} Practivio News — Free Public RSS Video Sources
</footer>
</body></html>`;
  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage updated with ${videos.length} playable videos`);
}

async function main() {
  let allVideos = [];
  for (const feed of FEEDS) {
    const vids = await fetchRSS(feed);
    allVideos.push(...vids);
  }

  const unique = Array.from(new Map(allVideos.map((v) => [v.src, v])).values());
  fs.writeJsonSync(OUT_PATH, unique, { spaces: 2 });
  await buildHomePage(unique);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: update RSS-based video homepage"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
  } catch {
    console.log("⚠️ Git push skipped or remote not configured.");
  }

  console.log(`✅ Finished! Total videos: ${unique.length}`);
}

main().catch((e) => console.error("❌ Fatal:", e));
