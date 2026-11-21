import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {collect} from '../scripts/collect.mjs';
import {CollectionStop, createRequester, userAgent} from '../scripts/lib/http.mjs';
import {watchUrl} from '../js/video.js';

const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const empty = '<rdf:RDF></rdf:RDF>';
const alive = 'aZR02n-yejM';
const dead = 'a77m_WSa93A';
const short = 'abjrPJtgBRY';
const archived = 'W3X3RSmf7ds';
const json = (name) => JSON.parse(fixture(name));

function fakeClock() {
  let time = Date.parse('2026-11-21T00:00:00Z');
  return {now: () => time, sleep: async ms => { time += ms; }, log() {}};
}

async function temporaryDirectory(t) {
  const path = await mkdtemp(join(tmpdir(), 'hatebu-video-'));
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}

test('offline collection publishes verified videos, refreshes existing records and excludes dead videos and Shorts', async t => {
  const dataDir = await temporaryDirectory(t);
  const read = async name => JSON.parse(await readFile(join(dataDir, name + '.json'), 'utf8'));
  const archivedRecord = {id: archived, t: '既存の動画', c: 'チャンネル', n: 1599, d: '2020-02-05', u: '2020-02-06'};
  await writeFile(join(dataDir, 'videos.json'), JSON.stringify([archivedRecord]));
  const clock = fakeClock();
  const calls = [];
  const fetch = async (value, options) => {
    const url = new URL(value);
    calls.push({url, time: clock.now()});
    assert.equal(options.headers['User-Agent'], userAgent);
    if (url.pathname === '/entrylist') {
      return new Response(url.searchParams.get('url') === watchUrl('a') ? fixture('entrylist-hot.rss') : empty);
    }
    if (url.pathname === '/site/youtu.be/') return new Response(fixture('site-youtu.be.rss'));
    if (url.pathname.startsWith('/site/') || url.pathname === '/hotentry/all.rss') return new Response(empty);
    if (url.pathname === '/oembed') {
      const id = new URL(url.searchParams.get('url')).searchParams.get('v');
      if (id === dead) return new Response(null, {status: 401});
      if ([alive, short].includes(id)) return Response.json(json('oembed.json'));
      return new Response(null, {status: 451});
    }
    if (url.pathname.startsWith('/shorts/')) {
      assert.equal(options.redirect, 'manual');
      if (url.pathname.endsWith(short)) return new Response('Short');
      return new Response(null, {status: 303, headers: {location: '/watch?v=' + alive}});
    }
    if (url.hostname === 'bookmark.hatenaapis.com') return Response.json(json('count-entries.json'));
    if (url.pathname === '/entry/jsonlite/') {
      assert.equal(url.searchParams.get('url'), watchUrl(archived));
      return Response.json(json('jsonlite.json'));
    }
    throw new Error('Unexpected fixture URL ' + url);
  };
  await collect({dataDir, fetch, ...clock});
  const videos = await read('videos');
  assert.deepEqual(videos.map(video => video.id), [archived, alive]);
  assert.equal(videos[0].n, 1294);
  assert.equal(videos[0].u, '2026-11-21');
  assert.equal(videos[0].s, 1);
  assert.equal(videos[1].t, json('oembed.json').title);
  assert.equal((await read('comments/w3'))[archived].length, 3);
  assert.deepEqual(await read('excluded'), {[dead]: 'dead', [short]: 'short'});
  assert.ok((await read('pending')).some(video => video.id === 'fl-v3eRvXf4'));
  assert.equal((await read('meta')).lastDailyRun, '2026-11-21');
  assert.equal(calls.filter(({url}) => url.pathname === '/entrylist').length, 128);
  const hatenaCalls = calls.filter(({url}) => url.hostname === 'b.hatena.ne.jp');
  assert.ok(hatenaCalls.slice(1).every((call, i) => call.time - hatenaCalls[i].time >= 1000));
  assert.ok(calls.slice(1).every((call, i) => call.time - calls[i].time >= 500));

  calls.length = 0;
  await collect({dataDir, fetch, ...clock});
  assert.ok(!calls.some(({url}) => url.pathname === '/oembed' &&
    [alive, dead, short].some(id => url.searchParams.get('url') === watchUrl(id))));
  assert.ok(!calls.some(({url}) => url.pathname === '/entry/jsonlite/'));
});

test('seed checkpoints completed parents and resumes saturated shards with a hard cap', async t => {
  const dataDir = await temporaryDirectory(t);
  const seen = [];
  const oneItem = '<item><link>https://www.youtube.com/watch?v=AAAAAAAAAAA</link><hatena:bookmarkcount>5</hatena:bookmarkcount></item>';
  const fetch = async value => {
    const url = new URL(value);
    if (url.searchParams.get('sort') !== 'count') return new Response(empty);
    const prefix = new URL(url.searchParams.get('url')).searchParams.get('v');
    seen.push(prefix);
    return new Response(prefix === 'A' || prefix === 'AA' ? '<rss>' + oneItem.repeat(30) + '</rss>' : empty);
  };
  const options = {mode: 'seed', maxEnrich: 0, maxComments: 0, dataDir, fetch, ...fakeClock()};
  await collect({...options, maxRequests: 132});
  assert.deepEqual(seen, ['A']);
  await collect({...options, maxRequests: 2});
  assert.deepEqual(seen, ['A', 'AA', 'AAA']);
  const state = JSON.parse(await readFile(join(dataDir, 'crawl-state.json'), 'utf8'));
  assert.deepEqual(state.completed, {'watch:A': 1, 'watch:AA': 1, 'watch:AAA': 0});
});

test('retries with backoff and respects request and time budgets', async () => {
  const clock = fakeClock();
  const calls = [];
  const fetch = async () => {
    calls.push(clock.now());
    return new Response(null, {status: 429});
  };
  const unlimited = createRequester({fetch, maxRequests: Infinity, deadline: Infinity, ...clock});
  await assert.rejects(unlimited.request('https://b.hatena.ne.jp/'), CollectionStop);
  assert.equal(unlimited.count, 4);
  assert.deepEqual(calls.slice(1).map((time, i) => time - calls[i]), [1000, 2000, 4000]);
  const capped = createRequester({fetch, maxRequests: 2, deadline: Infinity, ...clock});
  await assert.rejects(capped.request('https://b.hatena.ne.jp/'), CollectionStop);
  assert.equal(capped.count, 2);
  const timed = createRequester({fetch, maxRequests: Infinity, deadline: clock.now() + 999, ...clock});
  await assert.rejects(timed.request('https://b.hatena.ne.jp/'), CollectionStop);
  assert.equal(timed.count, 1);
});
