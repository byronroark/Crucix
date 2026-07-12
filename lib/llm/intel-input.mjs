// Multi-pool intel input harvester — normalizes V2 sweep data into LLM context.

const DEFAULT_POOL_CAPS = {
  gdelt: 6,
  telegram: 5,
  who: 4,
  acled: 4,
  delta: 5,
  noaa: 3,
  earthquakes: 2,
  news: 4,
  reliefweb: 4,
  cisa: 4,
  cloudflare: 3,
  patents: 3,
  bluesky: 4,
  reddit: 4,
  sanctions: 4,
  adsb: 3,
  customAnalyzed: 4,
  defense: 3,
  fred: 4,
  bls: 3,
  markets: 3,
};

const DEFAULT_MAX_CHARS = 8000;
const PER_ITEM_CHARS = 400;

function clip(s, n = PER_ITEM_CHARS) {
  return String(s || '').replace(/\s+/g, ' ').trim().substring(0, n);
}

function norm(pool, name, title, content, region = 'Global', tags = []) {
  if (!title && !content) return null;
  return {
    pool,
    name: name || pool,
    title: clip(title, 180),
    content: clip(content),
    region: region || 'Global',
    tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
  };
}

function poolCaps(config) {
  return { ...DEFAULT_POOL_CAPS, ...(config?.intelAnalysis?.pools || {}) };
}

function maxChars(config) {
  return config?.intelAnalysis?.maxInputChars || DEFAULT_MAX_CHARS;
}

function minPools(config) {
  return config?.intelAnalysis?.minPoolsForRun ?? 2;
}

/** @returns {boolean} */
export function hasIntelInput(sweepData, config = {}) {
  if (config?.intelAnalysis?.enabled === false) return false;
  const { poolCounts } = harvestIntelItems(sweepData, config);
  const activePools = Object.values(poolCounts).filter(n => n > 0).length;
  return activePools >= minPools(config);
}

