import express from "express";
import fs from "fs-extra";
import axios from "axios";
import os from "os";
import { exec } from "child_process";

const API_KEY = "AIzaSyAdG1Ce4XZbP1P-66AdAWKpcIWweet5hOc";
const OUT_FILE = "./content/videos.json";
const PORT = 3030;

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

function scoreVideo(v) {
  const totalMin = parseFloat(v.duration);
  const vpm = v.vpm || 0;
  const views = v.views || 0;
  const ageHours = v.minutesOld / 60;
  const vpmScore = Math.min(vpm / 1000, 1);
  const recencyScore = ageHours < 12 ? 1 : Math.max(0, 1 - (ageHours - 12) / 24);
  const viewBoost = Math.min(Math.log10(views + 1) / 5, 0.3);
  const durationPenalty = totalMin > 8 ? -0.2 : 0;
  return vpmScore * 0.7 + recencyScore * 0.2 + viewBoost * 0.1 + durationPenalty;
}

// ---------- Time Scheduling ----------
function generateUploadTimes(count) {
  const times = [];
  const startHour = 9;
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const scheduled = new Date(now);
    scheduled.setHours(startHour + i * 2, 0, 0, 0);
    times.push(scheduled);
  }
  return times.slice(0, 12);
}

// ---------- Fetch YouTube Data ----------
async function fetchFromYouTube() {
  const allChannelVideos = {};

  // 🕘 Only include videos published since 9 PM last night
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getHours() < 21 ? now.getDate() - 1 : now.getDate());
  cutoff.setHours(21, 0, 0, 0);
  const cutoffTime = cutoff.getTime();
  console.log(`📅 Filtering videos newer than ${cutoff.toLocaleString()}`);

  for (const [name, id] of Object.entries(CHANNEL_IDS)) {
    try {
      console.log(`🎥 Fetching from ${name}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${id}&part=snippet,id&order=date&maxResults=25`;
      const { data } = await axios.get(searchUrl);
      const videoIds = (data.items || []).map(it => it.id?.videoId).filter(Boolean).join(",");
      if (!videoIds) continue;

      const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails,id&key=${API_KEY}&id=${videoIds}`;
      const { data: statsData } = await axios.get(statsUrl);

      const channelVideos = [];

      (statsData.items || []).forEach(v => {
        const s = v.statistics || {};
        const snip = v.snippet || {};
        const published = new Date(snip.publishedAt);
        if (published.getTime() < cutoffTime) return;

        const dur = v.contentDetails?.duration || "";
        const m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
        const mins = parseInt(m?.[1] || 0, 10);
        const secs = parseInt(m?.[2] || 0, 10);
        const totalMin = mins + secs / 60;

        // ✅ Must be between 3 and 10 minutes exactly
        if (totalMin < 3.0 || totalMin > 10.0) return;

        const thumb = snip.thumbnails?.medium;
        const w = thumb?.width || 0;
        const h = thumb?.height || 0;
        const aspect = w && h ? w / h : 16 / 9;

        const t = (snip.title + " " + (snip.description || "")).toLowerCase();

        // 🚫 Skip Shorts / social-media / vertical content
        if (
          t.includes("#short") ||
          t.includes("shorts") ||
          t.includes("tiktok") ||
          t.includes("reel") ||
          t.includes("clip") ||
          aspect < 1.4
        )
          return;

        const views = parseInt(s.viewCount || 0, 10);
        const ageMin = Math.max((Date.now() - published.getTime()) / 60000, 1);
        const vpm = views / ageMin;
        const score = scoreVideo({ duration: totalMin, vpm, views, minutesOld: ageMin });

        channelVideos.push({
          id: v.id,
          title: snip.title.trim(),
          channel: name,
          link: `https://www.youtube.com/watch?v=${v.id}`,
          embed: `https://www.youtube.com/embed/${v.id}`,
          thumb: thumb?.url,
          publishedAt: snip.publishedAt,
          duration: totalMin.toFixed(1),
          views,
          vpm,
          minutesOld: Math.round(ageMin),
          score
        });
      });

      allChannelVideos[name] = channelVideos.sort((a, b) => b.score - a.score);
      console.log(`✅ ${name}: ${channelVideos.length} valid 3–10 min videos`);
    } catch (e) {
      console.log(`⚠️ ${name} failed: ${e.message}`);
    }
  }

  // 🧹 Remove near-duplicate stories across all channels
  const normalize = str =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .slice(0, 6)
      .join(" ");
  const seen = new Set();
  for (const name of Object.keys(allChannelVideos)) {
    allChannelVideos[name] = allChannelVideos[name].filter(v => {
      const key = normalize(v.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 🌀 Round-robin pick up to 12
  const selected = [];
  let rank = 0;
  while (selected.length < 12) {
    for (const name of Object.keys(allChannelVideos)) {
      const vid = allChannelVideos[name]?.[rank];
      if (vid) selected.push(vid);
      if (selected.length >= 12) break;
    }
    rank++;
    if (rank > 10) break;
  }

  const times = generateUploadTimes(selected.length);
  selected.forEach((v, i) => {
    const t = times[i];
    v.uploadTime = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    v.score = v.score.toFixed(2);
  });

  await fs.outputJson(OUT_FILE, selected, { spaces: 2 });
  console.log(`✅ Saved ${selected.length} 3–10 min videos → ${OUT_FILE}`);
  return selected;
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
    await runCommand(
      `ffmpeg -hide_banner -loglevel error -y -i "${tmp}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart "${out}"`
    );
    await fs.remove(tmp);
    res.download(out, `${tag}.mp4`);
  } catch (err) {
    console.error("❌ Download failed:", err);
    res.status(500).send("Failed to download video");
  }
});

// ---------- Homepage ----------
async function buildHome(videos) {
  const cards = videos
    .map(
      v => `
    <div class="video-card">
      <iframe src="${v.embed}" allowfullscreen></iframe>
      <h3>${v.channel}</h3>
      <p>${v.title}</p>
      <p>🕒 Upload: ${v.uploadTime} • ⏱️ ${v.duration} min • 👁️ ${v.views.toLocaleString()} views • ⚡ ${v.vpm.toFixed(
        1
      )} v/m • 🧮 Score ${v.score}</p>
      <div class="buttons">
        <a class="download" href="/download/${v.id}">⬇️ Download</a>
        <a class="alt" href="${v.link}" target="_blank">▶️ YouTube</a>
      </div>
    </div>`
    )
    .join("\n");

  const html = `<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><title>🔥 Practivio News — 3–10 Minute Stories</title>
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
  <h1>🔥 Practivio News — 3–10 Minute Top Stories (9 AM → 9 PM)</h1>
  <a class="refresh" href="/refresh">🔄 Refresh Feed</a>
  <div class="grid">${cards}</div>
  </body></html>`;
  await fs.outputFile("./index.html", html);
  console.log(`🏠 Homepage updated with ${videos.length} scheduled stories`);
}

async function deploySite() {
  try {
    await runCommand("git add .");
    await runCommand(`git commit -m "Auto-update top videos ${new Date().toISOString()}"`);
    await runCommand("git push origin main");
  } catch (err) {
    console.error("❌ Git push failed:", err);
  }
}

app.use(express.static("."));
app.get("/refresh", async (req, res) => {
  const vids = await fetchFromYouTube();
  await buildHome(vids);
  await deploySite();
  res.redirect("/");
});

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
