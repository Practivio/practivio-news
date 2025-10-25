// Step 3d — tuned for Mistral 7B Instruct
// Long-form bias rewrites with tone separation, images, and crediting.

import fs from "fs";
import path from "path";
import fetch from "node-fetch";

const FULL_DIR = "./content/full";
const OUT_DIR = "./content/rewrites";
const MODEL = "mistral:instruct";
await fs.promises.mkdir(OUT_DIR, { recursive: true });

// helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOllama(prompt) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.8, num_predict: 2800 }
    })
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  let txt = (data.response || "").trim().replace(/^```json\s*|\s*```$/g, "");
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

// ── Few-shot prompt ─────────────────────────────────────────────
function buildPrompt(text, meta) {
  return `
You are a senior editor at *Practivio News*, rewriting long-form articles
into three versions that reflect differing editorial tones.

EXAMPLES OF TONE:
---
NEUTRAL → "NASA announced a new mission..." (balanced, factual, AP style)
CONSERVATIVE → "Critics of government spending question NASA’s new mission..." (skeptical of institutions)
LIBERAL → "Scientists hailed NASA’s inclusive new mission..." (emphasizes progress, diversity)
---

Rewrite the following article into THREE versions (neutral, conservative, liberal).  
Each must:
- Be **800–1000 words**, 3–5 paragraphs with natural flow.
- Keep all factual information accurate.
- Use clear transitions and narrative style.
- Mention at least one image contextually.
- End with an attribution line:  
  "*Reported by ${meta.author || "staff writers"} for Practivio News, based on original reporting by ${meta.sourceName || meta.source} (${meta.pubDate || "date unknown"}).*"

Return strict JSON:
{
 "neutral": {"headline":"...","body":"..."},
 "conservative": {"headline":"...","body":"..."},
 "liberal": {"headline":"...","body":"..."}
}

ARTICLE METADATA:
Title: ${meta.title}
Source: ${meta.sourceName || meta.source}
Published: ${meta.pubDate}
Images: ${meta.images.slice(0,3).join(", ")}
URL: ${meta.link}

FULL TEXT:
"""
${text}
"""
`.trim();
}

// ── Main runner ────────────────────────────────────────────────
async function main() {
  const files = fs.readdirSync(FULL_DIR).filter(f => f.endsWith(".json"));
  let done = 0;

  for (const [i, file] of files.entries()) {
    const inPath = path.join(FULL_DIR, file);
    const outPath = path.join(OUT_DIR, file);
    if (fs.existsSync(outPath)) continue;

    const raw = JSON.parse(fs.readFileSync(inPath, "utf8"));
    const text = raw.full_text?.trim();
    if (!text || text.length < 1500) continue;

    const meta = {
      title: raw.title,
      link: raw.link,
      sourceName: raw.sourceName || raw.source,
      pubDate: raw.pubDate,
      author: raw.author || "Unknown Author",
      images: raw.images || []
    };

    console.log(`(${i + 1}/${files.length}) 🧠 Rewriting: ${meta.title}`);

    const prompt = buildPrompt(text, meta);
    let out;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        out = await runOllama(prompt);
        const bodyLen =
          (out?.neutral?.body || "").split(" ").length +
          (out?.conservative?.body || "").split(" ").length +
          (out?.liberal?.body || "").split(" ").length;
        if (bodyLen > 1200) break; // ensures expansion
      } catch (err) {
        console.log(`⚠️ Retry ${attempt + 1}: ${err.message}`);
        await sleep(2000);
      }
    }

    if (!out?.neutral) {
      console.log(`❌ Failed: ${meta.title}`);
      continue;
    }

    const record = {
      ...meta,
      rewrites: out,
      extracted_chars: text.length,
      created_at: new Date().toISOString(),
      credits: {
        original_author: meta.author,
        original_source: meta.sourceName,
        published_date: meta.pubDate,
        copyright_notice:
          "© Original publisher. Used for AI editorial training under fair use."
      }
    };

    fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
    done++;
    console.log(`✅ Saved → ${outPath}`);
    await sleep(1000);
  }

  console.log(`\n✅ Finished ${done} rewrites.`);
}

main().catch(e => console.error("❌ Fatal:", e));
