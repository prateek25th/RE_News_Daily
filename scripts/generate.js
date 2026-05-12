// scripts/generate.js
// Fetches REAL news from RSS feeds of actual publications.
// AI (OpenRouter/Llama) only SUMMARISES real articles — never invents news.
// Saves real summaries + real article URLs to data/content.json

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const API_KEY = process.env.OPENROUTER_API_KEY;
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not set in GitHub Secrets.');
  process.exit(1);
}

// ── Date helpers ──────────────────────────────────────────────────────────
const _d      = new Date();
const _days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const today   = `${_days[_d.getDay()]}, ${_d.getDate()} ${_months[_d.getMonth()]} ${_d.getFullYear()}`;

// ── Real RSS Feed Sources ─────────────────────────────────────────────────
// These are real publications with free RSS feeds
const RSS_FEEDS = [
  // Indian RE specific
  { url: 'https://mercomindia.com/feed/',                                                   name: 'Mercom India',     tab: 'industry' },
  { url: 'https://solarquarter.com/feed/',                                                  name: 'Solar Quarter',    tab: 'industry' },
  { url: 'https://www.pv-magazine-india.com/feed/',                                         name: 'PV Magazine India',tab: 'industry' },
  // Indian business papers
  { url: 'https://economictimes.indiatimes.com/industry/energy/rssfeeds/13358499.cms',      name: 'Economic Times',   tab: 'industry' },
  { url: 'https://www.business-standard.com/rss/companies-114.rss',                         name: 'Business Standard',tab: 'industry' },
  { url: 'https://www.livemint.com/rss/industry',                                           name: 'Livemint',         tab: 'industry' },
  // Global RE
  { url: 'https://cleantechnica.com/feed/',                                                  name: 'CleanTechnica',    tab: 'both'     },
  { url: 'https://www.pv-magazine.com/feed/',                                                name: 'PV Magazine',      tab: 'both'     },
  { url: 'https://electrek.co/feed/',                                                        name: 'Electrek',         tab: 'both'     },
  { url: 'https://www.renewableenergyworld.com/feed/',                                       name: 'RE World',         tab: 'industry' },
  { url: 'https://www.solarpowerworldonline.com/feed/',                                      name: 'Solar Power World', tab: 'tech'    },
  { url: 'https://www.pv-tech.org/feed/',                                                    name: 'PV Tech',          tab: 'tech'     },
  // News agencies
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',                   name: 'BBC Environment',  tab: 'both'     },
  { url: 'https://www.theguardian.com/environment/rss',                                      name: 'The Guardian',     tab: 'both'     },
];

// RE keywords to filter relevant articles
const RE_KEYWORDS = [
  'solar', 'wind', 'renewable', 'clean energy', 'green energy', 'photovoltaic',
  'battery storage', 'energy storage', 'electric vehicle', 'ev charging',
  'green hydrogen', 'offshore wind', 'rooftop solar', 'net metering',
  'mnre', 'seci', 'power purchase', 'carbon', 'climate', 'emission',
  'megawatt', 'gigawatt', 'mw ', 'gw ', 'kwh', 'solar panel', 'turbine',
  'adani green', 'ntpc renewable', 'tata power', 'greenko', 'renew power',
  'waaree', 'vikram solar', 'orsted', 'vestas', 'siemens gamesa',
  'perovskite', 'lithium', 'electrolyzer', 'agrivoltaic', 'bifacial',
];

const TECH_KEYWORDS = [
  'breakthrough', 'efficiency', 'record', 'research', 'innovation', 'technology',
  'perovskite', 'solid state', 'sodium ion', 'electrolyzer', 'floating wind',
  'agrivoltaic', 'vehicle to grid', 'v2g', 'bifacial', 'storage technology',
  'new study', 'scientists', 'researchers', 'laboratory', 'prototype', 'patent',
  'milestone', 'achievement', 'announced', 'developed', 'discovered',
];

