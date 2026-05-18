// OpenStreetMap Nominatim geocoding provider (free fallback).
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// - Identify yourself via User-Agent (we send "Crucix/1.0")
// - Max ~1 request/second per IP — we serialize calls via a tiny throttle
// - No bulk/heavy use

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;
let chain = Promise.resolve();

function throttle() {
  chain = chain.then(async () => {
    const since = Date.now() - lastCallAt;
    if (since < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - since));
    }
    lastCallAt = Date.now();
  });
  return chain;
}

/**
 * Geocode a free-text query via Nominatim.
 * @param {string} query
 * @returns {Promise<{lat:number, lon:number, formatted:string}|null>}
 */
export async function geocodeNominatim(query) {
  if (!query) return null;
  await throttle();
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Crucix/1.0 (https://github.com/calesthio/Crucix)' },
  });
  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }
  const arr = await res.json();
  const hit = Array.isArray(arr) ? arr[0] : null;
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, formatted: hit.display_name || query };
}
