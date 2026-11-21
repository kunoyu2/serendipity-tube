export const videoId = /^[A-Za-z0-9_-]{11}$/;
export const watchUrl = id => 'https://www.youtube.com/watch?v=' + id;
export const hatenaUrl = id => 'https://b.hatena.ne.jp/entry/s/www.youtube.com/watch?v=' + id;
export const commentShard = id => id.slice(0, 2).toLowerCase();