// ── HTTP fetch helper ─────────────────────────────────────────────────────
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }

    const lib     = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; REPowerNews/2.0; +https://github.com/repower-news)',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 12000,
    };

    const req = lib.get(url, options, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve(fetchUrl(nextUrl, redirectCount + 1));
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── Parse RSS XML ─────────────────────────────────────────────────────────
function parseRSS(xml, sourceName) {
  const articles = [];

  // Extract items using regex (no external dependencies needed)
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && articles.length < 8) {
    const item = match[1] || match[2];

    const title = extractTag(item, 'title');
    const link  = extractLink(item);
    const desc  = extractTag(item, 'description') ||
                  extractTag(item, 'summary')     ||
                  extractTag(item, 'content:encoded') || '';
    const pubDate = extractTag(item, 'pubDate') ||
                    extractTag(item, 'published') ||
                    extractTag(item, 'updated') || '';

    if (!title || !link) continue;

    // Clean HTML tags from description
    const cleanDesc = desc
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    articles.push({
      title:   title.replace(/<[^>]*>/g, '').trim(),
      url:     link,
      desc:    cleanDesc,
      pubDate,
      source:  sourceName,
    });
  }

  return articles;
}

function extractTag(xml, tag) {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m) return m[1].trim();
  }
  return '';
}

function extractLink(item) {
  // Try <link> tag
  const linkTag = item.match(/<link[^>]*>([^<]+)<\/link>/i);
  if (linkTag) return linkTag[1].trim();

  // Try <link href="..."> (Atom feeds)
  const linkAttr = item.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (linkAttr) return linkAttr[1].trim();

  // Try <guid>
  const guid = item.match(/<guid[^>]*>([^<]+)<\/guid>/i);
  if (guid && guid[1].startsWith('http')) return guid[1].trim();

  return '';
}

// ── Check if article is about renewable energy ────────────────────────────
function isREArticle(article) {
  const text = `${article.title} ${article.desc}`.toLowerCase();
  return RE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function isTechArticle(article) {
  const text = `${article.title} ${article.desc}`.toLowerCase();
  return TECH_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function timeAgo(pubDate) {
  if (!pubDate) return 'Recently';
  const d    = new Date(pubDate);
  if (isNaN(d)) return 'Recently';
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Fetch all RSS feeds ───────────────────────────────────────────────────
async function fetchAllFeeds() {
  const allArticles = [];

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`  📡 Fetching ${feed.name}...`);
      const xml      = await fetchUrl(feed.url);
      const articles = parseRSS(xml, feed.name);
      const relevant = articles.filter(isREArticle).map(a => ({ ...a, feedTab: feed.tab }));
      allArticles.push(...relevant);
      console.log(`  ✅ ${feed.name}: ${relevant.length} relevant articles`);
    } catch(e) {
      console.warn(`  ⚠️  ${feed.name} failed: ${e.message}`);
    }

    // Small delay between RSS requests
    await sleep(500);
  }

  return allArticles;
}