/** @returns {{ items: object[], sections: string, poolCounts: Record<string, number>, hasInput: boolean }} */
export function harvestIntelItems(sweepData, config = {}) {
  const caps = poolCaps(config);
  const harvested = [];

  const add = (pool, items) => {
    const cap = caps[pool] ?? 0;
    if (!cap || !items?.length) return;
    for (const it of items.slice(0, cap)) {
      if (it) harvested.push(it);
    }
  };

  // GDELT
  add('gdelt', (sweepData?.gdelt?.articles || []).map(a =>
    norm('GDELT', a.domain || 'GDELT', a.title,
      [a.country, a.date].filter(Boolean).join(' · '), 'Global', ['gdelt'])
  ));

  // Telegram
  const tgPosts = [
    ...(sweepData?.tg?.urgent || []).map(p => ({ ...p, _kind: 'urgent' })),
    ...(sweepData?.tg?.topPosts || []).map(p => ({ ...p, _kind: 'top' })),
  ];
  add('telegram', tgPosts.map(p =>
    norm('Telegram', p.channel || 'Telegram', (p.text || '').substring(0, 120),
      p.text, 'Global', ['telegram', p._kind])
  ));

  // WHO
  add('who', (sweepData?.who || []).map(w =>
    norm('WHO', 'WHO', w.title, w.summary, 'Global', ['health', 'who'])
  ));

  // ACLED
  add('acled', (sweepData?.acled?.deadliestEvents || []).map(e =>
    norm('ACLED', 'ACLED', `${e.type || 'Event'} — ${e.location || e.country || 'Unknown'}`,
      [e.notes, e.fatalities ? `${e.fatalities} fatalities` : '', e.date].filter(Boolean).join('. '),
      regionFromCountry(e.country), ['conflict', 'acled'])
  ));

  // Delta escalations + new signals
  const delta = sweepData?.delta || sweepData?._delta;
  const deltaItems = [];
  for (const s of (delta?.signals?.escalated || [])) {
    deltaItems.push(norm('Delta', 'Delta', s.label || 'Escalated signal',
      `${s.previous} → ${s.current} (${(s.changePct || 0) > 0 ? '+' : ''}${(s.changePct || 0).toFixed?.(1) ?? s.changePct}%)`,
      'Global', ['delta', 'escalated']));
  }
  for (const s of (delta?.signals?.new || [])) {
    deltaItems.push(norm('Delta', 'Delta', s.label || 'New signal', s.text || s.signal || '', 'Global', ['delta', 'new']));
  }
  add('delta', deltaItems);

  // NOAA / unified weather dots
  const weatherDots = sweepData?.weatherAlerts?.dots?.length
    ? sweepData.weatherAlerts.dots
    : (sweepData?.noaa?.alerts || []);
  add('noaa', weatherDots.map(a =>
    norm('NOAA', a.sourceLabel || 'NOAA', a.headline || a.event,
      `${a.event} — ${a.severity || a.subtype || ''}`, 'Americas', ['weather', a.subtype || 'noaa'])
  ));

  // USGS earthquakes
  add('earthquakes', (sweepData?.earthquakes?.events || []).map(e =>
    norm('USGS', 'USGS', `M${e.magnitude} — ${e.place}`,
      `Depth ${e.depth ?? '?'} km${e.tsunami ? ' · tsunami flag' : ''}`, 'Global', ['earthquake', 'usgs'])
  ));

  // Built-in RSS (dedupe against GDELT titles)
  const gdeltTitles = new Set((sweepData?.gdelt?.articles || []).map(a => (a.title || '').toLowerCase().slice(0, 40)));
  const newsItems = (sweepData?.news || [])
    .filter(n => !gdeltTitles.has((n.title || '').toLowerCase().slice(0, 40)))
    .map(n => norm('World News', n.source || 'RSS', n.title, n.title, n.region || 'Global', ['rss']));
  add('news', newsItems);

  // Defense contracts
  add('defense', (sweepData?.defense || []).map(c =>
    norm('USAspending', c.recipient || 'Defense', c.desc || 'Defense contract',
      `$${c.amount} — ${c.desc}`, 'Americas', ['defense'])
  ));

  // Custom analyzed (user RSS tier:analyzed)
  add('customAnalyzed', (sweepData?.customAnalyzed || []).map(it =>
    norm(it.name || 'Custom', it.name || 'Custom', it.title, it.content, it.region || 'Custom', it.tags || ['custom'])
  ));

  // ReliefWeb
  const rw = sweepData?.reliefweb || {};
  const rwItems = [
    ...(rw.latestReports || []).map(r =>
      norm('ReliefWeb', 'ReliefWeb', r.title,
        [(r.countries || []).join(', '), (r.disasterType || []).join(', '), r.source].filter(Boolean).join(' · '),
        regionFromCountry((r.countries || [])[0]), ['humanitarian'])
    ),
    ...(rw.activeDisasters || []).map(d =>
      norm('ReliefWeb', 'ReliefWeb', d.name,
        [(d.countries || []).join(', '), d.type, d.status].filter(Boolean).join(' · '),
        regionFromCountry((d.countries || [])[0]), ['disaster'])
    ),
    ...(rw.hdxDatasets || []).map(h =>
      norm('HDX', 'HDX', h.title, h.source || '', 'Global', ['humanitarian', 'hdx'])
    ),
  ];
  add('reliefweb', rwItems);

  // CISA KEV
  add('cisa', (sweepData?.cisa?.vulnerabilities || []).map(v =>
    norm('CISA-KEV', 'CISA-KEV', `${v.vendorProject} ${v.product} — ${v.vulnerabilityName || 'CVE'}`,
      v.shortDescription, 'Global', ['cyber', 'cve'])
  ));

  // Cloudflare Radar
  const cfItems = [];
  for (const o of (sweepData?.cloudflare?.outages?.activeEvents || [])) {
    cfItems.push(norm('Cloudflare', 'Cloudflare', o.description?.substring(0, 100) || o.eventType || 'Internet outage',
      [(o.locations || []).join(', '), o.scope, o.startDate].filter(Boolean).join(' · '),
      'Global', ['internet', 'outage']));
  }
  for (const s of (sweepData?.cloudflare?.signals || [])) {
    cfItems.push(norm('Cloudflare', 'Cloudflare', 'Traffic signal', s.signal || s, 'Global', ['internet']));
  }
  add('cloudflare', cfItems);

  // Patents
  const patentItems = [];
  const rp = sweepData?.patents?.recentPatents || {};
  for (const [domain, patents] of Object.entries(rp)) {
    for (const p of (patents || [])) {
      patentItems.push(norm('Patents', p.assignee || 'Patents', p.title,
        `${domain}: ${p.assignee} (${p.date})`, 'Global', ['patents', domain]));
    }
  }
  for (const s of (sweepData?.patents?.signals || [])) {
    if (typeof s === 'string') patentItems.push(norm('Patents', 'Patents', 'Patent signal', s, 'Global', ['patents']));
  }
  add('patents', patentItems);

  // Bluesky
  const bsTopics = sweepData?.bluesky?.topics || {};
  const bsItems = [];
  for (const [topic, posts] of Object.entries(bsTopics)) {
    for (const p of (posts || [])) {
      bsItems.push(norm('Bluesky', p.author || 'Bluesky', (p.text || '').substring(0, 100),
        p.text, 'Global', ['social', topic]));
    }
  }
  add('bluesky', bsItems);

  // Reddit
  const redditItems = [];
  for (const [sub, posts] of Object.entries(sweepData?.reddit?.subreddits || {})) {
    for (const p of (posts || [])) {
      redditItems.push(norm('Reddit', `r/${sub}`, p.title,
        `${p.score || 0} pts`, 'Global', ['social', 'reddit']));
    }
  }
  add('reddit', redditItems);

  // Sanctions (OpenSanctions + OFAC)
  const sanctionItems = [];
  for (const r of (sweepData?.sanctions?.recentSearches || [])) {
    for (const e of (r.entities || [])) {
      sanctionItems.push(norm('OpenSanctions', 'OpenSanctions', e.name,
        [(e.topics || []).join(', '), (e.countries || []).join(', ')].filter(Boolean).join(' · '),
        regionFromCountry((e.countries || [])[0]), ['sanctions']));
    }
  }
  for (const e of (sweepData?.sanctions?.ofacSamples || [])) {
    sanctionItems.push(norm('OFAC', 'OFAC', e.name,
      [(e.programs || []).join(', '), e.type].filter(Boolean).join(' · '), 'Global', ['sanctions', 'ofac']));
  }
  add('sanctions', sanctionItems);

  // ADS-B military signals
  const adsbItems = (sweepData?.adsb?.signals || []).map(s =>
    norm('ADS-B', 'ADS-B', typeof s === 'string' ? 'Military flight' : 'Military flight',
      typeof s === 'string' ? s : s.signal || '', 'Global', ['military', 'adsb'])
  );
  add('adsb', adsbItems);

  // FRED macro indicators
  const fredItems = (sweepData?.fred || []).map(f =>
    norm('FRED', f.id || 'FRED', f.label || f.id,
      `${f.value}${f.date ? ` (${f.date})` : ''}`, 'Global', ['macro', 'fred'])
  );
  add('fred', fredItems);

  // BLS labor / inflation
  const blsItems = (sweepData?.bls || []).map(b =>
    norm('BLS', b.id || 'BLS', b.label || b.id,
      `${b.value}${b.period ? ` · ${b.period}` : ''}${b.momChangePct != null ? ` · MoM ${b.momChangePct}%` : ''}`,
      'Americas', ['macro', 'labor'])
  );
  add('bls', blsItems);

  // Live markets (indexes + key commodities)
  const marketItems = [];
  for (const idx of (sweepData?.markets?.indexes || [])) {
    marketItems.push(norm('Markets', idx.name || idx.symbol, idx.name || idx.symbol,
      `$${idx.price}${idx.changePct != null ? ` (${idx.changePct >= 0 ? '+' : ''}${idx.changePct}%)` : ''}`,
      'Global', ['markets', 'equities']));
  }
  for (const cmd of (sweepData?.markets?.commodities || []).slice(0, 4)) {
    marketItems.push(norm('Markets', cmd.name || cmd.symbol, cmd.name || cmd.symbol,
      `$${cmd.price}${cmd.changePct != null ? ` (${cmd.changePct >= 0 ? '+' : ''}${cmd.changePct}%)` : ''}`,
      'Global', ['markets', 'commodities']));
  }
  if (sweepData?.markets?.vix?.value != null) {
    marketItems.push(norm('Markets', 'VIX', 'VIX Fear Index',
      `${sweepData.markets.vix.value}${sweepData.markets.vix.changePct != null ? ` (${sweepData.markets.vix.changePct}%)` : ''}`,
      'Global', ['markets', 'volatility']));
  }
  add('markets', marketItems);

  const poolCounts = {};
  for (const it of harvested) {
    const key = it.pool === 'GDELT' ? 'gdelt'
      : it.pool === 'Telegram' ? 'telegram'
      : it.pool === 'WHO' ? 'who'
      : it.pool === 'ACLED' ? 'acled'
      : it.pool === 'Delta' ? 'delta'
      : it.pool === 'NOAA' ? 'noaa'
      : it.pool === 'USGS' ? 'earthquakes'
      : it.pool === 'World News' ? 'news'
      : it.pool === 'USAspending' ? 'defense'
      : it.pool === 'ReliefWeb' || it.pool === 'HDX' ? 'reliefweb'
      : it.pool === 'CISA-KEV' ? 'cisa'
      : it.pool === 'Cloudflare' ? 'cloudflare'
      : it.pool === 'Patents' ? 'patents'
      : it.pool === 'Bluesky' ? 'bluesky'
      : it.pool === 'Reddit' ? 'reddit'
      : it.pool === 'OpenSanctions' || it.pool === 'OFAC' ? 'sanctions'
      : it.pool === 'ADS-B' ? 'adsb'
      : it.pool === 'FRED' ? 'fred'
      : it.pool === 'BLS' ? 'bls'
      : it.pool === 'Markets' ? 'markets'
      : it.name && sweepData?.customAnalyzed?.some(c => c.name === it.name) ? 'customAnalyzed'
      : 'other';
    poolCounts[key] = (poolCounts[key] || 0) + 1;
  }

  const activePools = Object.values(poolCounts).filter(n => n > 0).length;
  const hasInput = activePools >= minPools(config);

  return { items: harvested, sections: formatSections(harvested, sweepData, config), poolCounts, hasInput };
}

