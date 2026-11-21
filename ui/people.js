import {element as h, button, external} from './dom.js';
import {feed} from './feed.js';

export function peopleView(people, select) {
  if (!people.length) return h('p', {class: 'empty'}, '更新すると、共通の動画にコメントした人が表示されます。');
  return h('div', {class: 'people'}, people.map(person =>
    h('article', {class: 'panel person'},
      h('span', {class: 'avatar', 'aria-hidden': 'true'}, person.name.slice(0, 1)),
      h('div', {}, h('h2', {}, person.name), h('p', {}, `共通の動画 ${person.count}本 ・ 共通の登録 ${person.overlap}件`)),
      button('タイムライン', () => select(person)))));
}

export function timeline(person, videos, actions, back, uploads) {
  return h('section', {class: 'timeline'}, button('← 人一覧', back),
    h('h2', {}, person.name + 'さんのタイムライン'),
    person.demo ? null : external('YouTube チャンネル ↗', 'https://www.youtube.com/channel/' + encodeURIComponent(person.id)),
    h('h3', {}, '公開登録チャンネル'),
    person.subscriptions === null ? h('p', {}, '登録チャンネルは非公開です。') :
      person.subscriptions.length ? person.subscriptions.map(channel =>
        h('div', {class: 'panel upload-row'}, h('strong', {}, channel.title), button('新着動画', event => uploads(channel, event.currentTarget)))) :
        h('p', {}, '公開登録チャンネルがありません。'),
    h('h3', {}, '公開再生リスト'),
    person.playlists.length ? person.playlists.map(list =>
      h('section', {}, h('h4', {}, list.title), feed(list.videoIds.map(id => videos[id]).filter(Boolean).filter(actions.visible), actions))) :
      h('p', {}, '公開再生リストがありません。'));
}
