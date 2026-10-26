import { extractEwsSnapshot } from '../apis/sources/ews.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const raw = {
  current: {
    asOf: '2026-10-26T04:59:50+00:00',
    concurrentCount: 102,
    baselineMean: 117.5,
    zScore: -0.42,
    emergencyLevel: 2,
    alertLevel: 'elevated',
  },
  signals: {
    composite: {
      asOf: '2026-10-26T04:59:50+00:00',
      actualConcurrentCount: 102,
      expectedConcurrentCount: 117.5,
      varianceAdjustedSigmaShift: -0.42,
    },
  },
  liveAircraft: new Array(500).fill({ id: 1 }),
  watchlist: { huge: true },
};

const extracted = extractEwsSnapshot(raw);
assert(extracted.level === 2, 'level');
assert(extracted.concurrentCount === 102, 'concurrentCount');
assert(extracted.baselineMean === 117.5, 'baselineMean');
assert(extracted.zScore === -0.42, 'zScore');
assert(extracted.url.includes('ews.kylemcdonald'), 'url');
assert(extracted.composite?.actualConcurrentCount === 102, 'composite');
assert(!('liveAircraft' in extracted), 'must not store liveAircraft');
assert(!('watchlist' in extracted), 'must not store watchlist');

assert(extractEwsSnapshot(null) === null, 'null raw');
assert(extractEwsSnapshot({ current: { emergencyLevel: 9 } }) === null, 'invalid level');
assert(extractEwsSnapshot({ current: {} }) === null, 'missing level');

console.log('ews-extract.test.mjs: ok');
