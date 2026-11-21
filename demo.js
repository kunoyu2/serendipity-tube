const samples = [
  ['夜明けの尾瀬を歩く', '静かな山旅', 'mountain', 1128],
  ['手回し焙煎で、コーヒーの香りを探る', '台所の実験室', 'coffee', 764],
  ['A Field Guide to the Night Sky', 'Midnight Observatory', 'space', 1405],
  ['海辺の町、はじめての活版印刷', '暮らしの手ざわり', 'paper', 684],
  ['苔の森には、どんな時間が流れる？', '小さな自然誌', 'forest', 967],
  ['A Small Studio Built by Hand', 'The Quiet Workshop', 'clay', 823],
  ['古いレンズで撮る、雨の夜', '光の余白', 'space', 795],
  ['港から始まるローカル線の旅', '車窓ノート', 'mountain', 1758],
  ['机の上に小さな庭をつくる', '週末の庭', 'forest', 1104],
  ['The Sound of an Old Tape Recorder', 'Tape Notes', 'paper', 892],
  ['祖母の台所で覚えたスープ', '台所の実験室', 'coffee', 601],
  ['木のスプーンを削る午後', 'The Quiet Workshop', 'clay', 780],
  ['雪が降る日の音を録る', '車窓ノート', 'space', 856],
  ['春を待つ庭の記録', '季節の手帖', 'forest', 1274],
  ['工房で直す、古い椅子', '暮らしの手ざわり', 'clay', 940]
];

export function demoData() {
  const channels = [...new Set(samples.map(sample => sample[1]))];
  const cards = samples.map(([title, channel, art, duration], index) => ({
    id: 'sample-' + index, demo: true, title, channel, art, duration, channelId: 'demo-channel-' + channels.indexOf(channel),
    published: new Date(Date.UTC(2025, 1, 20 - index)).toISOString(), views: 100,
    sources: [index % 3 === 0 ? {key: 'aoi', type: 'subscription', name: 'あおい', count: 3, overlap: 2} :
      index % 3 === 1 ? {key: 'mio', type: 'playlist', name: 'ミオ', playlist: '休日の観察ノート'} :
      {key: 'featured', type: 'featured', name: '暮らしの手ざわり', subscribed: true}]
  }));
  const subscribed = cards.slice(12).map(video => ({...video, sources: [{type: 'uploads', name: video.channel}]}));
  return {
    candidates: cards.slice(0, 12), subscribed, timelineVideos: Object.fromEntries(cards.map(video => [video.id, video])),
    people: [
      {id: 'aoi', name: 'あおい', count: 3, overlap: 2, demo: true, subscriptions: [{id: cards[0].channelId, title: cards[0].channel}], playlists: []},
      {id: 'mio', name: 'ミオ', count: 2, overlap: 1, demo: true, subscriptions: null,
        playlists: [{title: '休日の観察ノート', videoIds: ['sample-1', 'sample-4', 'sample-7']}]}
    ]
  };
}
