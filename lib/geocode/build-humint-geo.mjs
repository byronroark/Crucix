// Geocode Telegram urgent/top posts for the HUMINT / OSINT map layer.
// Replaces hardcoded Ukraine-region pin offsets. Unlocated posts stay in
// the ticker / OSINT feed but are omitted from the map.

import { resolveCoords } from './index.mjs';

const SWEEP_GEOCODE_BUDGET = 12;
const MAX_MAP_POSTS = 40;
const JITTER_DEG = 0.25;

/**
 * @param {Array} urgentPosts
 * @param {Array} topPosts
 * @returns {Promise<Array>} { channel, text, views, date, lat, lon, region, method, urgent, url? }
 */
export async function buildHumintGeo(urgentPosts = [], topPosts = []) {
  const pool = [];
  const seen = new Set();

  const push = (p, urgent) => {
    if (!p?.text) return;
    const key = `${(p.channel || '').toLowerCase()}|${String(p.text).slice(0, 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ ...p, _urgent: urgent });
  };

  for (const p of urgentPosts || []) push(p, true);
  for (const p of topPosts || []) push(p, false);

  // Prefer urgent, then highest views
  pool.sort((a, b) => {
    if (a._urgent !== b._urgent) return a._urgent ? -1 : 1;
    return (b.views || 0) - (a.views || 0);
  });

  const budget = { remaining: SWEEP_GEOCODE_BUDGET };
  const out = [];

  for (const p of pool) {
    if (out.length >= MAX_MAP_POSTS) break;
    const channel = p.channel || 'telegram';
    const source = {
      name: channel,
      region: 'OSINT',
      geocode: true,
    };
    const item = {
      title: String(p.text || '').slice(0, 200),
      source: channel,
      region: 'OSINT',
    };

    let coords;
    try {
      coords = await resolveCoords({ item, source, budget });
    } catch (err) {
      console.error(`[humintGeo] resolve failed for "${item.title.slice(0, 60)}":`, err.message);
      continue;
    }
    if (!coords) continue;

    out.push({
      channel,
      text: String(p.text || '').slice(0, 280),
      views: p.views ?? null,
      date: p.date || null,
      urgentFlags: p.urgentFlags || [],
      urgent: Boolean(p._urgent),
      lat: coords.lat + (Math.random() - 0.5) * 2 * JITTER_DEG,
      lon: coords.lon + (Math.random() - 0.5) * 2 * JITTER_DEG,
      region: coords.region || 'OSINT',
      method: coords.method,
      url: p.url || (channel ? `https://t.me/s/${channel}` : undefined),
    });
  }

  return out;
}
