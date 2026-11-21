import {element as h, button, bookmark, commentList, external} from './js/dom.js';
import {watchUrl} from './js/video.js';

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

export function openPlayer({videos, tv = false, hide, watched, comments}) {
  let queue = [...videos];
  let player;
  let generation = 0;
  let wakeLock;
  let watchTimer;
  let index = 0;
  let muted = false;
  let playing = false;
  let blocked = false;
  const stage = h('div', {class: 'stage'});
  const info = h('div', {class: 'player-info'});
  const status = h('p', {class: 'player-status', role: 'status'});
  const sound = button('タップで音を出す', () => {
    muted = false;
    player?.unMute();
    player?.playVideo();
    sound.hidden = true;
  });
  sound.hidden = true;
  const play = button('再生', togglePlay);
  const prev = button('前へ', () => move(-1));
  const next = button('次へ', () => move(1));
  const hideCurrent = button(tv ? '非表示して次へ' : '非表示', () => {
    if (!queue[index]) return;
    hide(queue[index]);
    queue.splice(index, 1);
    if (!tv) {
      dialog.close();
      return;
    }
    if (index >= queue.length) index = 0;
    load();
  });
  const dialog = h('dialog', {class: tv ? 'player tv' : 'player', 'aria-label': tv ? 'TVモード' : '動画プレーヤー'},
    h('div', {class: 'player-bar'}, h('strong', {}, tv ? 'TVモード' : '動画'), button('閉じる ×', () => dialog.close())),
    stage, h('div', {class: 'actions player-controls'}, tv && prev, play, next, hideCurrent, sound), status, info);

  function togglePlay() {
    if (!player && queue[index]) {
      load();
      return;
    }
    if (playing) player?.pauseVideo();
    else player?.playVideo();
  }
  function move(offset) {
    const target = index + offset;
    if (target < 0 || target >= queue.length) return false;
    index = target;
    load();
    return true;
  }
  function clearPlayer() {
    clearTimeout(watchTimer);
    player?.destroy();
    player = null;
    playing = false;
    sound.hidden = true;
    stage.replaceChildren();
  }
  function finish(message) {
    generation++;
    clearPlayer();
    play.textContent = 'もう一度再生';
    status.textContent = message;
  }
  async function load() {
    const request = ++generation;
    clearPlayer();
    blocked = false;
    play.textContent = '再生';
    info.replaceChildren();
    status.textContent = '';
    const current = queue[index];
    play.disabled = true;
    hideCurrent.disabled = !current;
    prev.disabled = index === 0;
    next.disabled = index >= queue.length - 1;
    if (!current) {
      status.textContent = '再生できる動画がありません。';
      return;
    }
    info.append(h('h2', {}, current.t), h('p', {class: 'channel'}, current.c),
      h('div', {class: 'actions'}, bookmark(current), external('YouTubeで開く ↗', watchUrl(current.id))));
    comments(current).then(items => {
      const list = commentList(items);
      if (request === generation && list) info.append(list);
    }).catch(() => {});
    status.textContent = 'プレーヤーを読み込み中…';
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
            if (request !== generation || !dialog.open) return;
            play.disabled = false;
            status.textContent = '';
            if (muted) {
              target.mute();
              sound.hidden = false;
            }
            target.playVideo();
          },
          onAutoplayBlocked({target}) {
            if (request !== generation || !dialog.open) return;
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
          onStateChange({data, target}) {
            if (request !== generation || !dialog.open) return;
            clearTimeout(watchTimer);
            playing = data === YT.PlayerState.PLAYING;
            play.textContent = playing ? '一時停止' : '再生';
            if (playing) {
              status.textContent = '';
              watchTimer = setTimeout(() => {
                if (request === generation && dialog.open && target.getPlayerState() === YT.PlayerState.PLAYING) watched(current);
              }, 4000);
            }
            if (data === YT.PlayerState.ENDED && !(tv && move(1))) finish('再生が終了しました。');
          },
          onError({data}) {
            if (request !== generation || !dialog.open) return;
            if (tv && [2, 5, 100, 101, 150].includes(data) && move(1)) return;
            finish('この動画を再生できませんでした。');
            play.disabled = false;
          }
        }
      });
    } catch (error) {
      if (request === generation) {
        status.textContent = error.message;
        play.disabled = false;
      }
    }
  }
  dialog.addEventListener('keydown', event => {
    if (!tv || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft') move(-1);
    else if (event.key === 'ArrowRight') move(1);
    else if (event.key.toLowerCase() === 'k' || (event.key === ' ' && event.target === dialog)) togglePlay();
    else return;
    event.preventDefault();
  });
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
    clearPlayer();
    wakeLock?.release().catch(() => {});
    document.removeEventListener('visibilitychange', keepAwake);
    dialog.remove();
  }, {once: true});
  document.body.append(dialog);
  dialog.showModal();
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();
  load();
  return dialog;
}