// ── Summarise with AI ─────────────────────────────────────────────────────
async function summariseArticles(articles, label) {
  if (!articles.length) {
    console.warn(`  ⚠️  No articles to summarise for ${label}`);
    return [];
  }

  console.log(`  🤖 Summarising ${articles.length} ${label} articles...`);

  const articleList = articles.map((a, i) =>
    `[${i}] TITLE: ${a.title}\nSOURCE: ${a.source}\nCONTENT: ${a.desc}\nURL: ${a.url}`
  ).join('\n\n');

  const prompt = `You are editor of REPower News. Today is ${today}.

Below are REAL news articles fetched from actual publications. 
Your job is ONLY to summarise them — do NOT invent any information.
Only use facts present in the title and content provided.

${articleList}

For each article return a JSON object. Return ONLY a valid JSON array:
{
  "index": article index number,
  "headline": "rewritten headline max 12 words — must reflect actual article content",
  "summary": "55-65 word summary using ONLY facts from the article. Start with the most important fact. Include specific figures if mentioned in the article.",
  "source": "source name as provided",
  "url": "exact URL as provided — do not change",
  "category": "one of: Solar Tender|Wind Auction|Green Finance|Project Commission|Policy Update|Leadership Change|Regulation|Market Analysis|Company Results|International Deal|Grid Infrastructure|Manufacturing|Rooftop Solar|Energy Storage|Offshore Wind|Solar Tech|Battery Innovation|Green Hydrogen|EV Technology|Smart Grid|Agrivoltaics",
  "region": "India or Global or Europe or US or Asia or Middle East",
  "timeAgo": "time string as provided",
  "validity": 9,
  "validityReason": "Real article from ${label === 'industry' ? 'industry publication' : 'tech publication'}"
}

IMPORTANT: 
- Only summarise articles in the list above
- Do not add facts not in the original
- Keep the exact URL provided
- If content is too short to summarise properly, skip that article

JSON array only. No markdown. Start with [ end with ]`;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer':  'https://github.com/repower-news',
        'X-Title':       'REPower News',
      },
      body: JSON.stringify({
        model:       'meta-llama/llama-3.3-70b-instruct:free',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.3, // Low temperature — we want faithful summaries
        max_tokens:  3000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';

    const parsed = parseJSON(text);
    if (!parsed?.length) throw new Error('Could not parse summarisation response');

    // Map back to full articles with summaries
    return parsed.map(s => {
      const original = articles[s.index];
      if (!original) return null;
      return {
        headline:       s.headline || original.title,
        summary:        s.summary  || original.desc.slice(0, 200),
        source:         original.source,
        url:            original.url,  // Always use original URL
        searchQuery:    `${original.title.slice(0, 50)} ${new Date().getFullYear()}`,
        category:       s.category || 'Policy Update',
        region:         s.region   || 'India',
        timeAgo:        timeAgo(original.pubDate),
        validity:       9,
        validityReason: 'Real article — AI summarised only',
      };
    }).filter(Boolean);

  } catch(e) {
    console.error(`  ❌ Summarisation failed for ${label}: ${e.message}`);
    // Fallback: return articles with truncated description as summary
    return articles.map(a => ({
      headline:       a.title,
      summary:        a.desc.slice(0, 250) || a.title,
      source:         a.source,
      url:            a.url,
      searchQuery:    `${a.title.slice(0, 50)} ${new Date().getFullYear()}`,
      category:       'Policy Update',
      region:         'India',
      timeAgo:        timeAgo(a.pubDate),
      validity:       9,
      validityReason: 'Real article from publication',
    }));
  }
}

