// /scripts/generateNews.js
// Auto-ingest RSS → extract → call local Ollama (phi3:mini) → write 3-perspective JSON files
// PLUS: generate a Sora 2 prompt (neutral-only) saved under content/sora/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseStringPromise } from "xml2js";
import makeDir from "make-dir";
import slugify from "slugify";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");
const ARTICLES_DIR = path.join(CONTENT_DIR, "articles");
const INDEX_FILE = path.join(CONTENT_DIR, "index.json");
const SORA_DIR = path.join(CONTENT_DIR, "sora");
const SORA_INDEX_FILE = path.join(SORA_DIR, "index.json");

const RSS_FEEDS = [
  // 🗞️ News & Current Affairs
  "https://feeds.bbci.co.uk/news/rss.xml",
  "http://rss.cnn.com/rss/edition.rss",
  "http://feeds.reuters.com/Reuters/worldNews",
  "https://www.theguardian.com/world/rss",
  "https://www.aljazeera.com/xml/rss/all.xml",
  "https://apnews.com/rss",
  "https://feeds.npr.org/1001/rss.xml",
  "https://rss.dw.com/rdf/rss-en-all",
  "https://www.politico.com/rss/politics08.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",

  // 💻 Technology & Startups
  "http://feeds.feedburner.com/TechCrunch/",
  "https://www.wired.com/feed/rss",
  "https://www.theverge.com/rss/index.xml",
  "http://feeds.arstechnica.com/arstechnica/index/",
  "http://feeds.mashable.com/Mashable",
  "https://news.ycombinator.com/rss",
  "https://www.producthunt.com/feed",
  "https://www.engadget.com/rss.xml",
  "https://venturebeat.com/feed/",
  "https://gizmodo.com/rss",

  // 💰 Business & Finance
  "https://www.bloomberg.com/feed/podcast/etf-report.xml",
  "https://www.forbes.com/business/feed/",
  "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  "https://www.ft.com/?format=rss",
  "https://www.economist.com/latest/rss.xml",
  "https://hbr.org/feed",
  "https://www.marketwatch.com/rss/topstories",
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
  "https://www.businessinsider.com/rss",
  "https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_articles",

  // ⚽ Sports
  "https://www.espn.com/espn/rss/news",
  "https://feeds.bbci.co.uk/sport/rss.xml",
  "https://www.skysports.com/rss/12040",
  "https://www.si.com/rss/si_topstories.rss",
  "https://www.formula1.com/rss/news/headlines.rss",
  "https://www.nba.com/rss/nba_rss.xml",
  "https://www.nfl.com/rss/rsslanding?searchString=home",
  "https://theathletic.com/feed/",
  "https://www.fifa.com/rss-feeds/",
  "https://www.eurosport.com/rss.xml",

  // 🎭 Entertainment & Pop Culture
  "https://variety.com/feed/",
  "https://www.rollingstone.com/music/music-news/feed/",
  "https://www.billboard.com/feed/",
  "https://www.imdb.com/news/feed",
  "https://www.eonline.com/syndication/feeds/rssfeeds/topstories",
  "http://www.mtv.com/news/rss/",
  "https://pitchfork.com/rss/reviews/albums/",
  "https://deadline.com/feed/",
  "https://www.hollywoodreporter.com/t/feed/",
  "https://ew.com/feed/",

  // 🩺 Health & Wellness
  "https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml",
  "https://www.healthline.com/rss",
  "https://www.medicalnewstoday.com/rss",
  "https://rssfeeds.webmd.com/rss/rss.aspx?RSSSource=RSS_PUBLIC",
  "https://www.health.harvard.edu/blog/feed",
  "https://newsnetwork.mayoclinic.org/feed/",
  "https://www.england.nhs.uk/feed/",
  "https://www.psychologytoday.com/us/rss",
  "https://www.everydayhealth.com/rss/all.aspx",
  "https://www.medscape.com/rss/siteupdates.xml",

  // ✈️ Travel & Lifestyle
  "https://www.lonelyplanet.com/blog.rss",
  "https://www.cntraveler.com/feed/rss",
  "https://www.travelandleisure.com/rss",
  "https://www.nomadicmatt.com/feed/",
  "https://thepointsguy.com/feed/",
  "https://theculturetrip.com/feed/",
  "https://www.luxurytravelmagazine.com/rss",
  "https://www.smartertravel.com/rss/",
  "https://www.adventure-journal.com/feed/",
  "https://www.nationalgeographic.com/content/nationalgeographic/en_us/travel/rss",

  // 🔬 Science & Education
  "https://www.nasa.gov/rss/dyn/breaking_news.rss",
  "https://www.nature.com/nature.rss",
  "https://www.scientificamerican.com/feed/",
  "https://www.smithsonianmag.com/rss/",
  "https://feeds.feedburner.com/tedtalks_video",
  "https://www.sciencemag.org/rss/current.xml",
  "https://www.livescience.com/feeds/all",
  "https://www.popsci.com/arcio/rss/",
  "https://theconversation.com/us/articles.atom",
  "https://www.nationalgeographic.com/content/nationalgeographic/en_us/rss",

  // 🎨 Special Interest & Hobbies
  "https://www.seriouseats.com/rss",
  "https://food52.com/blog.rss",
  "https://www.vogue.com/feed/rss",
  "https://www.elle.com/rss/all.xml/",
  "https://feeds.ign.com/ign/all",
  "https://kotaku.com/rss",
  "https://petapixel.com/feed/",
  "https://fstoppers.com/feed",
  "https://www.goodreads.com/blog.atom",
  "https://www.goodreads.com/choiceawards/best-books-2024.rss"
];

