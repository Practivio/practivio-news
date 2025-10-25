import fs from "fs";
import { execSync } from "child_process";
import fetch from "node-fetch";

const GNEWS_URL = "https://gnews.io/api/v4/top-headlines?lang=en&country=us&token=YOUR_TOKEN";

async function run() {
  const res = await fetch(GNEWS_URL);
  const data = await res.json();

  for (const article of data.articles.slice(0, 3)) {
    const prompt = `
Summarize this article into facts, then create Neutral, Conservative, and Liberal rewrites.
Facts only. No hallucination.
${article.title}\n\n${article.description || ""}
    `;
    const ai = execSync(`ollama run llama3 "${prompt}"`).toString();

    const file = `content/articles/${article.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.json`;
    fs.writeFileSync(file, JSON.stringify({ source: article.url, output: ai }, null, 2));
  }

  execSync("git add . && git commit -m 'Auto update' && git push");
}

run();
