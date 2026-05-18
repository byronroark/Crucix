// Shared geo-tagging keyword map and helpers.
//
// Used by both built-in RSS news (dashboard/inject.mjs) and the custom
// OSINT source pipeline (lib/geocode/index.mjs). Kept here so we have a
// single source of truth for headline-keyword based location guesses.

export const GEO_KEYWORDS = {
  'Ukraine':[49,32],'Russia':[56,38],'Moscow':[55.7,37.6],'Kyiv':[50.4,30.5],
  'China':[35,105],'Beijing':[39.9,116.4],'Iran':[32,53],'Tehran':[35.7,51.4],
  'Israel':[31.5,35],'Gaza':[31.4,34.4],'Palestine':[31.9,35.2],
  'Syria':[35,38],'Iraq':[33,44],'Saudi':[24,45],'Yemen':[15,48],'Lebanon':[34,36],
  'India':[20,78],'Japan':[36,138],'Korea':[37,127],'Pyongyang':[39,125.7],
  'Taiwan':[23.5,121],'Philippines':[13,122],'Myanmar':[20,96],
  'Canada':[56,-96],'Mexico':[23,-102],'Brazil':[-14,-51],'Argentina':[-38,-63],
  'Colombia':[4,-74],'Venezuela':[7,-66],'Cuba':[22,-80],'Chile':[-35,-71],
  'Germany':[51,10],'France':[46,2],'UK':[54,-2],'Britain':[54,-2],'London':[51.5,-0.1],
  'Spain':[40,-4],'Italy':[42,12],'Poland':[52,20],'NATO':[50,4],'EU':[50,4],
  'Turkey':[39,35],'Greece':[39,22],'Romania':[46,25],'Finland':[64,26],'Sweden':[62,15],
  'Africa':[0,20],'Nigeria':[10,8],'South Africa':[-30,25],'Kenya':[-1,38],
  'Egypt':[27,30],'Libya':[27,17],'Sudan':[13,30],'Ethiopia':[9,38],
  'Somalia':[5,46],'Congo':[-4,22],'Uganda':[1,32],'Morocco':[32,-6],
  'Pakistan':[30,70],'Afghanistan':[33,65],'Bangladesh':[24,90],
  'Australia':[-25,134],'Indonesia':[-2,118],'Thailand':[15,100],
  'US':[39,-98],'America':[39,-98],'Washington':[38.9,-77],'Pentagon':[38.9,-77],
  'Trump':[38.9,-77],'White House':[38.9,-77],
  'Wall Street':[40.7,-74],'New York':[40.7,-74],'California':[37,-120],
  'Nepal':[28,84],'Cambodia':[12.5,105],'Malawi':[-13.5,34],'Burundi':[-3.4,29.9],
  'Oman':[21,57],'Netherlands':[52.1,5.3],'Gabon':[-0.8,11.6],
  'Peru':[-10,-76],'Ecuador':[-2,-78],'Bolivia':[-17,-65],
  'Singapore':[1.35,103.8],'Malaysia':[4.2,101.9],'Vietnam':[16,108],
  'Algeria':[28,3],'Tunisia':[34,9],'Zimbabwe':[-20,30],'Mozambique':[-18,35],
  // Americas expansion
  'Texas':[31,-100],'Florida':[28,-82],'Chicago':[41.9,-87.6],'Los Angeles':[34,-118],
  'San Francisco':[37.8,-122.4],'Seattle':[47.6,-122.3],'Miami':[25.8,-80.2],
  'Toronto':[43.7,-79.4],'Ottawa':[45.4,-75.7],'Vancouver':[49.3,-123.1],
  'São Paulo':[-23.5,-46.6],'Rio':[-22.9,-43.2],'Buenos Aires':[-34.6,-58.4],
  'Bogotá':[4.7,-74.1],'Lima':[-12,-77],'Santiago':[-33.4,-70.7],
  'Caracas':[10.5,-66.9],'Havana':[23.1,-82.4],'Panama':[9,-79.5],
  'Guatemala':[14.6,-90.5],'Honduras':[14.1,-87.2],'El Salvador':[13.7,-89.2],
  'Costa Rica':[10,-84],'Jamaica':[18.1,-77.3],'Haiti':[19,-72],
  'Dominican':[18.5,-70],'Puerto Rico':[18.2,-66.5],
  // More Asia-Pacific
  'Sri Lanka':[7,80],'Hong Kong':[22.3,114.2],'Taipei':[25,121.5],
  'Seoul':[37.6,127],'Osaka':[34.7,135.5],'Mumbai':[19.1,72.9],
  'Delhi':[28.6,77.2],'Shanghai':[31.2,121.5],'Shenzhen':[22.5,114.1],
  'Auckland':[-36.8,174.8],'Papua New Guinea':[-6.3,147],
  // More Europe
  'Berlin':[52.5,13.4],'Paris':[48.9,2.3],'Madrid':[40.4,-3.7],
  'Rome':[41.9,12.5],'Warsaw':[52.2,21],'Prague':[50.1,14.4],
  'Vienna':[48.2,16.4],'Budapest':[47.5,19.1],'Bucharest':[44.4,26.1],
  'Oslo':[59.9,10.7],'Copenhagen':[55.7,12.6],
  'Brussels':[50.8,4.4],'Zurich':[47.4,8.5],'Dublin':[53.3,-6.3],
  'Lisbon':[38.7,-9.1],'Athens':[37.9,23.7],'Minsk':[53.9,27.6],
  // More Africa
  'Nairobi':[-1.3,36.8],'Lagos':[6.5,3.4],'Accra':[5.6,-0.2],
  'Addis Ababa':[9,38.7],'Cape Town':[-33.9,18.4],'Johannesburg':[-26.2,28],
  'Kinshasa':[-4.3,15.3],'Khartoum':[15.6,32.5],'Mogadishu':[2.1,45.3],
  'Dakar':[14.7,-17.5],'Abuja':[9.1,7.5],
  // Tech/Economy keywords with US locations
  'Fed':[38.9,-77],'Congress':[38.9,-77],'Senate':[38.9,-77],
  'Silicon Valley':[37.4,-122],'NASA':[28.6,-80.6],
  'IMF':[38.9,-77],'World Bank':[38.9,-77],'UN':[40.7,-74],
};

