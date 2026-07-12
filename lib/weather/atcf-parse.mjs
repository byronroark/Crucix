/** Parse NHC ATCF a-deck text into model forecast tracks. */

function parseLatLon(latStr, lonStr) {
  const latM = String(latStr || '').match(/^(\d+(?:\.\d+)?)([NS])$/i);
  const lonM = String(lonStr || '').match(/^(\d+(?:\.\d+)?)([EW])$/i);
  if (!latM || !lonM) return null;
  let lat = parseFloat(latM[1]);
  let lon = parseFloat(lonM[1]);
  if (latM[2].toUpperCase() === 'S') lat = -lat;
  if (lonM[2].toUpperCase() === 'E') lon = -lon;
  return { lat, lon };
}

export function parseAdeckLines(text) {
  const tracks = new Map();
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 8) continue;
    const tech = (parts[4] || '').toUpperCase();
    const tau = parseInt(parts[5], 10);
    if (!tech || Number.isNaN(tau)) continue;
    const pos = parseLatLon(parts[6], parts[7]);
    if (!pos) continue;
    if (!tracks.has(tech)) tracks.set(tech, []);
    tracks.get(tech).push({ tau, lat: pos.lat, lon: pos.lon });
  }
  for (const pts of tracks.values()) {
    pts.sort((a, b) => a.tau - b.tau);
  }
  return tracks;
}

export function tracksToArcs(tech, points, opts = {}) {
  if (!points?.length) return [];
  const coords = points.map(p => [p.lon, p.lat]);
  const arcs = [];
  for (let i = 0; i < coords.length - 1; i++) {
    arcs.push({
      startLat: coords[i][1],
      startLng: coords[i][0],
      endLat: coords[i + 1][1],
      endLng: coords[i + 1][0],
      color: opts.color || ['rgba(255,152,0,0.85)', 'rgba(255,152,0,0.25)'],
      stroke: opts.stroke ?? 0.5,
      label: opts.label || tech,
      hurricane: true,
      model: tech,
      modelId: opts.modelId || null,
    });
  }
  return arcs;
}
