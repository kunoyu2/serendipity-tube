import {element as h, button, why, timeLabel} from './dom.js';

export function feed(videos, actions, empty = '表示できる動画がありません。') {
  if (!videos.length) return h('p', {class: 'empty'}, empty);
  const list = h('div', {class: 'cards'});
  const more = button('さらに表示', append, 'button more');
  let index = 0;
  function append() {
    for (const video of videos.slice(index, index + 12)) {
      const thumbnail = h('div', {class: 'thumb', 'data-art': video.art ?? 'blue'},
        video.demo ? h('span', {class: 'art-mark', 'aria-hidden': 'true'}) :
          h('img', {src: 'https://i.ytimg.com/vi/' + encodeURIComponent(video.id) + '/mqdefault.jpg', alt: '', loading: 'lazy', decoding: 'async'}),
        h('span', {class: 'duration'}, timeLabel(video.duration)));
      const open = button([
        thumbnail, h('span', {class: 'video-title'}, video.title), h('span', {class: 'channel'}, video.channel)
      ], () => actions.open(video), 'card-open');
      list.append(h('article', {class: 'card'}, open,
        h('div', {class: 'card-footer'}, h('span', {class: 'why'}, why(video)),
          button('非表示', event => actions.hide(video, event.currentTarget.closest('article')), 'button subtle'))));
    }
    index += 12;
    more.hidden = index >= videos.length;
  }
  append();
  return h('div', {}, list, more);
}
