/** ATCF model TECH id registry for hurricane track dropdown. */

export const HURRICANE_MODELS = [
  { id: 'official', label: 'Official NHC', techs: ['OFCL', 'OFCI'] },
  { id: 'ecmwf', label: 'ECMWF (European)', techs: ['EMXI', 'EGRI', 'EMX', 'ECMF'] },
  { id: 'gfs', label: 'GFS', techs: ['AVNI', 'AVNO', 'GFSO', 'GFSI'] },
  { id: 'hafs', label: 'HAFS', techs: ['HFAI', 'HFBI', 'HFSA', 'HFSB'] },
  { id: 'ukmet', label: 'UKMET', techs: ['UKMI', 'UKX', 'EGRR'] },
  { id: 'cmc', label: 'Canadian (CMC)', techs: ['CMCI', 'CMC', 'CMCI'] },
  { id: 'consensus', label: 'Consensus (TVCA)', techs: ['TVCA', 'TVCN', 'GFEX'] },
];

export const SPAGHETTI_TECH_BLOCKLIST = new Set([
  'OFCL', 'OFCI', 'CARQ', 'WRNG', 'BEST', 'TEST',
]);

export function modelIdForTech(tech) {
  const t = String(tech || '').toUpperCase();
  for (const m of HURRICANE_MODELS) {
    if (m.techs.includes(t)) return m.id;
  }
  return null;
}

export function labelForTech(tech) {
  const t = String(tech || '').toUpperCase();
  for (const m of HURRICANE_MODELS) {
    if (m.techs.includes(t)) return `${m.label} (${t})`;
  }
  return t;
}

export function availableModelIds(foundTechs) {
  const ids = new Set(['official', 'spaghetti']);
  for (const tech of foundTechs || []) {
    const id = modelIdForTech(tech);
    if (id) ids.add(id);
  }
  return HURRICANE_MODELS.map(m => m.id).filter(id => ids.has(id)).concat(ids.has('spaghetti') ? ['spaghetti'] : []);
}
