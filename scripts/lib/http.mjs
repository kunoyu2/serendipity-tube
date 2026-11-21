export const userAgent = 'serendipity-tube/1.0 (+https://github.com/kunoyu2/serendipity-tube)';
export class CollectionStop extends Error {}

export function createRequester({fetch, maxRequests, deadline, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  let count = 0;
  let previous = -Infinity;
  const lastHost = new Map();
  const request = async (url, options = {}) => {
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const start = now();
      const wait = Math.max(0, previous + 500 - start,
        (lastHost.get(host) ?? -Infinity) + (host === 'b.hatena.ne.jp' ? 1000 : 500) - start,
        attempt ? 1000 * 2 ** (attempt - 1) : 0);
      if (count >= maxRequests || start + wait >= deadline) throw new CollectionStop('Request or time budget reached');
      if (wait) await sleep(wait);
      previous = now();
      if (previous >= deadline) throw new CollectionStop('Time budget reached');
      lastHost.set(host, previous);
      count++;
      const timeout = Math.max(1000, Math.min(20000, deadline - previous));
      try {
        const response = await fetch(url, {...options, headers: {'User-Agent': userAgent},
          signal: AbortSignal.timeout(timeout)});
        if (response.status !== 429 && response.status < 500) return response;
        await response.body?.cancel();
      } catch (error) {
        if (error?.name === 'CollectionStop') throw error;
        if (attempt === 3) throw new CollectionStop('Repeated request failure at ' + host, {cause: error});
      }
    }
    throw new CollectionStop('Repeated HTTP failure at ' + host);
  };
  return {request, get count() { return count; }};
}
