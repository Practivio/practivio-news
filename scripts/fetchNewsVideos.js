// scripts/newsVideosServer.js
import fs from "fs-extra";
import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import express from "express";
import ytdl from "ytdl-core";
import path from "path";

const CHANNELS = [
  ["CNN", "https://www.youtube.com/feeds/videos.xml?channel_id=UCupvZG-5ko_eiXAupbDfxWw"],
  ["BBC", "https://www.youtube.com/feeds/videos.xml?channel_id=UC16niRr50-MSBwiO3YDb3RA"],
  ["AP", "https://www.youtube.com/feeds/videos.xml?channel_id=UCBi2mrWuNuyYy4gbM6fU18Q"],
  ["Fox News", "https://www.youtube.com/feeds/videos.xml?channel_id=UCaXkIU1QidjPwiAYu6GcHjg"],
  ["Reuters", "https://www.youtube.com/feeds/videos.xml?channel_id=UCB1o7_gbFp2PLsamWxFenBg"],
  ["ESPN", "https://www.youtube.com/feeds/videos.xml?channel_id=UCiWLfSweyRNmLpgEHekhoAg"],
  ["NASA", "https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ"]
];

const OUT_PATH = "./content/videos.json";
const INDEX_PAGE = "./index.html";
const PORT = process.env.PORT || 3030;

async function fetchYouTubeFeed(name, url) {
  try {
    console.log(`📡  ${name}`);
    const res = await fetch(url);
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xml);
    const entries = data.feed?.entry || [];
    const now = Date.now();
    return entries
      .filter((e) => now - new Date(e.published).getTime() < 24 * 60 * 60 * 1000)
      .map((e) => ({
        title: e.title,
        src: e.link?.["@_href"] || "",
        channel: name,
        published: e.published
      }));
  } catch (err) {
    console.log(`⚠️ ${name} failed: ${err.message}`);
    return [];
  }
}

async function buildHome(videos) {
  const cards = videos
    .map((v) => {
      const vidId = new URL(v.src).searchParams.get("v");
      const embed = vidId ? `https://www.youtube.com/embed/${vidId}` : v.src.replace("watch?v=", "embed/");
      return `
      <div class="card">
        <iframe src="${embed}" allowfullscreen></iframe>
        <p><strong>${v.title}</strong><br><small>${v.channel} — ${new Date(v.published).toLocaleString()}</small></p>
        <button onclick="window.open('/download?url=${encodeURIComponent(v.src)}')">⬇️ Download</button>
      </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>🎥 Practivio News — Live Video Feed</title>
<style>
body{font-family:Inter,sans-serif;margin:2rem;background:#f8f8f8;color:#111}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.5rem}
.card{background:#fff;border-radius:12px;padding:1rem;box-shadow:0 2px 5px rgba(0,0,0,.1)}
iframe{width:100%;aspect-ratio:16/9;border-radius:8px}
button{margin-top:.5rem;padding:.4rem .8rem;background:#0059ff;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:hover{background:#0040cc}
small{color:#555}
</style>
</head>
<body>
<h1>🎬 Latest News & Sports Videos (Last 24 h)</h1>
<div class="grid">${cards}</div>
<footer style="margin-top:2rem;font-size:0.9em;color:#555">
© ${new Date().getFullYear()} Practivio News
</footer>
</body></html>`;
  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage written (${videos.length} videos)`);
}

async function refreshVideos() {
  let all = [];
  for (const [name, url] of CHANNELS) all.push(...(await fetchYouTubeFeed(name, url)));
  fs.writeJsonSync(OUT_PATH, all, { spaces: 2 });
  await buildHome(all);
  return all;
}

// --- Express server with download route ---
const app = express();
app.use(express.static(path.resolve("./")));

app.get("/download", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !ytdl.validateURL(videoUrl)) return res.status(400).send("Invalid YouTube URL");
  try {
    const info = await ytdl.getInfo(videoUrl);
    const title = info.videoDetails.title.replace(/[^\w\s-]/g, "").slice(0, 50);
    res.header("Content-Disposition", `attachment; filename="${title}.mp4"`);
    ytdl(videoUrl, { quality: "highestvideo" }).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).send("Download failed");
  }
});

app.get("/refresh", async (_, res) => {
  const vids = await refreshVideos();
  res.send(`✅ Refreshed ${vids.length} videos`);
});

app.listen(PORT, async () => {
  console.log(`🚀  Live server running → http://localhost:${PORT}`);
  await refreshVideos();
});
