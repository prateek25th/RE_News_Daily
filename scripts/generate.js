// scripts/generate.js
// REPower News — Content Generator
//
// HOW IT WORKS:
// 1. Fetches REAL news from RSS feeds of actual publications
// 2. AI (OpenRouter/Llama) ONLY summarises real articles — never invents
// 3. Accumulates news over 48 hours (rolling window)
//    - Every 2 hours: adds new articles
//    - Keeps all articles from last 48 hours
//    - After 48 hours articles drop off naturally
//    - Result: tiles grow for 48 hours then stay constant
// 4. Learning cards: 50+ diverse topics from real educational websites

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const API_KEY      = process.env.OPENROUTER_API_KEY;
const NEWSAPI_KEY  = process.env.NEWSAPI_KEY;  // Optional — adds ET, Mint, BS, NDTV, Hindu
const API_URL      = 'https://openrouter.ai/api/v1/chat/completions';
const NEWSAPI_URL  = 'https://newsapi.org/v2/everything';
const OUTPUT       = path.join(__dirname, '..', 'data', 'content.json');

if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not set in GitHub Secrets.');
  process.exit(1);
}
if (!NEWSAPI_KEY) {
  console.warn('⚠️  NEWSAPI_KEY not set — skipping Indian newspaper sources.');
  console.warn('   Get free key at newsapi.org and add as NEWSAPI_KEY secret.');
}

// ── Date helpers ──────────────────────────────────────────────────────────
const _d      = new Date();
const _days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const today   = `${_days[_d.getDay()]}, ${_d.getDate()} ${_months[_d.getMonth()]} ${_d.getFullYear()}`;
const HOURS_48 = 48 * 60 * 60 * 1000;

// ── Real RSS Feeds ────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://mercomindia.com/feed/',                                               name: 'Mercom India',      tab: 'industry' },
  { url: 'https://solarquarter.com/feed/',                                              name: 'Solar Quarter',     tab: 'industry' },
  { url: 'https://www.pv-magazine-india.com/feed/',                                     name: 'PV Magazine India', tab: 'industry' },
  { url: 'https://economictimes.indiatimes.com/industry/energy/rssfeeds/13358499.cms', name: 'Economic Times',    tab: 'industry' },
  { url: 'https://www.business-standard.com/rss/companies-114.rss',                    name: 'Business Standard', tab: 'industry' },
  { url: 'https://www.livemint.com/rss/industry',                                      name: 'Livemint',          tab: 'industry' },
  { url: 'https://cleantechnica.com/feed/',                                             name: 'CleanTechnica',     tab: 'both'     },
  { url: 'https://www.pv-magazine.com/feed/',                                           name: 'PV Magazine',       tab: 'both'     },
  { url: 'https://electrek.co/feed/',                                                   name: 'Electrek',          tab: 'both'     },
  { url: 'https://www.renewableenergyworld.com/feed/',                                  name: 'RE World',          tab: 'industry' },
  { url: 'https://www.solarpowerworldonline.com/feed/',                                 name: 'Solar Power World', tab: 'tech'     },
  { url: 'https://www.pv-tech.org/feed/',                                               name: 'PV Tech',           tab: 'tech'     },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',              name: 'BBC Environment',   tab: 'both'     },
  { url: 'https://www.theguardian.com/environment/rss',                                 name: 'The Guardian',      tab: 'both'     },
];

const RE_KEYWORDS = [
  'solar','wind','renewable','clean energy','green energy','photovoltaic',
  'battery storage','energy storage','electric vehicle','ev charging',
  'green hydrogen','offshore wind','rooftop solar','net metering',
  'mnre','seci','power purchase','carbon','climate','emission',
  'megawatt','gigawatt',' mw ',' gw ','kwh','solar panel','turbine',
  'adani green','ntpc renewable','tata power','greenko','renew power',
  'waaree','vikram solar','orsted','vestas','siemens gamesa',
  'perovskite','lithium','electrolyzer','agrivoltaic','bifacial',
  'energy transition','decarbonisation','net zero','carbon neutral',
];

const TECH_KEYWORDS = [
  'breakthrough','efficiency record','research','innovation','technology',
  'perovskite','solid state','sodium ion','electrolyzer','floating wind',
  'agrivoltaic','vehicle to grid','v2g','bifacial','storage technology',
  'new study','scientists','researchers','laboratory','prototype','patent',
  'milestone','achievement','developed','discovered','announced','trial',
];

