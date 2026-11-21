import {videoId, watchUrl} from '../../js/video.js';

export const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export const hatena = 'https://b.hatena.ne.jp';
export const feeds = ['www.youtube.com', 'youtu.be'].map(host =>
  hatena + '/site/' + host + '/?mode=rss&sort=hot&threshold=3');
feeds.push(hatena + '/hotentry/all.rss');

export function normalizeVideo(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const segments = url.pathname.split('/');
    let id;
    if (url.hostname === 'youtu.be' && segments.length === 2) id = segments[1];
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      if (segments.length === 3 && segments[1] === 'embed') id = segments[2];
    }
    return id && videoId.test(id) ? id : null;
  } catch {
    return null;
  }
}

const entities = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
export function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (match, cdata, entity) => {
      if (cdata !== undefined) return cdata;
      if (entity[0] !== '#') return entities[entity] ?? match;
      const numeric = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return numeric <= 0x10ffff ? String.fromCodePoint(numeric) : match;
    });
}

export function parseRss(xml) {
  if (!/<(?:rdf:RDF|rss)(?:\s|>)/i.test(xml)) throw new Error('Unexpected RSS response');
  return Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi), ([, item]) => {
    const field = tag => decodeXml(item.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>','i'))?.[1]?.trim() ?? '');
    const url = field('link');
    const date = field('dc:date');
    return {id: normalizeVideo(url), url, t: field('title'), n: Number(field('hatena:bookmarkcount')) || 0,
      d: Number.isFinite(Date.parse(date)) ? date.slice(0, 10) : '',
      image: field('hatena:imageurl'), description: field('description')};
  });
}

export function prefixes(prefix = '') {
  return prefix.length < 3 ? Array.from(alphabet, char => prefix + char) : [];
}

export function shardUrl(form, prefix, sort) {
  const url = form === 'watch' ? watchUrl(prefix) : 'https://youtu.be/' + prefix;
  return hatena + '/entrylist?' + new URLSearchParams({mode: 'rss', url, sort, threshold: sort === 'count' ? 5 : 3});
}

export function countBatches(urls) {
  const unique = [...new Set(urls)];
  const batches = [];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    batches.push({urls: batch, url: 'https://bookmark.hatenaapis.com/count/entries?' +
      new URLSearchParams(batch.map(url => ['url', url]))});
  }
  return batches;
}

export function oembedAction(status) {
  if (status === 200) return 'accept';
  return [400, 401, 403, 404].includes(status) ? 'dead' : 'skip';
}

export function shortsAction(status, location, id) {
  if (status === 200) return 'short';
  if (![301, 302, 303].includes(status) || !location) return 'skip';
  try {
    const url = new URL(location, watchUrl(id));
    return url.pathname === '/watch' && normalizeVideo(url.href) === id ? 'accept' : 'skip';
  } catch {
    return 'skip';
  }
}
