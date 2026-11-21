import {element as h, button} from './dom.js';

export function setup(configured, signIn, demo) {
  return h('section', {class: 'setup'},
    h('div', {class: 'hero'}, h('span', {class: 'kicker'}, 'あなたのための動画棚'),
      h('h1', {}, '次の一本を、', h('br'), '偶然に出会う。'),
      h('p', {}, '高評価、登録チャンネル、共通のコメントから、まだ知らない動画へ。'),
      h('div', {class: 'actions'}, configured && button('Google でログイン', signIn, 'button primary'), button('デモデータで試す', demo, 'button ' + (configured ? '' : 'primary')))),
    !configured && h('section', {class: 'panel'}, h('h2', {}, 'はじめての設定'),
      h('ol', {}, [
        'Google Cloud でプロジェクトを作成し、YouTube Data API v3 を有効にします。',
        'OAuth 同意画面の対象を「外部」にし、テストユーザーに自分の Google アカウントを追加します。',
        'OAuth クライアント ID の種類に「ウェブ アプリケーション」を選びます。',
        '承認済みの JavaScript 生成元に https://kunoyu2.github.io を追加します。ローカルでは http://localhost:8080 も追加します。',
        '発行されたクライアント ID を config.js の GOOGLE_CLIENT_ID に貼り付けます。リダイレクト URI の設定は不要です。'
      ].map(line => h('li', {}, line))),
      h('p', {}, '現在のオリジン ', h('code', {}, location.origin))));
}
