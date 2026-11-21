import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaults, filterVideos, localSets, periodStart, serializeSets, shuffled} from '../js/catalog.js';

const a = {id: 'aaaaaaaaaaa', n: 50, d: '2026-10-02', t: '街の風景', c: '山手線', cu: '@1'};
const b = {id: 'bbbbbbbbbbb', n: 12, d: '2026-11-18', t: '猫の動画', c: 'ペット', k: [{c: 'かわいい ＣＡＴ'}]};
const short = {...a, id: 'ccccccccccc', dur: 180};
const flagged = {...a, id: 'ddddddddddd', short: true};
const items = [b, short, a, flagged];
const now = new Date('2026-11-21T04:00:00Z');
const select = (options, sets = {}) => filterVideos(items, {...defaults, ...options}, localSets(sets), 1234, {now});

test('sorts and filters with defensive Shorts checks, channel, dates and text', () => {
  assert.deepEqual(select({}), [a, b]);
  assert.deepEqual(select({sort: 'new'}), [b, a]);
  assert.deepEqual(select({period: 'week'}), [b]);
  assert.deepEqual(select({period: '2025'}), []);
  assert.deepEqual(select({period: '2026', min: 30}), [a]);
  assert.deepEqual(select({channel: '@1', query: '山手'}), [a]);
  assert.deepEqual(select({query: ' cat '}), [b]);
});

test('respects watched, video-hidden and channel-hidden sets', () => {
  assert.deepEqual(select({}, {watched: [a.id]}), [b]);
  assert.deepEqual(select({showWatched: true}, {watched: [a.id], hiddenChannels: ['ペット']}), [a]);
  assert.deepEqual(select({showWatched: true}, {hidden: [a.id, b.id]}), []);
  assert.deepEqual(serializeSets(localSets({hidden: [b.id, 'invalid', a.id, b.id], hiddenChannels: [null, '@1']})),
    {hidden: [a.id, b.id], watched: [], hiddenChannels: ['@1']});
});

test('clamps calendar month calculations and shuffles reproducibly without mutation', () => {
  assert.equal(periodStart('month', new Date('2024-03-31T01:00:00Z')), '2024-02-29');
  assert.equal(periodStart('quarter', new Date('2026-01-31T01:00:00Z')), '2025-10-31');
  assert.equal(periodStart('year', now), '2025-11-21');
  const source = [1, 2, 3, 4, 5];
  assert.deepEqual(shuffled(source, 42), shuffled(source, 42));
  assert.notDeepEqual(shuffled(source, 42), shuffled(source, 123));
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
});
