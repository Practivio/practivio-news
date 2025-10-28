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
          // category tagging logic could go here, default to “News”
          category: "News"
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
  // Split categories
  const cats = { News: [], Sports: [], Tech: [] };
  videos.forEach(v => {
    if (cats[v.category]) cats[v.category].push(v);
    else cats["News"].push(v);
  });

  // Hero (top story)
  const hero = videos[0];
  const heroHtml = hero ? `
    <section class="hero">
      <iframe src="${hero.embed}" allowfullscreen></iframe>
      <div class="hero-info">
        <h1>${hero.title}</h1>
        <p class="meta">${hero.channel} • ${hero.minutesOld} min ago</p>
      </div>
    </section>` : "";

  const sectionHtml = Object.entries(cats).map(([catName, arr]) => {
    const list = arr.map(v => `
      <article class="news-item">
        <iframe src="${v.embed}" allowfullscreen></iframe>
        <h2>${v.title}</h2>
        <p class="meta">${v.channel} • ${v.minutesOld} min ago</p>
        <p class="stats">👁️ ${v.views.toLocaleString()} views • ⚡ ${v.vpm.toFixed(2)} vpm</p>
        <a class="watch-link" href="${v.link}" target="_blank">▶️ Watch on YouTube</a>
      </article>`).join("\n");
    return `<section class="section-block"><h2>${catName}</h2>${list}</section>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Practivio News — Live Feed</title>
  <style>
    body { font-family:"Georgia","Times New Roman",serif; background:#fff; color:#111; margin:0; padding:0; }
    .ticker { background:#cc0000; color:#fff; font-size:0.9rem; padding:0.5rem 2rem; }
    .ticker span { margin-right:2rem; }
    header { background:#f8f8f8; padding:1rem 2rem; border-bottom:1px solid #e1e1e1; }
    header nav a { margin-right:1.5rem; text-decoration:none; color:#0077ff; font-size:1rem; }
    .hero { position:relative; }
    .hero iframe { width:100%; aspect-ratio:16/9; }
    .hero-info { padding:1rem 2rem; background:#fafafa; }
    .hero-info h1 { margin:0; font-size:2.5rem; line-height:1.2; }
    .hero-info .meta { color:#666; font-size:0.9rem; margin-0.5rem 0; }
    .section-block { max-width:900px; margin:2rem auto; padding:0 1rem; }
    .section-block h2 { border-bottom:2px solid #e1e1e1; padding-0 0 0.5rem; font-size:1.8rem; }
    .news-item { margin-2rem 0; }
    .news-item iframe { width:100%; aspect-ratio:16/9; border:none; margin-0 0 1rem; }
    .news-item h2 { margin:0 0 0.5rem; font-size:1.3rem; line-height:1.3; }
    .news-item .meta { color:#666; font-size:0.9rem; margin:0 0 0.5rem; }
    .news-item .stats { color:#666; font-size:0.9rem; margin:0 0 1rem; }
    .watch-link { font-size:1rem; color:#0077ff; text-decoration:none; }
    .watch-link:hover { text-decoration:underline; }
    footer { text-align:center; margin:3rem 0; font-size:0.8rem; color:#999; }
    @media (max-width:768px) {
      .hero-info h1 { font-size:1.8rem; }
      header nav a { display:block; margin-0.5rem 0; }
    }
  </style>
</head>
<body>
  <div class="ticker"><span>BREAKING:</span> Latest updates from major news outlets</div>
  <header>
    <nav><a href="#News">News</a><a href="#Sports">Sports</a><a href="#Tech">Tech</a></nav>
  </header>
  ${heroHtml}
  <main>
    ${sectionHtml}
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

  // initial run
  await pollLoop();

  // poll every 5 minutes
  setInterval(pollLoop, 5 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Local → http://localhost:${PORT}`);
    console.log(`📱 Phone → http://${localIP}:${PORT}`);
  });
}

start();
