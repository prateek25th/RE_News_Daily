// scripts/generate.js
// Runs on GitHub Actions every 2 hours.
// Calls Gemini API once → saves all content to data/content.json
// Users read from content.json — no API calls on their end. 

const fs   = require('fs');
const path = require('path');

const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_KEY) {
  console.error('❌ GROQ_API_KEY environment variable not set.');
  console.error('   Go to GitHub repo → Settings → Secrets → New secret → GROQ_API_KEY');
  process.exit(1);
}

// ── Prompts ────────────────────────────────────────────────────────────────

const today = new Date().toLocaleDateString('en-IN', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

const INDUSTRY_PROMPT = `You are editor of REPower News. Today is ${today}.

Generate 10 renewable energy INDUSTRY & BUSINESS news articles from the last 7 days.
Cover a DIVERSE mix — NOT just tenders. Include:
- Leadership changes (CEO/MD/Chairman appointments in RE companies)
- Government statements (what India ministers said about RE sector)
- New regulations (MNRE circulars, CERC/SERC orders, policy notifications)
- Company earnings, fundraising, IPOs, partnerships
- International RE deals and climate finance agreements
- Capacity additions and records broken
- Grid and transmission infrastructure updates
- Manufacturing news (PLI scheme, import duties, production milestones)
- Green bonds and sustainability-linked financing
- Newspaper headlines about major RE developments

India entities: Adani Green Energy, NTPC Renewable, ReNew Power, Tata Power Solar, Greenko, Torrent Power, JSW Energy, Waaree Energies, Premier Energies, Vikram Solar, SECI, MNRE, IREDA, CERC, Hero Future Energies, Avaada Energy.
Global entities: Orsted, Vestas, Siemens Gamesa, Shell Renewables, BP, Equinor, RWE, Enel Green Power, NextEra Energy, Iberdrola.
Mix: 6 India + 4 global. All different topics and companies.

Return ONLY a valid JSON array. Each object:
{
  "headline": "compelling headline max 12 words",
  "summary": "80-90 words. Start with entity name. Include specific figures MW/GW, crore/billion, location, timeline, significance.",
  "source": "one of: Economic Times|Business Standard|Livemint|Financial Express|The Hindu|Times of India|Business Line|Solar Quarter|Mercom India|PV Magazine|NDTV|Hindustan Times|Reuters|Bloomberg|AP News|Down To Earth|Deccan Herald",
  "searchQuery": "6-8 words + 2025 for Google News search",
  "category": "one of: Solar Tender|Wind Auction|Green Finance|Project Commission|Policy Update|Leadership Change|Regulation|Market Analysis|Company Results|International Deal|Grid Infrastructure|Manufacturing|Rooftop Solar|Energy Storage|Offshore Wind",
  "region": "India or Global or Europe or US or Middle East",
  "validity": 8,
  "validityReason": "Industry publication cited",
  "timeAgo": "1h ago to 6 days ago"
}

JSON array only. No markdown. Start with [ end with ]`;

const TECH_PROMPT = `You are editor of REPower News. Today is ${today}.

Generate 10 renewable energy TECHNOLOGY & INNOVATION articles from the last 7 days.
Pick 10 completely different topics from:
perovskite solar cells, tandem solar, solid-state batteries, sodium-ion batteries, green hydrogen electrolyzers, floating offshore wind, iron-air storage, AI grid management, building-integrated PV, agrivoltaics, wave energy, vehicle-to-grid, virtual power plants, compressed air storage, green ammonia, bifacial solar records, offshore wind size records, battery recycling, gravity storage, tidal energy, EV second-life batteries, solar desalination, smart inverters, HVDC transmission.

Institutions: NREL, MIT, IIT, Fraunhofer ISE, Tesla Energy, QuantumScape, Northvolt, Form Energy, Nel Hydrogen, ITM Power, LONGi Solar, Siemens Energy.

Return ONLY a valid JSON array. Each object:
{
  "headline": "technology headline max 12 words",
  "summary": "80-90 words. Start with institution/company. Include efficiency %, cost/kWh, % improvement, timeline.",
  "source": "one of: CleanTechnica|Electrek|PV Magazine|IRENA|IEA|Solar Power World|Green Tech Media|Bloomberg NEF|MIT Technology Review|Nature Energy|Science Daily|Wood Mackenzie|Canary Media|RE World",
  "searchQuery": "6-8 words + 2025 for Google News search",
  "category": "one of: Solar Tech|Battery Innovation|Green Hydrogen|Offshore Wind Tech|Grid Technology|EV Technology|Energy Storage|Carbon Tech|Smart Grid|Agrivoltaics|Wave Energy|Building Solar|Tidal Energy|Green Ammonia",
  "region": "Global or Europe or US or India or Asia",
  "validity": 8,
  "validityReason": "Research institution cited",
  "timeAgo": "1h ago to 6 days ago"
}

JSON array only. No markdown. Start with [ end with ]`;

const LEARN_TOPICS = [
  'How solar PV panels generate electricity using the photoelectric effect',
  'How wind turbines produce power through aerodynamics and generators',
  'How lithium-ion battery storage works and its grid applications',
  'How the electricity grid balances supply and demand in real time',
  'Green hydrogen production through water electrolysis explained',
  'How offshore wind farms are built and connected to shore',
  'What is a Power Purchase Agreement and how it works in India',
  'How electric vehicles work including motors and regenerative braking',
  'Perovskite solar cells — why they may replace silicon panels soon',
  'Agrivoltaics — combining solar panels with farming for dual benefit',
  'Vehicle-to-grid technology — EVs stabilising the power grid',
  'How pumped hydro storage works as the world oldest battery',
  'Net metering — how rooftop solar owners earn from surplus power',
  'Capacity factor — why a 100MW solar plant produces less than 100MW',
  'India ISTS waiver and how it made renewable energy cheaper',
];

// Pick 8 random topics each run for variety
const chosenTopics = [...LEARN_TOPICS].sort(() => Math.random() - 0.5).slice(0, 8);

const LEARN_PROMPT = `You are a renewable energy educator. Create 8 educational learning cards.

Topics:
${chosenTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY a valid JSON array. Each object must have ONLY flat string fields:
{
  "title": "clear educational title max 10 words",
  "category": "Solar Energy|Wind Energy|Battery Storage|Grid & Systems|Hydrogen|EV & Transport|Ocean Energy|Energy Policy",
  "difficulty": "Beginner or Intermediate or Advanced",
  "intro": "65-70 word engaging introduction explaining why this matters",
  "c1_title": "First concept title with emoji",
  "c1_text": "55 word explanation with analogy",
  "c2_title": "Second concept title with emoji",
  "c2_text": "55 word explanation building on first",
  "c3_title": "Third concept title with emoji — include India context",
  "c3_text": "55 word explanation with India data or policy",
  "stat1": "short fact with number",
  "stat2": "short fact with number",
  "stat3": "short fact with number",
  "stat4": "short fact with number",
  "readUrl": "real URL from irena.org, iea.org, mnre.gov.in, or nrel.gov",
  "readLabel": "short label e.g. Explore at IRENA"
}

All values plain strings. JSON array only. No markdown. Start with [ end with ]`;

// ── Call Gemini ─────────────────────────────────────────────────────────────

async function callGemini(prompt, label) {
  console.log(`  📡 Calling Gemini for: ${label}...`);

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens:  6000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status} for ${label}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';

  // Parse JSON — try multiple strategies
  const strategies = [
    () => JSON.parse(text.trim()),
    () => JSON.parse(text.replace(/```json|```/g, '').trim()),
    () => { const m = text.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw new Error('no match'); },
  ];

  for (const fn of strategies) {
    try {
      const parsed = fn();
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`  ✅ ${label}: ${parsed.length} items`);
        return parsed;
      }
    } catch {}
  }

  throw new Error(`Could not parse Gemini response for ${label}. Raw: ${text.slice(0, 300)}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 REPower News — Content Generator');
  console.log(`📅 ${today}\n`);

  // Small delay between calls to respect Gemini rate limits (15 req/min free)
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let industry, tech, learn;

  try {
    industry = await callGemini(INDUSTRY_PROMPT, 'Industry News');
    await sleep(5000); // 5 second gap between calls
    tech     = await callGemini(TECH_PROMPT,     'Tech & Innovation');
    await sleep(5000);
    learn    = await callGemini(LEARN_PROMPT,    'Learning Tech');
  } catch(err) {
    console.error('\n❌ Generation failed:', err.message);
    process.exit(1);
  }

  const content = {
    generatedAt:  new Date().toISOString(),
    nextUpdateAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    today,
    industry,
    tech,
    learn,
  };

  // Save to data/content.json
  const outputPath = path.join(__dirname, '..', 'data', 'content.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(content, null, 2));

  console.log(`\n✅ Saved to data/content.json`);
  console.log(`   Industry: ${industry.length} articles`);
  console.log(`   Tech:     ${tech.length} articles`);
  console.log(`   Learn:    ${learn.length} cards`);
  console.log(`   Next run: ${content.nextUpdateAt}`);
}

main();
