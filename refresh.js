import {youtube} from './api.js';
import {eligible, durationSeconds, rankPeople, rankVideos} from './rank.js';

export const defaults = {commentCap: 60, peopleCap: 25, showWatched: false};
const day = 86400000;
const parts = 'snippet,contentDetails,statistics,status';
const batches = function* (ids) {
  for (let i = 0; i < ids.length; i += 50) yield ids.slice(i, i + 50);
};
const ids = items => [...new Set(items.filter(Boolean))];
const subscription = item => ({id: item.snippet.resourceId.channelId, title: item.snippet.title});

export function videoCard(video, sources) {
  return {
    id: video.id, title: video.snippet.title, channel: video.snippet.channelTitle,
    channelId: video.snippet.channelId, published: video.snippet.publishedAt,
    duration: durationSeconds(video.contentDetails.duration), views: Number(video.statistics?.viewCount ?? 0), sources
  };
}

function client(db, signal, onQuota) {
  const call = youtube(db, signal, onQuota);
  async function cached(key, days, load) {
    signal?.throwIfAborted();
    const record = await db.get('cache:' + key);
    if (record && Date.now() - record.time < days * day) return record.value;
    const value = await load();
    await db.set('cache:' + key, {time: Date.now(), value});
    return value;
  }
  async function optional(request, reasons, fallback) {
    try { return await request(); }
    catch (error) {
      if (reasons.includes(error.reason)) return fallback;
      throw error;
    }
  }
  async function pages(resource, params, limit, run) {
    const result = [];
    let pageToken = '';
    do {
      const page = await cached(run + ':' + resource + ':' + pageToken, 2,
        () => call(resource, {...params, maxResults: 50, ...(pageToken && {pageToken})}));
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && result.length < limit);
    return result.slice(0, limit);
  }
  async function channels(channelIds) {
    const result = {};
    const missing = [];
    for (const id of ids(channelIds)) {
      const entry = await db.get('channel:' + id);
      if (entry && Date.now() - entry.time < 14 * day) result[id] = entry.value;
      else missing.push(id);
    }
    for (const group of batches(missing)) {
      const data = await call('channels', {part: 'snippet,contentDetails', id: group.join(',')});
      const found = new Map((data.items ?? []).map(item => [item.id, item]));
      for (const id of group) {
        const item = found.get(id);
        const value = item ? {id, title: item.snippet.title, uploads: item.contentDetails?.relatedPlaylists?.uploads} : null;
        result[id] = value;
        await db.set('channel:' + id, {time: Date.now(), value});
      }
    }
    return result;
  }
  async function playlist(id) {
    if (!id) return [];
    return cached('playlist:' + id, 1, async () => {
      const data = await optional(() => call('playlistItems', {part: 'contentDetails', playlistId: id, maxResults: 12}),
        ['playlistNotFound', 'playlistItemsNotAccessible', 'forbidden'], {});
      return ids((data.items ?? []).map(item => item.contentDetails.videoId));
    });
  }
  async function videos(videoIds, consume) {
    for (const group of batches(ids(videoIds))) {
      const data = await cached('videos:' + [...group].sort().join(','), 1,
        () => call('videos', {part: parts, id: group.join(',')}));
      await consume((data.items ?? []).filter(eligible));
    }
  }
  return {call, cached, optional, pages, channels, playlist, videos};
}

export async function channelUploads(db, id) {
  const api = client(db);
  const channel = (await api.channels([id]))[id];
  const videos = [];
  await api.videos(await api.playlist(channel?.uploads), items => {
    videos.push(...items.map(item => videoCard(item, [{type: 'uploads', name: channel.title}])));
  });
  return videos;
}

