import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {countBatches, decodeXml, normalizeVideo, oembedAction, parseRss, prefixes, shardUrl, shortsAction} from '../scripts/lib/sources.mjs';
import {mergeEntry, selectComments, serializeVideos} from '../scripts/lib/records.mjs';

const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const id = 'aZR02n-yejM';
const canonical = 'https://www.youtube.com/watch?v=' + id;

test('normalizes only supported video URLs', () => {
  for (const url of [canonical + '&t=5&list=PL', 'http://youtube.com/watch?v=' + id,
    'https://youtu.be/' + id + '?t=42', 'https://m.youtube.com/watch?v=' + id,
    'https://music.youtube.com/watch?v=' + id, 'https://youtube.com/embed/' + id]) assert.equal(normalizeVideo(url), id);
  for (const url of [null, 'wat', 'ftp://youtu.be/' + id, 'https://youtube.com.evil.test/watch?v=' + id,
    'https://www.youtube.com', 'https://youtube.com/channel/' + id, 'https://youtube.com/playlist?list=PL',
    'https://youtube.com/shorts/' + id, 'https://youtube.com/live/' + id, 'https://youtu.be/short',
    'https://youtu.be/' + id + '/extra']) assert.equal(normalizeVideo(url), null);
});

test('reads fixture RDF items and decodes XML exactly once', () => {
  const items = parseRss(fixture('entrylist-hot.rss'));
  assert.equal(items[0].id, id);
  assert.equal(items[0].n, 7);
  assert.equal(items[0].d, '2026-10-15');
  assert.match(items[0].t, /^ファイアーエムブレム/);
  assert.match(items[0].description, /^【ウェブサイト/);
  assert.equal(items[0].image, 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
  assert.equal(parseRss(fixture('site-youtu.be.rss'))[0].id, 'fl-v3eRvXf4');
  assert.equal(decodeXml('&#65;&#x1f4cc;&amp;lt;&quot;<![CDATA[&gt;]]>'), 'A📌&lt;"&gt;');
});

test('merges URL variants and keeps the earliest date and highest observed count', () => {
  const first = mergeEntry(undefined, {id, url: canonical, n: 9, d: '2025-01-02', t: 'Title'}, '2026-01-03');
  const variant = 'https://youtu.be/' + id;
  const merged = mergeEntry(first, {id, url: variant, n: 11, d: '2025-01-01'}, '2026-01-04');
  const last = mergeEntry(merged, {id, url: canonical, n: 5, d: '2025-01-03'}, '2026-01-05');
  assert.deepEqual(last, {id, t: 'Title', n: 11, d: '2025-01-01', u: '2026-01-04', url: variant});
});

test('selects three distinct substantial comments and preserves author and timestamp', () => {
  const original = JSON.parse(fixture('jsonlite.json')).bookmarks;
  const best = selectComments(original);
  assert.equal(best.length, 3);
  for (const {u, c, d} of best) {
    assert.ok(original.some(item => u === item.user && c === item.comment.trim() && d === item.timestamp));
  }
  assert.deepEqual(selectComments([
    {user: 'a', comment: '   有益なコメントがここにあります。  ', timestamp: '2020/02/01 07:30'},
    {user: 'b', comment: '有益なコメントがここにあります。'},
    {user: 'c', comment: 'https://example.com/spam'},
    {user: 'd', comment: '短い'},
    {user: 'e', comment: 'あ'.repeat(141)}
  ]), [{u: 'a', c: '有益なコメントがここにあります。', d: '2020/02/01 07:30'}]);
});

test('shards over 64 characters up to depth 3 and batches at most 50 URLs', () => {
  for (const prefix of ['', 'a', 'a_']) {
    const children = prefixes(prefix);
    assert.equal(new Set(children).size, 64);
    assert.ok(children.every(child => child.startsWith(prefix) && child.length === prefix.length + 1));
  }
  assert.deepEqual(prefixes('a_1'), []);
  const params = new URL(shardUrl('shortlink', 'a_', 'count')).searchParams;
  assert.deepEqual(Object.fromEntries(params), {mode: 'rss', url: 'https://youtu.be/a_', sort: 'count', threshold: '5'});
  const urls = Array.from({length: 103}, (_, i) => canonical + '&t=' + i);
  const batches = countBatches([...urls, urls[0]]);
  assert.deepEqual(batches.map(batch => batch.urls.length), [50, 50, 3]);
  assert.deepEqual(batches.flatMap(batch => new URL(batch.url).searchParams.getAll('url')), urls);
});

test('classifies oEmbed and manual Shorts responses conservatively', () => {
  for (const code of [400, 401, 403, 404]) assert.equal(oembedAction(code), 'dead');
  for (const code of [429, 500, 503, 302]) assert.equal(oembedAction(code), 'skip');
  assert.equal(oembedAction(200), 'accept');
  assert.equal(shortsAction(200, null, id), 'short');
  for (const code of [301, 302, 303]) assert.equal(shortsAction(code, '/watch?v=' + id, id), 'accept');
  for (const location of [null, '/watch?v=aaaaaaaaaaa', 'https://example.com/watch?v=' + id]) {
    assert.equal(shortsAction(303, location, id), 'skip');
  }
  assert.equal(shortsAction(429, null, id), 'skip');
});

test('publishes compact deterministic records with bookmark count ordering', () => {
  const videos = Array.from({length: 20000}, (_, i) => ({
    id: i.toString(36).padStart(11, 'a'), t: '放送局が公開したニュースの動画', c: 'ニュースチャンネル',
    cu: 'https://www.youtube.com/@channel', n: i % 300, d: '2026-10-03', u: '2026-10-05',
    description: 'should not leak', s: 1
  }));
  const json = serializeVideos(videos);
  assert.equal(serializeVideos([...videos].reverse()), json);
  assert.ok(Buffer.byteLength(json) < 6_000_000);
  assert.ok(!json.includes('description'));
  assert.ok(!json.includes('\n'));
  const output = JSON.parse(json);
  assert.equal(output[0].n, 299);
  assert.equal(output.at(-1).n, 0);
  assert.deepEqual(Object.keys(output[0]), ['id', 't', 'c', 'cu', 'n', 'd', 'u', 's']);
});
