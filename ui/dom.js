export function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined) node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(child => child != null && child !== false));
  return node;
}

export const button = (label, action, className = 'button') =>
  element('button', {type: 'button', class: className, onclick: action}, label);

export function why(video) {
  const source = video.sources[0];
  if (!source) return '発見したチャンネルの動画';
  if (source.type === 'subscription') return `${source.name}さん（共通の動画 ${source.count}本にコメント）の登録チャンネル`;
  if (source.type === 'playlist') return `${source.name}さんの公開再生リスト「${source.playlist}」`;
  if (source.type === 'featured') return `${source.subscribed ? '登録している' : '高評価した動画の'}「${source.name}」が紹介`;
  return `「${source.name}」の新着動画`;
}

export function timeLabel(duration) {
  const seconds = Math.floor(duration);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return [hours || null, hours ? String(minutes).padStart(2, '0') : minutes, String(seconds % 60).padStart(2, '0')].filter(part => part !== null).join(':');
}

export function external(text, href) {
  return element('a', {href, target: '_blank', rel: 'noopener noreferrer', class: 'button'}, text);
}
