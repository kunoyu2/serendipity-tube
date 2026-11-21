import {GOOGLE_CLIENT_ID} from './config.js';

const key = 'serendipity-token';
let session;
try { session = JSON.parse(sessionStorage.getItem(key)); } catch {}
session = session?.client === GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID ? session : null;
let script;

export function token() {
  return session?.expires > Date.now() ? session.value : null;
}

export function forget() {
  session = null;
  try { sessionStorage.removeItem(key); } catch {}
}

export function signOut() {
  const value = token();
  forget();
  if (value) globalThis.google?.accounts.oauth2.revoke(value, () => {});
}

export function prepareSignIn() {
  if (!GOOGLE_CLIENT_ID) return Promise.reject(new Error('クライアント ID を設定してください。'));
  script ??= new Promise((resolve, reject) => {
    const element = document.createElement('script');
    element.src = 'https://accounts.google.com/gsi/client';
    element.onload = resolve;
    element.onerror = () => {
      script = null;
      element.remove();
      reject(new Error('Google ログインを読み込めませんでした。'));
    };
    document.head.append(element);
  });
  return script;
}

export async function signIn() {
  await prepareSignIn();
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Google ログインを完了できませんでした。もう一度お試しください。'));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      callback(response) {
        if (!response.access_token) return fail();
        session = {value: response.access_token, client: GOOGLE_CLIENT_ID, expires: Date.now() + (Number(response.expires_in) - 30) * 1000};
        try { sessionStorage.setItem(key, JSON.stringify(session)); } catch {}
        resolve();
      },
      error_callback: fail
    });
    client.requestAccessToken({prompt: ''});
  });
}