// ── 50+ Diverse Learning Topics with Real Source URLs ──────────────────────
// Each topic has: concept, real educational URL, and source name
const LEARN_TOPICS = [
  // Solar Technology
  { topic: 'How solar PV panels generate electricity using the photoelectric effect', url: 'https://www.energy.gov/eere/solar/how-does-solar-work', source: 'US Dept of Energy' },
  { topic: 'Types of solar panels — monocrystalline vs polycrystalline vs thin-film compared', url: 'https://www.nrel.gov/pv/', source: 'NREL' },
  { topic: 'Perovskite solar cells — next generation efficiency beyond silicon', url: 'https://www.nrel.gov/pv/perovskite-solar-cells.html', source: 'NREL' },
  { topic: 'Bifacial solar panels — how they generate power from both sides', url: 'https://www.irena.org/solar', source: 'IRENA' },
  { topic: 'Agrivoltaics — combining solar panels with farming on the same land', url: 'https://www.nrel.gov/news/program/2022/agrivoltaics-provide-multiple-benefits.html', source: 'NREL' },
  { topic: 'Building Integrated Photovoltaics (BIPV) — solar as architecture', url: 'https://www.energy.gov/eere/solar/solar-integration-buildings', source: 'US Dept of Energy' },
  { topic: 'Floating solar farms on water — advantages and water conservation benefits', url: 'https://www.irena.org/publications/2020/nov/innovative-outlook-ocean-energy', source: 'IRENA' },
  { topic: 'How rooftop solar works and net metering policy in India', url: 'https://mnre.gov.in/solar/rooftop', source: 'MNRE India' },
  { topic: 'Solar inverters explained — string vs micro vs hybrid inverters', url: 'https://www.energy.gov/eere/solar/articles/solar-photovoltaic-technology-basics', source: 'US Dept of Energy' },
  { topic: 'Concentrated Solar Power (CSP) — using mirrors to generate electricity', url: 'https://www.irena.org/solar/concentrated-solar-power', source: 'IRENA' },

  // Wind Energy
  { topic: 'How wind turbines produce electricity — aerodynamics and generators', url: 'https://www.energy.gov/eere/wind/how-do-wind-turbines-work', source: 'US Dept of Energy' },
  { topic: 'Offshore wind farms — design, installation and grid connection', url: 'https://www.irena.org/wind/offshore', source: 'IRENA' },
  { topic: 'Floating offshore wind platforms — technology for deep water', url: 'https://www.energy.gov/eere/wind/offshore-wind-research-and-development', source: 'US Dept of Energy' },
  { topic: 'Wind resource assessment — how developers find the best wind sites', url: 'https://www.irena.org/publications/2022/sep/wind-resource-assessment', source: 'IRENA' },
  { topic: 'Small wind turbines for homes and communities — how they work', url: 'https://www.energy.gov/eere/wind/small-wind-turbines', source: 'US Dept of Energy' },
  { topic: 'Wind turbine lifespan, maintenance and end-of-life blade recycling', url: 'https://www.irena.org/publications/2023/jan/end-of-life-management-of-wind-turbine-blades', source: 'IRENA' },

  // Battery Storage
  { topic: 'How lithium-ion battery storage works and its grid applications', url: 'https://www.energy.gov/eere/vehicles/batteries', source: 'US Dept of Energy' },
  { topic: 'Solid-state batteries — why they are safer and more energy dense', url: 'https://www.energy.gov/eere/vehicles/solid-state-batteries', source: 'US Dept of Energy' },
  { topic: 'Sodium-ion batteries — the affordable alternative to lithium-ion', url: 'https://www.irena.org/publications/2023/jan/innovation-landscape-report', source: 'IRENA' },
  { topic: 'Iron-air batteries for long duration energy storage (100+ hours)', url: 'https://www.energy.gov/eere/long-duration-storage', source: 'US Dept of Energy' },
  { topic: 'Pumped hydro storage — how it works as the world largest battery', url: 'https://www.irena.org/publications/2020/nov/innovation-outlook-advanced-liquid-biofuels', source: 'IRENA' },
  { topic: 'Battery management systems (BMS) — protecting and optimising batteries', url: 'https://www.energy.gov/eere/vehicles/electric-vehicle-batteries', source: 'US Dept of Energy' },
  { topic: 'Second life EV batteries — reusing car batteries for grid storage', url: 'https://www.irena.org/publications/2020/jan/lifecycle-cost-analysis', source: 'IRENA' },
  { topic: 'Flow batteries for grid scale storage — vanadium and iron systems', url: 'https://www.energy.gov/eere/flow-batteries', source: 'US Dept of Energy' },

  // Grid and Systems
  { topic: 'How the electricity grid balances supply and demand in real time', url: 'https://www.energy.gov/eere/electricity/grid-integration', source: 'US Dept of Energy' },
  { topic: 'Smart grids and advanced metering — digitising the power system', url: 'https://www.iea.org/reports/smart-grids', source: 'IEA' },
  { topic: 'The duck curve problem — why solar creates grid challenges at sunset', url: 'https://www.energy.gov/eere/articles/confronting-duck-curve', source: 'US Dept of Energy' },
  { topic: 'Virtual power plants — AI managing millions of distributed energy sources', url: 'https://www.irena.org/publications/2022/jan/innovation-landscape-distributed-power', source: 'IRENA' },
  { topic: 'Demand response — how large consumers help balance the power grid', url: 'https://www.energy.gov/oe/demand-response', source: 'US Dept of Energy' },
  { topic: 'HVDC transmission lines — sending power across thousands of kilometres', url: 'https://www.iea.org/reports/electricity-grids-and-secure-energy-transitions', source: 'IEA' },
  { topic: 'Microgrids — energy independence for villages and disaster resilience', url: 'https://www.energy.gov/eere/microgrids', source: 'US Dept of Energy' },
  { topic: 'Capacity factor explained — why rated power differs from actual output', url: 'https://www.eia.gov/todayinenergy/detail.php?id=14611', source: 'US Energy Info Admin' },

  // Hydrogen
  { topic: 'Green hydrogen production through water electrolysis — PEM vs alkaline', url: 'https://www.irena.org/hydrogen', source: 'IRENA' },
  { topic: 'India National Green Hydrogen Mission — targets and incentives explained', url: 'https://mnre.gov.in/national-green-hydrogen-mission', source: 'MNRE India' },
  { topic: 'Green ammonia — clean fuel for shipping and carbon-free fertilisers', url: 'https://www.irena.org/publications/2022/may/innovation-outlook-ammonia', source: 'IRENA' },
  { topic: 'Hydrogen fuel cells — how they generate electricity cleanly in vehicles', url: 'https://www.energy.gov/eere/fuelcells/fuel-cells', source: 'US Dept of Energy' },
  { topic: 'Blue vs green vs grey hydrogen — understanding the colour code', url: 'https://www.iea.org/reports/the-future-of-hydrogen', source: 'IEA' },

  // EV and Transport
  { topic: 'How electric vehicles work — motors, regenerative braking and charging', url: 'https://www.energy.gov/eere/electricvehicles/how-do-all-electric-cars-work', source: 'US Dept of Energy' },
  { topic: 'Vehicle-to-grid (V2G) technology — EVs stabilising the power grid', url: 'https://www.irena.org/publications/2019/jan/electric-vehicles-technology-brief', source: 'IRENA' },
  { topic: 'EV charging infrastructure — Level 1 vs Level 2 vs DC fast charging', url: 'https://afdc.energy.gov/fuels/electricity_infrastructure.html', source: 'US Dept of Energy' },
  { topic: 'India EV policy — PM e-DRIVE scheme and state EV policies explained', url: 'https://e-amrit.niti.gov.in', source: 'NITI Aayog India' },
  { topic: 'Electric buses and trucks — commercial vehicle electrification explained', url: 'https://www.irena.org/publications/2023/jan/towards-hydrogen-definitions', source: 'IRENA' },

  // Policy and Finance
  { topic: 'What is a Power Purchase Agreement — how RE projects get financed', url: 'https://www.irena.org/publications/2018/jan/corporate-sourcing-of-renewables', source: 'IRENA' },
  { topic: 'India ISTS waiver policy — how it reduced inter-state renewable costs', url: 'https://mnre.gov.in/policy-documents', source: 'MNRE India' },
  { topic: 'Renewable Purchase Obligation in India — what it means for DISCOMs', url: 'https://mnre.gov.in/policy-documents', source: 'MNRE India' },
  { topic: 'Green bonds and climate finance — how RE projects raise global capital', url: 'https://www.iea.org/reports/financing-clean-energy-transitions', source: 'IEA' },
  { topic: 'Carbon markets and carbon credits — how they incentivise clean energy', url: 'https://www.iea.org/reports/scaling-up-private-finance-for-clean-energy', source: 'IEA' },
  { topic: 'Levelised Cost of Energy (LCOE) — the right way to compare power sources', url: 'https://www.irena.org/publications/2024/sep/renewable-power-generation-costs-2023', source: 'IRENA' },
  { topic: 'Production Linked Incentive for solar manufacturing in India', url: 'https://mnre.gov.in/solar/domestic-manufacturing', source: 'MNRE India' },
  { topic: 'Climate finance and COP agreements — what they mean for developing countries', url: 'https://www.iea.org/reports/world-energy-outlook-2024', source: 'IEA' },

  // Ocean and Emerging
  { topic: 'Tidal stream energy — harnessing predictable ocean currents for power', url: 'https://www.irena.org/publications/2020/dec/ocean-energy', source: 'IRENA' },
  { topic: 'Wave energy converters — different technologies for harvesting ocean waves', url: 'https://www.energy.gov/eere/water/marine-and-hydrokinetic-energy-research', source: 'US Dept of Energy' },
  { topic: 'Geothermal energy — using Earths heat for power and heating', url: 'https://www.energy.gov/eere/geothermal/geothermal-basics', source: 'US Dept of Energy' },
  { topic: 'Green steel production — hydrogen replacing coal in blast furnaces', url: 'https://www.iea.org/reports/iron-and-steel-technology-roadmap', source: 'IEA' },
  { topic: 'Direct air carbon capture — removing CO2 from atmosphere with renewables', url: 'https://www.iea.org/reports/direct-air-capture-2022', source: 'IEA' },
];

