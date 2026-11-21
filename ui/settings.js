import {element as h, button} from './dom.js';

export function settingsView({settings, hidden, watched, quota, refresh}, actions) {
  const input = (key, min, max) => h('input', {type: 'number', min, max, value: settings[key],
    onchange: event => {
      const field = event.target;
      const value = Math.min(max, Math.max(min, Math.round(field.valueAsNumber || min)));
      field.value = value;
      actions.setting(key, value);
    }});
  const toggle = h('input', {type: 'checkbox', onchange: event => actions.setting('showWatched', event.target.checked)});
  toggle.checked = settings.showWatched;
  return h('div', {class: 'settings'},
    h('section', {class: 'panel'}, h('h2', {}, '表示と履歴'),
      h('label', {class: 'setting-row'}, '視聴済みも表示', toggle),
      h('div', {class: 'setting-row'}, `非表示 ${hidden.length}本`, button('履歴を消去', () => actions.clear('hidden'))),
      h('div', {class: 'setting-row'}, `視聴済み ${watched.length}本`, button('履歴を消去', () => actions.clear('watched')))),
    h('section', {class: 'panel'}, h('h2', {}, '手動更新'),
      h('label', {class: 'setting-row'}, 'コメントを調べる動画数', input('commentCap', 1, 200)),
      h('label', {class: 'setting-row'}, '調べるコメント投稿者数', input('peopleCap', 1, 50)),
      h('p', {}, `本日の API 使用量（推定） ${quota} / 10,000 ユニット`),
      h('p', {class: 'muted'}, '標準上限は 1 日 10,000 ユニット。米国太平洋時間の午前 0 時に日付が切り替わります。'),
      h('p', {}, refresh.last ? '最終更新 ' + new Date(refresh.last).toLocaleString('ja-JP') : '更新履歴はありません。')),
    h('section', {class: 'panel'}, h('h2', {}, 'データとアカウント'),
      h('div', {class: 'actions'}, button('JSON を書き出す', actions.export),
        button('JSON を読み込む', actions.import), button(actions.demo ? 'デモを終了' : 'ログアウト', actions.exit))));
}
