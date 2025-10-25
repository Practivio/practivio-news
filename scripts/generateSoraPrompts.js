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

function trimNarration(text) {
  const words = text.split(/\s+/);
  if (words.length <= 38) return text.trim();
  return words.slice(0, 38).join(" ") + "...";
}

function buildPrompt(article) {
  const text = article.full_text?.replace(/\s+/g, " ").slice(0, 1200) || "";

  return `
You are a **cinematic Sora 2 video director and TikTok storyteller**.

🎬 Objective:
Create a **motion-filled 9:16 cinematic Sora 2 scene** and a **multi-sentence TikTok description** for this article.

🎥 For the SORA_PROMPT:
- Use active camera motion (panning, dolly, tracking, zoom, handheld, drone).
- Visuals must move — no static fades or still frames.
- Be factually correct (e.g., telescopes in orbit, not desert).
- No numbered scenes.
- Narration (voice of @lee627) ≤ 38 words, calm factual tone.
- Never say “Breaking news”.
- End narration with a relevant, natural call to action tied to the topic.

🎵 For the TIKTOK_DESC:
- Start with: 🎵 TikTok Breaking News: + emojis
- Write a 1–3 sentence summary, natural tone.
- End with exactly 5 relevant hashtags.

Return output exactly like this:

SORA_PROMPT:
Scene:
(description of moving cinematic visuals)
Narration (voice of @lee627):
(short narration ending with a relevant CTA)
---
TIKTOK_DESC:
🎵 TikTok Breaking News: (emoji + summary + 5 hashtags)

ARTICLE (for reference only — do NOT include this in the output):
Title: ${article.title}
Category: ${article.category}
Text: ${text}
`.trim();
}

