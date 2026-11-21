import test from 'node:test';
import assert from 'node:assert/strict';
import {durationSeconds, eligible, rankPeople, rankVideos} from '../rank.js';

test('ISO 8601 duration supports days, hours, minutes and fractional seconds', () => {
  assert.equal(durationSeconds('P1DT1H2M3.5S'), 90123.5);
  assert.equal(durationSeconds('PT3M'), 180);
  for (const invalid of ['PT', 'P', '3:00', undefined]) assert.equal(durationSeconds(invalid), 0);
});

test('Shorts, live, upcoming, and unavailable videos are excluded', () => {
  const video = {id: 'abcdefghijk', contentDetails: {duration: 'PT3M1S'},
    snippet: {title: '森を歩く', description: '散策', liveBroadcastContent: 'none'}};
  assert.equal(eligible(video), true);
  assert.equal(eligible({...video, contentDetails: {duration: 'PT180S'}}), false);
  for (const patch of [{title: '森 #SHORTS'}, {description: '見てね #Shorts'}, {tags: ['shorts']},
    {liveBroadcastContent: 'live'}, {liveBroadcastContent: 'upcoming'}]) {
    assert.equal(eligible({...video, snippet: {...video.snippet, ...patch}}), false);
  }
  assert.equal(eligible({...video, status: {privacyStatus: 'private'}}), false);
  assert.equal(eligible({...video, status: {uploadStatus: 'rejected'}}), false);
  assert.equal(eligible({...video, snippet: null}), false);
});

test('commenter scoring counts distinct videos and boosts shared subscriptions', () => {
  const a = {id: 'a', name: 'あ'}, b = {id: 'b', name: 'い'};
  const channel = {id: 'u'};
  const result = rankPeople({first: [a, a, b], second: [a, b]}, {b: [channel, channel]}, [channel]);
  assert.deepEqual(result.map(({id, count, overlap}) => [id, count, overlap]), [['b', 2, 1], ['a', 2, 0]]);
});

test('video scoring deduplicates sources and limits repeats per channel', () => {
  const now = Date.UTC(2026, 0, 1);
  const video = {id: 'a', channelId: 'u', published: new Date(now).toISOString(), views: 0};
  const one = {key: 'one', type: 'subscription', count: 3};
  const two = {key: 'two', type: 'featured'};
  const result = rankVideos([{...video, sources: [one]}, {...video, sources: [one, two]},
    {...video, id: 'b', sources: [one]}, {...video, id: 'c', channelId: 'v', sources: [two]}], now, 1);
  assert.deepEqual(result.map(item => item.id), ['a', 'c']);
  assert.deepEqual(result[0].sources.map(source => source.key), ['one', 'two']);
  assert.equal(result[0].score, 15.5);
});
