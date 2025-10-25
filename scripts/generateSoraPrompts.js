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
You are a **cinematic Sora 2 video director and short-form news storyteller**.

🎯 Goal:
Create a visually engaging **motion-filled 9:16 cinematic clip** inspired by the article below.  
You have creative freedom to choose camera style, pacing, tone, and transitions — as long as the visuals move and feel alive. Avoid still images fading or static scenes.

🎥 Guidelines:
- Use **continuous motion** (e.g., panning over screens, spacecraft adjusting, crowds moving, light reflections).
- Be **factually accurate** — if the subject exists in space (e.g., JWST), depict it in orbit, not on Earth.
- You may use creative cuts, lighting, atmosphere, or symbolic transitions.
- Avoid numbered scenes (no "(1)", "(2)", "(3)").
- Narration: ≤ 38 words, spoken naturally by @lee627.
- Never say “Breaking news”.
- End narration with a **context-appropriate call to action** fitting the article theme  
  (e.g., "Could this rewrite what we know?", "What do you think it means for travelers?", "Would you see this film?", "How far could this technology go?").

🎬 Output format:
SORA_PROMPT:
Scene:
(describe connected motion-filled visuals — camera movements, atmosphere, lighting, and tone)
Narration (voice of @lee627):
(short narration with contextual CTA)

---
TIKTOK_DESC:
(short, factual TikTok summary + exactly 5 relevant hashtags)

ARTICLE:
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

    // Fallback retry with shortened text
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

    // --- Extract parts
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

    // --- Hashtags
    const hashtags = (tiktokRaw.match(/#[A-Za-z0-9_]+/g) || []).slice(0, 5).join(" ");
    const descText = tiktokRaw.replace(/#[A-Za-z0-9_]+/g, "").trim();
    const tiktokPart = `${descText} ${hashtags}`.trim();

    // --- Save
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
    execSync('git commit -m "auto: updated cinematic freeform Sora prompts"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log("🚀 Changes pushed to GitHub!");
  } catch {
    console.log("⚠️ No new changes or Git remote not configured.");
  }

  console.log(`\n✅ Finished ${done} cinematic Sora prompts with adaptive storytelling.`);
}

main().catch((e) => console.error("❌ Fatal:", e));
