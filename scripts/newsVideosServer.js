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
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const [name, id] of Object.entries(CHANNEL_IDS)) {
    try {
      console.log(`🎥 Fetching from ${name}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${id}&part=snippet,id&order=date&maxResults=15`;
      const { data } = await axios.get(searchUrl);

      const items = data.items.filter(
        (it) => it.id.videoId && new Date(it.snippet.publishedAt).getTime() > cutoff
      );
      const videoIds = items.map((it) => it.id.videoId).join(",");
      if (!videoIds) continue;

      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
      const { data: statsData } = await axios.get(statsUrl);

      statsData.items.forEach((v) => {
        const s = v.statistics || {};
        const views = parseInt(s.viewCount || 0);
        const published = new Date(v.snippet.publishedAt);
        const minutesOld = Math.max(
          (Date.now() - published.getTime()) / (1000 * 60),
          1
        );
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
  const unique = videos.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  // Sort by views per minute (descending)
  unique.sort((a, b) => b.vpm - a.vpm);

  await fs.outputJson(OUT_FILE, unique, { spaces: 2 });
  console.log(`✅ Saved ${unique.length} fresh videos → ${OUT_FILE}`);
  return unique;
}

// -------- Download Route ----------
app.get("/download/:id", async (req, res) => {
  const { id } = req.params;
  const url = `https://www.youtube.com/watch?v=${id}`;
  const dir = "./downloads";
  const rawPath = `${dir}/${id}.mp4`;
  const fixedPath = `${dir}/${id}_fixed.mp4`;

  await fs.ensureDir(dir);
  console.log(`⬇️ Downloading ${url} ...`);

  exec(`yt-dlp -f mp4 -o "${rawPath}" "${url}"`, (err) => {
    if (err) {
      console.error(`❌ Download failed for ${id}: ${err.message}`);
      return res.status(500).send("Download failed.");
    }

    exec(
      `ffmpeg -y -i "${rawPath}" -c:v libx264 -c:a aac -movflags +faststart "${fixedPath}"`,
      (convErr) => {
        if (convErr) {
          console.error(`⚠️ FFmpeg failed: ${convErr.message}`);
          return res.download(rawPath, `${id}.mp4`);
        }
        res.download(fixedPath, `${id}.mp4`, () => {
          setTimeout(() => {
            fs.remove(rawPath).catch(() => {});
            fs.remove(fixedPath).catch(() => {});
          }, 5000);
        });
      }
    );
  });
});

// -------- Build homepage ----------
async function buildHome(videos) {
  const cards = videos
    .map((v) => {
      const views = v.views || 0;
      const vpm = v.vpm?.toFixed(2) || "0.00";
      const ageHrs = (v.minutesOld / 60).toFixed(1);
      return `
      <div class="video-card">
        <iframe src="${v.embed}" allowfullscreen></iframe>
        <p><strong>${v.channel}</strong>: ${v.title}</p>
        <p>👁️ ${views.toLocaleString()} views • ⚡ ${vpm} views/min • ⏰ ${ageHrs} h old</p>
        <div class="buttons">
          <a class="download" href="/download/${v.id}" target="_blank">⬇️ Download</a>
          <a class="alt" href="${v.link}" target="_blank">▶️ Watch on YouTube</a>
        </div>
      </div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Practivio News — Trending Now (Last 24 h)</title>
<style>
body{font-family:Inter,Arial,sans-serif;margin:2rem;background:#fafafa;color:#111;}
h1{text-align:center;}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;}
.video-card{background:#fff;border-radius:10px;padding:1rem;box-shadow:0 2px 5px rgba(0,0,0,0.1);}
iframe{width:100%;aspect-ratio:16/9;border-radius:10px;border:none;}
.buttons{display:flex;gap:0.5rem;margin-top:0.5rem;}
.download,.alt{flex:1;text-align:center;text-decoration:none;color:white;padding:0.4rem 0.8rem;border-radius:6px;}
.download{background:#0077ff;}
.alt{background:#00994c;}
.download:hover{background:#005ae0;}
.alt:hover{background:#007a3b;}
.refresh{display:block;width:fit-content;margin:1rem auto;padding:0.6rem 1rem;background:#111;color:#fff;text-decoration:none;border-radius:8px;}
.refresh:hover{background:#333;}
</style>
</head>
<body>
<h1>🔥 Practivio News — Most Viral Now (Views per Minute)</h1>
<a class="refresh" href="/refresh">🔄 Refresh Feed</a>
<div class="grid">
${cards || "<p>No new uploads found in the last 24 hours.</p>"}
</div>
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
    await runCommand("git push origin main"); // change branch name if needed
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
