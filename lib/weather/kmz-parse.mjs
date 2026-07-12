/** Minimal KMZ → KML text + coordinate extraction (no external deps). */

import { inflateRawSync } from 'zlib';

export function kmlFromKmzBuffer(buf) {
  let off = 0;
  while (off < buf.length - 30) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const comp = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString();
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (name.endsWith('.kml')) {
      return comp === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8');
    }
    off = dataStart + compSize;
  }
  return null;
}

export async function kmlFromKmzUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Crucix/1.0' } });
  if (!res.ok) return null;
  return kmlFromKmzBuffer(Buffer.from(await res.arrayBuffer()));
}

/** Parse lon,lat pairs from first <coordinates> block in KML. */
export function parseKmlCoordinates(kml) {
  const blocks = [...String(kml || '').matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  const coords = [];
  for (const block of blocks) {
    const pairs = block[1].trim().split(/\s+/).filter(Boolean);
    for (const pair of pairs) {
      const [lon, lat] = pair.split(',').map(Number);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) coords.push([lon, lat]);
    }
    if (coords.length >= 2) break;
  }
  return coords;
}

export async function fetchKmzCoordinates(url) {
  const kml = await kmlFromKmzUrl(url);
  if (!kml) return [];
  return parseKmlCoordinates(kml);
}
