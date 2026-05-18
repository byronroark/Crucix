// Google Geocoding API provider.
// Docs: https://developers.google.com/maps/documentation/geocoding/overview
//
// Requires the "Geocoding API" enabled in Google Cloud Console (separate
// from the JavaScript Maps embed). The legacy unsigned key (no referrer
// restriction) works for server-side use.

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';
const TIMEOUT_MS = 8000;

/**
 * Geocode a free-text query via Google.
 * @param {string} query
 * @param {string} apiKey
 * @returns {Promise<{lat:number, lon:number, formatted:string}|null>}
 */
export async function geocodeGoogle(query, apiKey) {
  if (!query || !apiKey) return null;
  const url = `${ENDPOINT}?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'Crucix/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Google geocode HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') {
    throw new Error(`Google geocode status=${data.status}${data.error_message ? `: ${data.error_message}` : ''}`);
  }
  const hit = data.results?.[0];
  if (!hit?.geometry?.location) return null;
  return {
    lat: hit.geometry.location.lat,
    lon: hit.geometry.location.lng,
    formatted: hit.formatted_address || query,
  };
}
