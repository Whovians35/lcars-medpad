/* ============================================================
 * ui.smoke.mjs — 用假 DOM 跑通 app.js 的完整渲染流程
 * 目的：在没有浏览器的环境里提前抓出渲染期异常（比静态检查强得多）
 * 运行：node tests/ui.smoke.mjs
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MedCore = require(path.join(ROOT, 'js', 'core.js'));
const KEY = 'lcars_medpad_v1';

/* ---------- 假 DOM ---------- */
function makeEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    dataset: {}, style: {}, className: '', id: '', textContent: '', innerHTML: '',
    children: [], _attr: {},
    setAttribute(k, v) { this._attr[k] = String(v); },
    getAttribute(k) { return k in this._attr ? this._attr[k] : null; },
    removeAttribute(k) { delete this._attr[k]; },
    hasAttribute(k) { return k in this._attr; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { }, addEventListener() { }, removeEventListener() { },
    focus() { }, click() { },
    querySelector() { return makeEl('div'); }, querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 360, height: 640 }; }
  };
}

function makeApp(seed) {
  const store = {};
  if (seed) store[KEY] = JSON.stringify(seed);
  const els = new Map();
  const el = (k) => { if (!els.has(k)) els.set(k, makeEl(k)); return els.get(k); };

  const document = {
    hidden: false, title: '',
    documentElement: makeEl('html'), body: makeEl('body'),
    querySelector: (s) => el('doc:' + s),
    querySelectorAll: () => [],
    getElementById: (id) => el('doc:#' + id),
    createElement: (t) => makeEl(t),
    addEventListener() { }, removeEventListener() { }
  };
  const window = {
    MedCore, innerWidth: 360, innerHeight: 640,
    addEventListener() { }, removeEventListener() { }, scrollTo() { },
    matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
    location: { href: 'http://localhost:8787/index.html', protocol: 'http:' }
  };
  const localStorage = {
    _d: store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { for (const k of Object.keys(store)) delete store[k]; }
  };
  const navigator = { userAgent: 'node-smoke' };
  const URLx = { createObjectURL: () => 'blob:fake', revokeObjectURL() { } };
  class Blob { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } }

  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  new Function(
    'window', 'document', 'localStorage', 'navigator', 'URL', 'Blob',
    'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'confirm', 'alert',
    src + '\n//# sourceURL=app.js'
  )(window, document, localStorage, navigator, URLx, Blob,
    () => 0, () => { }, () => 0, () => { }, () => false, () => { });

  return { window, document, localStorage, store, el, api: window.__medpad };
}

/* 一份"标准"药品：28片×3盒、早1片晚0.5片 */
function seedMed() {
  const C = MedCore;
  const med = C.normalizeMed({
    id: 'smoke-med-1', name: '舍曲林', icon: '💊', color: 'sky',
    startDate: C.addDays(C.today(), -5),
    inventory: { boxes: 3, pillsPerBox: 28, loosePills: 0 },
    slots: [
      { id: 'morning', time: '08:00', dose: 1, on: true },
      { id: 'evening', time: '18:30', dose: 0.5, on: true }
    ]
  });
  return { schemaVersion: 1, meds: [med], checkins: {}, settings: { refillWarnDays: 7, notifyOn: false, lastNotified: '' } };
}

/* ================= 1. 空状态 ================= */
test('空状态：能渲染、有引导、有底部 Tab 导航', () => {
  const app = makeApp(null);
  const html = app.el('doc:#app').innerHTML;
  assert.ok(html.length > 0, '#app 应该有内容');
  assert.match(html, /还没有/, '空状态应提示添加药品');
  const nav = app.el('doc:#nav').innerHTML;
  for (const t of ['今日', '药品', '记录', '设置']) assert.ok(nav.includes(t), '导航应有 ' + t);
  assert.equal(app.api.state.meds.length, 0, '初始应为空列表');
  assert.equal(app.api.state.settings.refillWarnDays, 7, '默认提前 7 天提醒补药');
});

/* ================= 2. 有数据：四个 Tab 全渲染 ================= */
const app = makeApp(seedMed());
const api = app.api;

test('四个 Tab 都能渲染且不抛异常', () => {
  assert.ok(api, 'app.js 应暴露 window.__medpad');
  for (const t of ['today', 'meds', 'log', 'settings']) {
    assert.doesNotThrow(() => api.setTab(t), t + ' 渲染不应抛异常');
    assert.ok(app.el('doc:#app').innerHTML.length > 60, t + ' 页面内容太短');
  }
});

