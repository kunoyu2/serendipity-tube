import {GOOGLE_CLIENT_ID} from './config.js';
import {token, signIn, signOut, prepareSignIn} from './auth.js';
import {quotaDay} from './api.js';
import {storage} from './db.js';
import {defaults, refresh, channelUploads} from './refresh.js';
import {rankVideos} from './rank.js';
import {demoData} from './demo.js';
import {openPlayer} from './player.js';
import {element as h, button} from './ui/dom.js';
import {setup} from './ui/setup.js';
import {feed} from './ui/feed.js';
import {peopleView, timeline} from './ui/people.js';
import {settingsView} from './ui/settings.js';

const root = document.querySelector('#app');
const notice = document.querySelector('#notice');
const tabs = [
  ['discovery', '発見', 'compass'], ['subscribed', '登録', 'stack'],
  ['people', '人', 'people'], ['settings', '設定', 'settings']
];
const paths = {
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM16 8l-2.5 5.5L8 16l2.5-5.5L16 8Z',
  stack: 'M5 3h14M3 7h18M3 11h18v10H3zM10 14l5 2-5 2z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm4-4a4 4 0 0 1 0 8',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  tv: 'M3 7h18v13H3zM8 2l4 5 4-5m-6 9 5 2.5-5 2.5z'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}

const initial = {
  candidates: [], subscribed: [], people: [], timelineVideos: {}, discovered: [], likes: [],
  subscriptions: [], comments: {}, settings: defaults, hidden: [], watched: [], quota: {}, refresh: {}
};
let demo = false;
let db = storage();
let state = {...initial};
let tab = 'discovery';
let person;
let running;
let busy = false;
let messageTimer;
let historyWrites = Promise.resolve();

function message(text) {
  clearTimeout(messageTimer);
  notice.textContent = text;
  notice.hidden = !text;
  if (text) messageTimer = setTimeout(() => { notice.hidden = true; }, 8500);
}

async function loadState() {
  const entries = await Promise.all(Object.entries(initial).map(async ([key, value]) => [key, await db.get(key, value)]));
  state = Object.fromEntries(entries);
}

function guarded(action) {
  return async (...args) => {
    try { return await action(...args); }
    catch (error) { message(error.message || '処理を完了できませんでした。'); }
  };
}

async function enterDemo() {
  demo = true;
  db = storage('demo');
  await loadState();
  Object.assign(state, demoData());
  tab = 'discovery';
  render();
}

async function login() {
  if (busy) return;
  busy = true;
  try {
    await signIn();
    demo = false;
    db = storage();
    await loadState();
    tab = 'discovery';
  } finally {
    busy = false;
    render();
  }
}

function visible(video) {
  return !state.hidden.includes(video.id) && (state.settings.showWatched || !state.watched.includes(video.id));
}

function getFeed(key) {
  const own = new Set(state.subscriptions.map(channel => channel.id));
  const subscribed = state.subscribed.filter(visible);
  const discovery = rankVideos(state.candidates.filter(video => visible(video) && !own.has(video.channelId)));
  return key === 'subscribed' ? subscribed : key === 'mix' ? [...new Map([...discovery, ...subscribed].map(video => [video.id, video])).values()] : discovery;
}

function addHistory(key, id) {
  const target = db;
  const operation = historyWrites.then(async () => {
    const previous = await target.get(key, []);
    if (previous.includes(id)) return;
    const next = [...previous, id];
    await target.set(key, next);
    if (target === db) state[key] = next;
  });
  historyWrites = operation.catch(() => {});
  return operation;
}

function play(video) {
  const dialog = openPlayer({video, initialFeed: tab === 'subscribed' ? tab : 'discovery', getFeed,
    hide: item => addHistory('hidden', item.id), watched: item => addHistory('watched', item.id), demo});
  dialog.addEventListener('close', render, {once: true});
}
const actions = {
  open: play, visible,
  hide: guarded(async (video, card) => {
    await addHistory('hidden', video.id);
    card.remove();
    message('動画を非表示にしました。');
  })
};

async function update() {
  if (running || busy || demo) return;
  if (!token()) return login();
  running = {controller: new AbortController(), step: '更新を開始', count: 0, units: 0};
  const current = running;
  render();
  try {
    await storage('demo').clear();
    await refresh(db, state.settings, current.controller.signal, progress => {
      Object.assign(current, progress);
      paintProgress();
    });
    message('更新が完了しました。');
  } catch (error) {
    message(current.controller.signal.aborted ? '更新を中止しました。取得済みのデータは保存されています。' : error.message);
  } finally {
    running = null;
    try { await loadState(); }
    finally { render(); }
  }
}