function formatSections(items, sweepData, config) {
  if (!items.length) return null;

  const budget = maxChars(config);
  const byPool = new Map();
  for (const it of items) {
    if (!byPool.has(it.pool)) byPool.set(it.pool, []);
    byPool.get(it.pool).push(it);
  }

  const lines = [];
  let remaining = budget;
  for (const [pool, poolItems] of byPool) {
    if (remaining <= 0) break;
    lines.push(`${pool.toUpperCase()}:`);
    for (const it of poolItems) {
      if (remaining <= 0) break;
      const tags = it.tags?.length ? ` [${it.tags.join(',')}]` : '';
      const line = `- [${it.name} | ${it.region}${tags}] ${it.title}\n  ${it.content}`;
      if (line.length > remaining) {
        lines.push(line.substring(0, Math.max(0, remaining)));
        remaining = 0;
        break;
      }
      lines.push(line);
      remaining -= line.length;
    }
    lines.push('');
  }

  const sections = [`OSINT_INPUT:\n${lines.join('\n').trim()}`];

  const delta = sweepData?.delta || sweepData?._delta;
  if (delta?.summary) {
    sections.push(`DELTA_SUMMARY: direction=${delta.summary.direction}, changes=${delta.summary.totalChanges}, critical=${delta.summary.criticalChanges}`);
  }

  return sections.join('\n\n');
}

/** Build full LLM user context string. */
export function buildIntelContext(sweepData, config = {}) {
  const { sections, hasInput } = harvestIntelItems(sweepData, config);
  return hasInput ? sections : null;
}

function regionFromCountry(country) {
  if (!country) return 'Global';
  const c = String(country).toLowerCase();
  if (/united states|canada|mexico|brazil|florida/.test(c)) return 'Americas';
  if (/ukraine|russia|germany|france|uk|britain|europe/.test(c)) return 'Europe';
  if (/china|japan|korea|india|taiwan|asia/.test(c)) return 'Asia';
  if (/iran|iraq|syria|israel|gaza|yemen|saudi|middle/.test(c)) return 'Middle East';
  if (/africa|sudan|congo|nigeria|ethiopia/.test(c)) return 'Africa';
  return 'Global';
}
