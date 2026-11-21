import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commentShard, watchUrl} from '../js/video.js';
import {CollectionStop, createRequester} from './lib/http.mjs';
import {countBatches, feeds, hatena, oembedAction, parseRss, prefixes, shardUrl, shortsAction} from './lib/sources.mjs';
import {byCount, mergeEntry, selectComments, serializeVideos} from './lib/records.mjs';

const day = 86400000;
const forms = ['watch', 'shortlink'];
const hotFeeds = [...feeds, ...forms.flatMap(form => prefixes().map(prefix => shardUrl(form, prefix, 'hot')))];

export async function collect({
  mode = 'daily', dataDir = 'data', maxRequests = Infinity, maxEnrich = 800,
  maxComments = 300, timeBudgetMin = Infinity, fetch = globalThis.fetch,
  now = Date.now, sleep, log = message => process.stdout.write(String(message) + '\n')
} = {}) {
  const started = now();
  const today = new Date(started).toISOString().slice(0, 10);
  const http = createRequester({fetch, now, sleep, maxRequests, deadline: started + timeBudgetMin * 60000});
  await mkdir(dataDir, {recursive: true});
  async function read(name, fallback) {
    try {
      return JSON.parse(await readFile(join(dataDir, name), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    }
  }
  async function write(name, value) {
    const path = join(dataDir, name);
    const tmp = path + '.tmp';
    await writeFile(tmp, value);
    await rename(tmp, path);
  }

  const [index, backlog, excluded, state, previousMeta] = await Promise.all([
    read('videos.json', []), read('pending.json', []), read('excluded.json', {}),
    read('crawl-state.json', {}), read('meta.json', {})
  ]);
  state.completed ??= {};
  state.dailyCursor ??= 0;
  state.seedHotCursor ??= 0;
  state.commentDates ??= {};
  state.variants ??= {};
  const videos = new Map(index.filter(video => !excluded[video.id]).map(video => [video.id, video]));
  const pending = new Map(backlog.filter(video => !excluded[video.id] && !videos.has(video.id)).map(video => [video.id, video]));
  const shards = new Map();
  let enriched = 0;
  let commented = 0;
  const attempted = new Set();
  const attemptedComments = new Set();
  let lastDailyRun = previousMeta.lastDailyRun ?? null;

  async function save() {
    if (shards.size) await mkdir(join(dataDir, 'comments'), {recursive: true});
    for (const [key, shard] of shards) await write('comments/' + key + '.json', JSON.stringify(shard));
    shards.clear();
    await write('excluded.json', JSON.stringify(excluded));
    await write('videos.json', serializeVideos(videos.values()));
    await write('pending.json', JSON.stringify([...pending.values()].sort(byCount)));
    const dates = [...videos.values()].map(video => video.d).filter(Boolean).sort();
    const meta = {
      generatedAt: new Date(now()).toISOString(), count: videos.size,
      minDate: dates[0] ?? null, maxDate: dates.at(-1) ?? null, version: 1, lastDailyRun,
      seedProgress: {completed: Object.keys(state.completed).length, hotFeeds: state.seedHotCursor}
    };
    await write('meta.json', JSON.stringify(meta));
    await write('crawl-state.json', JSON.stringify(state));
    return meta;
  }

  async function ingest(url) {
    const response = await http.request(url);
    if (response.status !== 200) throw new CollectionStop('RSS returned HTTP ' + response.status);
    const items = parseRss(await response.text());
    for (const item of items) {
      if (!item.id || item.n < 3 || excluded[item.id]) continue;
      const map = videos.has(item.id) ? videos : pending;
      const previous = map.get(item.id);
      const record = mergeEntry(previous && {...previous, url: state.variants[item.id] ?? previous.url}, item, today);
      if (record.url) state.variants[item.id] = record.url;
      else delete state.variants[item.id];
      if (map === videos) delete record.url;
      map.set(item.id, record);
    }
    return items.length;
  }

  async function enrich() {
    for (const video of [...pending.values()].sort(byCount)) {
      if (enriched >= maxEnrich) break;
      if (attempted.has(video.id)) continue;
      attempted.add(video.id);
      enriched++;
      const canonical = watchUrl(video.id);
      let action = 'accept';
      if (!video.oembed) {
        const response = await http.request('https://www.youtube.com/oembed?' + new URLSearchParams({format: 'json', url: canonical}));
        action = oembedAction(response.status);
        if (action === 'accept') {
          const details = await response.json();
          video.oembed = {t: details.title || '', c: details.author_name || '', cu: details.author_url || ''};
        } else await response.body?.cancel();
      }
      if (action === 'accept') {
        const shorts = await http.request('https://www.youtube.com/shorts/' + video.id, {redirect: 'manual'});
        action = shortsAction(shorts.status, shorts.headers.get('location'), video.id);
        await shorts.body?.cancel();
        if (action === 'accept') {
          const {url, oembed, ...record} = video;
          videos.set(video.id, {...record, c: oembed.c, cu: oembed.cu, t: oembed.t || video.t});
          pending.delete(video.id);
        }
      }
      if (action === 'dead' || action === 'short') {
        excluded[video.id] = action;
        pending.delete(video.id);
        delete state.variants[video.id];
      }
      if (enriched % 25 === 0) {
        log('enriched ' + enriched + ', published ' + videos.size + ', pending ' + pending.size);
        await save();
      }
    }
  }

  async function refreshCounts() {
    const recent = new Date(started - 60 * day).toISOString().slice(0, 10);
    const stale = new Date(started - 30 * day).toISOString().slice(0, 10);
    const due = [...videos.values(), ...pending.values()].filter(video =>
      !video.u || video.u <= stale || (video.d >= recent && video.u !== today));
    let cursor = 0;
    const countResults = new Map();
    for (const batch of countBatches(due.flatMap(video => [watchUrl(video.id), state.variants[video.id]].filter(Boolean)))) {
      const response = await http.request(batch.url);
      if (response.status !== 200) throw new CollectionStop('Count API returned HTTP ' + response.status);
      const counts = await response.json();
      for (const url of batch.urls) countResults.set(url, counts[url]);
      while (cursor < due.length) {
        const video = due[cursor];
        const canonical = watchUrl(video.id);
        const variant = state.variants[video.id];
        if (!countResults.has(canonical) || (variant && !countResults.has(variant))) break;
        cursor++;
        const values = [countResults.get(canonical), countResults.get(variant)].filter(value => Number.isInteger(value) && value >= 0);
        if (values.length) video.n = Math.max(...values);
        video.u = today;
      }
    }
  }

  async function refreshComments() {
    const stale = new Date(started - 30 * day).toISOString().slice(0, 10);
    for (const video of [...videos.values()].sort(byCount)) {
      if (commented >= maxComments || video.n < 10) break;
      if ((state.commentDates[video.id] ?? '') > stale || attemptedComments.has(video.id)) continue;
      commented++;
      attemptedComments.add(video.id);
      const canonical = watchUrl(video.id);
      const lookup = url => http.request(hatena + '/entry/jsonlite/?' + new URLSearchParams({url}));
      let response = await lookup(canonical);
      let data = response.status === 200 ? await response.json() : null;
      if (!data?.bookmarks?.length && state.variants[video.id]) {
        response = await lookup(state.variants[video.id]);
        if (response.status === 200) data = await response.json() ?? data;
      }
      if (!data && ![200, 404].includes(response.status)) continue;
      const key = commentShard(video.id);
      if (!shards.has(key)) shards.set(key, await read('comments/' + key + '.json', {}));
      const comments = selectComments(data?.bookmarks);
      if (comments.length) shards.get(key)[video.id] = comments;
      else delete shards.get(key)[video.id];
      if (comments.length) video.s = 1;
      else delete video.s;
      state.commentDates[video.id] = today;
    }
  }

  function* seedQueue(form, roots) {
    for (const prefix of roots) {
      const key = form + ':' + prefix;
      if (state.completed[key] === undefined) yield [key, prefix];
      if (state.completed[key]) yield* seedQueue(form, prefixes(prefix));
    }
  }

  try {
    const cursor = mode === 'seed' ? 'seedHotCursor' : 'dailyCursor';
    while (state[cursor] < hotFeeds.length) {
      await ingest(hotFeeds[state[cursor]]);
      state[cursor]++;
      if (state[cursor] % 32 === 0) await save();
    }
    await enrich();
    if (mode === 'daily') await refreshCounts();
    await refreshComments();
    if (mode === 'seed') {
      let queries = 0;
      for (const form of forms) {
        for (const [key, prefix] of seedQueue(form, prefixes())) {
          state.completed[key] = await ingest(shardUrl(form, prefix, 'count')) >= 30 && prefix.length < 3 ? 1 : 0;
          if (++queries % 32 === 0) {
            await save();
            await enrich();
            await refreshComments();
          }
        }
      }
      await enrich();
      await refreshComments();
    } else {
      state.dailyCursor = 0;
      lastDailyRun = today;
    }
  } catch (error) {
    log('Collection paused: ' + error.message);
    if (!(error instanceof CollectionStop) && !['AbortError', 'TimeoutError'].includes(error.name)) {
      await save();
      throw error;
    }
  }
  const meta = await save();
  log(`${http.count} requests, ${videos.size} published, ${pending.size} pending, ${Object.keys(excluded).length} excluded`);
  return meta;
}

function parseArgs(args) {
  const options = {};
  const numeric = {'max-requests': 'maxRequests', 'max-enrich': 'maxEnrich', 'max-comments': 'maxComments', 'time-budget-min': 'timeBudgetMin'};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = args.slice(i, i + 2);
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
    if (flag === '--mode' && ['daily', 'seed'].includes(value)) options.mode = value;
    else if (flag === '--data-dir') options.dataDir = value;
    else if (flag.startsWith('--') && Object.hasOwn(numeric, flag.slice(2)) && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
      options[numeric[flag.slice(2)]] = Number(value);
    } else throw new Error('Invalid option: ' + flag);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await collect(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
