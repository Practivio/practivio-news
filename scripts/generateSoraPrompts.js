import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { execSync } from "child_process";

const FULL_DIR = "./content/full";
const OUT_DIR = "./content/sora";
const MODEL = "mistral:instruct";
const INDEX_PAGE = "./index.html";
await fs.promises.mkdir(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOllama(prompt) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.9, num_predict: 900 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data.response || "").trim();
}

// Keep narration concise but natural
function trimNarration(text) {
  const words = text.split(/\s+/);
  if (words.length <= 38) return text.trim();
  const clipped = words.slice(0, 38).join(" ");
  return clipped.replace(/[.,;:]?$/, "") + "...";
}

function buildPrompt(article) {
  const text = article.full_text?.replace(/\s+/g, " ").slice(0, 1200) || "";

  return `
You are a **cinematic Sora 2 video director and TikTok storyteller**.

🎬 Objective:
Create a **motion-filled 9:16 cinematic Sora 2 scene** and a **multi-sentence TikTok description** for this article.

🎥 For the SORA_PROMPT:
- Use active **camera motion** (panning, dolly, tracking, zoom, handheld, drone).
- Visuals must move — no static fades or still frames.
- Be **factually correct** (e.g., space telescope in orbit, not desert).
- No numbered scenes.
- Narration (voice of @lee627) ≤ 38 words, factual, calm tone.
- Never say “Breaking news”.
- End narration with a relevant, natural **call to action** tied to the topic.
  Examples:  
  “Could this reshape how we see the cosmos?”  
  “Would you fly after this?”  
  “How would you respond if this happened near you?”  
  “What do you think happens next?”

🎵 For the TIKTOK_DESC:
- Start with: **“🎵 TikTok Breaking News:” + emoji(s)**  
- Write a **natural 1–3 sentence summary**, not just one line.  
- End with **exactly 5 relevant hashtags**.  
- Do NOT include article metadata or sections — only the summary and hashtags.

Return output exactly like this:

SORA_PROMPT:
Scene:
(description of dynamic, cinematic visuals — motion, light, tone, transitions)
Narration (voice of @lee627):
(short narration ending with a relevant CTA)
---
TIKTOK_DESC:
🎵 TikTok Breaking News: (emoji + multi-sentence summary + 5 hashtags)

ARTICLE (for reference only — do NOT include this in the output):
Title: ${article.title}
Category: ${article.category}
Text: ${text}
`.trim();
}

function buildHomePage(files) {
  const entries = files
    .map((file) => {
      const data = fs.readFileSync(path.join(OUT_DIR, file), "utf8");
      const title = data.match(/^# (.+)/)?.[1] || file.replace(".md", "");
      return `<li><a href="content/sora/${file}">${title}</a></li>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sora 2 Newsroom — Cinematic TikTok Feed</title>
  <style>
    body { font-family: Inter, sans-serif; margin: 2rem; background:#fafafa; color:#111; }
    a { color:#0059ff; text-decoration:none; }
    a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <h1>🎬 Sora 2 Newsroom — AI-Directed Cinematic Clips</h1>
  <ul>${entries}</ul>
  <footer style="margin-top:2rem;font-size:0.9em;color:#555">
    © ${new Date().getFullYear()} Practivio News — Auto-generated with Mistral & Sora 2.
  </footer>
</body>
</html>`;
  fs.writeFileSync(INDEX_PAGE, html);
  console.log(`🏠 Homepage updated → ${INDEX_PAGE}`);
}

async function main() {
  const files = fs.readdirSync(FULL_DIR).filter((f) => f.endsWith(".json"));
  let done = 0;

  for (const file of files) {
    const inPath = path.join(FULL_DIR, file);
    const outPath = path.join(OUT_DIR, file.replace(".json", ".md"));
    if (fs.existsSync(outPath)) continue;

    const article = JSON.parse(fs.readFileSync(inPath, "utf8"));
    console.log(`🎬 Generating cinematic Sora prompt for: ${article.title}`);

    // Generate with retries
    let response = "";
    for (let i = 1; i <= 3; i++) {
      try {
        const prompt = buildPrompt(article);
        response = await runOllama(prompt);
        if (response.length > 100) break;
      } catch (err) {
        console.log(`⚠️ Retry ${i}/3: ${err.message}`);
        await sleep(1500);
      }
    }

    // Retry with shortened article
    if (response.length < 100) {
      console.log("⚠️ Retrying with shorter article context...");
      const shortArticle = { ...article, full_text: article.full_text?.slice(0, 600) || "" };
      const retryPrompt = buildPrompt(shortArticle);
      try {
        response = await runOllama(retryPrompt);
      } catch {
        console.log(`❌ Failed again: ${article.title}`);
        continue;
      }
    }

    // --- Parse outputs
    let soraPart = response.match(/SORA_PROMPT:(.*?)(?:---|TIKTOK_DESC:)/s)?.[1]?.trim() || "";
    let tiktokRaw = response.match(/TIKTOK_DESC:(.*)/s)?.[1]?.trim() || "";

    if (!soraPart && response.includes("TikTok Breaking News")) {
      const idx = response.indexOf("TikTok Breaking News");
      soraPart = response.slice(0, idx).trim();
      tiktokRaw = response.slice(idx).trim();
    }

    if (!soraPart) {
      console.log(`❌ No SORA output for: ${article.title}`);
      continue;
    }

    // --- Clean narration
    const narrationMatch = soraPart.match(/Narration.*?:([\s\S]*)/);
    let soraClean = soraPart;
    if (narrationMatch) {
      const trimmed = trimNarration(narrationMatch[1]);
      soraClean = soraPart.replace(narrationMatch[1], trimmed);
    }

    soraClean = soraClean
      .replace(/\(\d+\)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/(Leave your opinion.*){2,}/gi, "")
      .trim();

    // --- Clean TikTok text
    const hashtags = (tiktokRaw.match(/#[A-Za-z0-9_]+/g) || []).slice(0, 5).join(" ");
    let descText = tiktokRaw.replace(/#[A-Za-z0-9_]+/g, "").trim();

    if (!descText.startsWith("🎵 TikTok Breaking News:")) {
      descText = "🎵 TikTok Breaking News: " + descText;
    }

    const tiktokPart = `${descText} ${hashtags}`.trim();

    // --- Save file
    const formatted = `# ${article.title}

\`\`\`sora
${soraClean}
\`\`\`

\`\`\`tiktok
${tiktokPart}
\`\`\`
`;

    fs.writeFileSync(outPath, formatted);
    done++;
    console.log(`✅ Saved cinematic file → ${outPath}`);
  }

  // --- Homepage
  const outFiles = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".md"));
  buildHomePage(outFiles);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: multi-sentence TikTok summaries + cinematic motion prompts"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log("🚀 Changes pushed to GitHub!");
  } catch {
    console.log("⚠️ No new changes or Git remote not configured.");
  }

  console.log(`\n✅ Finished ${done} cinematic Sora prompts with multi-sentence TikTok summaries.`);
}

main().catch((e) => console.error("❌ Fatal:", e));