const MAX_ITEMS = 5;
const OLLAMA_MODEL = "phi3:mini";
const OLLAMA_URL = "http://localhost:11434/api/generate";
const UA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
};

// ——— Setup Directories ———
async function ensureDirs() {
  await makeDir(ARTICLES_DIR);
  await makeDir(SORA_DIR);
  if (!fs.existsSync(INDEX_FILE))
    fs.writeFileSync(INDEX_FILE, JSON.stringify({ articles: [] }, null, 2));
  if (!fs.existsSync(SORA_INDEX_FILE))
    fs.writeFileSync(SORA_INDEX_FILE, JSON.stringify({ prompts: [] }, null, 2));
}
function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
  catch { return { articles: [] }; }
}
function saveIndex(index) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}
function loadSoraIndex() {
  try { return JSON.parse(fs.readFileSync(SORA_INDEX_FILE, "utf8")); }
  catch { return { prompts: [] }; }
}
function saveSoraIndex(idx) {
  fs.writeFileSync(SORA_INDEX_FILE, JSON.stringify(idx, null, 2));
}

// ——— Fetch + Parse RSS (reliable w/ retries) ———
async function fetchRSS(url) {
  const maxAttempts = 3;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers: UA_HEADERS });
      if (!res.ok) throw new Error(res.statusText);
      const xml = await res.text();
      const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
      const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
      const list = Array.isArray(items) ? items : [items];
      return list.map((i) => ({
        title: i.title?._ || i.title || "",
        link: i.link?.href || i.link || i.guid || "",
        pubDate: i.pubDate || i.published || i.updated || "",
      })).filter((x) => x.title && x.link);
    } catch (err) {
      console.warn(`Attempt ${attempt}/${maxAttempts} failed for ${url}: ${err.message}`);
      if (attempt < maxAttempts) await delay(1000 * attempt);
      else console.error(`Feed failed after ${maxAttempts} tries: ${url}`);
    }
  }
  return [];
}

// ——— Fetch full article text ———
async function fetchArticleText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA_HEADERS["User-Agent"], Accept: "text/html,*/*" },
  });
  if (!res.ok) throw new Error(`Article fetch failed ${url}: ${res.status}`);
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return (article?.textContent || article?.content || "").trim();
}

// ——— Prompt Builders ———
function buildArticlePrompt(articleText, title, sourceUrl, category) {
  return `
SOURCE_TITLE: ${title}
SOURCE_URL: ${sourceUrl}
CATEGORY: ${category || "general"}
ARTICLE_TEXT:
${articleText}

TASKS:
1) Extract up to 10 factual bullet points strictly from ARTICLE_TEXT.
2) Using only those facts, produce Neutral, Conservative, and Liberal summaries (headline + <p>body_html</p>).
Return JSON EXACTLY:
{
  "facts": ["..."],
  "neutral": {"headline":"...","body_html":"<p>...</p>"},
  "conservative": {"headline":"...","body_html":"<p>...</p>"},
  "liberal": {"headline":"...","body_html":"<p>...</p>"}
}`.trim();
}

// ——— Stronger meaning-rich Sora prompt ———
function buildSoraPromptRequest(facts, neutralHeadline, neutralBody) {
  const factStr = (facts || []).slice(0, 6).join("\n- ");
  const summary = (neutralBody || "")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .slice(0, 80)
    .join(" ");

  return `
You are generating a PRIVATE Sora 2 prompt for a 9:16 newsroom-style video about current events.

Requirements:
- Duration: 8–10 seconds total
- Aspect: vertical 9:16
- Voice: @lee627, calm and informative tone, 140–160 wpm
- Scene plan: 3–4 short shots that visually represent the event
- Include environment and subject details (crowds, buildings, maps, nature, headlines, flags)
- Do NOT mention brands or social platforms
- End with: "Comment below."
- Keep the language neutral and factual.

Facts to work from:
${factStr || "(facts unavailable)"}

Headline:
"${neutralHeadline || "News Update"}"

Summary context:
${summary}

Return STRICT JSON EXACTLY:
{
  "sora_prompt": "SORA 2 PROMPT — PRIVATE\\nGoal: 9:16 newsroom-style video, 8–10s realistic shots.\\nFormat: vertical, soft light.\\nScene plan:\\nShot 1: [establishing environment]\\nShot 2: [main event or subject close]\\nShot 3: [contextual or data visual]\\nShot 4: [closing moment]\\nVoiceOver (<=25 words): '<concise narration capturing essence of the article>. Comment below.'"
}`.trim();
}

