import express from "express";
import fs from "fs-extra";
import axios from "axios";
import os from "os";
import { exec } from "child_process";

const API_KEY = "AIzaSyAdG1Ce4XZbP1P-66AdAWKpcIWweet5hOc";
const OUT_FILE = "./content/videos.json";
const PORT = 3030;

// ---------- Trusted verified sources ----------
const CHANNEL_IDS = {
  FOX: "UCXIJgqnII2ZOINSWNOGFThA",
  CNN: "UCupvZG-5ko_eiXAupbDfxWw",
  BBC: "UC16niRr50-MSBwiO3YDb3RA",
  REUTERS: "UC8p1vwvWtl6T73JiExfWs1g",
  AP: "UCk8Rz2iX4h0otBOr6Vpuweg",
  CBS: "UC8p1vwvWtl6T73JiExfWs1g",
  ABC: "UCBi2mrWuNuyYy4gbM6fU18Q",
  BLOOMBERG: "UCIALMKvObZNtJ6AmdCLP7Lg",
  CSPAN: "UCbR0qg4Qd5MwHdAAp5aBvFw",
  MSNBC: "UCaXkIU1QidjPwiAYu6GcHjg",
  ALJAZEERA: "UCNye-wNBqNL5ZzHSJj3l8Bg",
  ESPN: "UCiWLfSweyRNmLpgEHekhoAg",
  WEATHER: "UCQ5vM2GvthjVx3y5C9Ftb2A"
};

const app = express();

// ---------- Helpers ----------
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
    exec(cmd, { maxBuffer: 1024 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (stdout?.trim()) console.log(stdout.trim());
      if (stderr?.trim()) console.error(stderr.trim());
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

async function ensureBins() {
  await runCommand("command -v yt-dlp");
  await runCommand("command -v ffmpeg");
}

// ---------- Viral Scoring ----------
function scoreVideo(v) {
  const totalMin = parseFloat(v.duration);
  const vpm = v.vpm || 0;
  const views = v.views || 0;
  const ageHours = v.minutesOld / 60;
  const vpmScore = Math.min(vpm / 1000, 1);
  const recencyScore = ageHours < 12 ? 1 : Math.max(0, 1 - (ageHours - 12) / 24);
  const viewBoost = Math.min(Math.log10(views + 1) / 5, 0.3);
  const durationPenalty = totalMin > 5 ? -0.2 : 0;
  return vpmScore * 0.7 + recencyScore * 0.2 + viewBoost * 0.1 + durationPenalty;
}

// ---------- Time Scheduling ----------
function generateUploadTimes(count) {
  const times = [];
  let hour = 21; // start at 9 PM
  const now = new Date();

  for (let i = 0; i < count; i++) {
    hour += 2;
    if (hour === 17) hour = 19; // skip 5–7 PM window
    if (hour >= 24) hour -= 24;

    const scheduled = new Date(now);
    scheduled.setHours(hour, 0, 0, 0);
    times.push(scheduled);
  }

  return times;
}

// ---------- Fetch YouTube Data ----------
async function fetchFromYouTube() {
  const videos = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const [name, id] of Object.entries(CHANNEL_IDS)) {
    try {
      console.log(`🎥 Fetching from ${name}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${id}&part=snippet,id&order=date&maxResults=25`;
      const { data } = await axios.get(searchUrl);
      const videoIds = (data.items || []).map(it => it.id?.videoId).filter(Boolean).join(",");
      if (!videoIds) continue;

      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds}&key=${API_KEY}`;
      const { data: statsData } = await axios.get(statsUrl);

      let bestVideo = null;
      let bestScore = 0;
      let bestByViews = null;
      let maxViews = 0;

      (statsData.items || []).forEach(v => {
        const s = v.statistics || {};
        const published = new Date(v.snippet.publishedAt);
        if (published.getTime() < cutoff) return;

        const dur = v.contentDetails?.duration || "";
        const m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
        const mins = parseInt(m?.[1] || 0, 10);
        const secs = parseInt(m?.[2] || 0, 10);
        const totalMin = mins + secs / 60;
        if (totalMin < 0.5 || totalMin > 10.0) return;

        const views = parseInt(s.viewCount || 0, 10);
        const ageMin = Math.max((Date.now() - published.getTime()) / 60000, 1);
        const vpm = views / ageMin;
        const score = scoreVideo({ duration: totalMin, vpm, views, minutesOld: ageMin });

        if (vpm >= 200 && score > bestScore) {
          bestScore = score;
          bestVideo = v;
        }
        if (views > maxViews) {
          maxViews = views;
          bestByViews = v;
        }
      });

      const pick = bestVideo || bestByViews;
      if (pick) {
        const s = pick.statistics || {};
        const published = new Date(pick.snippet.publishedAt);
        const dur = pick.contentDetails?.duration || "";
        const m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
        const mins = parseInt(m?.[1] || 0, 10);
        const secs = parseInt(m?.[2] || 0, 10);
        const totalMin = mins + secs / 60;
        const views = parseInt(s.viewCount || 0, 10);
        const ageMin = Math.max((Date.now() - published.getTime()) / 60000, 1);
        const vpm = views / ageMin;

        videos.push({
          id: pick.id,
          title: pick.snippet.title.trim(),
          channel: name,
          link: `https://www.youtube.com/watch?v=${pick.id}`,
          embed: `https://www.youtube.com/embed/${pick.id}`,
          thumb: pick.snippet.thumbnails?.medium?.url,
          publishedAt: pick.snippet.publishedAt,
          duration: totalMin.toFixed(1),
          views,
          vpm,
          minutesOld: Math.round(ageMin),
          score: scoreVideo({ duration: totalMin, vpm, views, minutesOld: ageMin }).toFixed(2)
        });
        console.log(
          bestVideo
            ? `🔥 Viral from ${name}: ${pick.snippet.title} (${vpm.toFixed(1)} v/m)`
            : `⭐ Top (fallback) from ${name}: ${pick.snippet.title} (${views.toLocaleString()} views)`
        );
      } else {
        console.log(`⚠️ No recent videos for ${name}`);
      }
    } catch (e) {
      console.log(`⚠️ ${name} failed: ${e.message}`);
    }
  }

  // 🧹 Deduplicate identical stories
  const seen = new Map();
  for (const v of videos) {
    const key = v.title.toLowerCase();
    if (!seen.has(key) || v.score > seen.get(key).score) seen.set(key, v);
  }
  const deduped = Array.from(seen.values());

  // Assign upload times (2-hour spacing, skip 5–7 PM)
  const times = generateUploadTimes(deduped.length);
  deduped.forEach((v, i) => {
    const t = times[i];
    v.uploadTime = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  });

  await fs.outputJson(OUT_FILE, deduped, { spaces: 2 });
  console.log(`✅ Saved ${deduped.length} videos with upload times → ${OUT_FILE}`);
  return deduped;
}

