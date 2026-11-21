import {hatenaUrl} from './video.js';

export function element(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
}
export const button = (label, onclick, className = 'button') => element('button', {type: 'button', class: className, onclick}, label);
export const external = (label, href, className = '') => element('a', {href, class: className, target: '_blank', rel: 'noopener noreferrer'}, label);
export const bookmark = video => external('🔖 ' + video.n.toLocaleString('ja-JP') + ' users', hatenaUrl(video.id), 'badge');

export function commentList(comments) {
  if (!comments.length) return null;
  return element('section', {class: 'comments'}, element('h3', {}, 'ブクマコメント'),
    ...comments.map(item => element('p', {}, element('strong', {}, item.u), ' ', item.c)));
}
