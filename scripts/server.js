// scripts/server.js
import express from "express";
import ytdl from "ytdl-core";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3030;

app.use(express.static(path.resolve("./")));

app.get("/download", async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).send("Invalid YouTube URL");
  }

  try {
    const info = await ytdl.getInfo(videoUrl);
    const title = info.videoDetails.title.replace(/[^\w\s-]/g, "").slice(0, 50);
    res.header("Content-Disposition", \`attachment; filename="\${title}.mp4"\`);
    ytdl(videoUrl, { quality: "highestvideo" }).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).send("Download failed");
  }
});

app.listen(PORT, () => {
  console.log(\`🚀 Server running → http://localhost:\${PORT}\`);
});
