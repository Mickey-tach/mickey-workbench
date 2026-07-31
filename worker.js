// Cloudflare Worker —— 实时热榜代理（服务端抓取真实数据，带 CORS）
//
// 为什么需要它：浏览器的「今日热点」直接请求知乎/微博/抖音/新浪等接口会被跨域(CORS)拦截，
// 而市面上的免费聚合 API 又经常集体抽风。这个 Worker 在服务端（Cloudflare 边缘节点）直接抓取
// 源头站点的真实热榜，再返回带 CORS 的 JSON，前端就能稳定拿到「实时」数据。
//
// 部署步骤（约 5 分钟，免费）：
//   1. 打开 https://dash.cloudflare.com/ 注册/登录（免费）
//   2. 左侧「Workers 和 Pages」→「创建」→ 命名如 mickey-news →「部署」
//   3. 进入该 Worker →「快速编辑」→ 用本文件内容覆盖默认代码 →「部署」
//   4. 部署后会得到一个地址，形如 https://mickey-news.<你的子域>.workers.dev
//   5. 打开你的工作台「首页 → 今日热点 → ⚙」，粘贴该地址保存即可（留空则走前端兜底）
//
// 前端调用：GET <worker地址>?tab=zhihu|douyin|weibo|finance
// 返回：{ tab, live, count, items:[{title, hot, url}] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function getJSON(url, headers) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', ...(headers || {}) },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// 知乎热榜（官方 API，需浏览器 UA）
async function zhihu() {
  const j = await getJSON('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true');
  if (!j || !Array.isArray(j.data)) return [];
  return j.data.slice(0, 30).map((it) => {
    const t = it.target || {};
    return {
      title: t.title || it.title || '',
      hot: Number(String(it.detail_text || '').replace(/[^0-9]/g, '')) || 0,
      url: t.id ? ('https://www.zhihu.com/question/' + t.id) : '',
    };
  }).filter((x) => x.title);
}

// 微博热搜（官方 ajax 接口，真实可靠）
async function weibo() {
  const j = await getJSON('https://weibo.com/ajax/side/hotSearch');
  const arr = j && j.data && j.data.realtime;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 30).map((it) => ({
    title: it.word || it.title || '',
    hot: Number(it.num || it.raw_hot || 0) || 0,
    url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + (it.word || '') + '#'),
  })).filter((x) => x.title);
}

// 抖音热榜（尽力而为，无稳定官方 JSON 时返回空，由前端兜底）
async function douyin() {
  const j = await getJSON('https://www.iesdouyin.com/web/api/v2/hotsearch/');
  const arr = Array.isArray(j) ? j : (j && (j.data || j.list));
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 30).map((it) => ({
    title: it.word || it.title || it.hotword || '',
    hot: Number(it.hot || it.hot_value || 0) || 0,
    url: it.share_url || it.url || '',
  })).filter((x) => x.title);
}

// 新浪财经（真实财经快讯）
async function finance() {
  const j = await getJSON('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=20&page=1');
  const arr = j && j.result && j.result.data;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 20).map((it) => ({ title: it.title || '', hot: 0, url: it.url || '' })).filter((x) => x.title);
}

const MAP = { zhihu, douyin, weibo, finance };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const tab = (url.searchParams.get('tab') || 'zhihu').toLowerCase();
    const fn = MAP[tab] || MAP.zhihu;
    let items = [];
    try { items = await fn(); } catch (e) { items = []; }
    const body = JSON.stringify({ tab, live: items.length > 0, count: items.length, items });
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    });
  },
};