function paintProgress() {
  const label = document.querySelector('#progress-label');
  if (label && running) label.textContent = `${running.step} ・ ${running.count}件 ・ ${running.units}ユニット（推定）`;
}

async function uploads(channel, trigger) {
  if (busy || running) return message('更新が終わってからお試しください。');
  let content = trigger.closest('.upload-row').nextElementSibling;
  if (content?.classList.contains('upload-results')) {
    content.hidden = !content.hidden;
    return;
  }
  if (!demo && !token()) return login();
  busy = true;
  trigger.disabled = true;
  try {
    const items = demo ? Object.values(state.timelineVideos).filter(video => video.channelId === channel.id) : await channelUploads(db, channel.id);
    content = h('div', {class: 'upload-results'}, feed(items.filter(visible), actions));
    trigger.closest('.upload-row').after(content);
    if (!demo) state.quota = await db.get('quota', {});
  } finally {
    busy = false;
    trigger.disabled = false;
    if (!demo && !token()) render();
  }
}

function exportState() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, demo, state}, null, 2)], {type: 'application/json'}));
  h('a', {href: url, download: 'serendipity-tube' + (demo ? '-demo' : '') + '.json'}).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validateBackup(backup) {
  if (backup?.version !== 1 || backup.demo !== demo || !backup.state) return false;
  const data = backup.state;
  const videoId = demo ? /^sample-\d+$/ : /^[\w-]{11}$/;
  const validVideo = item => item && typeof item.title === 'string' && typeof item.channel === 'string' &&
    typeof item.channelId === 'string' && typeof item.published === 'string' && videoId.test(item.id) &&
    Number.isFinite(item.duration) && item.duration > 180 && Number.isFinite(item.views) &&
    Array.isArray(item.sources) && item.sources.every(source => source && typeof source.type === 'string') &&
    Boolean(item.demo) === demo && !/\bshorts\b/i.test(item.title);
  const validChannel = item => item && typeof item.id === 'string' && typeof item.title === 'string';
  return ['candidates', 'subscribed', 'likes'].every(key => Array.isArray(data[key]) && data[key].every(validVideo)) &&
    data.timelineVideos && Object.entries(data.timelineVideos).every(([id, item]) => validVideo(item) && id === item.id) &&
    ['hidden', 'watched'].every(key => Array.isArray(data[key]) && data[key].every(id => typeof id === 'string' && videoId.test(id))) &&
    Array.isArray(data.subscriptions) && data.subscriptions.every(validChannel) &&
    Array.isArray(data.people) && data.people.every(item => item && typeof item.id === 'string' && typeof item.name === 'string' &&
      (item.subscriptions === null || Array.isArray(item.subscriptions) && item.subscriptions.every(validChannel)) &&
      Array.isArray(item.playlists) && item.playlists.every(list => list && typeof list.title === 'string' && Array.isArray(list.videoIds))) &&
    data.settings && typeof data.settings.showWatched === 'boolean' &&
    Number.isInteger(data.settings.commentCap) && data.settings.commentCap >= 1 && data.settings.commentCap <= 200 &&
    Number.isInteger(data.settings.peopleCap) && data.settings.peopleCap >= 1 && data.settings.peopleCap <= 50 &&
    data.quota && typeof data.quota === 'object' && data.refresh && typeof data.refresh === 'object';
}

function importState() {
  if (running || busy) return message('処理が終わってからお試しください。');
  const target = db;
  const input = h('input', {type: 'file', accept: '.json,application/json', onchange: guarded(async () => {
    if (!input.files[0] || target !== db || running || busy) return;
    const backup = JSON.parse(await input.files[0].text());
    if (target !== db || running || busy) return;
    if (!validateBackup(backup)) return message('この画面に対応するバックアップを選んでください。');
    if (!confirm('保存済みのデータを、このファイルで置き換えますか？')) return;
    busy = true;
    try {
      await historyWrites;
      const values = Object.fromEntries(Object.keys(initial).map(key => [key, backup.state[key] ?? initial[key]]));
      if (state.quota.day === quotaDay() && (values.quota.day !== state.quota.day || state.quota.units > values.quota.units)) values.quota = state.quota;
      await db.replace(values);
      state = values;
      message('バックアップを読み込みました。');
      render();
    } finally { busy = false; }
  })});
  input.click();
}

