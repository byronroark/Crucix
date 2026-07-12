/** Extract a representative lat/lon from GeoJSON geometry. */

export function extractCentroid(geo) {
  if (!geo) return { lat: null, lon: null };
  if (geo.type === 'Point' && geo.coordinates?.length >= 2) {
    const [lon, lat] = geo.coordinates;
    return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  }
  if (geo.type === 'Polygon' && geo.coordinates?.[0]?.length) {
    const coords = geo.coordinates[0];
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  }
  if (geo.type === 'MultiPolygon' && geo.coordinates?.[0]?.[0]?.length) {
    const coords = geo.coordinates[0][0];
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
  }
  if (geo.type === 'GeometryCollection' && geo.geometries?.length) {
    for (const g of geo.geometries) {
      const c = extractCentroid(g);
      if (c.lat != null) return c;
    }
  }
  if (geo.type === 'LineString' && geo.coordinates?.length) {
    const mid = geo.coordinates[Math.floor(geo.coordinates.length / 2)];
    return { lat: +mid[1].toFixed(3), lon: +mid[0].toFixed(3) };
  }
  return { lat: null, lon: null };
}

export function lineToArcs(coords, { color, stroke = 0.5, label = '', hurricane = false, model = '' } = {}) {
  const arcs = [];
  if (!coords || coords.length < 2) return arcs;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    arcs.push({
      startLat: lat1,
      startLng: lon1,
      endLat: lat2,
      endLng: lon2,
      color: color || ['rgba(255,152,0,0.85)', 'rgba(255,152,0,0.25)'],
      stroke,
      label,
      hurricane,
      model,
    });
  }
  return arcs;
}