test('今日页：药名、每日剂量、盒里剩余、吃完日、打卡按钮', () => {
  api.setTab('today');
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /舍曲林/, '应显示药名');
  assert.match(html, /每天\s*<b>1\.5<\/b>\s*片/, '应显示每天 1.5 片');
  assert.match(html, /盒里还有\s*[\d.]+\s*片/, '应显示盒里剩余片数');
  assert.ok(/剩\s*\d+\s*天/.test(html), '应显示还能吃几天');
  assert.match(html, /data-act="quick"/, '应有快速打卡按钮');
  assert.match(html, /data-act="dose-sheet"/, '点剂量应能打开打卡面板');
});

test('药品页：显示吃完日期与补药提醒', () => {
  api.setTab('meds');
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /舍曲林/);
  assert.ok(/吃完|预计/.test(html), '应给出吃完日期');
});

test('记录页：能按月/日分组渲染', () => {
  api.setTab('log');
  const html = app.el('doc:#app').innerHTML;
  assert.ok(html.length > 60);
  assert.match(html, /记录|打卡/);
});

test('设置页：必须有 LCARS 署名与医疗免责声明', () => {
  api.setTab('settings');
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /TheLCARS\.com/, 'LCARS 署名（EULA 要求）');
  assert.match(html, /不是医疗器械/, '医疗免责声明');
});

/* ================= 3. 载入/续算 ================= */
test('从 localStorage 载入后：数据完整、算法续算正确', () => {
  const C = MedCore;
  const med = api.state.meds[0];
  assert.equal(api.state.meds.length, 1);
  assert.equal(med.slots.length, 4, 'slots 应被规整成 4 段');
  assert.equal(C.dailyUnits(med), 6, '每日 1.5 片 = 6 个四分之一单位');
  // 从 5 天前开始、每天 6 单位 → 已用 30 单位，剩 306 单位 = 51 天
  const p = C.projectEnd(med, C.today(), api.state.checkins);
  assert.equal(p.daysLeft, 51, '剩余天数应随已开始天数递减');
});

test('存档能被重新解析，schemaVersion 存在', () => {
  const raw = app.localStorage.getItem(KEY);
  const saved = JSON.parse(raw);
  assert.equal(saved.meds.length, 1);
  assert.equal(saved.meds[0].name, '舍曲林');
  assert.ok(saved.settings, 'settings 应存在');
  assert.equal(api.state.schemaVersion, 2, '载入后内存里的版本应是 2');
});

/* ================= 4. v2：舰籍 / 舰况 / 红警 / 菜单 / 多吃 ================= */
test('舰籍行与舷号：默认 U.S.S. 坚定 · 医疗舰 / NCC-4747', () => {
  api.setTab('today');
  assert.equal(app.el('doc:#shipLine').textContent, 'U.S.S. 坚定 · 医疗舰');
  assert.equal(app.el('doc:#nccLine').textContent, 'NCC-4747');
});

test('今日页顶部有舰况面板（MSD）与读数条', () => {
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /舰况总览/, '应有舰况面板标题');
  assert.match(html, /STARDATE/, '应有星历');
  assert.match(html, /msd-row/, '应有读取项');
  assert.match(html, /class="gauge"/, '应有读数条');
  assert.match(html, /NCC-4747/, '面板里应有舷号');
});

test('红色警报：标记漏服时亮红，全部已服后消失', () => {
  const C = MedCore, t = C.today(), id = api.state.meds[0].id;
  api.state.checkins[C.ck(id, t, 'morning')] = { status: 'missed', at: '' };
  api.render();
  let html = app.el('doc:#app').innerHTML;
  assert.match(html, /class="redalert"/, '漏服应触发红色警报');
  assert.match(html, /CONDITION: RED/);
  ['morning', 'noon', 'evening', 'night'].forEach((s) => {
    api.state.checkins[C.ck(id, t, s)] = { status: 'taken', at: '' };
  });
  api.render();
  html = app.el('doc:#app').innerHTML;
  assert.doesNotMatch(html, /CONDITION: RED/, '全部已服后红警应消失');
});

test('多吃记录：超量触发红警、卡片显示已多吃、当日读数变红', () => {
  const C = MedCore, t = C.today(), id = api.state.meds[0].id;
  api.state.checkins[C.ck(id, t, 'morning')] = { status: 'extra', amountPills: 2, at: '' };
  api.render();
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /CONDITION: RED/);
  assert.match(html, /超量服用/);
  assert.match(html, /med-sub over/, '卡片副标题要标红');
  assert.match(html, /今日已多吃 1 片/, '计划 1 片吃了 2 片 → 多吃 1 片');
  assert.match(html, /预计 <b>\d+月\d+日<\/b> 吃完/, '吃完日不能是空的');  assert.match(html, /实吃 2/);
  assert.match(html, /data-state="extra"/);
});

