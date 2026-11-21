import {watchUrl} from '../../js/video.js';

export const byCount = (a, b) => b.n - a.n || (a.id < b.id ? -1 : Number(a.id > b.id));

export function mergeEntry(previous, item, today) {
  const d = [previous?.d, item.d].filter(Boolean).sort()[0] ?? '';
  if (!previous) return {id: item.id, t: item.t || item.id, n: item.n, d, u: today, ...(item.url === watchUrl(item.id) ? {} : {url: item.url})};
  const record = {...previous, d};
  if (item.n > previous.n) {
    record.n = item.n;
    record.u = today;
    if (item.url === watchUrl(item.id)) delete record.url;
    else record.url = item.url;
  }
  return record;
}

export function selectComments(bookmarks = []) {
  const seen = new Set();
  return bookmarks.flatMap(({user, comment, timestamp}) => {
    const c = typeof comment === 'string' ? comment.trim() : '';
    const length = [...c].length;
    const key = c.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    if (!user || length < 10 || length > 140 || /^(?:https?:\/\/\S+\s*)+$/i.test(c) || seen.has(key)) return [];
    seen.add(key);
    return [{u: user, c, d: timestamp ?? ''}];
  }).sort((a, b) => [...b.c].length - [...a.c].length).slice(0, 3);
}

export function serializeVideos(videos) {
  return JSON.stringify([...videos].sort(byCount).map(({id, t, c, cu, n, d, u, s}) => ({id, t, c, cu, n, d, u, s})));
}