// ——— Run Ollama JSON ———
async function runOllamaJSON(prompt) {
  const body = { model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2 }, format: "json" };
  const res = await fetch(OLLAMA_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama HTTP error ${res.status}`);
  const data = await res.json();
  let parsed;
  try { parsed = JSON.parse(data.response); }
  catch { parsed = JSON.parse(data.response.replace(/^```json\\s*|\\s*```$/g, "")); }
  return parsed;
}

// ——— Category ———
function detectCategory(url) {
  if (url.match(/babylonbee|theonion|duffelblog|betootaadvocate/)) return "satire";
  if (url.match(/tmz|variety|hollywoodreporter|rollingstone|etonline/)) return "entertainment";
  if (url.match(/espn|yahoo|cbssports|sportingnews/)) return "sports";
  if (url.match(/nasa|space|science/)) return "science";
  if (url.match(/opinion|editorial|latimes|nytimes|hill/)) return "opinion";
  if (url.match(/foxnews|nationalreview|theblaze|dailywire|newsmax/)) return "right";
  if (url.match(/cnn|msnbc|huffpost|vox|guardian|npr/)) return "left";
  return "center";
}

// ——— Process each item ———
async function processItem(item, index, soraIndex) {
  const slug = (slugify(item.title, { lower: true, strict: true }) || "story").slice(0, 100);
  const outPath = path.join(ARTICLES_DIR, `${slug}.json`);
  const soraOutPath = path.join(SORA_DIR, `${slug}.json`);
  if (fs.existsSync(outPath) && fs.existsSync(soraOutPath)) return;

  let text = "";
  try { text = await fetchArticleText(item.link); } catch {}
  if (!text || text.length < 500) return;

  const category = detectCategory(item.link);
  const artPrompt = buildArticlePrompt(text, item.title, item.link, category);

  let result;
  try { result = await runOllamaJSON(artPrompt); } catch (e) { console.error(e.message); return; }

  const record = {
    id: `${Date.now()}-${slug}`,
    category,
    source: { url: item.link, title: item.title, published_at: item.pubDate },
    facts: result.facts || [],
    neutral: result.neutral,
    conservative: result.conservative,
    liberal: result.liberal,
  };
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));

  try {
    const soraReq = buildSoraPromptRequest(
      record.facts,
      record.neutral?.headline || item.title,
      record.neutral?.body_html || ""
    );
    const soraRes = await runOllamaJSON(soraReq);
    const soraPrompt = {
      id: record.id,
      slug: `${slug}.json`,
      source_url: item.link,
      title: record.neutral?.headline || item.title,
      category,
      sora_prompt: soraRes.sora_prompt,
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(soraOutPath, JSON.stringify(soraPrompt, null, 2));
    soraIndex.prompts.unshift(soraPrompt);
  } catch (e) { console.error("Sora prompt error:", e.message); }

  index.articles.unshift({
    id: record.id,
    slug: `${slug}.json`,
    title: result.neutral?.headline || item.title,
    category,
    published_at: item.pubDate || new Date().toISOString(),
    source_url: item.link,
  });
}

// ——— Main Runner ———
async function main() {
  await ensureDirs();
  const index = loadIndex();
  const soraIndex = loadSoraIndex();
  let items = [];

  for (const feed of RSS_FEEDS) {
    try { items = items.concat(await fetchRSS(feed)); }
    catch (e) { console.error("Feed error:", feed, e.message); }
  }

  const seen = new Set();
  items = items.filter(i => { const k = i.link || i.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_ITEMS);

  for (const item of items) {
    try { await processItem(item, index, soraIndex); }
    catch (e) { console.error("Process error:", e.message); }
  }

  saveIndex(index);
  saveSoraIndex(soraIndex);

  try {
    execSync('git add content && git diff --cached --quiet || git commit -m "auto: update articles + sora prompts"', { cwd: ROOT, stdio: "inherit" });
    execSync("git push", { cwd: ROOT, stdio: "inherit" });
  } catch { console.log("No changes or push failed."); }
}

main().catch((e) => { console.error(e); process.exit(1); });