test('全屏菜单：能打开、有四个入口、有红警状态行、能关闭', () => {
  api.menu(true);
  const m = app.el('doc:#layer').innerHTML;
  assert.match(m, /LCARS \/ 主菜单/);
  assert.match(m, /data-tab="today"/);
  assert.match(m, /data-tab="settings"/);
  assert.match(m, /RED ALERT|GREEN/, '应有状态行');
  assert.match(m, /STARDATE/);
  api.menu(false);
  assert.equal(app.el('doc:#layer').innerHTML, '', '关闭后层应清空');
});

test('打卡面板：有实吃片数步进与「记录实吃」按钮', () => {
  const C = MedCore, t = C.today(), id = api.state.meds[0].id;
  api.openDose(id, 'evening', t);
  const h = app.el('doc:#layer').innerHTML;
  assert.match(h, /实际吃了几片/);
  assert.match(h, /data-act="extra-step"/, '应有加减按钮');
  assert.match(h, /data-act="set-extra"/, '应有记录实吃按钮');
  assert.match(h, /还原计划量/, '应有还原按钮');
  assert.match(h, /照片存证/, '应有照片存证区块');
  assert.match(h, /data-act="photo-take"/, '应有拍照按钮');
  assert.match(h, /只保留今天/, '应说明照片只保留当天');
  api.close();
});

/* ================= 5. v1 → v2 迁移 ================= */
test('v1 → v2 迁移：旧的 4 种状态全部保留，自动补舰籍并留备份', () => {
  const C = MedCore, t = C.today();
  const med = C.normalizeMed({
    id: 'old-1', name: '老数据药', icon: '💊', color: 'green',
    startDate: C.addDays(t, -3),
    inventory: { boxes: 2, pillsPerBox: 28, loosePills: 0 },
    slots: [{ id: 'morning', time: '08:00', dose: 1, on: true }]
  });
  const seed = {
    schemaVersion: 1,
    meds: [med],
    checkins: {
      [C.ck('old-1', t, 'morning')]: { status: 'partial', amountPills: 0.5, at: '' },
      [C.ck('old-1', C.addDays(t, -1), 'morning')]: { status: 'taken', at: '' },
      [C.ck('old-1', C.addDays(t, -2), 'morning')]: { status: 'skipped', at: '' },
      [C.ck('old-1', C.addDays(t, -3), 'morning')]: { status: 'missed', at: '' }
    },
    settings: { refillWarnDays: 5, notifyOn: false }
  };
  const a2 = makeApp(seed);
  const st = a2.api.state;

  assert.equal(st.schemaVersion, 2, '应升级到 v2');
  assert.equal(st.meds.length, 1, '药品不能丢');
  assert.equal(st.meds[0].name, '老数据药');
  assert.equal(Object.keys(st.checkins).length, 4, '4 条旧打卡都要在');
  assert.equal(st.settings.refillWarnDays, 5, '旧设置要保留');
  assert.equal(st.settings.ship.name, '坚定', '缺舰籍时补默认值');
  assert.equal(st.settings.alertOn, true, '红警默认开');
  assert.equal(st.settings.alertSound, false, '红警音默认关（不扰人）');

  const bak = a2.localStorage.getItem(KEY + '.bak');
  assert.ok(bak, '应留下升级前备份');
  const bakObj = JSON.parse(bak);
  assert.equal(bakObj.schemaVersion, 1);
  assert.equal(bakObj.meds[0].name, '老数据药');

  /* 渲染不抛异常即可 */
  assert.doesNotThrow(() => a2.api.setTab('today'));
  assert.doesNotThrow(() => a2.api.setTab('log'));
});

/* ================= 出行药量计算 ================= */
test('出行：今日页有入口，打开后显示“够用”和每种药的片数', () => {
  const C = MedCore;
  const m0 = api.state.meds[0];
  m0.slots = [
    { id: 'morning', time: '08:00', dose: 1, on: true },
    { id: 'evening', time: '18:30', dose: 0.5, on: true }
  ];
  m0.weekdays = [0, 1, 2, 3, 4, 5, 6];
  m0.pauses = [];
  m0.startDate = C.today();
  m0.endDate = '';
  m0.inventory = { boxes: 0, pillsPerBox: 0, loosePills: 11 };
  api.state.checkins = {};
  api.setTab('today');
  assert.match(app.el('doc:#app').innerHTML, /出行药量/, '今日页应有出行入口');
  api.openTrip(C.today(), C.addDays(C.today(), 6));
  const layer = app.el('doc:#layer').innerHTML;
  assert.match(layer, /出行药量/, '应显示标题');
  assert.match(layer, /够用/, '库存充足时应显示够用');
  assert.match(layer, /舍曲林/, '应列出药品');
  assert.match(layer, /要带\s*<b>10\.5<\/b>\s*片/, '7 天 × 1.5 片 = 10.5 片');
  assert.match(layer, /class="gauge"/, '应有 LCARS 读数条');
  api.close();
});

