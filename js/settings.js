import {button, element as h} from './dom.js';
import {localSets, serializeSets, setKeys} from './catalog.js';

export function openSettings(sets, update) {
  const names = {hidden: '非表示の動画', watched: '視聴済み', hiddenChannels: '非表示のチャンネル'};
  const rows = h('div');
  const status = h('p', {role: 'status'});
  const input = h('input', {type: 'file', accept: '.json,application/json', hidden: '', onchange: async () => {
    if (!input.files.length) return;
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!setKeys.every(key => Array.isArray(data?.[key]))) throw new Error();
      if (!confirm('現在の非表示リストと視聴履歴を読み込んだ内容に置き換えますか？')) return;
      sets = localSets(data);
      update(sets);
      render();
      status.textContent = '設定を読み込みました。';
    } catch {
      status.textContent = '設定のJSONファイルを読み込めませんでした。';
    } finally {
      input.value = '';
    }
  }});
  const dialog = h('dialog', {class: 'player settings', 'aria-label': '設定'},
    h('div', {class: 'player-bar'}, h('h2', {}, '設定'), button('閉じる', () => dialog.close())),
    h('p', {}, '非表示と視聴履歴は、このブラウザーに保存されます。'), rows,
    h('div', {class: 'actions'}, button('JSONを書き出す', () => {
      const href = URL.createObjectURL(new Blob([JSON.stringify(serializeSets(sets))], {type: 'application/json'}));
      h('a', {href, download: 'hatebu-video-settings.json'}).click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }), button('JSONを読み込む', () => input.click())), input, status);
  function render() {
    rows.replaceChildren(...setKeys.map(key => h('div', {class: 'setting-row'},
      h('span', {}, names[key] + ' ' + sets[key].size + '件'),
      button('リセット', () => {
        if (!confirm(names[key] + 'をリセットしますか？')) return;
        sets[key].clear();
        update(sets);
        render();
      }))));
  }
  render();
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog);
  dialog.showModal();
}