export async function refresh(db, settings, signal, report) {
  let units = 0;
  let step = 'ライブラリを取得';
  let count = 0;
  const update = (name, total = 0) => {
    step = name;
    count = total;
    report({step, count, units});
  };
  const api = client(db, signal, () => {
    units++;
    report({step, count, units});
  });
  const prior = await db.get('refresh', {});
  const run = prior.pending && Date.now() - prior.pending < day ? prior.pending : Date.now();
  await db.set('refresh', {...prior, pending: run});
  update(step);
  const likes = (await api.pages('videos', {part: parts, myRating: 'like'}, 200, run)).filter(eligible);
  await db.set('likes', likes.map(item => videoCard(item, [])));
  update('登録チャンネルを取得', likes.length);
  const own = (await api.pages('subscriptions', {part: 'snippet', mine: true, order: 'relevance'}, 500, run)).map(subscription);
  await db.set('subscriptions', own);
  const ownIds = new Set(own.map(channel => channel.id));
  const owner = await api.cached(run + ':owner', 2, () => api.call('channels', {part: 'id', mine: true}));
  const selfIds = new Set((owner.items ?? []).map(item => item.id));
  const offset = (prior.offset ?? 0) % (own.length || 1);
  const sampled = [...own.slice(offset), ...own.slice(0, offset)].slice(0, 40);
  const subscribedSources = new Map();
  const ownVideos = new Map();
  const oldSubscribed = (await db.get('subscribed', [])).filter(video => ownIds.has(video.channelId));
  const ownChannels = await api.channels(sampled.map(channel => channel.id));
  for (const channel of sampled) {
    update('登録チャンネルの新着', subscribedSources.size);
    for (const id of await api.playlist(ownChannels[channel.id]?.uploads)) subscribedSources.set(id, channel);
  }
  const seeds = new Map(likes.map(item => [item.id, item]));
  const saveSubscribed = async previous => {
    await db.set('subscribed', [...ownVideos.values(), ...previous.filter(video => !ownVideos.has(video.id))]
      .sort((a, b) => b.published.localeCompare(a.published)).slice(0, 600));
  };
  await api.videos([...subscribedSources.keys()], async items => {
    for (const item of items) {
      seeds.set(item.id, item);
      ownVideos.set(item.id, videoCard(item, [{type: 'uploads', name: subscribedSources.get(item.id).title}]));
    }
    await saveSubscribed(oldSubscribed);
  });
  const refreshedChannels = new Set(sampled.map(channel => channel.id));
  await saveSubscribed(oldSubscribed.filter(video => !refreshedChannels.has(video.channelId)));
  const comments = {};
  const seedIds = ids([...likes.slice(0, Math.ceil(settings.commentCap / 2)).map(item => item.id),
    ...[...ownVideos.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, Math.floor(settings.commentCap / 2)).map(item => item.id),
    ...seeds.keys()]).slice(0, settings.commentCap);
  for (const id of seedIds) {
    update('共通のコメント投稿者を探す', Object.keys(comments).length);
    const authors = await api.cached('comments:' + id, 7, async () => {
      const data = await api.optional(() => api.call('commentThreads', {part: 'snippet', videoId: id, order: 'relevance', maxResults: 20}),
        ['commentsDisabled', 'videoNotFound', 'forbidden'], {});
      return (data.items ?? []).map(item => item.snippet.topLevelComment.snippet)
        .filter(item => item.authorChannelId?.value)
        .map(item => ({id: item.authorChannelId.value, name: item.authorDisplayName}));
    });
    comments[id] = authors.filter(author => !selfIds.has(author.id));
    await db.set('comments', comments);
  }
  const sourcesByChannel = new Map();
  const sourcesByVideo = new Map();
  function add(map, id, source) {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(source);
  }
  const people = rankPeople(comments).slice(0, settings.peopleCap);
  const subscriptions = {};
  const timelines = {};
  for (const person of people) {
    update('公開タイムラインを調べる', Object.keys(timelines).length);
    const channelId = person.id;
    subscriptions[channelId] = await api.cached('subscriptions:' + channelId, 7, async () => {
      const data = await api.optional(() => api.call('subscriptions', {part: 'snippet', channelId, maxResults: 50}),
        ['subscriptionForbidden', 'channelNotFound', 'subscriberNotFound'], null);
      return data ? (data.items ?? []).map(subscription) : null;
    });
    const ranked = rankPeople(comments, subscriptions, own).find(item => item.id === channelId);
    const base = {personId: channelId, name: person.name, count: person.count, overlap: ranked.overlap, seeds: person.seeds};
    for (const channel of subscriptions[channelId] ?? []) {
      add(sourcesByChannel, channel.id, {...base, key: 'person:' + channelId, type: 'subscription'});
    }
    const playlists = await api.cached('public-playlists:' + channelId, 7, async () => {
      const data = await api.optional(() => api.call('playlists', {part: 'snippet,status', channelId, maxResults: 5}),
        ['channelNotFound', 'playlistForbidden'], {});
      return (data.items ?? []).filter(item => item.status?.privacyStatus === 'public').slice(0, 3)
        .map(item => ({id: item.id, title: item.snippet.title}));
    });
    for (const list of playlists) {
      list.videoIds = await api.playlist(list.id);
      for (const id of list.videoIds) add(sourcesByVideo, id, {...base, key: 'playlist:' + list.id, type: 'playlist', playlist: list.title});
    }
    timelines[channelId] = {...ranked, subscriptions: subscriptions[channelId], playlists};
    await db.set('people', Object.values(timelines).sort((a, b) => b.count * 2 + b.overlap - a.count * 2 - a.overlap));
  }
  const likedChannels = new Map(likes.map(item => [item.snippet.channelId, {id: item.snippet.channelId, title: item.snippet.channelTitle}]));
  const features = new Map([...likedChannels, ...sampled.map(channel => [channel.id, channel])]);
  let featuredCount = 0;
  for (const id of ids([...sampled.map(channel => channel.id), ...likedChannels.keys()]).slice(0, 65)) {
    update('紹介チャンネルを調べる', featuredCount++);
    const sections = await api.cached('sections:' + id, 7, async () => {
      const data = await api.optional(() => api.call('channelSections', {part: 'snippet,contentDetails', channelId: id}),
        ['channelNotFound', 'channelSectionForbidden'], {});
      return data.items ?? [];
    });
    const source = {key: 'featured:' + id, type: 'featured', channelId: id, name: features.get(id).title, subscribed: ownIds.has(id)};
    for (const section of sections) {
      for (const channel of section.contentDetails?.channels ?? []) add(sourcesByChannel, channel, source);
    }
    for (const list of ids(sections.flatMap(section => section.contentDetails?.playlists ?? [])).slice(0, 3)) {
      for (const video of await api.playlist(list)) add(sourcesByVideo, video, source);
    }
  }
  const featuredVideos = [...sourcesByVideo].filter(([, sources]) => sources.some(source => source.type === 'featured'));
  await api.videos(featuredVideos.map(([id]) => id), items => {
    for (const item of items) {
      for (const source of sourcesByVideo.get(item.id)) {
        if (source.type === 'featured') add(sourcesByChannel, item.snippet.channelId, source);
      }
    }
  });
  for (const [id, sources] of sourcesByChannel) {
    sourcesByChannel.set(id, [...new Map(sources.map(source => [source.key, source])).values()]);
  }
  const channels = await api.channels([...sourcesByChannel.keys()].filter(id => !ownIds.has(id))
    .sort((a, b) => sourcesByChannel.get(b).length - sourcesByChannel.get(a).length).slice(0, 240));
  await db.set('discovered', Object.values(channels).filter(Boolean).map(channel => ({...channel, sources: sourcesByChannel.get(channel.id)})));
  const candidateIds = new Set(sourcesByVideo.keys());
  let channelCount = 0;
  const candidates = new Map();
  const oldCandidates = await db.get('candidates', []);
  let candidateCount = 0;
  const save = async items => {
    for (const item of items) {
      const sources = [...(sourcesByChannel.get(item.snippet.channelId) ?? []), ...(sourcesByVideo.get(item.id) ?? [])];
      candidates.set(item.id, videoCard(item, sources));
    }
    candidateCount += items.length;
    await db.set('timelineVideos', Object.fromEntries([...candidates].filter(([id]) => sourcesByVideo.has(id))));
    await db.set('candidates', rankVideos([...oldCandidates.filter(video => !candidates.has(video.id)), ...candidates.values()]
      .filter(video => !ownIds.has(video.channelId)), Date.now(), Infinity).slice(0, 1200));
    update('候補動画を確認', candidateCount);
  };
  const checked = new Set();
  const checkCandidates = async () => {
    const pending = [...candidateIds].filter(id => !checked.has(id));
    await api.videos(pending, save);
    for (const id of pending) checked.add(id);
  };
  await checkCandidates();
  for (const channel of Object.values(channels).filter(Boolean)) {
    update('発見したチャンネルの新着', channelCount++);
    for (const id of await api.playlist(channel.uploads)) candidateIds.add(id);
    if (channelCount % 10 === 0) await checkCandidates();
  }
  await checkCandidates();
  await db.set('candidates', rankVideos([...candidates.values()].filter(video => !ownIds.has(video.channelId)), Date.now(), Infinity).slice(0, 1200));
  signal.throwIfAborted();
  await db.set('refresh', {last: Date.now(), offset: offset + 40, units});
}
