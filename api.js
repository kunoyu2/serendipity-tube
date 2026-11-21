import {token, forget} from './auth.js';

const resources = new Set(['videos', 'playlistItems', 'subscriptions', 'channels', 'commentThreads', 'playlists', 'channelSections']);
export const quotaDay = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/Los_Angeles'}).format();

export function youtube(db, signal, onQuota = () => {}) {
  return async (resource, parameters) => {
    signal?.throwIfAborted();
    if (!resources.has(resource)) throw new Error('未対応の API です。');
    const access = token();
    if (!access) throw new Error('セッションの有効期限が切れました。再ログインしてください。');
    const day = quotaDay();
    const previous = await db.get('quota', {});
    const units = (previous.day === day ? previous.units : 0) + 1;
    await db.set('quota', {day, units});
    onQuota(units);
    const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
    url.search = new URLSearchParams(parameters);
    const response = await fetch(url, {signal, headers: {Authorization: 'Bearer ' + access}});
    const body = await response.json();
    if (response.ok) return body;
    if (response.status === 401) forget();
    const reason = body.error?.errors?.[0]?.reason;
    const message = response.status === 401 ? '再ログインしてください。' :
      ['quotaExceeded', 'dailyLimitExceeded'].includes(reason) ? 'API の利用上限に達しました。取得済みデータを保存しました。' :
      'YouTube API の取得に失敗しました（' + (reason || response.status) + '）。';
    throw Object.assign(new Error(message), {reason, status: response.status});
  };
}
