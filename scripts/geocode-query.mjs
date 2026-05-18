#!/usr/bin/env node
// CLI helper: look up coordinates for a free-text query so you can paste
// them into crucix.config.mjs customSources entries.
//
// Usage:
//   npm run geocode:query -- "Kyiv, Ukraine"
//   npm run geocode:query -- "Strait of Hormuz" --no-cache
//
// Uses Google Geocoding API if GOOGLE_GEOCODING_API_KEY is set in your
// env, otherwise falls back to OpenStreetMap Nominatim. Results are
// disk-cached the same way the live sweep caches them.

import { geocodeQuery } from '../lib/geocode/index.mjs';

const args = process.argv.slice(2);
const ignoreCache = args.includes('--no-cache');
const query = args.filter(a => !a.startsWith('--')).join(' ').trim();

if (!query) {
  console.error('Usage: npm run geocode:query -- "City, Country" [--no-cache]');
  process.exit(1);
}

try {
  const hit = await geocodeQuery(query, { ignoreCache });
  if (!hit) {
    console.log(`No result for "${query}"`);
    process.exit(2);
  }
  console.log('');
  console.log(`Query     : ${query}`);
  console.log(`Provider  : ${hit.provider}`);
  console.log(`Formatted : ${hit.formatted || '(n/a)'}`);
  console.log(`Coordinates: lat=${hit.lat.toFixed(4)} lon=${hit.lon.toFixed(4)}`);
  console.log('');
  console.log('Paste into crucix.config.mjs:');
  console.log(`  lat: ${hit.lat.toFixed(4)},`);
  console.log(`  lon: ${hit.lon.toFixed(4)},`);
  console.log('');
} catch (err) {
  console.error('Lookup failed:', err.message);
  process.exit(3);
}
