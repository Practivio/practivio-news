// scripts/fetchNewsVideos.js
import fs from "fs-extra";
import path from "path";
import puppeteer from "puppeteer";
import { execSync } from "child_process";

const OUT_PATH = "./content/videos.json";
const INDEX_PAGE = "./index.html";

const SITES = [
  "https://www.cnn.com/videos",
  "https://www.bbc.com/news/av",
  "https://www.reuters.com/video",
  "https://apnews.com/video",
  "https://www.foxnews.com/video",
  "https://www.cbsnews.com/latest/video/",
  "https://sports.yahoo.com/video/",
  "https://www.espn.com/video"
];

// Utility to pause
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchVideosWithPuppeteer(url) {
  console.log(`🎥 Scanning ${url}`);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    const videos = await page.evaluate(() => {
      const vids = [];
      document.querySelectorAll("video, iframe, source").forEach((el) => {
        const src = el.src || el.dataset.src || el.getAttribute("src");
        if (!src) return;
        const title =
          el.title ||
          el.alt ||
          el.closest("article,h2,h3")?.innerText?.trim() ||
          document.title ||
          "Untitled Clip";
        vids.push({ title, src });
      });
      return vids.filter((v) => v.src && !v.src.startsWith("blob:"));
    });

    await browser.close();
    return videos.map((v) => ({ ...v, site: new URL(url).hostname }));
  } catch (err) {
    console.log(`⚠️ Failed to scrape ${url}: ${err.message}`);
    await browser.close();
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
  h1 { margin-bottom: 1rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; }
  .card { background: #fff; border-radius: 12px; padding: 1rem; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  video, iframe { width: 100%; border-radius: 8px; }
  button { margin-top: 0.5rem; padding: 0.4rem 0.8rem; background: #0059ff; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  button:hover { background: #0040cc; }
</style>
</head>
<body>
  <h1>🎬 Latest News & Sports Videos (Past 24h)</h1>
  <div class="grid">
  ${videos
    .map(
      (v) => `
    <div class="card">
      ${
        v.src.includes("youtube") || v.src.includes("player")
          ? `<iframe src="${v.src}" allowfullscreen></iframe>`
          : `<video controls src="${v.src}"></video>`
      }
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
    © ${new Date().getFullYear()} Practivio News — Auto-fetched with Puppeteer.
  </footer>
</body>
</html>`;
  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage updated with ${videos.length} playable videos`);
}

async function main() {
  let allVideos = [];

  for (const url of SITES) {
    const vids = await fetchVideosWithPuppeteer(url);
    if (vids.length) {
      console.log(`✅ Found ${vids.length} videos on ${url}`);
      allVideos.push(...vids);
    } else {
      console.log(`⚠️ No videos found at ${url}`);
    }
    await sleep(2000);
  }

  // Deduplicate by src
  const uniqueVideos = Array.from(new Map(allVideos.map((v) => [v.src, v])).values());
  fs.writeJsonSync(OUT_PATH, uniqueVideos, { spaces: 2 });
  console.log(`✅ Saved ${uniqueVideos.length} videos → ${OUT_PATH}`);

  await buildHomePage(uniqueVideos);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: update video homepage"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
  } catch {
    console.log("⚠️ Git push skipped or remote not configured.");
  }

  console.log("🎉 Done!");
}

main().catch((e) => console.error("❌ Fatal:", e));
