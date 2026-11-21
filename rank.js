export function durationSeconds(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return 0;
  return match.slice(1).reduce((sum, number, i) => sum + Number(number || 0) * [86400, 3600, 60, 1][i], 0);
}

export function eligible(video) {
  const snippet = video.snippet;
  if (!snippet || !/^[\w-]{11}$/.test(video.id) || durationSeconds(video.contentDetails?.duration) <= 180) return false;
  if (snippet.liveBroadcastContent !== 'none' || video.status?.privacyStatus === 'private' ||
      ['deleted', 'failed', 'rejected', 'uploaded'].includes(video.status?.uploadStatus)) return false;
  return !/\bshorts\b/i.test([snippet.title, snippet.description, ...(snippet.tags ?? [])].join(' '));
}

export function rankPeople(comments, subscriptions = {}, own = []) {
  const people = new Map();
  const ownIds = new Set(own.map(channel => channel.id));
  for (const [video, authors] of Object.entries(comments)) {
    for (const author of authors) {
      if (!people.has(author.id)) people.set(author.id, {...author, seeds: new Set()});
      people.get(author.id).seeds.add(video);
    }
  }
  return [...people.values()].map(({seeds, ...person}) => {
    const overlap = new Set((subscriptions[person.id] ?? []).filter(channel => ownIds.has(channel.id)).map(channel => channel.id)).size;
    return {...person, seeds: [...seeds], count: seeds.size, overlap};
  }).sort((a, b) => (b.count * 2 + b.overlap) - (a.count * 2 + a.overlap) || a.id.localeCompare(b.id));
}

export function sourceWeight(source) {
  return (source.type === 'featured' ? 4 : 2) + (source.count ?? 0) * 1.5 + (source.overlap ?? 0) * 0.8;
}

export function rankVideos(videos, now = Date.now(), cap = 4) {
  const unique = new Map();
  for (const video of videos) {
    const previous = unique.get(video.id);
    const sources = new Map([...(previous?.sources ?? []), ...video.sources].map(source => [source.key, source]));
    unique.set(video.id, {...video, sources: [...sources.values()].sort((a, b) => sourceWeight(b) - sourceWeight(a))});
  }
  const sorted = [...unique.values()].map(video => {
    const days = Math.max(0, (now - Date.parse(video.published)) / 86400000) || 0;
    const score = video.sources.reduce((sum, source) => sum + sourceWeight(source), 0) +
      5 / (1 + days / 14) + Math.log10(1 + video.views) * 0.25;
    return {...video, score};
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const counts = new Map();
  return sorted.filter(video => {
    const count = (counts.get(video.channelId) ?? 0) + 1;
    counts.set(video.channelId, count);
    return count <= cap;
  });
}