function settings() {
  return settingsView({...state, quota: state.quota.day === quotaDay() ? state.quota.units : 0}, {
    demo, export: exportState, import: importState,
    setting: guarded(async (key, value) => {
      const next = {...state.settings, [key]: value};
      state.settings = next;
      await db.set('settings', next);
    }),
    clear: guarded(async key => {
      if (!confirm(key === 'hidden' ? '非表示の履歴をすべて消去しますか？' : '視聴済みの履歴をすべて消去しますか？')) return;
      const target = db;
      const operation = historyWrites.then(() => target.set(key, []));
      historyWrites = operation.catch(() => {});
      await operation;
      if (target === db) {
        state[key] = [];
        render();
      }
    }),
    exit: () => {
      if (running || busy) return message('処理が終わってからお試しください。');
      if (!demo) signOut();
      demo = false;
      db = storage();
      tab = 'discovery';
      person = null;
      render();
    }
  });
}

function selectTab(key) {
  tab = key;
  person = null;
  render();
  window.scrollTo(0, 0);
}
function render() {
  const active = demo || token();
  const brand = h('div', {class: 'brand'}, h('img', {src: './icon.svg', alt: '', width: 36, height: 36}), h('span', {}, 'セレンディピティTube'));
  const header = h('header', {class: 'topbar'}, h('div', {class: 'top-inner'}, brand,
    demo ? h('span', {class: 'demo-label'}, 'デモ') : active ? button('↻ 更新', guarded(update)) : null));
  if (!active && !running) {
    root.replaceChildren(header, h('main', {class: 'shell'}, setup(Boolean(GOOGLE_CLIENT_ID), guarded(login), guarded(enterDemo))));
    return;
  }
  const progress = running && h('section', {class: 'panel progress'}, h('progress', {'aria-label': '更新中'}),
    h('div', {id: 'progress-label', role: 'status'}), button('中止', () => running.controller.abort()));
  const heading = {discovery: '発見', subscribed: '登録チャンネル', people: '似た好みの人', settings: '設定'}[tab];
  const descriptions = {
    discovery: '高評価や共通のコメントから見つけた動画',
    subscribed: '登録しているチャンネルの新着動画',
    people: '同じ動画にコメントした人をたどる'
  };
  let body;
  if (tab === 'settings') body = settings();
  else if (tab === 'people') body = person ? timeline(person, state.timelineVideos, actions, () => selectTab('people'), guarded(uploads)) :
    peopleView(state.people, selected => { person = selected; render(); window.scrollTo(0, 0); });
  else body = feed(getFeed(tab), actions, state.refresh.last ? undefined : '「更新」を押して動画を取得してください。');
  const navbar = h('nav', {class: 'tabs', 'aria-label': 'メインメニュー'}, h('div', {class: 'tabs-inner'}, tabs.map(([key, name, symbol]) => {
    const item = button([icon(symbol), h('span', {}, name)], () => selectTab(key), 'tab');
    if (key === tab) item.setAttribute('aria-current', 'page');
    return item;
  })));
  root.replaceChildren(header, h('main', {class: 'shell'}, progress,
    h('div', {class: 'page-head'}, h('div', {}, h('h1', {}, heading), descriptions[tab] && h('p', {}, descriptions[tab])),
      ['discovery', 'subscribed'].includes(tab) && button([icon('tv'), ' TV モード'], () => play(), 'button primary tv-button')),
    body), navbar);
  paintProgress();
}

render();
if (token()) guarded(async () => { await loadState(); if (!demo) render(); })();
if (GOOGLE_CLIENT_ID) prepareSignIn().catch(() => {});
if (GOOGLE_CLIENT_ID) {
  let hadToken = Boolean(token());
  const checkSession = () => {
    const signedIn = Boolean(token());
    if (running || busy) return;
    if (hadToken && !signedIn && !demo) {
      render();
      message('セッションが切れました。Google で再ログインしてください。');
    }
    hadToken = signedIn;
  };
  setInterval(checkSession, 5000);
  document.addEventListener('visibilitychange', checkSession);
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
