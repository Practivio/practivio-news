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

let lastFetchTime = Date.now();

async function fetchFromYouTube() {
  const videos = [];
  const cutoff = Date.now() - (60 * 60 * 1000); // last hour

  for (const [name, id] of Object.entries(CHANNEL_IDS)) {
    try {
      console.log(`🎥 Fetching from ${name}`);
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${id}&part=snippet,id&order=date&maxResults=15`;
      const { data } = await axios.get(searchUrl);

      const items = data.items.filter(
        it => it.id.videoId
              && new Date(it.snippet.publishedAt).getTime() > cutoff
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

  const seen = new Set();
  const unique = videos.filter(v => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });

  unique.sort((a, b) => b.vpm - a.vpm);

  await fs.outputJson(OUT_FILE, unique, { spaces: 2 });
  console.log(`✅ Saved ${unique.length} fresh videos → ${OUT_FILE}`);
  return unique;
}

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

async function buildHome(videos) {
  const tickerItems = videos.slice(0,10).map(v => `${v.channel}: ${v.title}`).join(" • ");

  const cards = videos.map(v => {
    const views = v.views || 0;
    const vpm = v.vpm?.toFixed(2) || "0.00";
    const ageMins = v.minutesOld;
    return `
      <article class="news-item">
        <iframe src="${v.embed}" allowfullscreen></iframe>
        <h2>${v.title}</h2>
        <p class="meta">${v.channel} • ${ageMins} min ago</p>
        <p class="stats">👁️ ${views.toLocaleString()} views • ⚡ ${vpm} views/min</p>
        <div class="buttons">
          <a class="watch-link" href="${v.link}" target="_blank">▶️ Watch on YouTube</a>
          <a class="download-link" href="/download/${v.id}" target="_blank">⬇️ Download</a>
        </div>
      </article>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Practivio News — Live Feed (Last Hour)</title>
  <style>
    body { font-family:"Georgia","Times New Roman",serif; background:#fff; color:#111; margin:0; padding:0; }
    .ticker { background:#cc0000; color:#fff; font-size:0.9rem; overflow:hidden; white-space:nowrap; padding:0.5rem 2rem; }
    .ticker .ticker-text { display:inline-block; animation: scrollTicker 40s linear infinite; }
    @keyframes scrollTicker {
      0%   { transform: translateX(100%); }
      100% { transform: translateX(-100%); }
    }
    header { background:#f8f8f8; padding:1rem 2rem; border-bottom:1px solid #e1e1e1; }
    header h1 { margin:0; font-size:2rem; }
    header .refresh { display:inline-block; margin-top:0.5rem; padding:0.4rem 1rem; background:#0077ff; color:#fff; text-decoration:none; border-radius:4px; }
    main { max-width:900px; margin:2rem auto; padding:0 1rem; }
    .news-item { margin-bottom:2rem; border-bottom:1px solid #eaeaea; padding-bottom:2rem; }
    .news-item iframe { width:100%; aspect-ratio:16/9; border:none; margin-bottom:1rem; }
    .news-item h2 { margin:0 0 0.5rem; font-size:1.4rem; line-height:1.4; }
    .news-item .meta { color:#666; font-size:0.9rem; margin:0 0 0.5rem; }
    .news-item .stats { color:#666; font-size:0.9rem; margin:0 0 1rem; }
    .buttons { display:flex; gap:0.5rem; margin-top:0.5rem; }
    .watch-link, .download-link {
      flex:1; text-align:center; text-decoration:none; padding:0.6rem 1rem; border-radius:4px; color:#fff;
    }
    .watch-link { background:#0077ff; }
    .download-link { background:#00994c; }
    .watch-link:hover { background:#005ae0; }
    .download-link:hover { background:#007a3b; }
    footer { text-align:center; margin:3rem 0; font-size:0.8rem; color:#999; }
    @media (max-width:768px) {
      header h1 { font-size:1.5rem; }
    }
  </style>
</head>
<body>
  <div class="ticker"><div class="ticker-text">${tickerItems}</div></div>
  <header>
    <h1>🔥 Practivio News — Most Viral Now (Last Hour)</h1>
    <a class="refresh" href="/refresh">🔄 Refresh Feed</a>
  </header>
  <main>
    ${cards || "<p>No new uploads in the last hour.</p>"}
  </main>
  <footer><p>Updated at ${new Date().toLocaleString()}</p></footer>
</body>
</html>`;

  await fs.outputFile("./index.html", html);
  console.log(`🏠 Homepage updated with ${videos.length} videos`);
}

async function deploySite() {
  console.log("📦 Deploying site…");
  try {
    await runCommand("git add .");
    await runCommand(`git commit -m "Auto-update site ${new Date().toISOString()}"`);
    await runCommand("git push origin main");
    console.log("✅ Git push succeeded");
  } catch (err) {
    console.error("❌ Git push failed:", err);
  }
}

app.use(express.static("."));
app.get("/refresh", async (req, res) => {
  const videos = await fetchFromYouTube();
  await buildHome(videos);
  await deploySite();
  res.redirect("/");
});

async function pollLoop() {
  const videos = await fetchFromYouTube();
  await buildHome(videos);
  await deploySite();
  lastFetchTime = Date.now();
}

async function start() {
  const localIP = getLocalIP();
  await fs.ensureDir("./downloads");

  await pollLoop();
  setInterval(pollLoop, 5 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Local → http://localhost:${PORT}`);
    console.log(`📱 Phone → http://${localIP}:${PORT}`);
  });
}

start();