// ---------- Download Route ----------
app.get("/download/:id", async (req, res) => {
  const safeId = req.params.id.replace(/[^a-zA-Z0-9_-]/g, "");
  const data = await fs.readJson(OUT_FILE).catch(() => []);
  const info = data.find(v => v.id === safeId);
  const timeTag = info ? info.uploadTime.replace(/[:\s]/g, "-") : "unknown-time";
  const tag = info ? `${info.channel}_${timeTag}_${info.id}` : safeId;
  const videoUrl = `https://www.youtube.com/watch?v=${safeId}`;
  const tmp = `./tmp/${safeId}.webm`;
  const out = `./downloads/${tag}.mp4`;

  try {
    await ensureBins();
    await fs.ensureDir("./tmp");
    await fs.ensureDir("./downloads");
    await runCommand(`yt-dlp -f "bestvideo+bestaudio/best" -o "${tmp}" "${videoUrl}"`);
    await runCommand(`ffmpeg -hide_banner -loglevel error -y -i "${tmp}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart "${out}"`);
    await fs.remove(tmp);
    res.download(out, `${tag}.mp4`);
  } catch (err) {
    console.error("❌ Download failed:", err);
    res.status(500).send("Failed to download video");
  }
});

// ---------- Homepage ----------
async function buildHome(videos) {
  const cards = videos.map(v => `
    <div class="video-card">
      <iframe src="${v.embed}" allowfullscreen></iframe>
      <h3>${v.channel}</h3>
      <p>${v.title}</p>
      <p>🕒 Upload: ${v.uploadTime} • ⏱️ ${v.duration} min • 👁️ ${v.views.toLocaleString()} views • ⚡ ${v.vpm.toFixed(1)} v/m • 🧮 Score ${v.score}</p>
      <div class="buttons">
        <a class="download" href="/download/${v.id}">⬇️ Download</a>
        <a class="alt" href="${v.link}" target="_blank">▶️ YouTube</a>
      </div>
    </div>`).join("\n");

  const html = `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><title>🔥 Practivio News — Top Stories (Last 24 Hours)</title>
  <style>
  body{font-family:Inter,Arial,sans-serif;margin:2rem;background:#fafafa;color:#111;}
  h1{text-align:center;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1rem;}
  .video-card{background:#fff;padding:1rem;border-radius:10px;box-shadow:0 2px 5px rgba(0,0,0,.1);}
  iframe{width:100%;aspect-ratio:16/9;border:none;border-radius:10px;}
  .buttons{display:flex;gap:.5rem;margin-top:.5rem;}
  .download,.alt{flex:1;text-align:center;text-decoration:none;color:#fff;padding:.4rem;border-radius:6px;}
  .download{background:#0077ff}.alt{background:#00994c}
  .download:hover{background:#005ae0}.alt:hover{background:#007a3b}
  .refresh{display:block;margin:1rem auto;text-align:center;padding:.6rem 1rem;background:#111;color:#fff;text-decoration:none;border-radius:8px;}
  </style></head><body>
  <h1>🔥 Practivio News — Scheduled Top Stories (Last 24 Hours)</h1>
  <a class="refresh" href="/refresh">🔄 Refresh Feed</a>
  <div class="grid">${cards}</div>
  </body></html>`;
  await fs.outputFile("./index.html", html);
  console.log(`🏠 Homepage updated with ${videos.length} scheduled stories`);
}

// ---------- Deploy ----------
async function deploySite() {
  try {
    await runCommand("git add .");
    await runCommand(`git commit -m "Auto-update top videos ${new Date().toISOString()}"`);
    await runCommand("git push origin main");
  } catch (err) {
    console.error("❌ Git push failed:", err);
  }
}

// ---------- Server ----------
app.use(express.static("."));
app.get("/refresh", async (req, res) => {
  const vids = await fetchFromYouTube();
  await buildHome(vids);
  await deploySite();
  res.redirect("/");
});

// ---------- Start ----------
async function start() {
  const localIP = getLocalIP();
  const vids = await fetchFromYouTube();
  await buildHome(vids);
  await deploySite();
  await fs.ensureDir("./downloads");
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Local → http://localhost:${PORT}`);
    console.log(`📱 Phone → http://${localIP}:${PORT}`);
  });
}
start();