test('出行：库存不够时显示差多少片并给出补药提示', () => {
  const C = MedCore;
  const m = api.state.meds[0];
  m.startDate = C.today();
  m.inventory = { boxes: 0, pillsPerBox: 0, loosePills: 2 };
  api.openTrip(C.today(), C.addDays(C.today(), 6));
  const layer = app.el('doc:#layer').innerHTML;
  assert.match(layer, /不够/, '应提示不够');
  assert.match(layer, /差\s*8\.5\s*片/, '10.5 - 2 = 8.5');
  assert.match(layer, /出发前先补药/, '应给出补药提示');
  api.close();
  assert.equal(app.el('doc:#layer').innerHTML, '', '关闭后弹层应清空');
});



/* ================= 红警：看过可以收起 ================= */
test('红警可以确认收起，也能在当天重新显示', () => {
  const C = MedCore;
  const m = api.state.meds[0];
  m.startDate = C.today();
  const slot = C.activeSlots(m)[0];
  api.state.checkins = {};
  api.state.checkins[C.ck(m.id, C.today(), slot.id)] = {
    status: 'extra', amountPills: Number(slot.dose) + 1
  };
  api.state.settings.alertOn = true;
  api.setTab('today');

  let html = app.el('doc:#app').innerHTML;
  assert.match(html, /CONDITION: RED/, '超量时应亮红');
  assert.match(html, /data-act="alert-ack"/, '红警应带「确认收起」按钮');

  api.ackAll();
  html = app.el('doc:#app').innerHTML;
  assert.ok(html.indexOf('CONDITION: RED') < 0, '收起后不应再显示红警徽章');
  assert.match(html, /红警已确认/, '应显示已确认的提示');
  assert.match(html, /data-act="alert-unack"/, '应能重新显示');

  api.unackAll();
  html = app.el('doc:#app').innerHTML;
  assert.match(html, /CONDITION: RED/, '重新显示后红警应回来');

  api.state.checkins = {};
  api.state.settings.alertAck = { date: '', keys: [] };
});

/* ================= v11：补水页 / 专注舱 ================= */
test('补水页：液位、目标、快捷按钮、设置都在', () => {
  api.state.waterDays = {};
  api.state.settings.water = { targetMl: 1800, cupMl: 250, intervalMin: 60, startHM: '08:00', endHM: '22:00', on: true, sound: true };
  api.setTab('water');
  const html = app.el('doc:#app').innerHTML;
  assert.match(html, /HYDRATION CONTROL/, '要有补水标题');
  assert.match(html, /class="tank"/, '要有水仓示意图');
  assert.match(html, /1800 ml/, '要显示目标水量');
  assert.match(html, /data-act="sip"/, '要有喝水按钮');
  assert.match(html, /data-act="water-set"/, '要有设置项');
  assert.match(html, /短视频刹车|刹车舱/, '要有短视频刹车入口');
});

test('喝一杯会记账、撤销会减回去', () => {
  const C = MedCore;
  api.setTab('water');
  api.water.add(300);
  assert.equal(api.water.today(), 300);
  let html = app.el('doc:#app').innerHTML;
  assert.match(html, /300/, '页面应显示 300 ml');
  api.water.add(200);
  assert.equal(api.water.today(), 500);
  api.water.undo();
  assert.equal(api.water.today(), 300);
  assert.equal(api.water.day().length, 1);
  assert.ok(C.waterPct(api.water.today(), 1800) === 17);
});

test('专注舱：打开、30 秒冷却、记一次拦下', () => {
  api.state.focusDays = {};
  api.focus.open();
  let html = app.el('doc:#layer').innerHTML;
  assert.match(html, /FOCUS/, '要有专注舱标题');
  assert.match(html, /data-act="focus-urge"/, '要有「想刷」按钮');
  assert.match(html, /数字健康|专注模式/, '要给出系统级阻断指引');
  api.focus.urge();
  assert.equal(api.focus.cool(), 30, '冷却从 30 秒开始');
  html = app.el('doc:#layer').innerHTML;
  assert.match(html, /先停 30 秒|秒/, '冷却界面要显示倒计时');
  api.focus.close();
});
