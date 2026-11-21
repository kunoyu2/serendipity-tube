import {element as h, button, why, external} from './ui/dom.js';

let library;
function iframeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve();
  library ??= new Promise((resolve, reject) => {
    const script = h('script', {src: 'https://www.youtube.com/iframe_api'});
    const failed = () => {
      clearTimeout(timeout);
      script.remove();
      library = null;
      reject(new Error('プレーヤーを読み込めませんでした。'));
    };
    const timeout = setTimeout(failed, 15000);
    globalThis.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = failed;
    document.head.append(script);
  });
  return library;
}

export function openPlayer({video, initialFeed = 'discovery', getFeed, hide, watched, demo}) {
  const tv = !video;
  let player;
  let generation = 0;
  let wakeLock;
  let queue = video ? [video] : [];
  let index = 0;
  let muted = false;
  let playing = false;
  let blocked = false;
  const stage = h('div', {class: 'stage'});
  const info = h('div', {class: 'player-info'});
  const status = h('p', {class: 'player-status', role: 'status'});
  const sound = button('音声をオン', () => {
    muted = false;
    player?.unMute();
    player?.playVideo();
    sound.hidden = true;
  });
  sound.hidden = true;
  const play = button('再生', () => playing ? player?.pauseVideo() : player?.playVideo());
  const selector = h('select', {'aria-label': '再生フィード', onchange: rebuild},
    h('option', {value: 'discovery'}, '発見'), h('option', {value: 'subscribed'}, '登録'),
    h('option', {value: 'mix'}, 'ミックス'));
  selector.value = initialFeed;
  const shuffle = h('input', {type: 'checkbox', onchange: rebuild});
  const hideCurrent = button(tv ? '非表示にして次へ' : '非表示', async () => {
    const current = queue[index];
    if (!current) return;
    hideCurrent.disabled = true;
    try {
      await hide(current);
      if (!dialog.open) return;
      if (!tv) return dialog.close();
      const active = queue[index];
      queue = queue.filter(item => item.id !== current.id);
      if (active === current) {
        index %= queue.length || 1;
        load();
      } else index = Math.max(0, queue.indexOf(active));
    } catch {
      status.textContent = '非表示を保存できませんでした。';
    } finally {
      hideCurrent.disabled = false;
    }
  });
  const controls = h('div', {class: 'actions player-controls'}, play,
    tv && button('前へ', () => move(-1)), tv && button('次へ', () => move(1)),
    tv && button('スキップ', () => move(1)), hideCurrent, sound);
  const dialog = h('dialog', {class: tv ? 'player tv' : 'player', 'aria-label': tv ? 'TV モード' : '動画プレーヤー'},
    h('div', {class: 'player-bar'}, h('strong', {}, tv ? 'TV モード' : '動画'), button('閉じる ×', () => dialog.close())),
    tv && h('div', {class: 'actions tv-options'}, selector, h('label', {}, shuffle, ' シャッフル')),
    stage, info, status, controls);

  function rebuild() {
    queue = [...getFeed(selector.value)];
    if (shuffle.checked) {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    }
    index = 0;
    load();
  }
  function move(offset, automatic = false) {
    if (!queue.length) return;
    if (automatic && index >= queue.length - 1) {
      status.textContent = 'このフィードの再生が終了しました。';
      return;
    }
    index = (index + offset + queue.length) % queue.length;
    load();
  }
  async function load() {
    const request = ++generation;
    player?.destroy();
    player = null;
    playing = false;
    blocked = false;
    play.textContent = '再生';
    stage.replaceChildren();
    info.replaceChildren();
    status.textContent = '';
    sound.hidden = true;
    const current = queue[index];
    play.disabled = !current || demo;
    hideCurrent.disabled = !current;
    if (!current) {
      status.textContent = '再生できる動画がありません。';
      return;
    }
    info.append(h('h2', {}, current.title), h('p', {class: 'channel'}, current.channel), h('p', {class: 'why'}, why(current)));
    if (demo) {
      stage.append(h('div', {class: 'thumb demo-stage', 'data-art': current.art}, h('span', {class: 'art-mark'})));
      status.textContent = 'デモ動画のプレビューです。';
      return;
    }
    info.append(external('YouTube で開く ↗', 'https://www.youtube.com/watch?v=' + encodeURIComponent(current.id)));
    const mount = h('div');
    stage.append(mount);
    try {
      await iframeAPI();
      if (request !== generation || !dialog.open) return;
      player = new YT.Player(mount, {
        videoId: current.id,
        playerVars: {rel: 0, playsinline: 1, origin: location.origin, hl: 'ja'},
        events: {
          onReady({target}) {
            if (request !== generation) return;
            if (muted) {
              target.mute();
              sound.hidden = false;
            }
            target.playVideo();
          },
          onAutoplayBlocked({target}) {
            if (request !== generation) return;
            sound.hidden = false;
            if (blocked) {
              status.textContent = '再生ボタンを押してください。';
              return;
            }
            blocked = true;
            muted = true;
            target.mute();
            target.playVideo();
          },
          onStateChange({data}) {
            if (request !== generation) return;
            playing = data === YT.PlayerState.PLAYING;
            play.textContent = playing ? '一時停止' : '再生';
            if (playing) {
              status.textContent = '';
              watched(current).catch(() => { status.textContent = '視聴履歴を保存できませんでした。'; });
            }
            if (data === YT.PlayerState.ENDED && tv) move(1, true);
          },
          onError({data}) {
            if (request !== generation) return;
            if (tv && index < queue.length - 1) return move(1, true);
            status.textContent = [101, 150].includes(data) ? 'この動画は埋め込み再生できません。' : 'この動画を再生できませんでした。';
          }
        }
      });
    } catch (error) {
      if (request === generation) status.textContent = error.message;
    }
  }
  async function keepAwake() {
    if (!tv || !dialog.open || document.hidden || !navigator.wakeLock || (wakeLock && !wakeLock.released)) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (dialog.open) wakeLock = lock;
      else await lock.release();
    } catch {}
  }
  dialog.addEventListener('close', () => {
    generation++;
    player?.destroy();
    wakeLock?.release().catch(() => {});
    document.removeEventListener('visibilitychange', keepAwake);
    dialog.remove();
  }, {once: true});
  document.body.append(dialog);
  dialog.showModal();
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();
  if (tv) rebuild();
  else load();
  return dialog;
}