// ── HTTP fetch helper ─────────────────────────────────────────────────────
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
    const lib     = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; REPowerNews/2.0; +https://repower.news)',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 12000,
    };
    const req = lib.get(url, options, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        resolve(fetchUrl(next, redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Parse RSS XML ─────────────────────────────────────────────────────────
function parseRSS(xml, sourceName) {
  const articles = [];
  const itemRx   = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = itemRx.exec(xml)) !== null && articles.length < 10) {
    const item    = match[1] || match[2];
    const title   = extractTag(item, 'title');
    const link    = extractLink(item);
    const desc    = extractTag(item, 'description') || extractTag(item, 'summary') || extractTag(item, 'content:encoded') || '';
    const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated') || '';
    if (!title || !link) continue;
    const cleanDesc = desc.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0, 600);
    articles.push({ title: title.replace(/<[^>]*>/g,'').trim(), url: link, desc: cleanDesc, pubDate, source: sourceName });
  }
  return articles;
}

function extractTag(xml, tag) {
  for (const p of [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ]) { const m = xml.match(p); if (m) return m[1].trim(); }
  return '';
}

function extractLink(item) {
  const a = item.match(/<link[^>]*>([^<]+)<\/link>/i);   if (a) return a[1].trim();
  const b = item.match(/<link[^>]+href=["']([^"']+)["']/i); if (b) return b[1].trim();
  const c = item.match(/<guid[^>]*>([^<]+)<\/guid>/i);   if (c && c[1].startsWith('http')) return c[1].trim();
  return '';
}