// Per-source default coordinates (used when headline keywords miss but the
// publication has a known regional focus).
export const RSS_SOURCE_FALLBACKS = {
  'SBS Australia': { lat: -35.2809, lon: 149.13, region: 'Australia' },
  'Indian Express': { lat: 28.6139, lon: 77.209, region: 'India' },
  'The Hindu': { lat: 13.0827, lon: 80.2707, region: 'India' },
  'MercoPress': { lat: -34.9011, lon: -56.1645, region: 'South America' },
};

// Broad region centers used when a user sets `region` on a custom source
// (e.g. region: 'Middle East') but no keyword match resolves.
export const REGION_CENTERS = {
  'Global': null,
  'North America': { lat: 40, lon: -100 },
  'South America': { lat: -15, lon: -60 },
  'Latin America': { lat: -10, lon: -70 },
  'Europe': { lat: 50, lon: 10 },
  'Western Europe': { lat: 48, lon: 5 },
  'Eastern Europe': { lat: 50, lon: 25 },
  'Middle East': { lat: 30, lon: 45 },
  'MENA': { lat: 28, lon: 25 },
  'Africa': { lat: 0, lon: 20 },
  'North Africa': { lat: 27, lon: 17 },
  'Sub-Saharan Africa': { lat: -5, lon: 25 },
  'Asia': { lat: 30, lon: 100 },
  'East Asia': { lat: 35, lon: 115 },
  'Southeast Asia': { lat: 5, lon: 110 },
  'South Asia': { lat: 22, lon: 80 },
  'Central Asia': { lat: 45, lon: 65 },
  'Oceania': { lat: -25, lon: 140 },
  'Pacific': { lat: 0, lon: 160 },
  'Arctic': { lat: 80, lon: 0 },
  'Antarctic': { lat: -80, lon: 0 },
};

/**
 * Find the first matching geo keyword in `text` and return its coordinates.
 * Returns null if nothing matches.
 *
 * @param {string} text
 * @returns {{lat:number, lon:number, region:string}|null}
 */
export function geoTagText(text) {
  if (!text) return null;
  for (const [keyword, [lat, lon]] of Object.entries(GEO_KEYWORDS)) {
    if (text.includes(keyword)) {
      return { lat, lon, region: keyword };
    }
  }
  return null;
}

/**
 * Lookup a coarse region center by user-supplied region label.
 * @param {string} region
 * @returns {{lat:number, lon:number, region:string}|null}
 */
export function regionCenter(region) {
  if (!region) return null;
  const hit = REGION_CENTERS[region];
  if (!hit) return null;
  return { lat: hit.lat, lon: hit.lon, region };
}
