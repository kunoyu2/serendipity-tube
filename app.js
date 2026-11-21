import {openPlayer} from './player.js';
import {bookmark, button, commentList, element as h, external} from './js/dom.js';
import {channelKey, defaults, filterVideos, localSets, serializeSets} from './js/catalog.js';
import {commentShard, hatenaUrl} from './js/video.js';
import {openSettings} from './js/settings.js';

const get = id => document.getElementById(id);
const pageSize = 24;
const stateKey = 'hatebu-video-state';
const controlKey = 'hatebu-video-controls';

function readStorage(key, storage = 'localStorage') {
  try { return JSON.parse(window[storage].getItem(key)); } catch { return null; }
}
function store(key, value, storage = 'localStorage') {
  try { window[storage].setItem(key, JSON.stringify(value)); } catch {}
}
function newSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
let sets = localSets(readStorage(stateKey));
let seed = readStorage('hatebu-video-seed', 'sessionStorage') ?? newSeed();
store('hatebu-video-seed', seed, 'sessionStorage');
const controls = {...defaults, ...readStorage(controlKey)};
let catalog = [];
let filtered = [];
let page = 0;
let loaded = false;
let generation = 0;
let searchDelay;
const shards = new Map();
const loadedShards = new Map();

async function fetchJson(path) {
  const response = await fetch('./data/' + path, {cache: 'no-cache'});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}
function getShard(key) {
  if (!shards.has(key)) {
    shards.set(key, fetchJson('comments/' + key + '.json').then(data => {
      loadedShards.set(key, data);
      return data;
    }).catch(error => {
      shards.delete(key);
      throw error;
    }));
  }
  return shards.get(key);
}
async function comments(video) {
  return video.k ?? (video.s ? (await getShard(commentShard(video.id)))[video.id] ?? [] : []);
}

function saveSets() {
  store(stateKey, serializeSets(sets));
  refresh(false);
}
function hide(video) {
  sets.hidden.add(video.id);
  saveSets();
}
function play(videos, tv = false) {
  openPlayer({videos, tv, hide, comments, watched(video) {
    if (sets.watched.has(video.id)) return;
    sets.watched.add(video.id);
    saveSets();
  }});
}
function setChannel(key) {
  controls.channel = key;
  store(controlKey, controls);
  refresh();
}
function card(video, index) {
  const open = () => play(filtered.slice(index));
  const channel = channelKey(video);
  const title = h('h2', {}, button(video.t, open, 'video-title'));
  const thumb = h('button', {class: 'card-open thumb', type: 'button', 'aria-label': video.t + 'を再生', onclick: open},
    h('img', {src: 'https://i.ytimg.com/vi/' + video.id + '/mqdefault.jpg', alt: '', loading: 'lazy', decoding: 'async', width: 320, height: 180}),
    h('span', {class: 'play-icon', 'aria-hidden': 'true'}, '▶'));
  const detail = h('div', {class: 'card-body'}, title,
    channel && button(video.c || 'チャンネル', () => setChannel(channel), 'channel channel-link'),
    h('div', {class: 'actions card-meta'}, bookmark(video), video.d && h('time', {datetime: video.d}, video.d.slice(0, 10))));
  const article = h('article', {class: 'card'}, thumb, detail,
    h('div', {class: 'card-footer actions'}, external('はてブで見る ↗', hatenaUrl(video.id)),
      button('非表示', () => hide(video), 'button subtle'),
      channel && button('このチャンネルを非表示', () => {
        sets.hiddenChannels.add(channel);
        if (controls.channel === channel) setChannel('');
        saveSets();
      }, 'button subtle')));
  if (video.s || video.k?.length) {
    const load = () => comments(video).then(items => {
      const list = commentList(items);
      if (list) detail.append(list);
    }).catch(() => {});
    if (observer) {
      onVisible.set(article, load);
      observer.observe(article);
    } else load();
  }
  return article;
}

const onVisible = new WeakMap();
const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    onVisible.get(entry.target)?.();
  }
}, {rootMargin: '240px'}) : null;