function isRE(a) {
  const t = `${a.title} ${a.desc}`.toLowerCase();
  // For general news sources (Guardian/BBC), require stronger RE signal
  const generalSources = ['the guardian', 'bbc environment', 'bbc news'];
  const isGeneral = generalSources.some(s => a.source.toLowerCase().includes(s.replace('the ','')));
  if (isGeneral) {
    // Must match at least 2 RE keywords OR contain core energy terms
    const coreTerms = ['solar','wind energy','renewable','clean energy','battery storage','electric vehicle','green hydrogen','offshore wind','energy storage','photovoltaic'];
    return coreTerms.some(k => t.includes(k));
  }
  return RE_KEYWORDS.some(k => t.includes(k));
}
function isTech(a) { const t = `${a.title} ${a.desc}`.toLowerCase(); return TECH_KEYWORDS.some(k => t.includes(k)); }

function timeAgo(pubDate) {
  if (!pubDate) return 'Recently';
  const d = new Date(pubDate);
  if (isNaN(d)) return 'Recently';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 0)     return 'Just now';   // future date — treat as now
  if (s < 60)    return 'Just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  if (s < 86400*7) return `${Math.floor(s/86400)}d ago`;
  return 'This week';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fetch all RSS feeds ───────────────────────────────────────────────────

// ── Fetch from NewsAPI (ET, Mint, Business Standard, NDTV, Hindu etc.) ──
// NewsAPI aggregates 80,000+ sources including all major Indian newspapers
// Free tier: 100 requests/day. We use 2-4 per day — well within limit.
async function fetchNewsAPI() {
  if (!NEWSAPI_KEY) return [];

  const queries = [
    // India RE news — gets ET, Mint, BS, NDTV, Hindu, HT
    { q: 'renewable energy india solar wind', tab: 'industry' },
    { q: 'solar energy india MNRE SECI tender', tab: 'industry' },
    // Tech innovation
    { q: 'solar technology battery storage innovation breakthrough', tab: 'tech' },
  ];

  const allArticles = [];
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q:          q.q,
        from:       sevenDaysAgo,
        sortBy:     'publishedAt',
        language:   'en',
        pageSize:   '10',
        apiKey:     NEWSAPI_KEY,
      });

      console.log(`  📡 NewsAPI: "${q.q}"...`);
      const xml = await fetchUrl(`${NEWSAPI_URL}?${params}`);
      const data = JSON.parse(xml);

      if (data.status !== 'ok') {
        console.warn(`     ⚠️  NewsAPI error: ${data.message || data.status}`);
        continue;
      }

      const articles = (data.articles || [])
        .filter(a => a.title && a.url && a.title !== '[Removed]')
        .map(a => ({
          title:   a.title,
          url:     a.url,
          desc:    (a.description || a.content || '').slice(0, 600),
          pubDate: a.publishedAt,
          source:  a.source?.name || 'NewsAPI',
          feedTab: q.tab,
        }))
        .filter(isRE);

      allArticles.push(...articles);
      console.log(`     ✅ ${articles.length} relevant articles`);

    } catch(e) {
      console.warn(`     ⚠️  NewsAPI query failed: ${e.message}`);
    }
    await sleep(1000); // 1s between NewsAPI calls
  }

  // Deduplicate by URL
  const seen = new Set();
  return allArticles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

async function fetchAllFeeds() {
  const all = [];
  for (const feed of RSS_FEEDS) {
    try {
      console.log(`  📡 ${feed.name}...`);
      const xml  = await fetchUrl(feed.url);
      const arts = parseRSS(xml, feed.name);
      const rel  = arts.filter(isRE).map(a => ({ ...a, feedTab: feed.tab }));
      all.push(...rel);
      console.log(`     ✅ ${rel.length} relevant`);
    } catch(e) {
      console.warn(`     ⚠️  Failed: ${e.message}`);
    }
    await sleep(500);
  }
  // Also fetch from NewsAPI (Indian newspapers — ET, Mint, BS, NDTV, Hindu)
  if (NEWSAPI_KEY) {
    console.log('\n  📰 Fetching from Indian newspapers via NewsAPI...');
    const newsApiArticles = await fetchNewsAPI();
    all.push(...newsApiArticles);
    console.log(`  📊 NewsAPI added ${newsApiArticles.length} articles`);
  }

  // Deduplicate all articles by URL
  const seenUrls = new Set();
  const deduped  = all.filter(a => {
    if (seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    return true;
  });

  console.log(`\n  📊 Total after deduplication: ${deduped.length} articles`);
  return deduped;
}

// ── AI summarisation ──────────────────────────────────────────────────────
async function summarise(articles, label) {
  if (!articles.length) return [];
  console.log(`  🤖 Summarising ${articles.length} ${label} articles...`);

  const list = articles.map((a, i) =>
    `[${i}] TITLE: ${a.title}\nSOURCE: ${a.source}\nCONTENT: ${a.desc}\nURL: ${a.url}`
  ).join('\n\n');

  const prompt = `You are editor of REPower News. Today is ${today}.

These are REAL articles from actual publications. Summarise them only — do NOT add any facts.

${list}

Return a JSON array. For each article:
{
  "index": number,
  "headline": "rewritten headline max 12 words reflecting actual content",
  "summary": "55-65 words using ONLY facts from the article. Start with key entity name and most important fact. Include specific figures if in article.",
  "source": "source as given",
  "url": "exact URL unchanged",
  "category": "Solar Tender|Wind Auction|Green Finance|Project Commission|Policy Update|Leadership Change|Regulation|Market Analysis|Company Results|International Deal|Grid Infrastructure|Manufacturing|Rooftop Solar|Energy Storage|Offshore Wind|Solar Tech|Battery Innovation|Green Hydrogen|EV Technology|Smart Grid|Agrivoltaics",
  "region": "India or Global or Europe or US or Asia or Middle East",
  "timeAgo": "time string",
  "validity": 9,
  "validityReason": "Real article — AI summarised only"
}

CRITICAL: Keep exact URLs. Only summarise what is in the articles. JSON array only:`;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer':  'https://repower.news',
        'X-Title':       'REPower News',
      },
      body: JSON.stringify({
        model:       'meta-llama/llama-3.3-70b-instruct:free',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens:  3000,
      }),
    });

    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0,200)}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJSON(text);
    if (!parsed?.length) throw new Error('Could not parse summarisation');

    return parsed.map(s => {
      const orig = articles[s.index];
      if (!orig) return null;
      return {
        id:             `${orig.source}-${Date.now()}-${s.index}`,
        fetchedAt:      new Date().toISOString(),
        headline:       s.headline || orig.title,
        summary:        s.summary  || orig.desc.slice(0,250),
        source:         orig.source,
        url:            orig.url,
        searchQuery:    `${orig.title.slice(0,50)} ${new Date().getFullYear()}`,
        category:       s.category  || 'Policy Update',
        region:         s.region    || 'India',
        timeAgo:        timeAgo(orig.pubDate),
        validity:       9,
        validityReason: 'Real article — AI summarised only',
      };
    }).filter(Boolean);

  } catch(e) {
    console.error(`  ❌ Summarisation failed: ${e.message}`);
    // Fallback: use raw article data
    return articles.map((a, i) => ({
      id:             `${a.source}-${Date.now()}-${i}`,
      fetchedAt:      new Date().toISOString(),
      headline:       a.title,
      summary:        a.desc.slice(0, 250) || a.title,
      source:         a.source,
      url:            a.url,
      searchQuery:    `${a.title.slice(0,50)} ${new Date().getFullYear()}`,
      category:       guessCategory(a.title),
      region:         guessRegion(a.title + ' ' + a.desc),
      timeAgo:        timeAgo(a.pubDate),
      validity:       9,
      validityReason: 'Real article from publication',
    }));
  }
}

