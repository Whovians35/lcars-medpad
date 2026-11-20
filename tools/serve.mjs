#!/usr/bin/env node
/* 极简静态服务器（零依赖）。用法：
 *   node tools/serve.mjs           # 端口 8787，监听所有网卡
 *   node tools/serve.mjs 9000      # 指定端口
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.argv[2]) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ics': 'text/calendar; charset=utf-8'
};

function safeJoin(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = path.normalize(path.join(root, clean));
  if (!p.startsWith(root)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  console.log(new Date().toISOString().slice(11, 19), req.method, req.url);
  let file = safeJoin(ROOT, req.url || '/');
  if (!file) { res.writeHead(403).end('forbidden'); return; }
  try {
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + req.url);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const stat = fs.statSync(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
      'service-worker-allowed': '/'
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500).end('500 ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((k) => {
    (nets[k] || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    });
  });
  console.log('LCARS MedPad 已启动');
  console.log('  本机:   http://localhost:' + PORT + '/');
  ips.forEach((ip) => console.log('  手机:   http://' + ip + ':' + PORT + '/   (需同一 WiFi)'));
  console.log('  注意:   手机浏览器打开 http://localhost 属于安全上下文，可安装 + 离线；');
  console.log('          用 http://192.168.x.x 打开时只能在线预览，不能离线。');
  console.log('  停止:   Ctrl + C');
});
