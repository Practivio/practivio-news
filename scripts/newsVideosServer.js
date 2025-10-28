import express from "express";
import fs from "fs-extra";
import axios from "axios";
import os from "os";
import { exec } from "child_process";

const API_KEY = "AIzaSyAdG1Ce4XZbP1P-66AdAWKpcIWweet5hOc";
const OUT_FILE = "./content/videos.json";
const PORT = 3030;

const CHANNEL_IDS = {
  CNN: "UCupvZG-5ko_eiXAupbDfxWw",
  BBC: "UC16niRr50-MSBwiO3YDb3RA",
  FOX: "UCXIJgqnII2ZOINSWNOGFThA",
  REUTERS: "UC8p1vwvWtl6T73JiExfWs1g",
  AP: "UCk8Rz2iX4h0otBOr6Vpuweg",
  CBS: "UC8p1vwvWtl6T73JiExfWs1g",
  ESPN: "UCiWLfSweyRNmLpgEHekhoAg",
};

const app = express();

// -------- Helpers ----------
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    console.log(`> ${cmd}`);
    exec(cmd, (err, stdout, stderr) => {
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());
      if (err) {
        console.error(`❌ Error running command: ${cmd}`);
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

// -------- Fetch from YouTube API ----------
async function fetchFromYouTube() {
  const videos = [];
  const cutoff = Date.now() - (60 * 60 * 1000); // one hour ago

  for (const [name, id] of Object.entries(CHANNEL_IDS)) {
    try {
      console.log(`🎥 Fetching from ${name}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${id}&part=snippet,id&order=date&maxResults=15`;
      const { data } = await axios.get(searchUrl);

      const items = data.items.filter(
        it => it.id.videoId && new Date(it.snippet.publishedAt).getTime() > cutoff
      );
      const videoIds = items.map(it => it.id.videoId).join(",");
      if (!videoIds) continue;

      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
      const { data: statsData } = await axios.get(statsUrl);

      statsData.items.forEach(v => {
        const s = v.statistics || {};
        const views = parseInt(s.viewCount || 0);
        const published = new Date(v.snippet.publishedAt);
        const minutesOld = Math.max((Date.now() - published.getTime()) / (1000 * 60), 1);
        const vpm = views / minutesOld;

        videos.push({
          title: v.snippet.title,
          id: v.id,
          embed: `https://www.youtube.com/embed/${v.id}`,
          thumb: v.snippet.thumbnails.medium.url,
          channel: name,
          link: `https://www.youtube.com/watch?v=${v.id}`,
          publishedAt: v.snippet.publishedAt,
          views,
          vpm,
          minutesOld: Math.round(minutesOld),
        });
      });

    } catch (err) {
      console.log(`⚠️ ${name} failed: ${err.message}`);
    }
  }

  // Remove duplicates
  const seen = new Set();
  const unique = videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  // Sort by views/minute (descending)
  unique.sort((a, b) => b.vpm - a.vpm);

  await fs.outputJson(OUT_FILE, unique, { spaces: 2 });
  console.log(`✅ Saved ${unique.length} fresh videos → ${OUT_FILE}`);
  return unique;
}

// -------- Download Route (unchanged) ----------
app.get("/download/:id", async (req, res) => {
  const { id } = req.params;
  const url = `https://www.youtube.com/watch?v=${id}`;
  console.log(`⬇️ Downloading ${url} …`);
  exec(`yt-dlp -f mp4 -o "./downloads/${id}.mp4" "${url}"`, err => {
    if (err) {
      console.error(`❌ Download failed for ${id}: ${err.message}`);
      return res.status(500).send("Download failed.");
    }
    const fixedPath = `./downloads/${id}_fixed.mp4`;
    exec(`ffmpeg -y -i "./downloads/${id}.mp4" -c:v libx264 -c:a aac -movflags +faststart "${fixedPath}"`, convErr => {
      if (convErr) {
        console.error(`⚠️ FFmpeg failed: ${convErr.message}`);
        return res.download(`./downloads/${id}.mp4`, `${id}.mp4`);
      }
      res.download(fixedPath, `${id}.mp4`, () => {
        setTimeout(() => {
          fs.remove(`./downloads/${id}.mp4`).catch(()=>{});
          fs.remove(fixedPath).catch(()=>{});
        }, 5000);
      });
    });
  });
});

// -------- Build homepage (modern-style) ----------
async function buildHome(videos) {
  const cards = videos.map(v => {
    const views = v.views || 0;
    const vpm = v.vpm?.toFixed(2) || "0.00";
    const ageMins = v.minutesOld;
    return `
      <article class="video-card">
        <iframe src="${v.embed}" allowfullscreen></iframe>
        <div class="info">
          <h2>${v.title}</h2>
          <p class="meta"><span class="channel">${v.channel}</span> • <span class="age">${ageMins} min ago</span></p>
          <p class="stats">👁️ ${views.toLocaleString()} views • ⚡ ${vpm} views/min</p>
          <a class="watch-btn" href="${v.link}" target="_blank">▶️ Watch on YouTube</a>
        </div>
      </article>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Practivio News — Trending Now (Last Hour)</title>
<style>
body {
  font-family: "Inter", Arial, sans-serif;
  margin: 0;
  background: #f4f4f5;
  color: #111;
}
header {
  background: #fff;
  padding: 1rem 2rem;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
header h1 {
  margin: 0;
  font-size: 1.8rem;
}
.refresh {
  display: inline-block;
  margin: 0.5rem 2rem;
  padding: 0.5rem 1rem;
  background: #111;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
}
main {
  max-width: 1200px;
  margin: 1rem auto;
  padding: 0 1rem;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.5rem;
}
.video-card {
  background: #fff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  display: flex;
  flex-direction: column;
}
.video-card iframe {
  width: 100%;
  aspect-ratio: 16/9;
  border: none;
}
.video-card .info {
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.video-card .info h2 {
  margin: 0 0 0.5rem;
  font-size: 1.2rem;
}
.video-card .info .meta {
  color: #555;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}
.video-card .info .stats {
  color: #555;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
.video-card .info .watch-btn {
  margin-top: auto;
  align-self: start;
  padding: 0.6rem 1rem;
  background: #0077ff;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
}
.video-card .info .watch-btn:hover {
  background: #005ae0;
}
footer {
  text-align: center;
  padding: 2rem 1rem;
  color: #777;
}
</style>
</head>
<body>
<header>
  <h1>🔥 Practivio News — Most Viral Now (Last Hour)</h1>
  <a class="refresh" href="/refresh">🔄 Refresh Feed</a>
</header>
<main>
  <div class="grid">
    ${cards || "<p>No new uploads in the last hour.</p>"}
  </div>
</main>
<footer>
  <p>Updated at ${new Date().toLocaleString()}</p>
</footer>
</body>
</html>`;

  await fs.outputFile("./index.html", html);
  console.log(`🏠 Homepage updated with ${videos.length} videos`);
}

// -------- Deploy step (including git) ----------
async function deploySite() {
  console.log("📦 Deploying site…");
  try {
    await runCommand("git add .");
    await runCommand(`git commit -m "Auto-update site with latest videos ${new Date().toISOString()}"`);
    await runCommand("git push origin main");
    console.log("✅ Git push succeeded");
  } catch (err) {
    console.error("❌ Git push failed:", err);
  }
}

// -------- Express server ----------
app.use(express.static("."));
app.get("/refresh", async (req, res) => {
  const videos = await fetchFromYouTube();
  await buildHome(videos);
  await deploySite();
  res.redirect("/");
});

// -------- Start ----------
async function start() {
  const localIP = getLocalIP();
  const videos = await fetchFromYouTube();
  await buildHome(videos);
  await deploySite();
  await fs.ensureDir("./downloads");

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Local → http://localhost:${PORT}`);
    console.log(`📱 Phone → http://${localIP}:${PORT}`);
  });
}

start();
