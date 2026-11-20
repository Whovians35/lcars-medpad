/* LCARS MedPad — service worker (v22)
 * 目标：装到手机后，断网 / 关电脑 / 拔数据线也能打开。
 * 策略：
 *   - 导航请求：联网优先，但最多等 4 秒；超时或失败立刻回落到缓存里的首页。
 *   - 静态资源：缓存优先，未命中再联网并写入缓存。
 * 关键保护（v22 加固）：
 *   1) 新缓存没装齐（四个关键文件缺一个）就绝不接管、绝不删旧缓存；
 *   2) 激活时保留「当前 + 上一个」两代缓存，任何一代完整就能打开；
 *   3) 断网时从任意一代缓存里找首页，实在没有才给一张带「重试」按钮的说明页。
 */
var CACHE = 'medpad-v22';
var PREFIX = 'medpad-v';
var NAV_TIMEOUT = 4000;

/* 真正托管 App 所必需的四个文件：少一个就不允许新版本接管 */
var CRITICAL = ['./index.html', './app.css?v=22', './js/core.js?v=22', './app.js?v=22'];

var ASSETS = [
  './',
  './index.html',
  './app.css?v=22',
  './app.js?v=22',
  './js/core.js?v=22',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './assets/fonts/Antonio-Regular.woff2',
  './assets/fonts/Antonio-Bold.woff2'
];

function cacheReady() {
  return caches.open(CACHE).then(function (c) {
    return Promise.all(CRITICAL.map(function (u) {
      return c.match(u).then(function (r) { return !!r; });
    }));
  }).then(function (list) {
    return list.every(Boolean);
  }).catch(function () { return false; });
}

/* 在「所有」缓存里找某个键（某代缓存残缺时还能靠另一代救回来） */
function matchAny(key) {
  return caches.match(key).catch(function () { return null; }) || Promise.resolve(null);
}

/* 依次尝试几种首页缓存键；都没有就返回 null */
function offlineHome() {
  var keys = ['./index.html', './', 'index.html', '/'];
  var i = 0;
  function next() {
    if (i >= keys.length) return Promise.resolve(null);
    var k = keys[i++];
    return matchAny(k).then(function (hit) { return hit || next(); });
  }
  return next();
}

function offlinePage() {
  var html =
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>离线副本还没准备好</title>' +
    '<style>body{background:#000;color:#FFCC66;font:16px/1.75 system-ui,-apple-system,"Noto Sans SC",sans-serif;' +
    'padding:28px;margin:0}h2{color:#FF9C00;font-size:20px;letter-spacing:.04em}' +
    'b{color:#99CCFF}p{color:#cfc6ba}code{background:#111;border:1px solid #262626;border-radius:6px;padding:2px 6px;color:#99CCFF}' +
    'button{margin-top:22px;background:#FF9C00;color:#101010;border:0;border-radius:999px;' +
    'font:700 16px/1 system-ui,sans-serif;padding:16px 26px;width:100%}ul{padding-left:20px}</style>' +
    '<h2>离线副本还没准备好</h2>' +
    '<p>这台手机上的 App 缓存不完整（升级到一半时断线了，或者缓存被系统清掉了）。</p>' +
    '<p>现在做任意一件就能恢复：</p>' +
    '<ul>' +
    '<li>用数据线连电脑，打开 <code>http://localhost:8787</code> 刷新一次；</li>' +
    '<li>或者连上 Wi-Fi，打开你部署好的 GitHub Pages 地址刷新一次；</li>' +
    '<li>刷新后回到桌面重新点开 App，就又能离线用了。</li>' +
    '</ul>' +
    '<p>你的记录没有丢，它们存在浏览器本地，不会因为缓存被清而消失。</p>' +
    '<button onclick="location.reload()">重新加载</button>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 单个文件失败不阻断安装：先整体尝试，再逐个兜底 */
      return c.addAll(ASSETS).catch(function () {
        return Promise.all(ASSETS.map(function (u) {
          return c.add(u).catch(function () { /* ignore */ });
        }));
      });
    }).then(cacheReady).then(function (ok) {
      /* 关键文件没装齐就别接管，避免把能用的旧版本顶掉 */
      if (ok) return self.skipWaiting();
      return null;
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    cacheReady().then(function (ok) {
      if (!ok) return null; /* 新缓存不完整 → 保留旧缓存，什么都不删 */
      return caches.keys().then(function (keys) {
        var mine = keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
        /* 保留当前这代 + 上一代，其余本应用的缓存删掉；别碰别人的缓存 */
        var keep = {};
        keep[CACHE] = true;
        mine.sort().reverse().some(function (k) {
          if (k === CACHE) return false;
          keep[k] = true;
          return true;
        });
        return Promise.all(keys.map(function (k) {
          if (k.indexOf(PREFIX) !== 0) return null;
          if (keep[k]) return null;
          return caches.delete(k);
        }));
      });
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (!req || req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          offlineHome().then(function (hit) { resolve(hit || offlinePage()); });
        }, NAV_TIMEOUT);

        fetch(req).then(function (res) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            var cp = res.clone();
            caches.open(CACHE).then(function (c) { c.put('./index.html', cp); }).catch(function () {});
          } catch (err) { /* ignore */ }
          resolve(res);
        }).catch(function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          offlineHome().then(function (hit) { resolve(hit || offlinePage()); });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var cp = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, cp); }).catch(function () {});
        }
        return res;
      });
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || Response.error(); });
    })
  );
});