// 🔥 New interactive homepage generator
function buildHomePage(files) {
  const articles = files.map((file) => {
    const data = fs.readFileSync(path.join(OUT_DIR, file), "utf8");
    const title = data.match(/^# (.+)/)?.[1] || file.replace(".md", "");
    const sora = data.match(/```sora([\s\S]*?)```/i)?.[1]?.trim() || "";
    const tiktok = data.match(/```tiktok([\s\S]*?)```/i)?.[1]?.trim() || "";
    return { file, title, sora, tiktok };
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Sora 2 Newsroom — Cinematic TikTok Feed</title>
<style>
  body { font-family: Inter, sans-serif; background:#fafafa; color:#111; margin:2rem; }
  h1 { margin-bottom:1.5rem; }
  .card { background:#fff; border:1px solid #ddd; border-radius:12px; padding:1rem 1.5rem; margin-bottom:1.5rem; box-shadow:0 2px 6px rgba(0,0,0,0.05); position:relative; }
  .title { font-size:1.2rem; font-weight:600; margin-bottom:0.4rem; }
  .checkbox { position:absolute; top:14px; right:14px; }
  pre { background:#111; color:#fff; padding:0.75rem; border-radius:8px; white-space:pre-wrap; }
  button.copy { background:#007bff; color:#fff; border:none; border-radius:6px; padding:4px 10px; font-size:0.8rem; cursor:pointer; float:right; }
  button.copy:hover { background:#0059ff; }
  .used { opacity:0.55; }
</style>
</head>
<body>
<h1>🎬 Sora 2 Newsroom — Cinematic TikTok Feed</h1>
<div id="articles"></div>

<script>
  const articles = ${JSON.stringify(articles, null, 2)};
  const used = JSON.parse(localStorage.getItem("usedArticles") || "{}");
  const container = document.getElementById("articles");

  for (const a of articles) {
    const card = document.createElement("div");
    card.className = "card" + (used[a.file] ? " used" : "");
    const soraId = "sora-" + a.file;
    const tiktokId = "tiktok-" + a.file;

    card.innerHTML = \`
      <input type="checkbox" class="checkbox" \${used[a.file] ? "checked" : ""}>
      <div class="title">\${a.title}</div>
      <p><b>Sora Prompt</b> <button class="copy" data-target="\${soraId}">Copy</button></p>
      <pre id="\${soraId}">\${a.sora}</pre>
      <p><b>TikTok Description</b> <button class="copy" data-target="\${tiktokId}">Copy</button></p>
      <pre id="\${tiktokId}">\${a.tiktok}</pre>
    \`;

    const checkbox = card.querySelector(".checkbox");
    checkbox.addEventListener("change", () => {
      used[a.file] = checkbox.checked;
      localStorage.setItem("usedArticles", JSON.stringify(used));
      card.classList.toggle("used", checkbox.checked);
    });

    card.querySelectorAll("button.copy").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        navigator.clipboard.writeText(target.innerText);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      });
    });

    container.appendChild(card);
  }
</script>

<footer style="margin-top:2rem;font-size:0.9em;color:#555">
  © ${new Date().getFullYear()} Practivio News — Auto-generated with Mistral & Sora 2.
</footer>
</body>
</html>`;

  fs.writeFileSync(INDEX_PAGE, html);
  console.log("🏠 Interactive homepage created → " + INDEX_PAGE);
}

async function main() {
  const files = fs.readdirSync(FULL_DIR).filter(f => f.endsWith(".json"));
  let done = 0;

  for (const file of files) {
    const inPath = path.join(FULL_DIR, file);
    const outPath = path.join(OUT_DIR, file.replace(".json", ".md"));
    if (fs.existsSync(outPath)) continue;

    const article = JSON.parse(fs.readFileSync(inPath, "utf8"));
    console.log("🎬 Generating cinematic Sora prompt for:", article.title);

    let response = "";
    for (let i = 1; i <= 3; i++) {
      try {
        const prompt = buildPrompt(article);
        response = await runOllama(prompt);
        if (response.length > 100) break;
      } catch (err) {
        console.log("⚠️ Retry", i, "/3:", err.message);
        await sleep(1500);
      }
    }

    if (response.length < 100) {
      console.log("⚠️ Retrying with shorter article context...");
      const shortArticle = { ...article, full_text: article.full_text?.slice(0, 600) || "" };
      const retryPrompt = buildPrompt(shortArticle);
      try {
        response = await runOllama(retryPrompt);
      } catch {
        console.log("❌ Failed again:", article.title);
        continue;
      }
    }

    let soraPart = response.match(/SORA_PROMPT:(.*?)(?:---|TIKTOK_DESC:)/s)?.[1]?.trim() || "";
    let tiktokRaw = response.match(/TIKTOK_DESC:(.*)/s)?.[1]?.trim() || "";

    if (!soraPart && response.includes("TikTok Breaking News")) {
      const idx = response.indexOf("TikTok Breaking News");
      soraPart = response.slice(0, idx).trim();
      tiktokRaw = response.slice(idx).trim();
    }
    if (!soraPart) {
      console.log("❌ No SORA output for:", article.title);
      continue;
    }

    const narrationMatch = soraPart.match(/Narration.*?:([\s\S]*)/);
    let soraClean = soraPart;
    if (narrationMatch) {
      const trimmed = trimNarration(narrationMatch[1]);
      soraClean = soraPart.replace(narrationMatch[1], trimmed);
    }

    soraClean = soraClean.replace(/\(\d+\)/g, "").replace(/\s{2,}/g, " ").trim();
    const hashtags = (tiktokRaw.match(/#[A-Za-z0-9_]+/g) || []).slice(0, 5).join(" ");
    let descText = tiktokRaw.replace(/#[A-Za-z0-9_]+/g, "").trim();
    if (!descText.startsWith("🎵 TikTok Breaking News:")) descText = "🎵 TikTok Breaking News: " + descText;
    const tiktokPart = `${descText} ${hashtags}`.trim();

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
    console.log("✅ Saved cinematic file →", outPath);
  }

  const outFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith(".md"));
  buildHomePage(outFiles);

  try {
    execSync("git add .", { stdio: "inherit" });
    execSync('git commit -m "auto: interactive homepage with checkboxes + copy buttons"', { stdio: "inherit" });
    execSync("git push", { stdio: "inherit" });
    console.log("🚀 Pushed updates to GitHub!");
  } catch {
    console.log("⚠️ No new changes or Git remote not configured.");
  }

  console.log("\\n✅ Finished", done, "cinematic Sora prompts with interactive homepage.");
}

main().catch((e) => console.error("❌ Fatal:", e));