function render() {
  const pages = Math.ceil(filtered.length / pageSize);
  page = Math.max(0, Math.min(page, pages - 1));
  const start = page * pageSize;
  observer?.disconnect();
  get('cards').replaceChildren(...filtered.slice(start, start + pageSize).map((video, i) => card(video, start + i)));
  get('cards').setAttribute('aria-busy', 'false');
  get('status').textContent = filtered.length ? filtered.length.toLocaleString('ja-JP') + '件' :
    catalog.length ? '条件に合う動画がありません。' : '集計された動画はまだありません。';
  get('pages').hidden = pages < 2;
  get('pageNumber').textContent = (page + 1) + ' / ' + pages;
  get('prevPage').disabled = page === 0;
  get('nextPage').disabled = page >= pages - 1;
  get('tv').disabled = !filtered.length;
}

async function refresh(reset = true) {
  const request = ++generation;
  if (reset) page = 0;
  get('shuffle').hidden = controls.sort !== 'random';
  get('channel').hidden = !controls.channel;
  if (!loaded) return;
  const channel = catalog.find(video => channelKey(video) === controls.channel);
  get('channel').textContent = (channel?.c || 'チャンネル') + ' ×';
  const readComments = video => video.k ?? loadedShards.get(commentShard(video.id))?.[video.id] ?? [];
  const query = controls.query.trim();
  const candidates = query ? filterVideos(catalog, {...controls, query: '', sort: 'count'}, sets, seed) : catalog;
  const keys = query ? [...new Set(candidates.filter(video => video.s).map(video => commentShard(video.id)))]
    .filter(key => !loadedShards.has(key)) : [];
  if (keys.length) {
    get('status').textContent = 'コメントを検索中…';
    let failed = false;
    let cursor = 0;
    await Promise.all(Array.from({length: Math.min(keys.length, 6)}, async () => {
      while (request === generation && cursor < keys.length) {
        try { await getShard(keys[cursor++]); } catch { failed = true; }
      }
    }));
    if (request !== generation) return;
    filtered = filterVideos(candidates, controls, sets, seed, {comments: readComments});
    render();
    if (failed) get('status').append(' · 一部のコメントを読み込めませんでした。');
    return;
  }
  filtered = filterVideos(candidates, controls, sets, seed, {comments: readComments});
  render();
}

async function load() {
  get('retry').hidden = true;
  get('status').textContent = '動画を読み込み中…';
  get('cards').setAttribute('aria-busy', 'true');
  if (!get('cards').children.length) get('cards').append(...Array.from({length: 3}, () => h('div', {class: 'skeleton', 'aria-hidden': 'true'})));
  try {
    const meta = await fetchJson('meta.json');
    const updated = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('ja-JP', {dateStyle: 'medium', timeStyle: 'short'}) : '集計前';
    get('meta').textContent = '更新 ' + updated + ' · 全' + meta.count.toLocaleString('ja-JP') + '件';
    catalog = await fetchJson('videos.json');
    if (!Array.isArray(catalog)) throw new Error('Invalid catalog');
    loaded = true;
    await refresh();
  } catch {
    get('cards').replaceChildren();
    get('cards').setAttribute('aria-busy', 'false');
    get('status').textContent = '動画を読み込めませんでした。時間をおいて再読み込みしてください。';
    get('retry').hidden = false;
  }
}

const years = h('optgroup', {label: '年ごと'});
for (let year = new Date().getFullYear(); year >= 2009; year--) years.append(h('option', {value: year}, year + '年'));
get('period').append(years);
for (const key of ['sort', 'period', 'min', 'query', 'showWatched']) {
  const input = get(key);
  if (key === 'showWatched') input.checked = controls[key];
  else input.value = controls[key];
  input.addEventListener(key === 'query' ? 'input' : 'change', () => {
    controls[key] = key === 'showWatched' ? input.checked : key === 'min' ? Number(input.value) : input.value;
    store(controlKey, controls);
    clearTimeout(searchDelay);
    if (key === 'query') {
      generation++;
      searchDelay = setTimeout(refresh, 220);
    } else refresh();
  });
}
get('channel').onclick = () => setChannel('');
get('tv').onclick = () => play(filtered, true);
get('settings').onclick = () => openSettings(sets, value => { sets = value; saveSets(); });
get('shuffle').onclick = () => {
  seed = newSeed();
  store('hatebu-video-seed', seed, 'sessionStorage');
  refresh();
};
for (const [id, offset] of [['prevPage', -1], ['nextPage', 1]]) {
  get(id).onclick = () => {
    page += offset;
    render();
    get('status').focus({preventScroll: true});
    window.scrollTo(0, 0);
  };
}
get('retry').onclick = load;
load();
navigator.serviceWorker?.register('./sw.js').catch(() => {});