// ── Generate learning content (AI-generated educational cards are OK) ────
async function generateLearnContent() {
  const LEARN_TOPICS = [
    'How solar PV panels generate electricity — photoelectric effect and silicon cells',
    'How wind turbines produce power — rotor aerodynamics and generators',
    'How lithium-ion battery storage works and its applications in grid stabilisation',
    'How the electricity grid balances supply and demand in real time',
    'Green hydrogen production through water electrolysis — PEM vs alkaline',
    'How offshore wind farms are designed, installed and connected to shore',
    'What is a Power Purchase Agreement and how it works for RE projects in India',
    'How electric vehicles work — motors, regenerative braking and charging levels',
    'Perovskite solar cells — why they could replace silicon and current efficiency records',
    'Agrivoltaics — combining solar panels with farming for dual land use',
    'Vehicle-to-grid technology — how EVs can stabilise the renewable power grid',
    'How pumped hydro storage works as the world largest battery technology',
    'Net metering in India — how rooftop solar owners sell power back to the grid',
    'Capacity factor explained — why a 100MW solar plant produces less than 100MW always',
    'India ISTS waiver policy — how it reduced renewable energy costs significantly',
    'Solid-state batteries vs lithium-ion — safety, energy density and timeline',
    'Floating solar farms on water bodies — advantages and India installations',
    'The duck curve problem — why solar power creates a grid challenge at sunset',
    'Green steel production — using hydrogen to replace coking coal in blast furnaces',
    'India National Green Hydrogen Mission — targets, incentives and 2030 roadmap',
  ];

  const chosen = [...LEARN_TOPICS].sort(() => Math.random() - 0.5).slice(0, 6);

  const prompt = `You are a renewable energy educator creating learning cards for professionals and students.

Create 6 educational cards on these topics:
${chosen.map((t, i) => `${i + 1}. ${t}`).join('\n')}

These educational cards can be AI-generated (unlike news which must be real).
Make them accurate, detailed and useful.

Return ONLY a valid JSON array. Each object must have these exact flat string fields:
{
  "title": "clear educational title max 10 words",
  "category": "Solar Energy|Wind Energy|Battery Storage|Grid & Systems|Hydrogen|EV & Transport|Ocean Energy|Energy Policy",
  "difficulty": "Beginner or Intermediate or Advanced",
  "intro": "65-70 word engaging introduction explaining why this topic matters",
  "c1_title": "First concept title with relevant emoji",
  "c1_text": "55 word explanation with a helpful analogy",
  "c2_title": "Second concept title with relevant emoji",
  "c2_text": "55 word explanation building on the first concept",
  "c3_title": "Third concept title with relevant emoji",
  "c3_text": "55 word explanation with India-specific data or policy context",
  "stat1": "short factual stat with number e.g. India: 90 GW solar installed 2024",
  "stat2": "short factual stat with number",
  "stat3": "short factual stat with number",
  "stat4": "short factual stat with number",
  "readUrl": "real URL from irena.org, iea.org, mnre.gov.in, or nrel.gov",
  "readLabel": "short label e.g. Explore at IRENA"
}

All values must be plain strings. JSON array only. No markdown. Start with [ end with ]`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'HTTP-Referer':  'https://github.com/repower-news',
      'X-Title':       'REPower News',
    },
    body: JSON.stringify({
      model:       'meta-llama/llama-3.3-70b-instruct:free',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens:  4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  const parsed = parseJSON(text);
  if (!parsed?.length) throw new Error('Could not parse learn content');
  return parsed;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function parseJSON(t) {
  if (!t) return null;
  for (const fn of [
    () => JSON.parse(t.trim()),
    () => JSON.parse(t.replace(/```json|```/g, '').trim()),
    () => { const m = t.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw 0; },
  ]) { try { const r = fn(); if (Array.isArray(r)) return r; } catch {} }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱 REPower News — Real Content Generator');
  console.log(`📅 ${today}`);
  console.log('📰 Fetching REAL news from actual publications...\n');

  // Step 1: Fetch all RSS feeds
  const allArticles = await fetchAllFeeds();
  console.log(`\n📊 Total relevant articles found: ${allArticles.length}`);

  if (allArticles.length === 0) {
    console.error('❌ No articles fetched from any RSS feed.');
    console.error('   RSS feeds may be temporarily unavailable. Will retry next run.');
    // Don't exit with error — keep old content rather than showing nothing
    process.exit(0);
  }

  // Step 2: Split into industry vs tech
  const industryArticles = allArticles
    .filter(a => a.feedTab === 'industry' || a.feedTab === 'both')
    .slice(0, 8); // Max 8 for AI summarisation

  const techArticles = allArticles
    .filter(a => (a.feedTab === 'tech' || a.feedTab === 'both') && isTechArticle(a))
    .slice(0, 8);

  console.log(`   Industry articles: ${industryArticles.length}`);
  console.log(`   Tech articles: ${techArticles.length}`);

  // Step 3: Summarise with AI
  console.log('\n🤖 Summarising articles with AI...');

  const industry = await summariseArticles(industryArticles, 'industry');
  console.log(`   ✅ Industry summaries: ${industry.length}`);

  await sleep(30000); // 30 second gap for rate limit

  const tech = await summariseArticles(techArticles, 'tech');
  console.log(`   ✅ Tech summaries: ${tech.length}`);

  await sleep(30000);

  // Step 4: Generate learning cards (AI-generated is fine for education)
  console.log('\n📚 Generating learning cards...');
  let learn = [];
  try {
    learn = await generateLearnContent();
    console.log(`   ✅ Learning cards: ${learn.length}`);
  } catch(e) {
    console.warn(`   ⚠️  Learning cards failed: ${e.message}`);
  }

  // Step 5: Save to content.json
  const content = {
    generatedAt:  new Date().toISOString(),
    nextUpdateAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    today,
    totalFetched: allArticles.length,
    industry:     industry.length ? industry : [],
    tech:         tech.length     ? tech     : [],
    learn:        learn.length    ? learn    : [],
  };

  const outputPath = path.join(__dirname, '..', 'data', 'content.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(content, null, 2));

  console.log('\n✅ DONE — Real news saved to data/content.json');
  console.log(`   Industry: ${industry.length} real articles`);
  console.log(`   Tech:     ${tech.length} real articles`);
  console.log(`   Learn:    ${learn.length} educational cards`);
  console.log(`   Sources:  ${[...new Set(allArticles.map(a => a.source))].join(', ')}`);
  console.log(`   Next run: ${content.nextUpdateAt}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
