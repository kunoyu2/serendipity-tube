import {videoId} from './video.js';

export const setKeys = ['hidden', 'watched', 'hiddenChannels'];
export const defaults = {sort: 'count', period: 'all', min: 3, query: '', channel: '', showWatched: false};
export const channelKey = video => video.cu || video.c || '';

export function localSets(value = {}) {
  return Object.fromEntries(setKeys.map(key => [key, new Set(
    (Array.isArray(value?.[key]) ? value[key] : []).filter(item =>
      typeof item === 'string' && (key === 'hiddenChannels' ? item.length > 0 : videoId.test(item)))
  )]));
}
export function serializeSets(sets) {
  return Object.fromEntries(setKeys.map(key => [key, [...sets[key]].sort()]));
}
export function shuffled(values, seed) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((seed / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function periodStart(period, now = new Date()) {
  if (!['week', 'month', 'quarter', 'year'].includes(period)) return '';
  const date = new Date(now);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - 7);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - {month: 1, quarter: 3, year: 12}[period]);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  return date.toISOString().slice(0, 10);
}
export function filterVideos(videos, controls, sets, seed, {now, comments = video => video.k ?? []} = {}) {
  const start = periodStart(controls.period, now);
  const year = /^\d{4}$/.test(controls.period) ? controls.period : '';
  const query = controls.query.trim().normalize('NFKC').toLowerCase();
  const result = videos.filter(video => {
    if (typeof video.id !== 'string' || !videoId.test(video.id) || video.short || video.isShort || video.shorts || video.dead ||
      video.flagged || (video.dur != null && Number(video.dur) <= 180)) return false;
    const channel = channelKey(video);
    if (sets.hidden.has(video.id) || sets.hiddenChannels.has(channel) || (!controls.showWatched && sets.watched.has(video.id))) return false;
    if (video.n < controls.min || (start && (!video.d || video.d < start)) || (year && !video.d?.startsWith(year)) ||
      (controls.channel && controls.channel !== channel)) return false;
    return !query || [video.t, video.c, ...comments(video).map(item => item.c)].some(value =>
      value?.normalize('NFKC').toLowerCase().includes(query));
  });
  if (controls.sort === 'random') return shuffled(result, seed);
  return result.sort((a, b) => (controls.sort === 'new' ? (b.d ?? '').localeCompare(a.d ?? '') : 0) ||
    b.n - a.n || (a.id < b.id ? -1 : Number(a.id > b.id)));
}