// ── Generate learning cards ───────────────────────────────────────────────
// Picks 6 random topics from 50+ diverse list, links to real source websites
async function generateLearnCards() {
  // Pick 6 random topics — different each run
  const chosen = [...LEARN_TOPICS].sort(() => Math.random() - 0.5).slice(0, 6);

  const prompt = `You are a renewable energy educator. Create 6 educational learning cards.

For each topic below, create a card with accurate, engaging content.
Link each card to the provided authoritative source website.

Topics:
${chosen.map((t, i) => `${i+1}. TOPIC: ${t.topic}\n   SOURCE_URL: ${t.url}\n   SOURCE_NAME: ${t.source}`).join('\n\n')}

Return ONLY a valid JSON array. Each object must have ONLY flat string fields (no nested objects):
{
  "title": "clear title max 10 words",
  "category": "Solar Energy|Wind Energy|Battery Storage|Grid & Systems|Hydrogen|EV & Transport|Ocean Energy|Energy Policy",
  "difficulty": "Beginner or Intermediate or Advanced",
  "intro": "70 word introduction explaining why this topic matters for the energy transition. Be specific and engaging.",
  "c1_title": "First concept title with relevant emoji",
  "c1_text": "60 word explanation with a helpful real-world analogy. Be specific with numbers where relevant.",
  "c2_title": "Second concept title with relevant emoji",
  "c2_text": "60 word explanation building on the first concept. Include technical detail accessible to non-experts.",
  "c3_title": "Third concept title with relevant emoji",
  "c3_text": "60 word explanation with India-specific data, policy context or example from Indian RE sector.",
  "stat1": "factual statistic with number e.g. India: 90 GW solar installed (2024)",
  "stat2": "factual statistic with specific number",
  "stat3": "factual statistic with specific number",
  "stat4": "factual statistic with specific number",
  "readUrl": "use the SOURCE_URL provided for this topic exactly",
  "readLabel": "short label e.g. Read at IRENA or Explore at US DOE"
}

All values must be plain strings. JSON array only. No markdown:`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`  🤖 Generating learning cards (attempt ${attempt})...`);
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'HTTP-Referer':  'https://repower.news',
          'X-Title':       'REPower News',
        },
        body: JSON.stringify({
          model:       'meta-llama/llama-3.3-70b-instruct:free',
          messages:    [{ role: 'user', content: prompt }],
          temperature: 0.65,
          max_tokens:  4000,
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0,200)}`);
      const data   = await res.json();
      const text   = data?.choices?.[0]?.message?.content || '';
      const parsed = parseJSON(text);
      if (parsed?.length > 0) {
        console.log(`  ✅ Learning cards: ${parsed.length}`);
        return parsed;
      }
      throw new Error('Empty response');
    } catch(e) {
      console.warn(`  ⚠️  Attempt ${attempt} failed: ${e.message}`);
      if (attempt < 2) await sleep(20000);
    }
  }

  console.warn('  ⚠️  Using fallback learning cards');
  return getFallbackLearnCards();
}

// ── 48-hour rolling accumulation ──────────────────────────────────────────
// Keeps articles from last 48 hours, adds new ones
// Result: tiles grow for 48 hours, then stay roughly constant (rolling window)
function mergeWithExisting(existing, newArticles, tab) {
  const now      = Date.now();
  const cutoff   = now - HOURS_48;

  // Keep existing articles that are still within 48 hours
  const kept = (existing[tab] || []).filter(a => {
    const fetchedAt = a.fetchedAt ? new Date(a.fetchedAt).getTime() : 0;
    return fetchedAt > cutoff;
  });

  // Deduplicate new articles by URL (don't add same article twice)
  const existingUrls = new Set(kept.map(a => a.url));
  const fresh = newArticles.filter(a => !existingUrls.has(a.url));

  // Combine: new articles first, then kept existing ones
  const merged = [...fresh, ...kept];

  console.log(`  📊 ${tab}: ${fresh.length} new + ${kept.length} kept from 48h = ${merged.length} total`);
  return merged;
}

// ── JSON parser ───────────────────────────────────────────────────────────
function parseJSON(t) {
  if (!t) return null;
  for (const fn of [
    () => JSON.parse(t.trim()),
    () => JSON.parse(t.replace(/```json|```/g,'').trim()),
    () => { const m = t.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw 0; },
  ]) { try { const r = fn(); if (Array.isArray(r)) return r; } catch {} }
  return null;
}


// ── Smart category & region guessing ─────────────────────────────────────
function guessCategory(text) {
  const t = text.toLowerCase();
  if (t.match(/tender|auction|bid|rfp|rfs|rfq/))           return 'Solar Tender';
  if (t.match(/wind.*auction|auction.*wind/))               return 'Wind Auction';
  if (t.match(/finance|fund|investment|loan|bond|capital/)) return 'Green Finance';
  if (t.match(/commission|install|deploy|complet|megawatt|mw |gw /)) return 'Project Commission';
  if (t.match(/policy|regulation|rule|circular|order|ministry|mnre|cerc|government/)) return 'Policy Update';
  if (t.match(/ceo|coo|cfo|md |chairman|director|appoint|resign|leadership/)) return 'Leadership Change';
  if (t.match(/acquire|acquisition|merger|stake|m&a|buy|purchase.*company/)) return 'M&A Deal';
  if (t.match(/rooftop|residential|pm surya|net meter/))   return 'Rooftop Solar';
  if (t.match(/offshore wind|floating wind/))               return 'Offshore Wind';
  if (t.match(/grid|transmission|hvdc|substation/))         return 'Grid Infrastructure';
  if (t.match(/storage|battery|bess/))                      return 'Energy Storage';
  if (t.match(/manufactur|pli|import|export|production/))   return 'Manufacturing';
  if (t.match(/result|revenue|profit|earning|q[1-4]|fy2/))  return 'Company Results';
  if (t.match(/perovskite|tandem|efficiency|breakthrough|research|lab/)) return 'Solar Tech';
  if (t.match(/hydrogen|electrolyzer|electrolys/))          return 'Green Hydrogen';
  if (t.match(/ev |electric vehicle|e-vehicle|v2g/))        return 'EV Technology';
  return 'Policy Update';
}

function guessRegion(text) {
  const t = text.toLowerCase();
  if (t.match(/india|indian|rajasthan|gujarat|tamil|maharashtra|delhi|mnre|seci|ntpc|adani|tata power|greenko|waaree|premier energies/)) return 'India';
  if (t.match(/europe|european|germany|france|spain|uk |britain|denmark|netherlands/)) return 'Europe';
  if (t.match(/us |usa|united states|american|california|texas|new york|federal/))     return 'US';
  if (t.match(/china|chinese|beijing|shanghai/))            return 'Asia';
  if (t.match(/middle east|uae|saudi|abu dhabi|dubai|oman|qatar/)) return 'Middle East';
  if (t.match(/australia|japan|korea|southeast asia|africa/)) return 'Global';
  return 'Global';
}

// ── Fallback learning cards ───────────────────────────────────────────────
function getFallbackLearnCards() {
  return [
    {
      title: "How Solar Panels Generate Electricity",
      category: "Solar Energy", difficulty: "Beginner",
      intro: "Solar panels convert sunlight directly into electricity using the photoelectric effect. Understanding this process helps you appreciate why solar is now the cheapest electricity source in history — costs have fallen over 90% since 2010, making it accessible to millions of homes and businesses globally.",
      c1_title: "⚡ The Photoelectric Effect",
      c1_text: "When photons from sunlight hit silicon atoms in a solar cell, they knock electrons loose. These free electrons flow through a circuit creating DC electricity. Think of it like a pinball machine — photons are the plunger, electrons are the balls flowing through the circuit.",
      c2_title: "🔄 Inverter Converts DC to AC",
      c2_text: "Solar panels produce DC electricity but homes use AC. An inverter acts as a translator, converting DC to AC with 97-99% efficiency. Modern hybrid inverters also manage battery storage — charging batteries from excess solar during the day and discharging them at night.",
      c3_title: "🇮🇳 India Solar Achievement",
      c3_text: "India installed 90 GW of solar by 2024, making it the 4th largest solar nation. PM Surya Ghar scheme targets 10 million rooftop installations. Solar tariffs have fallen from ₹17/unit in 2010 to under ₹2.50/unit today — cheaper than coal in many states.",
      stat1: "India: 90 GW solar installed (2024)", stat2: "Solar cost fell 90% since 2010",
      stat3: "India target: 500 GW RE by 2030", stat4: "1 MW solar powers ~800 homes",
      readUrl: "https://www.energy.gov/eere/solar/how-does-solar-work",
      readLabel: "Read at US Dept of Energy"
    },
    {
      title: "How Wind Turbines Produce Electricity",
      category: "Wind Energy", difficulty: "Beginner",
      intro: "Wind turbines convert the kinetic energy of moving air into electricity using aerodynamic lift — the same principle as aircraft wings. India is the fourth largest wind energy producer globally, with over 46 GW installed across Tamil Nadu, Gujarat, Rajasthan and Karnataka.",
      c1_title: "🌬️ Lift Creates Rotation",
      c1_text: "Turbine blades are shaped like aircraft wings — curved on top, flat below. Wind flowing over the curve creates low pressure, generating lift that pulls the blade forward. This lift rotates the rotor at 10-20 RPM. Each blade tip travels at over 300 km/h at full speed.",
      c2_title: "⚙️ From Rotor to Grid",
      c2_text: "The rotor shaft connects to a gearbox that increases rotation from 20 RPM to 1,500 RPM for the generator. Modern direct-drive turbines eliminate the gearbox entirely. The nacelle atop the tower contains all these components and automatically yaws to face the wind direction.",
      c3_title: "🇮🇳 India Wind Sector",
      c3_text: "India has 46 GW wind capacity targeting 100 GW by 2030. Offshore wind target is 30 GW with sites off Tamil Nadu and Gujarat coasts. Suzlon Energy is India's largest turbine manufacturer. Wind energy prevents approximately 50 million tonnes of CO2 emissions annually in India.",
      stat1: "India: 46 GW wind capacity (2024)", stat2: "India offshore wind target: 30 GW",
      stat3: "World largest turbine: 16 MW offshore", stat4: "Wind capacity factor: 25-35% onshore",
      readUrl: "https://www.energy.gov/eere/wind/how-do-wind-turbines-work",
      readLabel: "Read at US Dept of Energy"
    },
    {
      title: "Battery Storage — How BESS Works",
      category: "Battery Storage", difficulty: "Intermediate",
      intro: "Battery Energy Storage Systems are the critical technology making renewable energy reliable around the clock. They store excess solar and wind power and release it on demand — solving the intermittency problem that limited renewable deployment for decades.",
      c1_title: "🔋 Lithium-Ion Chemistry",
      c1_text: "BESS uses lithium-ion cells — same chemistry as mobile phones, scaled massively. During charging, lithium ions move from cathode to anode through liquid electrolyte. Discharging reverses this, releasing electricity. A Battery Management System monitors every cell for temperature, voltage and state of charge.",
      c2_title: "📊 Power vs Energy",
      c2_text: "Power (MW) measures how fast energy can flow — like water pressure in a pipe. Energy (MWh) measures total stored amount — like tank volume. A 200 MWh battery with 100 MW power gives 2 hours of storage. Round-trip efficiency of 85-92% means you recover most stored energy.",
      c3_title: "🇮🇳 India BESS Mandate",
      c3_text: "India mandates 4 hours of storage with new renewable projects under the National Electricity Plan. Government targets 47 GW of storage by 2030. NTPC, Adani and Greenko are building large projects. IREDA provides concessional loans at 8-9% for storage projects versus 12% market rate.",
      stat1: "India BESS target: 47 GW by 2030", stat2: "Li-ion cost: $130/kWh (2024) vs $1,200 (2010)",
      stat3: "Round-trip efficiency: 85-92%", stat4: "World largest BESS: 6 GWh, California",
      readUrl: "https://www.energy.gov/eere/vehicles/batteries",
      readLabel: "Read at US Dept of Energy"
    },
    {
      title: "Green Hydrogen — Fuel of the Future",
      category: "Hydrogen", difficulty: "Intermediate",
      intro: "Green hydrogen is produced by splitting water using renewable electricity — creating a zero-carbon fuel that can decarbonise heavy industry, long-distance shipping and aviation. It is the missing link for sectors that cannot be directly electrified, covering 30% of global emissions.",
      c1_title: "⚗️ Electrolysis Process",
      c1_text: "An electrolyser passes electricity through water (H₂O), splitting it into hydrogen (H₂) and oxygen (O₂). PEM (Proton Exchange Membrane) electrolysers respond quickly to variable renewable power. Alkaline electrolysers are more mature and cheaper. Both achieve 65-80% efficiency — improving rapidly with scale.",
      c2_title: "🏭 Industries That Need It",
      c2_text: "Steel, cement, shipping and aviation produce 20% of global CO2 and cannot easily run on batteries. Green hydrogen replaces coal in steel via Direct Reduced Iron process. Green ammonia (hydrogen + nitrogen) powers ships and replaces natural gas in fertiliser plants, cutting agricultural emissions.",
      c3_title: "🇮🇳 India Hydrogen Mission",
      c3_text: "India's National Green Hydrogen Mission (2023) targets 5 million tonnes annual production and $100 billion investment by 2030. The SIGHT scheme provides ₹50/kg incentive for 3 years. India aims to export green hydrogen to Europe and Japan. Reliance, NTPC and ACME are leading projects.",
      stat1: "India NGHM target: 5 MMT by 2030", stat2: "Current green H₂ cost: $4-6/kg",
      stat3: "Target cost by 2030: under $2/kg", stat4: "SIGHT incentive: ₹50/kg for 3 years",
      readUrl: "https://www.irena.org/hydrogen",
      readLabel: "Explore at IRENA"
    },
    {
      title: "Power Purchase Agreements in India Explained",
      category: "Energy Policy", difficulty: "Beginner",
      intro: "A Power Purchase Agreement (PPA) is the foundation of every renewable energy project. It provides the revenue certainty that allows developers to raise bank financing, and gives buyers guaranteed clean electricity at fixed prices — protecting both sides from market volatility for 25 years.",
      c1_title: "📄 What a PPA Contains",
      c1_text: "A PPA specifies the tariff (₹/kWh), contract duration (usually 25 years), performance guarantees, and transmission arrangements. The developer guarantees electricity supply; the buyer — usually a state DISCOM or corporate — guarantees payment. Banks lend against this guaranteed cash flow stream.",
      c2_title: "🏛️ How Competitive Bidding Works",
      c2_text: "SECI or state agencies issue tenders specifying capacity needed. Developers submit the lowest tariff they will accept. Lowest bidders win PPAs. This process drove solar tariffs from ₹17/unit in 2010 to under ₹2.50/unit today — an 85% reduction driven entirely by competition and scale.",
      c3_title: "🇮🇳 DISCOM Payment Challenge",
      c3_text: "State DISCOMs (electricity distribution companies) sometimes delay PPA signing or payments — Rajasthan and Andhra Pradesh delayed payments by 6-12 months historically. PRAAPTI portal tracks payment delays. Central government RDSS scheme is improving DISCOM financial health to ensure timely RE payments.",
      stat1: "Solar PPA tariff 2024: ₹2.15-2.50/unit", stat2: "Solar PPA tariff 2010: ₹17/unit",
      stat3: "Typical PPA duration: 25 years", stat4: "India RE under PPA: 70+ GW",
      readUrl: "https://www.irena.org/publications/2018/jan/corporate-sourcing-of-renewables",
      readLabel: "Read at IRENA"
    },
    {
      title: "Capacity Factor — What It Really Means",
      category: "Energy Policy", difficulty: "Beginner",
      intro: "Capacity factor is one of the most important yet misunderstood concepts in energy. It explains why a 100 MW solar plant never produces 100 MW continuously, and why comparing power plants purely on installed capacity is deeply misleading without understanding how much they actually generate.",
      c1_title: "📐 The Calculation",
      c1_text: "Capacity factor equals actual annual energy produced divided by maximum theoretical energy. A 100 MW solar plant at 22% capacity factor produces 22 MW on average — generating 193,000 MWh per year. The gap from 100% reflects nights, cloudy days, seasonal variation and maintenance downtime.",
      c2_title: "☀️ Comparing Technologies",
      c2_text: "Solar PV capacity factor: 18-25% (India average 22%). Onshore wind: 25-35%. Offshore wind: 40-55%. Coal: 60-85%. Nuclear: 85-95%. This is why 1 GW of nuclear produces 3-4 times more annual electricity than 1 GW of solar. Storage is essential to make variable renewables dispatchable.",
      c3_title: "🇮🇳 India Renewable Targets",
      c3_text: "India's 500 GW renewable target by 2030, assuming 30% average capacity factor, will produce roughly 1,300 TWh annually. India's current electricity consumption is 1,700 TWh/year. This means renewables alone cannot yet fully power India — making storage, pumped hydro and gas backup essential.",
      stat1: "India solar capacity factor: ~22%", stat2: "India wind capacity factor: ~28%",
      stat3: "500 GW RE target → ~1,300 TWh/year", stat4: "India electricity consumption: ~1,700 TWh/year",
      readUrl: "https://www.iea.org/reports/renewables-2024",
      readLabel: "Read at IEA"
    }
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🌱 REPower News — Real Content Generator');
  console.log(`📅 ${today}`);
  console.log('⏱️  48-hour rolling accumulation enabled\n');

  // Load existing content (for accumulation)
  let existing = { industry: [], tech: [], learn: [] };
  try {
    if (fs.existsSync(OUTPUT)) {
      existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
      console.log(`📦 Loaded existing: ${existing.industry?.length || 0} industry, ${existing.tech?.length || 0} tech\n`);
    }
  } catch(e) {
    console.warn(`⚠️  Could not load existing content: ${e.message}`);
  }

  // Step 1: Fetch RSS feeds
  console.log('📰 Fetching real news from RSS feeds...');
  const allArticles = await fetchAllFeeds();
  console.log(`\n📊 Total relevant articles fetched: ${allArticles.length}`);

  // Step 2: Split by tab
  const industryFresh = allArticles
    .filter(a => a.feedTab === 'industry' || a.feedTab === 'both')
    .slice(0, 10);

  const techFresh = allArticles
    .filter(a => (a.feedTab === 'tech' || a.feedTab === 'both') && isTech(a))
    .slice(0, 10);

  // Step 3: Summarise new articles with AI
  let industrySummarised = [], techSummarised = [];

  if (industryFresh.length > 0) {
    industrySummarised = await summarise(industryFresh, 'industry');
    await sleep(30000); // 30s gap between AI calls
  }

  if (techFresh.length > 0) {
    techSummarised = await summarise(techFresh, 'tech');
    await sleep(30000);
  }

  // Step 4: Merge with existing (48-hour rolling window)
  console.log('\n🔄 Merging with existing 48-hour window...');
  const industry = mergeWithExisting(existing, industrySummarised, 'industry');
  const tech     = mergeWithExisting(existing, techSummarised,     'tech');

  // Step 5: Generate fresh learning cards (new set every 2 hours)
  console.log('\n📚 Generating learning cards from 50+ topic pool...');
  const learn = await generateLearnCards();

  // Step 6: Save everything
  const content = {
    generatedAt:  new Date().toISOString(),
    nextUpdateAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    today,
    stats: {
      industryTotal: industry.length,
      techTotal:     tech.length,
      learnTotal:    learn.length,
      windowHours:   48,
    },
    industry,
    tech,
    learn,
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(content, null, 2));

  console.log('\n✅ DONE — Saved to data/content.json');
  console.log(`   Industry: ${industry.length} articles (48hr rolling)`);
  console.log(`   Tech:     ${tech.length} articles (48hr rolling)`);
  console.log(`   Learn:    ${learn.length} cards (fresh each run)`);
  console.log(`   Next run: ${content.nextUpdateAt}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
