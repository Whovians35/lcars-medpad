/* ============================================================
 * LCARS MedPad — app.js  (UI / 存储 / 打卡 / 导入导出)
 * ============================================================ */
(function () {
  'use strict';

  var C = window.MedCore;
  var KEY = 'lcars_medpad_v1';
  var BAK = KEY + '.bak';
  var VERSION = '2.5.1';
  var AUTHOR_DEFAULT = '张浩宇';
  var LICENSE = 'CC BY-NC 4.0';
  var SHIP_DEFAULT = { name: '坚定', cls: '医疗舰', ncc: '4747' };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var COLORS = {
    orange: ['琥珀', 'var(--orange)'],
    sky: ['天蓝', 'var(--sky)'],
    lilac: ['紫丁香', 'var(--lilac)'],
    green: ['薄荷', 'var(--green)'],
    almond: ['杏仁', 'var(--almond)'],
    violet: ['紫罗兰', 'var(--violet)']
  };
  var ICONS = ['💊', '🔵', '🟡', '🟣', '🟢', '🔴', '⚪', '🌙', '☀️', '🧠', '🫀', '🌿', '🌸', '💧', '🧴', '🩹'];

  /* ---------------- state ---------------- */
  var state = null;
  var ui = { tab: 'today', draft: null, sheet: null, menu: false, trip: null, focus: null, photo: null, cool: 0, waterAck: '', drinkOn: false };
  var cache = {};
  var lastTab = '';

  var STATUSES = ['taken', 'partial', 'skipped', 'missed', 'extra'];

  function blankState() {
    return {
      schemaVersion: 2,
      meds: [],
      checkins: {},
      waterDays: {},
      focusDays: {},
      settings: {
        refillWarnDays: 7, notifyOn: false, lastNotified: {}, photoRequired: true, author: '',
        ship: { name: SHIP_DEFAULT.name, cls: SHIP_DEFAULT.cls, ncc: SHIP_DEFAULT.ncc },
        alertOn: true, alertSound: false,
        alertAck: { date: '', keys: [] },
        trip: { from: '', to: '' },
        water: { targetMl: 1800, cupMl: 250, intervalMin: 60, startHM: '08:00', endHM: '22:00', on: true, sound: true }
      }
    };
  }

  function normalize(raw) {
    var s = blankState();
    if (!raw || typeof raw !== 'object') return s;
    s.settings.refillWarnDays = Math.min(60, Math.max(1, Number(raw.settings && raw.settings.refillWarnDays) || 7));
    s.settings.notifyOn = !!(raw.settings && raw.settings.notifyOn);
    s.settings.lastNotified = (raw.settings && raw.settings.lastNotified) || {};
    /* 舰桥：老数据没有 ship 字段，补默认值即可，不覆盖任何已存在内容 */
    var sh = (raw.settings && raw.settings.ship) || {};
    s.settings.ship = {
      name: String(sh.name || SHIP_DEFAULT.name).slice(0, 18),
      cls: String(sh.cls || SHIP_DEFAULT.cls).slice(0, 18),
      ncc: String(sh.ncc || SHIP_DEFAULT.ncc).replace(/[^0-9A-Za-z-]/g, '').slice(0, 10)
    };
    s.settings.alertOn = raw.settings && raw.settings.alertOn === false ? false : true;
    s.settings.alertSound = !!(raw.settings && raw.settings.alertSound);
    s.settings.photoRequired = !(raw.settings && raw.settings.photoRequired === false);
    s.settings.author = String((raw.settings && raw.settings.author) || '').slice(0, 40);
    var ack = (raw.settings && raw.settings.alertAck) || {};
    s.settings.alertAck = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(ack.date || '') ? ack.date : '',
      keys: Array.isArray(ack.keys) ? ack.keys.filter(function (k) { return typeof k === 'string'; }).slice(0, 80) : []
    };
    var tr = (raw.settings && raw.settings.trip) || {};
    s.settings.trip = {
      from: /^\d{4}-\d{2}-\d{2}$/.test(tr.from || '') ? tr.from : '',
      to: /^\d{4}-\d{2}-\d{2}$/.test(tr.to || '') ? tr.to : ''
    };
    /* 补水设置（老数据没有就补默认，不动任何已有内容） */
    var wt = (raw.settings && raw.settings.water) || {};
    s.settings.water = {
      targetMl: Math.min(6000, Math.max(200, Number(wt.targetMl) || 1800)),
      cupMl: Math.min(1000, Math.max(50, Number(wt.cupMl) || 250)),
      intervalMin: Math.min(300, Math.max(10, Number(wt.intervalMin) || 60)),
      startHM: /^\d{2}:\d{2}$/.test(wt.startHM || '') ? wt.startHM : '08:00',
      endHM: /^\d{2}:\d{2}$/.test(wt.endHM || '') ? wt.endHM : '22:00',
      on: wt.on !== false,
      sound: wt.sound !== false
    };
    /* 喝水日志：{ 'YYYY-MM-DD': [{ml, at}] } */
    var wd = raw.waterDays && typeof raw.waterDays === 'object' ? raw.waterDays : {};
    Object.keys(wd).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var arr = Array.isArray(wd[k]) ? wd[k] : [];
      s.waterDays[k] = arr.filter(function (x) {
        return x && Number(x.ml) > 0;
      }).map(function (x) {
        return { ml: Math.min(2000, Math.round(Number(x.ml))), at: /^\d{2}:\d{2}$/.test(x.at || '') ? x.at : '00:00' };
      }).slice(-60);
    });
    /* 专注（短视频刹车）日志：{ 'YYYY-MM-DD': {ok, gave} } */
    var fd = raw.focusDays && typeof raw.focusDays === 'object' ? raw.focusDays : {};
    Object.keys(fd).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var o = fd[k] || {};
      s.focusDays[k] = {
        ok: Math.max(0, Math.min(999, Number(o.ok) || 0)),
        gave: Math.max(0, Math.min(999, Number(o.gave) || 0))
      };
    });
    if (Array.isArray(raw.meds)) {
      s.meds = raw.meds.filter(function (m) { return m && typeof m === 'object'; }).map(C.normalizeMed);
    }
    var ids = {};
    s.meds.forEach(function (m) { ids[m.id] = 1; });
    var cks = raw.checkins && typeof raw.checkins === 'object' ? raw.checkins : {};
    Object.keys(cks).forEach(function (k) {
      var parts = k.split('@');
      if (parts.length !== 3 || !ids[parts[0]]) return;
      var r = cks[k] || {};
      if (STATUSES.indexOf(r.status) < 0) return;
      s.checkins[k] = {
        status: r.status,
        amountPills: r.amountPills != null ? Number(r.amountPills) : undefined,
        at: r.at || ''
      };
    });
    return s;
  }

  function load() {
    try {
      var txt = localStorage.getItem(KEY);
      if (!txt) return blankState();
      var raw = JSON.parse(txt);
      /* v1 → v2 保险：升级前把原始 JSON 原样快照一份（只写一次，永不覆盖） */
      if (raw && raw.schemaVersion !== 2 && !localStorage.getItem(BAK)) {
        try { localStorage.setItem(BAK, txt); } catch (e2) { /* 配额满就跳过 */ }
      }
      return normalize(raw);
    } catch (e) {
      console.warn('读取失败', e);
      return blankState();
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('保存失败：存储空间不足', true);
      return false;
    }
  }

  function proj(med) {
    if (!cache.proj) cache.proj = {};
    if (!cache.proj[med.id]) {
      cache.proj[med.id] = C.refillInfo(med, C.today(), state.checkins, state.settings.refillWarnDays);
    }
    return cache.proj[med.id];
  }
  function medById(id) {
    for (var i = 0; i < state.meds.length; i++) if (state.meds[i].id === id) return state.meds[i];
    return null;
  }

  /* ---------------- 舰桥 / 舰况 ---------------- */
  function authorName() { return state.settings.author || AUTHOR_DEFAULT; }

  function ship() { return state.settings.ship; }

  /** 装饰性星历：2026-01-01 = 78000，按天折算，输出五位数带一位小数 */
  function stardate(iso) {
    var d = C.parseISO(iso || C.today());
    if (!d) return '00000.0';
    var y = d.getFullYear();
    var start = new Date(y, 0, 1);
    var doy = Math.floor((d - start) / 86400000) + 1;
    var v = 78000 + (y - 2026) * 1000 + (doy / 365) * 1000;
    return v.toFixed(1);
  }

  function todayDoses() {
    var t = C.today(), out = [];
    state.meds.forEach(function (med) {
      if (!C.isDoseDay(med, t)) return;
      C.activeSlots(med).forEach(function (s) { out.push({ med: med, s: s }); });
    });
    return out;
  }

  /** 今天任何一条超量记录，累计超出片数 */
  function overTodayPills() {
    var t = C.today(), u = 0;
    todayDoses().forEach(function (d) {
      var rec = C.getRec(state.checkins, d.med.id, t, d.s.id);
      if (rec) u += C.overUnitsOf(rec, d.s);
    });
    return u;
  }

  /** 红色警报判据：逾期未记录 / 跳过 / 漏服 / 超量 */
  function alertItems() {
    var t = C.today(), now = C.nowHM(), out = [];
    todayDoses().forEach(function (d) {
      var rec = C.getRec(state.checkins, d.med.id, t, d.s.id);
      var k = d.med.id + '@' + d.s.id;
      if (rec && (rec.status === 'skipped' || rec.status === 'missed')) {
        out.push({ key: rec.status + ':' + k, kind: rec.status, med: d.med, s: d.s, over: 0 });
      } else if (rec && C.overUnitsOf(rec, d.s) > 0) {
        out.push({ key: 'extra:' + k, kind: 'extra', med: d.med, s: d.s, over: C.overUnitsOf(rec, d.s) });
      } else if (!rec && d.s.time < now) {
        out.push({ key: 'overdue:' + k, kind: 'overdue', med: d.med, s: d.s, over: 0 });
      }
    });
    return out;
  }

  /* 今天已经看过、并点了「确认收起」的红警；换到第二天自动重新生效 */
  function ackSet() {
    var o = {};
    var a = state.settings.alertAck;
    if (a && a.date === C.today() && a.keys && a.keys.length) {
      a.keys.forEach(function (k) { o[k] = 1; });
    }
    return o;
  }
  function pendingAlerts() {
    var a = ackSet();
    return alertItems().filter(function (i) { return !a[i.key]; });
  }
  function ackAlerts(keys) {
    var a = ackSet();
    keys.forEach(function (k) { a[k] = 1; });
    state.settings.alertAck = { date: C.today(), keys: Object.keys(a) };
    save();
  }
  function clearAck() {
    state.settings.alertAck = { date: '', keys: [] };
    save();
  }

  function alertBadgeSVG() {
    return '<svg class="ra-shield" viewBox="0 0 56 56" width="52" height="52" aria-hidden="true">' +
      '<path d="M3 9 H53 L45 19 H11 Z" fill="#ff2b2b"/>' +
      '<path d="M3 47 H53 L45 37 H11 Z" fill="#ff2b2b"/>' +
      '<rect x="5" y="21" width="46" height="14" rx="3" fill="#3d0606"/>' +
      '<rect x="9" y="24" width="40" height="2.4" fill="#ff2b2b"/>' +
      '<rect x="9" y="29.6" width="40" height="2.4" fill="#ff2b2b"/>' +
      '</svg>';
  }

  function alertHTML() {
    if (!state.settings.alertOn || !state.meds.length) return '';
    var items = alertItems();
    if (!items.length) return '';
    var pend = pendingAlerts();

    if (!pend.length) {
      return '<div class="redalert done" role="status">' +
        '<div class="ra-done"><span class="rd-ic">✓</span>' +
        '<span class="rd-t">红警已确认：今天这 ' + items.length + ' 条不再弹出。</span>' +
        '<button class="ra-ack ghost" data-act="alert-unack">重新显示</button></div></div>';
    }

    var by = { overdue: [], missed: [], skipped: [], extra: [] };
    var overPills = 0;
    pend.forEach(function (i) {
      by[i.kind].push(i);
      overPills += i.over || 0;
    });
    var lines = [];
    var names = function (arr) {
      return arr.slice(0, 3).map(function (i) { return esc(i.med.name) + '·' + i.s.label; }).join('、') +
        (arr.length > 3 ? ' 等 ' + arr.length + ' 次' : '');
    };
    if (by.overdue.length) lines.push('⏱ <b>' + by.overdue.length + ' 次</b>到点还没打卡：' + names(by.overdue));
    if (by.missed.length) lines.push('✕ 已标记<b>漏服</b>：' + names(by.missed));
    if (by.skipped.length) lines.push('– 已标记<b>主动跳过</b>：' + names(by.skipped));
    if (by.extra.length) {
      lines.push('⚠ <b>超量服用</b> ' + C.fmtPills(overPills) + ' 片：' + names(by.extra) +
        '（请按说明书或咨询医生，不要自行补服或加量）');
    }
    return '<div class="redalert" role="alert">' +
      '<div class="ra-badge">' + alertBadgeSVG() +
      '<div class="ra-txt"><div class="t1">ALERT</div><div class="t2">CONDITION: RED</div></div></div>' +
      '<div class="ra-why">' + lines.join('<br>') + '</div>' +
      '<div class="ra-actions"><button class="ra-ack" data-act="alert-ack">我已经看过 · 确认收起</button></div>' +
      '<div class="ra-tip">收起只是把提示藏起来，不会改你的打卡记录、也不会动库存。</div></div>';
  }

  /* 红警音：WebAudio 现场合成，不下载文件；默认关闭
   * 注意：浏览器要求先有用户手势才允许出声，所以第一次触摸就解锁音频 */
  var actx = null, lastKlaxon = 0;
  function audioCtx() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = actx || new AC();
      if (actx.state === 'suspended' && actx.resume) {
        try { actx.resume(); } catch (e) { /* ignore */ }
      }
      return actx;
    } catch (e) { return null; }
  }
  function unlockAudio() {
    if (!state.settings.alertOn || !state.settings.alertSound) return;
    audioCtx();
    primeRa();
  }
  /* 第一次触摸时先静音播一下再暂停：让浏览器记住"用户已交互"，之后程序自动放行 */
  function primeRa() {
    try {
      if (!raEl) { raEl = new Audio('assets/sound/redalert.mp4'); raEl.preload = 'auto'; }
      raEl.volume = 0.9;
      raEl.muted = true;
      var p = raEl.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          try { raEl.pause(); raEl.currentTime = 0; } catch (e) { /* ignore */ }
          raEl.muted = false;
        }).catch(function () { try { raEl.muted = false; } catch (e) { /* ignore */ } });
      } else {
        try { raEl.pause(); raEl.currentTime = 0; } catch (e) { /* ignore */ }
        raEl.muted = false;
      }
    } catch (e) { /* 静默失败 */ }
  }
  /* 真正的 LCARS Red Alert 音：优先播放随 App 打包的录音（assets/sound/redalert.mp4，
   * 取自用户自己截的 LCARS 红警片段），播放失败才退回下面的现场合成音。 */
  var raEl = null, raTried = false;
  function klaxonFile() {
    try {
      if (!raEl) {
        raEl = new Audio('assets/sound/redalert.mp4');
        raEl.preload = 'auto';
      }
      raEl.volume = 0.9;
      raEl.muted = false;
      try { raEl.currentTime = 0; } catch (e) { /* ignore */ }
      var p = raEl.play();
      if (p && typeof p.then === 'function') {
        p.catch(function () { klaxonSynth(); });
      }
      raTried = true;
      return true;
    } catch (e) { return false; }
  }
  function klaxon(force) {
    if (!state.settings.alertOn || !state.settings.alertSound) return;
    if (!force && !pendingAlerts().length) return;
    var now = Date.now();
    if (!force && now - lastKlaxon < 600000) return; /* 10 分钟内只响一次 */
    lastKlaxon = now;
    /* 先确保音频上下文解锁（iOS/部分安卓要先有手势），再放录音 */
    audioCtx();
    if (!klaxonFile()) klaxonSynth();
  }
  function klaxonSynth() {
    var ctx = audioCtx();
    if (!ctx) return;
    try {
      var t0 = ctx.currentTime;
      [0, 0.5].forEach(function (off, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(i ? 480 : 660, t0 + off);
        g.gain.setValueAtTime(0.0001, t0 + off);
        g.gain.exponentialRampToValueAtTime(0.075, t0 + off + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.42);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + off); o.stop(t0 + off + 0.45);
      });
    } catch (e) { /* 静默失败 */ }
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  /* ---------------- helpers ---------------- */
  function fmtDateCN(iso) {
    var d = C.parseISO(iso);
    if (!d) return '—';
    var y = d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '年';
    return y + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function slotOf(med, slotId) {
    var s = (med.slots || []).filter(function (x) { return x.id === slotId; });
    return s.length ? s[0] : null;
  }
  /** "08:00" -> "8:00" */
  function hm(t) { return String(t || '').replace(/^0/, ''); }

  var toastTimer = null;
  function toast(msg, bad) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast' + (bad ? ' bad' : ''); }, 2200);
  }

  /* ---------------- 记录操作 ---------------- */
  function setDose(medId, dateISO, slotId, status, amountPills) {
    var k = C.ck(medId, dateISO, slotId);
    if (!status) {
      delete state.checkins[k];
    } else {
      state.checkins[k] = { status: status, amountPills: amountPills, at: new Date().toISOString() };
    }
    cache.proj = null;
    save();
    render();
  }

  /* ---------------- 渲染入口 ---------------- */
  function render() {
    cache.proj = null;
    var t = C.today();
    /* 头部：舰籍行 + 日期/星历 */
    var sh = ship();
    var shipEl = $('#shipLine'), nccEl = $('#nccLine'), sub = $('#hdrSub');
    if (shipEl) shipEl.textContent = 'U.S.S. ' + (sh.name || '—') + ' · ' + (sh.cls || '—');
    if (nccEl) nccEl.textContent = 'NCC-' + (sh.ncc || '0000');
    if (sub) sub.textContent = fmtDateCN(t) + ' ' + C.weekdayCN(t) + ' · ' + stardate(t);
    /* 主体 */
    var html = '';
    if (ui.tab === 'today') html = viewToday();
    else if (ui.tab === 'water') html = '<div class="water-theme">' + viewWater() + '</div>';
    else if (ui.tab === 'meds') html = viewMeds();
    else if (ui.tab === 'log') html = viewLog();
    else html = viewSettings();
    var alertBar = alertHTML();
    $('#app').innerHTML = alertBar + drinkCallHTML() + html;
    renderNav();
    renderLayer();
    if (alertBar && pendingAlerts().length) klaxon();
    var fab = $('#fab');
    if (fab) fab.style.display = (ui.tab === 'meds' || ui.tab === 'today') ? 'block' : 'none';
  }

  function renderNav() {
    var tabs = [
      ['today', '01', '🩺', '今日'],
      ['water', '02', '💧', '补水'],
      ['meds', '03', '💊', '药品'],
      ['log', '04', '📋', '记录'],
      ['settings', '05', '⚙️', '设置']
    ];
    $('#nav').innerHTML = tabs.map(function (x) {
      return '<button class="tab" role="tab" data-act="tab" data-tab="' + x[0] + '" aria-selected="' +
        (ui.tab === x[0] ? 'true' : 'false') + '"><span class="num" aria-hidden="true">' + x[1] +
        '</span><span class="ic" aria-hidden="true">' + x[2] + '</span><span>' + x[3] + '</span></button>';
    }).join('');
  }

  /* ---------------- 舰况总览（MSD） ---------------- */
  function gauge(ratio, color, segs) {
    var n = segs || 12;
    var on = Math.max(0, Math.min(n, Math.round(ratio * n)));
    var out = '';
    for (var i = 0; i < n; i++) {
      out += i < on ? '<i class="on" style="--g:' + color + '"></i>' : '<i></i>';
    }
    return '<span class="gauge" aria-hidden="true">' + out + '</span>';
  }

  function viewMsd() {
    var t = C.today();
    var sh = ship();
    var doses = todayDoses();
    var done = doses.filter(function (d) { return C.getRec(state.checkins, d.med.id, t, d.s.id); }).length;
    var over = overTodayPills();

    var rows = state.meds.slice(0, 5).map(function (m) {
      var p = proj(m);
      var supply = C.supplyUnits(m);
      var ratio = supply > 0 ? Math.max(0, Math.min(1, p.remaining / supply)) : 0;
      var col = COLORS[m.color] ? COLORS[m.color][1] : 'var(--orange)';
      return '<div class="msd-row"><span class="msd-lab">' + esc(m.icon) + ' ' + esc(m.name) +
        ' <em>' + C.fmtPills(Math.max(0, p.remaining)) + ' 片 · ' + (p.daysLeft || 0) + ' 天</em></span>' +
        gauge(ratio, col) + '</div>';
    }).join('');

    var nearest = null;
    state.meds.forEach(function (m) {
      var p = proj(m);
      if (p.lastDoseISO && (nearest === null || p.daysLeft < nearest.daysLeft)) {
        nearest = { med: m, daysLeft: p.daysLeft, at: p.refillByISO || p.lastDoseISO };
      }
    });

    var html = '<div class="msd">';
    html += '<div class="msd-head"><span class="msd-title">舰况总览</span>' +
      '<span class="msd-star">STARDATE ' + stardate(t) + '</span></div>';
    html += '<div class="msd-ship">U.S.S. ' + esc(sh.name || '—') + ' / ' + esc(sh.cls || '—') +
      ' · NCC-' + esc(sh.ncc || '0000') + '</div>';
    html += '<div class="msd-rows">' + (rows || '<div class="msd-lab">暂无可显示的药品</div>') + '</div>';
    html += '<div class="msd-foot">' +
      '<span>今日<b>' + done + '/' + doses.length + '</b>次</span>' +
      '<span>在册<b>' + state.meds.length + '</b>种</span>' +
      (nearest ? '<span>最近补药<b>' + (nearest.at ? fmtDateCN(nearest.at) : '—') + '</b></span>' : '') +
      (over > 0 ? '<span class="hot">超量<b>' + C.fmtPills(over) + '</b>片</span>' : '') +
      '</div>';
    html += '</div>';
    return html;
  }

  /* ---------------- 今日 ---------------- */
  function viewToday() {
    var t = C.today();
    if (!state.meds.length) {
      return '<div class="empty"><span class="big">🩺</span>' +
        '还没有添加药品。<br>点右下角的 ＋ 添加第一种药，<br>填好「每盒几片」和「早中晚各几片」，<br>我会自动算好哪天吃完。' +
        '</div><div class="field"><button class="btn primary block" data-act="med-new">＋ 添加第一种药</button></div>';
    }
    var doses = [], notToday = [];
    state.meds.forEach(function (med) {
      if (C.isDoseDay(med, t) && C.activeSlots(med).length) {
        C.activeSlots(med).forEach(function (s) { doses.push({ med: med, s: s }); });
      } else {
        notToday.push(med);
      }
    });
    var done = doses.filter(function (d) { return C.getRec(state.checkins, d.med.id, t, d.s.id); }).length;
    var pct = doses.length ? Math.round((done / doses.length) * 100) : 0;

    var out = viewMsd();
    out += '<div class="today-top"><div><div class="today-date">今日已打卡</div>' +
      '<div class="today-count">' + done + '<small> / ' + doses.length + ' 次</small></div></div>' +
      '<div style="text-align:right"><div class="today-count" style="font-size:22px;color:var(--sky)">' + pct + '%</div>' +
      '<div class="today-date">今日进度</div></div></div>';
    out += '<div class="pbar"><i style="width:' + pct + '%"></i></div>';

    /* 出行药量入口（LCARS 条形按钮） */
    out += '<button class="trip-entry" data-act="trip-open">' +
      '<span class="te-n">05</span>' +
      '<span class="te-t">出行药量</span>' +
      '<span class="te-d">出几天门要带几板 · 够不够 ›</span></button>';

    /* 补水入口 */
    var wm = waterTodayMl(), wcfg = waterCfg();
    out += '<button class="trip-entry water-entry" data-act="tab" data-tab="water">' +
      '<span class="te-n">06</span>' +
      '<span class="te-t">补水</span>' +
      '<span class="te-d">' + wm + ' / ' + wcfg.targetMl + ' ml · ' +
      (wm >= wcfg.targetMl ? '✓ 已达标' : '还差 ' + (wcfg.targetMl - wm) + ' ml') + ' ›</span></button>';

    /* 逾期提醒 */
    var now = C.nowHM();
    var overdue = doses.filter(function (d) {
      return !C.getRec(state.checkins, d.med.id, t, d.s.id) && d.s.time < now;
    });
    if (overdue.length) {
      out += '<div class="panel tight" style="--c:var(--red);margin-top:12px">' +
        '<div style="font-size:14.5px;color:#ffb3b3">⚠️ 有 ' + overdue.length +
        ' 次药已过时间还没打卡：' +
        overdue.map(function (d) { return esc(d.med.name) + '·' + d.s.label; }).join('、') + '</div></div>';
    }

    /* 分组显示 */
    var groups = {};
    doses.forEach(function (d) {
      if (!groups[d.med.id]) groups[d.med.id] = [];
      groups[d.med.id].push(d);
    });

    out += '<div class="bar">今日用药<span class="bar-end">' + fmtDateCN(t) + '</span></div>';
    if (!doses.length) {
      out += '<div class="empty">今天没有需要服用的药 🌙</div>';
    }
    Object.keys(groups).forEach(function (mid) {
      var med = medById(mid);
      if (!med) return;
      var p = proj(med);
      var overU = 0;
      groups[mid].forEach(function (d0) {
        var r0 = C.getRec(state.checkins, med.id, t, d0.s.id);
        if (r0) overU += C.overUnitsOf(r0, d0.s);
      });
      var badge = '';
      if (p.daysLeft === 0) badge = '<span class="pill-badge bad">已吃完</span>';
      else if (p.needRefill) badge = '<span class="pill-badge warn">剩 ' + p.daysLeft + ' 天</span>';
      else badge = '<span class="pill-badge">剩 ' + p.daysLeft + ' 天</span>';
      out += '<div class="panel" style="--c:' + (COLORS[med.color] ? COLORS[med.color][1] : 'var(--orange)') + '">';
      out += '<div class="med-head" data-act="med-open" data-id="' + med.id + '">' +
        '<span class="med-icon" aria-hidden="true">' + esc(med.icon) + '</span>' +
        '<span class="med-name">' + esc(med.name || '未命名') + '</span>' + badge + '</div>';
      out += '<div class="med-sub' + (overU > 0 ? ' over' : '') + '">每天 <b>' + C.fmtPills(C.dailyUnits(med)) + '</b> 片 · 盒里还有 ' +
        C.fmtPills(C.remainingUnits(med, t, state.checkins)) + ' 片' +
        (p.runOutISO ? ' · 预计 <b>' + C.mmdd(p.runOutISO) + '</b> 吃完' : '') +
        (overU > 0 ? ' · <b>今日已多吃 ' + C.fmtPills(overU) + ' 片</b>' : '') + '</div>';
      groups[mid].forEach(function (d) {
        var rec = C.getRec(state.checkins, med.id, t, d.s.id);
        var st = rec ? rec.status : '';
        var cls = 'dose' + (rec ? ' done' : '') + (!rec && d.s.time < now ? ' overdue' : '') +
          (rec && rec.status === 'extra' ? ' over' : '');
        var showAmt = rec && (rec.status === 'partial' || rec.status === 'extra') && rec.amountPills != null;
        var amt = showAmt ? rec.amountPills : d.s.dose;
        var mark = rec ? (rec.status === 'taken' ? '✓' : rec.status === 'partial' ? '◐' :
          rec.status === 'extra' ? '＋' : rec.status === 'skipped' ? '–' : '✕') : '✓';
        out += '<div class="' + cls + '" data-act="dose-sheet" data-med="' + med.id + '" data-slot="' + d.s.id + '">' +
          '<div class="sl">' + d.s.label + '</div>' +
          '<div class="meta"><div class="amt">' + C.fmtPills(C.slotDoseUnits(d.s)) + ' <em>片</em>' +
          (showAmt ? ' <em>（实吃 ' + C.fmtPills(C.toUnits(amt)) + '）</em>' : '') +
          '</div><div class="tm">' + hm(d.s.time) + ' · ' +
          (p.daysLeft > 0 ? '这些药还够 ' + p.daysLeft + ' 天' : '库存已用尽') + '</div>' +
          (photoIndex[photoKey(med.id, t, d.s.id)]
            ? '<button class="cam" data-act="photo-view" data-k="' + esc(photoKey(med.id, t, d.s.id)) + '" aria-label="看打卡照片">📷</button>' : '') +
          '</div>' +
          '<button class="chk" data-act="quick" data-med="' + med.id + '" data-slot="' + d.s.id + '" ' +
          'data-state="' + (st || 'idle') + '" aria-label="标记已服">' + mark + '</button>' +
          '</div>';
      });
      out += '</div>';
    });

    if (notToday.length) {
      out += '<div class="bar c-almond">今天不用吃<span class="bar-end">' + notToday.length + ' 种</span></div>';
      out += '<div class="panel tight" style="--c:var(--almond)">' +
        notToday.map(function (m) {
          return '<div class="kv"><span class="k">' + esc(m.icon) + '</span><span class="v">' + esc(m.name || '未命名') +
            (m.startDate > t ? '（' + fmtDateCN(m.startDate) + '开始）' : (m.endDate && m.endDate < t ? '（已结束）' : '')) +
            '</span></div>';
        }).join('') + '</div>';
    }
    return out;
  }

  /* ---------------- 药品库 ---------------- */
  function viewMeds() {
    if (!state.meds.length) {
      return '<div class="empty"><span class="big">💊</span>药品库是空的。<br>点右下角 ＋ 添加。</div>';
    }
    var out = '<div class="bar">药品库<span class="bar-end">' + state.meds.length + ' 种</span></div>';
    state.meds.forEach(function (med) {
      var p = proj(med);
      var supply = C.supplyUnits(med);
      var used = Math.max(0, Math.min(supply, supply - p.remaining));
      var w = supply > 0 ? Math.round((used / supply) * 100) : 0;
      var col = COLORS[med.color] ? COLORS[med.color][1] : 'var(--orange)';
      var badge = p.daysLeft === 0 ? '<span class="pill-badge bad">已吃完</span>'
        : (p.needRefill ? '<span class="pill-badge warn">该补药了</span>' : '<span class="pill-badge good">正常</span>');
      var endTxt = p.lastDoseISO
        ? (p.needRefill ? '按库存 ' + fmtDateCN(p.lastDoseISO) + ' 吃完' : fmtDateCN(p.lastDoseISO) + ' 吃完')
        : '库存已用尽';
      out += '<div class="panel" style="--c:' + col + '">';
      out += '<div class="med-head" data-act="med-open" data-id="' + med.id + '">' +
        '<span class="med-icon" aria-hidden="true">' + esc(med.icon) + '</span>' +
        '<span class="med-name">' + esc(med.name || '未命名') + '</span>' + badge + '</div>';
      out += '<div class="stat-row"><b>' + C.fmtPills(C.dailyUnits(med)) + '</b><span>片 / 天</span>' +
        '<span style="margin-left:auto;color:var(--dim);font-size:13px">' +
        C.activeSlots(med).map(function (s) { return s.label + ' ' + C.fmtPills(C.slotDoseUnits(s)); }).join(' · ') +
        '</span></div>';
      out += '<div class="stat-row"><b>' + C.fmtPills(Math.max(0, p.remaining)) + '</b><span>片剩余</span>' +
        '<span style="margin-left:auto;font-size:13px;color:' + (p.needRefill ? 'var(--amber)' : 'var(--dim)') + '">' +
        (p.daysLeft > 0 ? '还够 ' + p.daysLeft + ' 天' : '已用尽') + '</span></div>';
      out += '<div class="minibar"><i style="width:' + w + '%;background:' + col + '"></i></div>';
      out += '<div style="display:flex;align-items:center;gap:8px;margin-top:10px">' +
        '<span style="font-size:13px;color:var(--dim);flex:1">' + endTxt +
        (med.endDate ? ' · 医生定 ' + fmtDateCN(med.endDate) + ' 停' : '') + '</span>' +
        '<button class="btn sm ghost" data-act="addbox" data-id="' + med.id + '">＋1 盒</button>' +
        '</div>';
      out += '</div>';
    });
    out += '<div style="margin:0 12px 20px"><button class="btn primary block" data-act="med-new">＋ 添加药品</button></div>';
    return out;
  }

  /* ---------------- 记录 ---------------- */
  function viewLog() {
    var t = C.today();
    var d7 = C.addDays(t, -6), yest = C.addDays(t, -1);
    var a7 = C.adherence(state.meds, state.checkins, d7, yest);
    var a30 = C.adherence(state.meds, state.checkins, C.addDays(t, -29), yest);
    var out = '<div class="bar">依从率<span class="bar-end">不含今天</span></div>';
    out += '<div class="stats">';
    out += '<div class="stat' + (a7.pct != null && a7.pct < 80 ? ' warn' : '') + '"><b>' +
      (a7.pct == null ? '—' : a7.pct + '%') + '</b><span>近 7 天</span></div>';
    out += '<div class="stat' + (a30.pct != null && a30.pct < 80 ? ' warn' : '') + '"><b>' +
      (a30.pct == null ? '—' : a30.pct + '%') + '</b><span>近 30 天</span></div>';
    out += '<div class="stat"><b>' + Object.keys(state.checkins).length + '</b><span>打卡记录</span></div>';
    out += '</div>';
    out += '<div class="panel tight" style="--c:var(--sky);font-size:13px;color:var(--dim)">' +
      '近 7 天计划 ' + C.fmtPills(a7.planUnits) + ' 片 · 实际 ' + C.fmtPills(a7.takenUnits) + ' 片。' +
      '过去没打卡的日子按「按时服药」计算，标了「跳过 / 漏服」才会计为未服。' +
      (a30.overCount
        ? '<br>近 30 天有 <b style="color:var(--amber)">' + a30.overCount + '</b> 次超量，共多吃 ' +
          C.fmtPills(a30.overUnits) + ' 片。如果这不是医嘱，下次复诊请告诉医生。'
        : '') + '</div>';

    out += '<div class="bar c-lilac">近 14 天<span class="bar-end">点一天可补记</span></div>';
    var rows = '';
    for (var i = 0; i < 14; i++) {
      var d = C.addDays(t, -i);
      var due = 0, rec = 0, dots = '';
      state.meds.forEach(function (med) {
        if (!C.isDoseDay(med, d)) return;
        C.activeSlots(med).forEach(function (s) {
          due++;
          var r = C.getRec(state.checkins, med.id, d, s.id);
          if (r) rec++;
          dots += '<span class="dot ' + (r ? r.status : '') + '"></span>';
        });
      });
      if (!due) continue;
      rows += '<div class="log-day" data-act="day-sheet" data-date="' + d + '">' +
        '<span class="d">' + (i === 0 ? '今天' : C.mmdd(d) + ' ' + C.weekdayCN(d)) + '</span>' +
        '<span class="dots">' + dots + '</span>' +
        '<span class="pct">' + rec + '/' + due + '</span></div>';
    }
    out += '<div class="panel tight" style="--c:var(--lilac)">' + (rows || '<div style="color:var(--dim);font-size:14px">还没有可显示的计划</div>') + '</div>';
    return out;
  }

  /* ---------------- 设置 ---------------- */
  function viewSettings() {
    var t = C.today();
    var notifBtn;
    if (!('Notification' in window)) {
      notifBtn = '<button class="btn ghost block" disabled>此浏览器不支持系统通知</button>' +
        '<div class="help">可以用下面的「导出日历(.ics)」让手机自带日历帮你提醒，更可靠。</div>';
    } else if (Notification.permission === 'granted') {
      notifBtn = '<button class="btn ' + (state.settings.notifyOn ? 'ok' : 'ghost') + ' block" data-act="notify-toggle">' +
        (state.settings.notifyOn ? '✓ 通知已开启（点此关闭）' : '开启通知提醒') + '</button>';
    } else if (Notification.permission === 'denied') {
      notifBtn = '<button class="btn ghost block" disabled>通知已被浏览器拒绝</button>' +
        '<div class="help">到浏览器设置里允许本站通知后重试；或直接用 .ics 日历提醒。</div>';
    } else {
      notifBtn = '<button class="btn sky block" data-act="notify-on">允许通知（会弹系统授权）</button>';
    }

    var html = '';
    var sh = ship();
    html += '<div class="bar c-almond">舰桥</div>';
    html += '<div class="field"><label>舰名 / 舰级 / 舷号（会显示在标题和舰况面板）</label>' +
      '<div class="ship-grid">' +
      '<div><label>舰名（U.S.S. 之后）</label><input type="text" data-f="ship-name" maxlength="18" ' +
      'placeholder="坚定" value="' + esc(sh.name) + '"></div>' +
      '<div><label>舰级</label><input type="text" data-f="ship-cls" maxlength="18" ' +
      'placeholder="医疗舰" value="' + esc(sh.cls) + '"></div>' +
      '<div><label>舷号（NCC- 之后）</label><input type="text" data-f="ship-ncc" maxlength="10" ' +
      'placeholder="4747" value="' + esc(sh.ncc) + '"></div>' +
      '</div>' +
      '<div class="ship-preview">U.S.S. ' + esc(sh.name || '—') + ' / ' + esc(sh.cls || '—') +
      ' · NCC-' + esc(sh.ncc || '0000') + '</div>' +
      '<div style="margin-top:8px"><button class="btn primary block" data-act="ship-save">保存舰籍</button></div>' +
      '</div>';

    html += '<div class="bar">提醒与预警</div>';
    html += '<div class="field"><label>库存预警：剩余不到几天时提醒补药</label><div class="chips">';
    [3, 5, 7, 10, 14].forEach(function (n) {
      html += '<button class="chip" data-act="warn-days" data-v="' + n + '" aria-pressed="' +
        (state.settings.refillWarnDays === n ? 'true' : 'false') + '">' + n + ' 天</button>';
    });
    html += '</div></div>';
    html += '<div class="field"><label>系统通知</label>' + notifBtn + '</div>';
    html += '<div class="field"><label>日历提醒（推荐）</label>' +
      '<button class="btn lilac block" data-act="exp-ics">导出 .ics 到手机日历</button>' +
      '<div class="help">导出后双击文件用日历打开，会生成每天固定时间的重复提醒，App 关掉也能响。吃完药后会按库存自动停止。</div></div>';

    html += '<div class="field"><label>红色警报（Red Alert）</label>' +
      '<button class="btn ' + (state.settings.alertOn ? 'ok' : 'ghost') + ' block" data-act="alert-toggle">' +
      (state.settings.alertOn ? '✓ 已开启：该吃药没打卡 / 跳过 / 超量时亮红' : '已关闭（不会亮红）') + '</button>' +
      '<button class="btn ' + (state.settings.alertSound ? 'sky' : 'ghost') +
      ' block" data-act="alert-sound-toggle" style="margin-top:8px">' +
      (state.settings.alertSound ? '🔊 红警音已开启（点此关闭）' : '🔈 红警音关闭（点此开启）') + '</button>' +
      '<div class="help">红警只是提醒你回去看一眼，不做任何医学判断。红警音由浏览器现场合成，不联网、不下载音频文件；在公共场合建议保持关闭。</div></div>';

    html += '<div class="field"><label>打卡必须拍照</label>' +
      '<button class="btn ' + (state.settings.photoRequired !== false ? 'ok' : 'ghost') +
      ' block" data-act="photo-required">' +
      (state.settings.photoRequired !== false
        ? '📷 已开启：点“已服”先开相机，拍完才算数'
        : '已关闭：点一下就打卡（忙的时候用）') + '</button>' +
      '<div class="help">开着的时候，想记“吃了”必须先拍一张，照片上会印药名、剂量和拍摄时间。' +
      '它没法替你证明药真进了嘴，但能挡住手滑乱打勾，也让你事后一眼看出这张是几点拍的。' +
      '照片只留当天，最多 24 张自动循环覆盖。' +
      '跳过 / 漏服 不需要拍照。</div></div>';

    html += '<div class="bar c-sky">数据</div>';
    html += '<div class="field" style="display:grid;gap:10px">' +
      '<button class="btn ghost block" data-act="exp-json">导出备份（.json）</button>' +
      '<button class="btn ghost block" data-act="imp-json">从备份导入</button>' +
      '<button class="btn ghost block" data-act="restore-bak" style="color:var(--amber)">恢复升级前的备份</button>' +
      '<div class="help">换手机、清缓存前请先导出备份。数据只存在这台设备的浏览器里，不上传任何服务器。升级到 2.0.0 时会自动把旧数据原样存一份备份，万一显示不对可以用「恢复升级前的备份」退回去。</div>' +
      '</div>';
    html += '<div class="panel tight" style="--c:var(--sky)">' +
      '<div class="kv"><span class="k">药品</span><span class="v">' + state.meds.length + ' 种</span></div>' +
      '<div class="kv"><span class="k">打卡记录</span><span class="v">' + Object.keys(state.checkins).length + ' 条</span></div>' +
      '<div class="kv"><span class="k">超量记录</span><span class="v">' +
      Object.keys(state.checkins).filter(function (k) { return state.checkins[k].status === 'extra'; }).length +
      ' 条</span></div>' +
      '<div class="kv"><span class="k">今日</span><span class="v">' + fmtDateCN(t) + ' ' + C.weekdayCN(t) + '</span></div>' +
      '<div class="kv"><span class="k">版本</span><span class="v">' + VERSION + ' · 离线可用</span></div>' +
      '</div>';

    html += '<div class="bar c-almond">关于 · 署名与许可</div>';

    html += '<div class="field"><label>署名（作者）</label>' +
      '<input class="inp" data-f="author" maxlength="40" placeholder="写你的真名或 GitHub ID" value="' + esc(authorName()) + '" />' +
      '<button class="btn ghost block" data-act="author-save" style="margin-top:10px">保存署名</button>' +
      '<div class="help">这里写的名字会显示在 App 里，也是 CC 协议要求的“署名”那一项。改完记得也用同样的名字替换 LICENSE 文件里的占位。</div></div>';

    html += '<div class="panel tight lic-panel" style="--c:var(--violet)">' +
      '<div class="lic-badge">' + LICENSE + '</div>' +
      '<div class="lic-name">知识共享 · 署名—非商业性使用 国际许可 4.0</div>' +

      '<div class="lic-h">什么叫做 CC 协议</div>' +
      '<div class="lic-p">CC 是 Creative Commons（知识共享组织）推出的一套授权模板：作者不用请律师，就能用大白话说清楚“别人可以拿我的东西做什么”。它由四个要素拼成，你看到的那串字母就是这四块的缩写：</div>' +
      '<div class="lic-row"><b>BY</b> 署名 — 用的人必须写上原作者名字。</div>' +
      '<div class="lic-row"><b>NC</b> 非商业性使用 — 不能拿去赚钱（卖、放进付费或带广告的产品）。</div>' +
      '<div class="lic-row"><b>SA</b> 相同方式共享 — 改完的作品必须用同一份协议发布。</div>' +
      '<div class="lic-row"><b>ND</b> 禁止演绎 — 只许原样转载，不许修改。</div>' +
      '<div class="lic-p">四种要素组合出几种常见许可（如 CC BY、CC BY-SA、CC BY-NC、CC BY-NC-SA）；还有一种 CC0，是完全放弃权利、放进公共领域。本 App 选择的是 <b>BY + NC</b>。</div>' +

      '<div class="lic-h">你可以</div>' +
      '<div class="lic-row ok">✓ 自己用、装到自己的手机上，商用与否都不影响你自用</div>' +
      '<div class="lic-row ok">✓ 复制、修改、二次开发（这就是“可演绎”），甚至做成你自己的版本</div>' +
      '<div class="lic-row ok">✓ 免费分享给别人、把改好的代码开源出去</div>' +

      '<div class="lic-h">你必须</div>' +
      '<div class="lic-row">· 保留作者署名（就是上面那个名字）和这份许可说明</div>' +
      '<div class="lic-row">· 说明你改动过哪些地方（例如写“基于 X 修改”）</div>' +
      '<div class="lic-row">· 演绎作品仍然只能用于非商业用途</div>' +

      '<div class="lic-h">你不可以</div>' +
      '<div class="lic-row no">✗ 拿它去卖钱、放进收费 App、应用商店、带广告的产品</div>' +
      '<div class="lic-row no">✗ 去掉署名或假装是你原创的</div>' +

      '<div class="lic-p mut">它不是“公共领域”，也不是“随便用”：署名和非商业这两条一直在。完整法律文本见 creativecommons.org/licenses/by-nc/4.0/ （中文版页面里有全文中译）。</div>' +

      '<div class="lic-h">第三方与商标</div>' +
      '<div class="lic-row">· 界面风格参考 LCARS Inspired Website Template by <a href="https://www.thelcars.com/" target="_blank" rel="noopener noreferrer">www.TheLCARS.com</a>，按其许可仅作个人非商业使用，样式已按需修改。</div>' +
      '<div class="lic-row">· 字体 Antonio，SIL Open Font License 1.1（字体文件随本仓库一同再分发，许可全文见 openfontlicense.org）。</div>' +
      '<div class="lic-row">· 应用图标、LCARS 色条与所有界面元素均为本项目自绘（图标由 Pillow 脚本生成），不含任何第三方图片素材。</div>' +
      '<div class="lic-row">· 未使用任何第三方 JavaScript 库或框架：全部代码为原生 JS 手写，无打包、无依赖、无网上下载的代码。</div>' +

      '<div class="lic-h">商标与归属（逐条列出）</div>' +
      '<div class="lic-row">· STAR TREK 与相关标识、名称、角色为 CBS Studios Inc. 的注册商标；STAR TREK: LOWER DECKS 等剧集名称亦同。</div>' +
      '<div class="lic-row">· LCARS（Library Computer Access/Retrieval System）及其界面视觉语言属 Star Trek 设定，相关权利归 CBS Studios Inc.。</div>' +
      '<div class="lic-row">· U.S.S.、NCC、舰名与舰级（如 California-class、Shangri-La-class）等命名体系属上述权利人的虚构设定，本项目仅作致敬。</div>' +
      '<div class="lic-row">· 本项目是<b>非官方、非商业的粉丝作品</b>，与 CBS Studios Inc.、Paramount Global 及其关联公司<b>没有任何隶属、赞助或背书关系</b>；不使用其商标作为自身商品或服务的来源标识，也不上架任何应用商店。</div>' +
      '<div class="lic-row">· 本仓库不包含任何剧集截图、影音片段或官方字体文件；若你自行放入素材，请自行确认使用权。</div>' +

      '<div class="lic-h">数据与隐私</div>' +
      '<div class="lic-row">· 所有记录只存在这台设备的浏览器里（localStorage 存药品与打卡，IndexedDB 存当天照片），不上传任何服务器，没有账号、没有统计上报、没有广告。</div>' +
      '<div class="lic-row">· 打卡照片只保留当天，最多 24 张，自动循环覆盖；导出 JSON 备份时不含照片。</div>' +
      '<div class="lic-row">· 换手机或清缓存前，请先「导出备份（.JSON）」，新设备上「从备份导入」即可完整恢复。</div>' +

      '<div class="lic-h">版本</div>' +
      '<div class="lic-row">· ' + VERSION + '（2026-11）— 署名与 CC BY-NC 4.0 许可、离线缓存加固。</div>' +
      '<div class="lic-row">· 更新记录与安装说明见仓库 README.md。</div>' +
      '</div>' +

      '<div class="field">' +
      '<button class="btn ghost block" data-act="wipe" style="color:var(--red);border-color:#3a2020">清空全部数据</button></div>';
    html += '<div class="disclaimer"><b>重要提示</b><br>' +
      '本 App 只是记录与计算工具，<b>不是医疗器械，不提供任何用药建议</b>。' +
      '剂量、加减药、漏服后怎么补，请以你的医生、药师和药品说明书为准。' +
      '计算结果是按你填写的计划推算的，实际库存请以药盒为准。</div>';
    html += '<div class="credit">' +
      '© 2026 ' + esc(authorName()) + ' · 本作品采用 ' + LICENSE + '（署名—非商业性使用 4.0 国际）许可协议，允许演绎但不得商用。' +
      '界面风格参考 LCARS Inspired Website Template by ' +
      '<a href="https://www.thelcars.com/" target="_blank" rel="noopener noreferrer">www.TheLCARS.com</a>' +
      '（个人非商业使用，已按需修改样式）。字体 Antonio（SIL OFL 1.1）。' +
      'Star Trek、LCARS 为 CBS Studios 商标，本 App 与 CBS 无关联，仅供个人自用。</div>';
    return html;
  }

  /* ---------------- 全屏 LCARS 主菜单 ---------------- */
  function menuHTML() {
    var t = C.today();
    var items = [
      ['today', '01', '🩺', '今日用药', '打卡 · 今日进度', 'var(--orange)'],
      ['water', '02', '💧', '补水', '喝水提醒 · 水量液位', 'var(--sky)'],
      ['meds', '03', '💊', '药品库', '增减 · 库存 · 吃完日', 'var(--lilac)'],
      ['log', '04', '📋', '记录统计', '依从率 · 补记', 'var(--sky)'],
      ['settings', '05', '⚙️', '设置', '舰籍 · 提醒 · 备份', 'var(--almond)']
    ];
    var n = pendingAlerts().length;
    var html = '<div class="menu" role="dialog" aria-modal="true" aria-label="主菜单">';
    html += '<div class="menu-top"><div>' +
      '<div class="menu-title">LCARS / 主菜单</div>' +
      '<div class="menu-sub">' + fmtDateCN(t) + ' ' + C.weekdayCN(t) + ' · STARDATE ' + stardate(t) + '</div>' +
      '</div></div>';
    html += '<div class="menu-grid">';
    items.forEach(function (x) {
      html += '<button class="menu-item" style="--c:' + x[5] + '" data-act="menu-go" data-tab="' + x[0] + '">' +
        '<span class="n">' + x[1] + '</span>' +
        '<span class="t">' + x[2] + ' ' + x[3] + '</span>' +
        '<span class="d">' + x[4] + '</span></button>';
    });
    html += '<button class="menu-item wide" style="--c:var(--barley)" data-act="trip-open">' +
      '<span class="n">06 · 出行</span>' +
      '<span class="t">🧳 出行药量计算</span>' +
      '<span class="d">出几天门要带几板几瓶 · 够不够一眼看</span></button>';
    html += '<button class="menu-item wide" style="--c:var(--amber)" data-act="focus-open">' +
      '<span class="n">07 · 专注</span>' +
      '<span class="t">🛑 短视频刹车舱</span>' +
      '<span class="d">想刷之前先给我 30 秒 · 今天已拦下 ' + focusDay(C.today()).ok + ' 次</span></button>';
    html += '<button class="menu-item wide ghost" data-act="menu-go" data-tab="today" style="--c:#141414">' +
      '<span class="n">08 · 状态</span>' +
      '<span class="t">' + (n ? 'RED ALERT · ' + n + ' 项待处理' : 'GREEN · 无告警') + '</span>' +
      '<span class="d">' + (n ? '点这里回到今日处理' : '今日所有用药都在计划内') + '</span></button>';
    html += '</div>';
    html += '<button class="menu-close" data-act="menu-close">✕ 关闭菜单</button>';
    html += '</div>';
    return html;
  }

  /* ---------------- 出行药量计算 ---------------- */
  function tripRange() {
    var t = C.today();
    var st = (state.settings && state.settings.trip) || {};
    var from = /^\d{4}-\d{2}-\d{2}$/.test(st.from || '') ? st.from : C.addDays(t, 1);
    var to = /^\d{4}-\d{2}-\d{2}$/.test(st.to || '') ? st.to : C.addDays(from, 2);
    if (to < from) to = from;
    return { from: from, to: to };
  }

  function saveTrip(r) {
    state.settings.trip = { from: r.from, to: r.to };
    save();
  }

  function tripHTML() {
    var r = ui.trip || tripRange();
    var p = C.tripPlan(state.meds, state.checkins, r.from, r.to, C.today());
    var ok = p.status === 'ok';
    var P = function (v) { return C.fmtPills(C.toUnits(v)); };

    var h = '<div class="screen trip" role="dialog" aria-modal="true" aria-label="出行药量计算">';
    h += '<div class="scr-head"><button class="btn ghost" data-act="trip-close">← 返回</button>' +
      '<div class="t">出行药量</div></div><div class="scr-body">';

    h += '<div class="trip-dates">' +
      '<label class="trip-field"><span>出发</span>' +
      '<input type="date" data-f="trip-from" value="' + r.from + '"></label>' +
      '<label class="trip-field"><span>回来</span>' +
      '<input type="date" data-f="trip-to" value="' + r.to + '"></label>' +
      '<div class="trip-days"><b>' + p.days + '</b><small>天</small></div></div>';

    h += '<div class="trip-quick">' +
      [[2, '2 天'], [3, '3 天'], [5, '5 天'], [7, '一周'], [14, '两周']].map(function (x) {
        return '<button class="chip" data-act="trip-range" data-days="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>';

    if (p.rows.length) {
      h += '<div class="trip-sum ' + (ok ? 'ok' : 'bad') + '">' +
        '<div class="ts-badge" aria-hidden="true">' + (ok ? '✓' : '!') + '</div>' +
        '<div class="ts-main">' +
        '<div class="ts-big">' + (ok ? '够用，放心走' : '不够 · 差 ' + P(p.shortPills) + ' 片') + '</div>' +
        '<div class="ts-sub">共要带 <b>' + P(p.needPills) + '</b> 片 · 手上还有 <b>' + P(p.stashPills) +
        '</b> 片 · 这 ' + p.days + ' 天里有 ' + p.doseDays + ' 天要吃药</div>' +
        '</div></div>';
    }

    if (!p.rows.length) {
      h += '<div class="empty"><span class="big">🧳</span>这几天你登记的几种药都不需要吃。</div>';
    } else {
      h += '<div class="trip-rows">';
      p.rows.forEach(function (row) {
        var m = row.med;
        var ratio = row.needPills > 0 ? Math.min(1, row.stashPills / row.needPills) : 1;
        var color = row.enough ? 'var(--green)' : 'var(--ra)';
        h += '<div class="trip-row' + (row.enough ? '' : ' short') + '">' +
          '<div class="tr-top">' +
          '<span class="tr-ic">' + esc(m.icon || '💊') + '</span>' +
          '<span class="tr-nm">' + esc(m.name) + '</span>' +
          '<span class="tr-tag ' + (row.enough ? 'ok' : 'bad') + '">' +
          (row.enough ? '够' : '差 ' + P(row.shortPills) + ' 片') + '</span></div>' +
          '<div class="tr-meta">要带 <b>' + P(row.needPills) + '</b> 片' +
          (row.boxes ? '（按整盒 ≈ <b>' + row.boxes + '</b> 盒' + (row.perBox ? '，每盒 ' + row.perBox + ' 片' : '') + '）' : '') +
          ' · 手上 <b>' + P(row.stashPills) + '</b> 片</div>' +
          '<div class="tr-gauge">' + gauge(ratio, color, 14) +
          '<span class="tr-gpct">' + Math.round(Math.min(1, row.needPills > 0 ? row.stashPills / row.needPills : 1) * 100) + '%</span></div>' +
          '</div>';
      });
      h += '</div>';
    }

    if (p.shortPills > 0) {
      var shortList = p.rows.filter(function (x) { return x.shortPills > 0.001; })
        .map(function (x) { return esc(x.med.name) + ' ' + P(x.shortPills) + ' 片'; }).join('、');
      h += '<div class="trip-warn">⚠ 出发前先补药：' + shortList + '。补好后再回来算一次。</div>';
    } else if (p.rows.length) {
      h += '<div class="trip-okline">✓ 手上的量覆盖这 ' + p.days + ' 天，记得把它装进随身包里。</div>';
    }

    h += '<div class="help">算的是「按你登记的服药计划实际要吃多少片」：会跳过「不吃的那几天」和暂停区间，' +
      '今天已经吃过的不重复计算。按整盒带时向上取整。这里只做算术，吃什么、吃多少仍以医生和说明书为准。</div>';
    h += '</div></div>';
    return h;
  }

  /* ---------------- 弹层 ---------------- */
  function renderLayer() {
    var host = $('#layer');
    if (!host) return;
    if (ui.menu) { host.innerHTML = menuHTML(); return; }
    if (ui.trip) { host.innerHTML = tripHTML(); return; }
    if (ui.photo) { host.innerHTML = photoHTML(); return; }
    if (ui.focus) { host.innerHTML = focusHTML(); return; }
    if (ui.draft) { host.innerHTML = editorHTML(); updatePreview(); return; }
    if (!ui.sheet) { host.innerHTML = ''; return; }
    host.innerHTML = sheetHTML();
    attachThumb();
  }

  function closeLayer() {
    ui.draft = null;
    ui.sheet = null;
    renderLayer();
  }

  function sheetHTML() {
    var s = ui.sheet;
    if (s.type === 'dose') return doseSheetHTML(s);
    if (s.type === 'day') return daySheetHTML(s);
    return '';
  }

  function doseSheetHTML(s) {
    var med = medById(s.medId);
    if (!med) return '';
    var slot = slotOf(med, s.slotId);
    if (!slot) return '';
    var rec = C.getRec(state.checkins, med.id, s.date, slot.id);
    var du = C.slotDoseUnits(slot);
    var plan = C.toPills(du);
    var half = plan / 2;
    /* 强制拍照模式下，把按钮文字改掉，让人知道点下去会开相机 */
    var pkNow = photoKey(med.id, s.date, slot.id);
    var needCam = needPhoto() && s.date === C.today() && !photoIndex[pkNow] && photoOk();
    if (s.extra == null) {
      s.extra = (rec && (rec.status === 'extra' || rec.status === 'partial') && rec.amountPills != null)
        ? rec.amountPills : plan;
    }
    var amt = s.extra;
    var amtU = C.toUnits(amt);
    var overU = Math.max(0, amtU - du);
    var mk = function (status, label, cls, extra) {
      return '<button class="btn ' + cls + ' block" data-act="set" data-med="' + med.id + '" data-slot="' + slot.id +
        '" data-date="' + s.date + '" data-status="' + status + '"' + (extra || '') + '>' + label + '</button>';
    };
    var stepBtn = function (p, sign) {
      var lab = (p === 0.25 ? '¼' : p === 0.5 ? '½' : String(p));
      return '<button class="chip sw" data-act="extra-step" data-step="' + (sign === '-' ? -p : p) + '">' +
        (sign === '-' ? '−' : '+') + lab + '</button>';
    };
    var html = '<div class="mask" data-act="sheet-close"><div class="sheet" data-stop="1">';
    html += '<h2>' + esc(med.icon) + ' ' + esc(med.name) + ' · ' + slot.label + '</h2>';
    html += '<p class="hint">' + fmtDateCN(s.date) + ' ' + hm(slot.time) + ' · 计划 ' + C.fmtPills(du) + ' 片' +
      (rec ? ' · 现在标记为「' + statusCN(rec.status) + '」' : '') + '</p>';
    html += '<div class="sheet-actions">';
    html += mk('taken',
      (needCam ? '📷 拍照并打卡（' + C.fmtPills(du) + ' 片）' : '✓ 已服（' + C.fmtPills(du) + ' 片）'), 'ok');
    if (du > C.QS) html += mk('partial',
      (needCam ? '📷 拍一张，记少吃的量（' + C.fmtPills(C.toUnits(half)) + ' 片）' : '◐ 只吃了一部分（' + C.fmtPills(C.toUnits(half)) + ' 片）'), 'sky');
    html += mk('skipped', '– 这次主动跳过', 'ghost');
    html += mk('missed', '✕ 漏服了（忘了吃）', 'ghost');
    if (rec) html += mk('', '⌫ 清除这条记录', 'ghost', ' style="color:var(--red)"');
    html += '</div>';

    /* 多吃 / 实吃片数 */
    html += '<div class="extra-box"><div class="extra-head">' +
      '<span>实际吃了几片？（多吃就往上加）</span>' +
      '<span class="extra-num">' + C.fmtPills(amtU) + '<small> 片</small></span></div>';
    html += '<div class="extra-row">' + stepBtn(1, '-') + stepBtn(0.5, '-') + stepBtn(0.25, '-') +
      stepBtn(0.25, '+') + stepBtn(0.5, '+') + stepBtn(1, '+') + stepBtn(2, '+') + '</div>';
    if (overU > 0) {
      html += '<div class="extra-warn">⚠ 比医嘱多 <b>' + C.fmtPills(overU) + ' 片</b>。' +
        '超量后请不要自行加量或补服，按说明书或咨询医生／药师。</div>';
    }
    html += '<div class="extra-row">' +
      '<button class="chip sw" data-act="extra-step" data-step="reset">还原计划量 ' + C.fmtPills(du) + ' 片</button>' +
      '<button class="btn primary sm" data-act="set-extra">记录实吃 ' + C.fmtPills(amtU) + ' 片</button>' +
      '</div></div>';

    /* 照片存证：只保留当天，环形覆盖 */
    var pk = photoKey(med.id, s.date, slot.id);
    var pmeta = photoIndex[pk];
    var isToday = (s.date === C.today());
    html += '<div class="photo-box"><div class="photo-head">📷 照片存证' +
      '<em>只保留今天 · 照片会自动循环覆盖</em></div>';
    if (pmeta) {
      html += '<div class="photo-cur">' +
        '<img class="photo-thumb" id="photoThumb" alt="本次打卡照片" />' +
        '<div class="photo-meta"><span>拍于 ' + hmOfTs(pmeta.ts) + '</span>' +
        '<div class="photo-acts"><button class="btn ghost sm" data-act="photo-view" data-k="' + esc(pk) + '">看大图</button>' +
        '<button class="btn ghost sm" data-act="photo-del" data-k="' + esc(pk) + '" style="color:var(--red)">删除</button></div>' +
        '</div></div>';
    }
    html += '<div class="photo-acts">' +
      (isToday ? '<button class="btn ghost sm" data-act="photo-take" data-k="' + esc(pk) + '" data-cap="1">📷 拍一张</button>' +
        '<button class="btn ghost sm" data-act="photo-take" data-k="' + esc(pk) + '">🖼 从相册选</button>' : '') +
      '</div>';
    if (!isToday) html += '<div class="photo-warn">照片只存当天，补记以前的日期不会保存照片。</div>';
    if (!photoOk()) html += '<div class="photo-warn">这台浏览器不允许存照片（无痕模式常见）。统计和打卡不受影响。</div>';
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  function statusCN(st) {
    return {
      taken: '已服', partial: '部分服用', skipped: '主动跳过', missed: '漏服',
      extra: '超量服用'
    }[st] || st;
  }

  function daySheetHTML(s) {
    var rows = '';
    state.meds.forEach(function (med) {
      if (!C.isDoseDay(med, s.date)) return;
      C.activeSlots(med).forEach(function (slot) {
        var rec = C.getRec(state.checkins, med.id, s.date, slot.id);
        var over = rec ? C.overUnitsOf(rec, slot) : 0;
        rows += '<div class="dose' + (rec ? ' done' : '') + (over > 0 ? ' over' : '') + '">' +
          '<div class="sl">' + slot.label + '</div>' +
          '<div class="meta"><div class="amt" style="font-size:17px">' + esc(med.name) +
          ' ' + C.fmtPills(C.slotDoseUnits(slot)) + ' 片</div>' +
          '<div class="tm">' + (rec ? statusCN(rec.status) +
            (rec.amountPills != null && (rec.status === 'extra' || rec.status === 'partial')
              ? ' ' + C.fmtPills(C.toUnits(rec.amountPills)) + ' 片' : '') : '未记录') + '</div></div>' +
          '<div style="display:flex;gap:6px">' +
          '<button class="btn sm ' + (rec && rec.status === 'taken' ? 'ok' : 'ghost') + '" data-act="set" data-med="' + med.id +
          '" data-slot="' + slot.id + '" data-date="' + s.date + '" data-status="taken">✓</button>' +
          '<button class="btn sm ghost" data-act="day-extra" data-med="' + med.id +
          '" data-slot="' + slot.id + '" data-date="' + s.date + '">＋</button>' +
          '<button class="btn sm ' + (rec && rec.status === 'skipped' ? 'danger' : 'ghost') + '" data-act="set" data-med="' + med.id +
          '" data-slot="' + slot.id + '" data-date="' + s.date + '" data-status="skipped">–</button>' +
          '</div></div>';
      });
    });
    return '<div class="mask" data-act="sheet-close"><div class="sheet" data-stop="1">' +
      '<h2>' + fmtDateCN(s.date) + ' ' + C.weekdayCN(s.date) + '</h2>' +
      '<p class="hint">补记那天的情况。「＋」可以记那天多吃的量。标「跳过 / 漏服」后库存会自动加回来。</p>' +
      (rows || '<div class="empty" style="margin:0">这天没有计划用药</div>') +
      '<div class="sheet-actions"><button class="btn ghost block" data-act="sheet-close">关闭</button></div>' +
      '</div></div>';
  }

  /* ---------------- 编辑器 ---------------- */
  function openEditor(med) {
    ui.draft = med ? JSON.parse(JSON.stringify(med)) : C.newMed({ name: '' });
    ui.sheet = null;
    renderLayer();
  }

  function editorHTML() {
    var d = ui.draft;
    var isNew = !medById(d.id);
    var supply = C.supplyUnits(d);
    var html = '<div class="screen"><div class="scr-head">' +
      '<button class="btn sm ghost" data-act="ed-cancel">取消</button>' +
      '<div class="t">' + (isNew ? '添加药品' : '编辑药品') + '</div>' +
      (isNew ? '' : '<button class="btn sm ghost" data-act="ed-del" style="color:var(--red)">删除</button>') +
      '</div><div class="scr-body">';

    /* 名称 */
    html += '<div class="field"><label>药品名称</label>' +
      '<input type="text" data-f="name" maxlength="40" placeholder="例如：舍曲林 50mg" value="' + esc(d.name) + '"></div>';

    /* 图标 */
    html += '<div class="field"><label>辨认图标</label><div class="chips">';
    ICONS.forEach(function (ic) {
      html += '<button class="chip emoji" data-act="ed-icon" data-v="' + ic + '" aria-pressed="' +
        (d.icon === ic ? 'true' : 'false') + '">' + ic + '</button>';
    });
    html += '</div></div>';

    /* 颜色 */
    html += '<div class="field"><label>颜色标记</label><div class="chips">';
    Object.keys(COLORS).forEach(function (k) {
      html += '<button class="chip sw" data-act="ed-color" data-v="' + k + '" aria-pressed="' +
        (d.color === k ? 'true' : 'false') + '" style="border-color:' + (d.color === k ? COLORS[k][1] : 'transparent') +
        ';background:' + COLORS[k][1] + '22;color:' + COLORS[k][1] + '">' + COLORS[k][0] + '</button>';
    });
    html += '</div></div>';

    /* 日期 */
    html += '<div class="row2">' +
      '<div class="field"><label>开始日期</label><input type="date" data-f="startDate" value="' + esc(d.startDate) + '"></div>' +
      '<div class="field"><label>结束日期（可留空）</label><input type="date" data-f="endDate" value="' + esc(d.endDate) + '"></div>' +
      '</div>';
    html += '<div class="field" style="margin-top:-4px"><div class="help">结束日期留空 = 按库存自动算到吃完。医生给了停药日期就填上。</div></div>';

    /* 时段 */
    html += '<div class="bar">每天怎么吃</div>';
    html += '<div class="panel tight" style="--c:var(--sky)">';
    d.slots.forEach(function (s) {
      var on = C.slotDoseUnits(s) > 0;
      html += '<div class="slot-row ' + (on ? 'on' : 'off') + '" data-slot="' + s.id + '">' +
        '<div class="lb">' + s.label + '</div>' +
        '<input type="time" class="lv" data-f="time" data-slot="' + s.id + '" value="' + esc(s.time) + '">' +
        '<input type="number" class="dose-input lv" data-f="dose" data-slot="' + s.id + '" min="0" max="20" step="0.25" ' +
        'inputmode="decimal" value="' + (on ? s.dose : '') + '" placeholder="0">' +
        '<button class="tg" data-act="ed-slot" data-slot="' + s.id + '" aria-label="开关">' + (on ? '吃' : '停') + '</button>' +
        '</div>';
    });
    html += '</div>';
    html += '<div class="field" style="margin-top:-2px"><div class="help">片数可填 0.25 / 0.5 / 1 / 1.5 这样的分数，点右侧「吃/停」快速开关。留 0 或不填就是不吃。</div></div>';

    /* 库存 */
    html += '<div class="bar c-lilac">库存</div>';
    html += '<div class="row3">' +
      '<div class="field"><label>每盒片数</label><input type="number" data-f="pillsPerBox" min="0" step="1" inputmode="numeric" value="' + d.inventory.pillsPerBox + '"></div>' +
      '<div class="field"><label>整盒数</label><input type="number" data-f="boxes" min="0" step="1" inputmode="numeric" value="' + d.inventory.boxes + '"></div>' +
      '<div class="field"><label>散片</label><input type="number" data-f="loosePills" min="0" step="1" inputmode="numeric" value="' + d.inventory.loosePills + '"></div>' +
      '</div>';
    html += '<div class="field" style="margin-top:-2px"><div class="help">合计 <b style="color:var(--amber)">' +
      C.fmtPills(supply) + ' 片</b>。这里填「你手上现在有的总量」；以后补药回药品库点「＋1 盒」。</div></div>';

    /* 备注 */
    html += '<div class="field"><label>备注（可不填）</label>' +
      '<textarea data-f="note" maxlength="200" placeholder="例如：饭后吃、和碳酸锂间隔 2 小时">' + esc(d.note) + '</textarea></div>';

    /* 预览 */
    html += '<div class="preview" id="preview"></div>';
    html += '</div><div class="scr-foot">' +
      '<button class="btn ghost" data-act="ed-cancel">取消</button>' +
      '<button class="btn primary" data-act="ed-save">保存</button>' +
      '</div></div>';
    return html;
  }

  function updatePreview() {
    var el = $('#preview');
    if (!el || !ui.draft) return;
    var d = ui.draft;
    var daily = C.dailyUnits(d);
    var supply = C.supplyUnits(d);
    var p = C.projectEnd(d, C.today(), state.checkins);
    var lines = [];
    if (!d.name) lines.push('<span class="warn">还没有填药名</span>');
    lines.push('每天 <b>' + C.fmtPills(daily) + ' 片</b>' +
      (daily > 0 ? '（' + C.activeSlots(d).map(function (s) {
        return s.label + ' ' + C.fmtPills(C.slotDoseUnits(s));
      }).join(' + ') + '）' : ''));
    lines.push('库存 <b>' + C.fmtPills(supply) + ' 片</b>' +
      (d.inventory.pillsPerBox > 0 ? ' = ' + d.inventory.pillsPerBox + ' 片/盒 × ' + d.inventory.boxes + ' 盒' +
        (d.inventory.loosePills ? ' + ' + d.inventory.loosePills + ' 散片' : '') : ''));
    if (daily > 0 && supply > 0) {
      lines.push('预计 <b>' + fmtDateCN(p.lastDoseISO) + '</b> 吃完 · 还够 <b>' + p.daysLeft + ' 天</b>');
      if (p.shortfallUnits > 0) {
        lines.push('<span class="warn">最后一天会缺 ' + C.fmtPills(p.shortfallUnits) + ' 片</span>');
      }
    } else if (daily > 0) {
      lines.push('<span class="warn">库存为 0，请填每盒片数</span>');
    } else {
      lines.push('<span class="warn">至少给一个时段填片数</span>');
    }
    if (d.endDate) lines.push('医生指定 <b>' + fmtDateCN(d.endDate) + '</b> 停药');
    el.innerHTML = lines.join('<br>');
  }

  function syncDraft() {
    var d = ui.draft;
    if (!d) return;
    var root = $('.screen');
    if (!root) return;
    var g = function (f) { var el = root.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
    var n = function (f) { var v = parseFloat(g(f)); return isFinite(v) ? v : 0; };
    d.name = g('name').slice(0, 40);
    d.startDate = g('startDate') || d.startDate;
    d.endDate = g('endDate') || '';
    d.note = g('note').slice(0, 200);
    d.inventory.pillsPerBox = Math.max(0, Math.round(n('pillsPerBox')));
    d.inventory.boxes = Math.max(0, Math.round(n('boxes')));
    d.inventory.loosePills = Math.max(0, Math.round(n('loosePills')));
    d.slots.forEach(function (s) {
      var tEl = root.querySelector('[data-f="time"][data-slot="' + s.id + '"]');
      var dEl = root.querySelector('[data-f="dose"][data-slot="' + s.id + '"]');
      if (tEl && tEl.value) s.time = tEl.value;
      if (dEl) {
        var raw = String(dEl.value).trim();
        var v = raw === '' ? 0 : parseFloat(raw);
        if (!isFinite(v) || v < 0) v = 0;
        s.dose = Math.round(Math.min(20, v) * C.QS) / C.QS;
      }
    });
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      return true;
    } catch (e) {
      toast('导出失败：' + e.message, true);
      return false;
    }
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function exportJSON() {
    var payload = JSON.stringify({ app: 'LCARS-MedPad', version: VERSION, exportedAt: new Date().toISOString(), data: state }, null, 2);
    download('用药备份-' + stamp() + '.json', payload, 'application/json');
    toast('已导出备份文件');
  }

  function importJSON() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      try { if (inp.parentNode) inp.parentNode.removeChild(inp); } catch (e) { }
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(String(r.result));
          var data = obj && obj.data ? obj.data : obj;
          if (!data || !Array.isArray(data.meds)) throw new Error('文件格式不对');
          if (!confirm('导入会覆盖当前 ' + state.meds.length + ' 种药品和全部打卡记录，确定吗？')) return;
          state = normalize(data);
          save();
          render();
          toast('已导入 ' + state.meds.length + ' 种药品');
        } catch (e) {
          toast('导入失败：' + e.message, true);
        }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  function exportICS() {
    if (!state.meds.length) { toast('还没有药品', true); return; }
    var txt = C.buildICS(state.meds, C.today(), state.checkins, {});
    if (download('用药提醒-' + stamp() + '.ics', txt, 'text/calendar')) {
      toast('已导出，双击用日历打开');
    }
  }

  /* ---------------- 通知 ---------------- */
  function notifySupport() { return typeof window.Notification !== 'undefined'; }

  function tick() {
    waterTick();
    if (!state.settings.notifyOn || !notifySupport()) return;
    if (Notification.permission !== 'granted') return;
    var t = C.today(), now = C.nowHM(), fired = 0;
    state.settings.lastNotified = state.settings.lastNotified || {};
    /* 清理非今天的记录 */
    Object.keys(state.settings.lastNotified).forEach(function (k) {
      if (k.split('@')[1] !== t) delete state.settings.lastNotified[k];
    });
    state.meds.forEach(function (med) {
      if (!C.isDoseDay(med, t)) return;
      C.activeSlots(med).forEach(function (s) {
        if (C.getRec(state.checkins, med.id, t, s.id)) return;
        if (s.time > now) return;
        var k = C.ck(med.id, t, s.id);
        if (state.settings.lastNotified[k]) return;
        state.settings.lastNotified[k] = 1;
        fired++;
        try {
          new Notification('该吃药了 · ' + s.label, {
            body: med.name + ' ' + C.fmtPills(C.slotDoseUnits(s)) + ' 片（计划 ' + s.time + '）',
            tag: k,
            icon: 'icons/icon-192.png'
          });
        } catch (e) { /* ignore */ }
      });
    });
    if (fired) save();
  }

  /* ---------------- 补水 ---------------- */
  var WATER_DEFAULT = { targetMl: 1800, cupMl: 250, intervalMin: 60, startHM: '08:00', endHM: '22:00', on: true, sound: true };

  function waterCfg() {
    var w = (state.settings && state.settings.water) || {};
    return {
      targetMl: Math.min(6000, Math.max(200, Number(w.targetMl) || WATER_DEFAULT.targetMl)),
      cupMl: Math.min(1000, Math.max(50, Number(w.cupMl) || WATER_DEFAULT.cupMl)),
      intervalMin: Math.min(300, Math.max(10, Number(w.intervalMin) || WATER_DEFAULT.intervalMin)),
      startHM: /^\d{2}:\d{2}$/.test(w.startHM || '') ? w.startHM : WATER_DEFAULT.startHM,
      endHM: /^\d{2}:\d{2}$/.test(w.endHM || '') ? w.endHM : WATER_DEFAULT.endHM,
      on: w.on !== false,
      sound: w.sound !== false
    };
  }

  function waterDay(iso) { return (state.waterDays && state.waterDays[iso]) || []; }
  function waterTodayMl() { return C.waterMl(waterDay(C.today())); }
  function lastSipHM() { var d = waterDay(C.today()); return d.length ? d[d.length - 1].at : ''; }

  function addSip(ml) {
    var w = waterCfg();
    var v = Math.max(10, Math.min(2000, Math.round(Number(ml) || w.cupMl)));
    var t = C.today();
    if (!state.waterDays) state.waterDays = {};
    state.waterDays[t] = state.waterDays[t] || [];
    state.waterDays[t].push({ ml: v, at: C.nowHM() });
    ui.waterAck = '';
    save();
    var got = waterTodayMl();
    var hit = got >= w.targetMl && got - v < w.targetMl;
    toast(hit ? '✓ 达标了 · 今天 ' + got + ' ml' : '已喝 ' + v + ' ml · 今天 ' + got + ' / ' + w.targetMl + ' ml');
    if (hit && w.sound) chime();
    render();
  }

  function undoSip() {
    var t = C.today();
    var d = state.waterDays && state.waterDays[t];
    if (!d || !d.length) { toast('今天还没有喝水记录'); return; }
    var last = d.pop();
    save();
    toast('已撤销 ' + last.ml + ' ml');
    render();
  }

  function chime() {
    var a = audioCtx();
    if (!a) return;
    try {
      var t0 = a.currentTime;
      [880, 1180, 1480].forEach(function (f, i) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        var s0 = t0 + i * 0.13;
        g.gain.setValueAtTime(0, s0);
        g.gain.linearRampToValueAtTime(0.07, s0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, s0 + 0.32);
        o.connect(g); g.connect(a.destination);
        o.start(s0); o.stop(s0 + 0.36);
      });
    } catch (e) { /* 静默 */ }
  }

  function waterDueNow() {
    var w = waterCfg();
    if (!w.on) return null;
    var due = C.waterDue(w, lastSipHM(), C.nowHM());
    if (!due.due) return null;
    if (ui.waterAck && ui.waterAck === (lastSipHM() || 'start') + '@' + due.dueHM) return null;
    return due;
  }

  function drinkCallHTML() {
    var due = waterDueNow();
    if (!due) return '';
    var w = waterCfg();
    return '<div class="drink-call" role="status">' +
      '<div class="dc-ic" aria-hidden="true">💧</div>' +
      '<div class="dc-tx"><b>该喝水了</b>' +
      '<span>' + (due.sinceMin == null ? '今天还没喝' : '距上次喝水 ' + due.sinceMin + ' 分钟') +
      ' · 今天 ' + waterTodayMl() + ' / ' + w.targetMl + ' ml</span></div>' +
      '<button class="btn" data-act="sip" data-ml="' + w.cupMl + '">喝一杯</button>' +
      '<button class="btn ghost" data-act="drink-later">稍后</button></div>';
  }

  function waterTick() {
    var due = waterDueNow();
    var was = ui.drinkOn;
    ui.drinkOn = !!due;
    if (!due && !was) return;
    if (due && !was && waterCfg().sound) chime();
    ui.waterAck = ui.waterAck;
    if (!ui.draft && !ui.sheet && !ui.menu && !ui.trip && !ui.focus) render();
  }

  /* 3D 水仓：液位按比例填充 + 气泡 + 旋绕线圈 */
  function warpTankHTML(pct) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    var top = 38, bot = 206, hgt = bot - top;
    var lh = Math.round(hgt * p / 100);
    var ly = bot - lh;
    var bub = '';
    for (var i = 0; i < 7; i++) {
      var bx = 36 + ((i * 13 + 5) % 68);
      var by = bot - 10 - (i % 5) * 8;
      bub += '<circle class="bub b' + (i % 3) + '" cx="' + bx + '" cy="' + by + '" r="' + (1.5 + (i % 3) * 0.8).toFixed(1) +
        '" style="animation-delay:' + (i * 0.5).toFixed(2) + 's"/>';
    }
    var svg = '<svg class="tank" viewBox="0 0 140 232" role="img" aria-label="水仓液位 ' + p + '%">' +
      '<defs>' +
      '<linearGradient id="wfill" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#062738"/><stop offset=".26" stop-color="#1d7fb0"/>' +
      '<stop offset=".48" stop-color="#41c4f7"/><stop offset=".6" stop-color="#c8f3ff"/>' +
      '<stop offset=".82" stop-color="#2288ff"/><stop offset="1" stop-color="#062738"/>' +
      '</linearGradient>' +
      '<linearGradient id="wglass" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#e6f2ff" stop-opacity=".26"/><stop offset=".3" stop-color="#e6f2ff" stop-opacity="0"/>' +
      '<stop offset=".72" stop-color="#e6f2ff" stop-opacity="0"/><stop offset="1" stop-color="#e6f2ff" stop-opacity=".18"/>' +
      '</linearGradient>' +
      '<clipPath id="tube"><rect x="28" y="' + top + '" width="84" height="' + hgt + '" rx="16"/></clipPath>' +
      '</defs>' +
      '<rect class="tk-shell" x="18" y="28" width="104" height="188" rx="24"/>' +
      '<g clip-path="url(#tube)">' +
      '<rect class="tk-water" x="28" y="' + ly + '" width="84" height="' + lh + '"/>' +
      (p > 0 ? '<ellipse class="tk-surf" cx="70" cy="' + ly + '" rx="42" ry="5"/>' : '') +
      bub +
      '<rect x="28" y="' + top + '" width="84" height="' + hgt + '" fill="url(#wglass)"/>' +
      '</g>' +
      '<rect class="tk-rim" x="18" y="28" width="104" height="188" rx="24"/>' +
      '<circle class="coil" cx="70" cy="122" r="62"/>' +
      '<text class="tk-lab" x="70" y="224" text-anchor="middle">H2O RESERVOIR</text>' +
      '</svg>' +
      '<div class="tank-pct"><b>' + p + '</b><span>%</span></div>' +
      '<div class="tank-cap"><span>WARP COOLANT</span><span>' + (p >= 100 ? 'FULL' : p >= 60 ? 'NOMINAL' : p >= 30 ? 'LOW' : 'CRITICAL') + '</span></div>';
    return '<div class="tankwrap">' + svg + '</div>';
  }

  function waterWeekHTML(target) {
    var t = C.today(), out = '<div class="wweek">';
    for (var i = 6; i >= 0; i--) {
      var d = C.addDays(t, -i);
      var v = C.waterMl(waterDay(d));
      var pc = C.waterPct(v, target);
      out += '<div class="wk' + (i === 0 ? ' today' : '') + '">' +
        '<div class="wk-bar" style="--h:' + Math.max(3, pc) + '%"><i class="' + (pc >= 100 ? 'ok' : '') + '"></i></div>' +
        '<div class="wk-v">' + (v ? Math.round(v / 100) / 10 : '') + '</div>' +
        '<div class="wk-d">' + C.weekdayCN(d).replace('周', '') + '</div></div>';
    }
    return out + '</div>';
  }

  function chip(act, k, v, label, on) {
    return '<button class="chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-k="' + k + '" data-v="' + v + '">' + label + '</button>';
  }

  function viewWater() {
    var w = waterCfg(), t = C.today();
    var ml = waterTodayMl(), pct = C.waterPct(ml, w.targetMl);
    var left = Math.max(0, w.targetMl - ml);
    var due = waterDueNow();
    var streak = C.waterStreak(state.waterDays || {}, w.targetMl, t);
    var h = '';

    h += '<div class="wtop">' +
      '<div class="wtop-l"><div class="wlab">HYDRATION CONTROL</div>' +
      '<div class="wbig"><b>' + ml + '</b><span>/ ' + w.targetMl + ' ml</span></div>' +
      '<div class="wsub">' + (left > 0 ? '还差 <b>' + left + '</b> ml 才算达标' : '✓ 今天已达标') +
      ' · 连续 <b>' + streak + '</b> 天</div></div>' +
      '<div class="wring" style="--p:' + pct + '"><b>' + pct + '<small>%</small></b></div></div>';

    h += '<div class="panel tank-panel">' + warpTankHTML(pct) +
      '<div class="tank-read">' +
      '<div class="trow"><span>下次提醒</span><b>' + (w.on ? (due ? '现在' : (due ? due.dueHM : nextWaterHM())) : '已关闭') + '</b></div>' +
      '<div class="trow"><span>还差</span><b>' + left + ' ml</b></div>' +
      '<div class="trow"><span>每杯</span><b>' + w.cupMl + ' ml</b></div>' +
      '<div class="trow"><span>时段</span><b>' + w.startHM + '–' + w.endHM + '</b></div>' +
      '<div class="trow"><span>间隔</span><b>' + w.intervalMin + ' 分钟</b></div>' +
      '</div></div>';

    h += '<div class="sip-grid">' +
      [200, 300, 500, w.cupMl].filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) {
        return '<button class="btn sip" data-act="sip" data-ml="' + v + '">+' + v + ' ml</button>';
      }).join('') +
      '<button class="btn ghost sip" data-act="sip-custom">自定义</button>' +
      '<button class="btn ghost sip" data-act="sip-undo">撤销上一杯</button></div>';

    var log = waterDay(t);
    h += '<div class="bar2"><span>今天喝过</span><span>' + log.length + ' 次</span></div>';
    h += '<div class="panel sip-log">' + (log.length ? log.slice().reverse().map(function (x) {
      return '<div class="sip-row"><b>' + x.at + '</b><span>' + x.ml + ' ml</span></div>';
    }).join('') : '<div class="empty">还没有记录。喝一杯就点上面的按钮，或者等提醒弹出来。</div>') + '</div>';

    h += '<div class="bar2"><span>近 7 天</span><span>单位：百 ml</span></div>';
    h += '<div class="panel wweek-panel">' + waterWeekHTML(w.targetMl) + '</div>';

    h += '<div class="bar2"><span>提醒设置</span><span>' + (w.on ? '已开启' : '已关闭') + '</span></div>';
    h += '<div class="panel wset">';
    h += '<div class="wset-row"><span>每日目标</span><div>' +
      [1500, 1800, 2000, 2500].map(function (v) { return chip('water-set', 'targetMl', v, v + ' ml', w.targetMl === v); }).join('') + '</div></div>';
    h += '<div class="wset-row"><span>每杯容量</span><div>' +
      [200, 250, 300, 500].map(function (v) { return chip('water-set', 'cupMl', v, v + ' ml', w.cupMl === v); }).join('') + '</div></div>';
    h += '<div class="wset-row"><span>提醒间隔</span><div>' +
      [30, 45, 60, 90, 120].map(function (v) { return chip('water-set', 'intervalMin', v, v + ' 分', w.intervalMin === v); }).join('') + '</div></div>';
    h += '<div class="wset-row"><span>提醒时段</span><div>' +
      [['08:00', '22:00', '8–22'], ['09:00', '21:00', '9–21'], ['07:00', '23:00', '7–23']].map(function (v) {
        return chip('water-set', 'window', v[0] + '|' + v[1], v[2],
          w.startHM === v[0] && w.endHM === v[1]);
      }).join('') + '</div></div>';
    h += '<button class="btn" data-act="water-toggle">' + (w.on ? '关闭喝水提醒' : '开启喝水提醒') + '</button> ';
    h += '<button class="btn ghost" data-act="water-sound">' + (w.sound ? '提示音：开' : '提示音：关') + '</button>';
    h += '<div class="help">提醒只在本页开着、或切到后台还没被系统回收时生效——网页通知做不到「关掉浏览器也响」。' +
      '想要系统级闹钟，请在手机「时钟 → 闹钟」设几个固定时间（例如 9:00 / 11:00 / 15:00 / 20:00），或用系统自带的健康 App。' +
      '这里负责的是记录与液位，让你一眼看见今天够不够。</div>';
    h += '</div>';

    h += '<div class="panel wset"><div class="bar2"><span>短视频刹车</span><span>今日拦下 ' + focusDay(t).ok + ' 次</span></div>' +
      '<button class="btn" data-act="focus-open">打开刹车舱</button>' +
      '<div class="help">想刷之前先按一下，给你 30 秒缓冲。它拦不住 App 本身，但能把「无意识点开」变成「有意识选择」。</div></div>';

    return h;
  }

  function nextWaterHM() {
    var w = waterCfg();
    var due = C.waterDue(w, lastSipHM(), C.nowHM());
    return due.dueHM || w.startHM;
  }

  /* ---------------- 短视频刹车（专注舱） ---------------- */
  var SAVED_MIN = 10;
  var coolTimer = null;

  function focusDay(iso) {
    return (state.focusDays && state.focusDays[iso]) || { ok: 0, gave: 0 };
  }

  function bumpFocus(kind) {
    var t = C.today();
    if (!state.focusDays) state.focusDays = {};
    var d = state.focusDays[t] || { ok: 0, gave: 0 };
    d[kind] = (Number(d[kind]) || 0) + 1;
    state.focusDays[t] = d;
    save();
  }

  function stopCool() {
    if (coolTimer) { clearInterval(coolTimer); coolTimer = null; }
  }

  function startCool() {
    stopCool();
    ui.focus = 'cool';
    ui.cool = 30;
    renderLayer();
    coolTimer = setInterval(function () {
      if (ui.focus !== 'cool') { stopCool(); return; }
      ui.cool = Math.max(0, ui.cool - 1);
      if (ui.cool <= 0) { stopCool(); ui.focus = 'after'; }
      renderLayer();
    }, 1000);
  }

  function focusHTML() {
    var t = C.today(), d = focusDay(t);
    var mode = ui.focus || 'home';
    var saved = d.ok * SAVED_MIN;
    var h = '<div class="screen focus" role="dialog" aria-modal="true" aria-label="短视频刹车舱">';
    h += '<div class="scr-head"><button class="btn ghost" data-act="focus-close">← 返回</button>' +
      '<div class="t">专注舱 · FOCUS</div></div><div class="scr-body">';

    h += '<div class="fstats">' +
      '<div class="fstat"><b>' + d.ok + '</b><span>今天拦下的次数</span></div>' +
      '<div class="fstat"><b>' + saved + '</b><span>估计省下的分钟</span></div>' +
      '<div class="fstat"><b>' + d.gave + '</b><span>今天还是去刷了</span></div></div>';

    if (mode === 'cool') {
      var p = Math.round((30 - ui.cool) / 30 * 100);
      h += '<div class="fcooldown"><div class="fc-ring" style="--p:' + p + '"><b>' + ui.cool + '</b><span>秒</span></div>' +
        '<div class="fc-tx"><b>先停 30 秒</b>' +
        '<p>这 30 秒只做三件小事，做完再决定要不要刷：</p>' +
        '<ol><li>先去倒一杯水，喝掉半杯</li><li>站起来走动一下，把手机放下来 30 秒</li><li>看一眼窗外或屋子最远的角落，让眼睛离开屏幕</li></ol>' +
        '<p class="dim">短视频不是坏东西，但它会偷走你本来要休息的时间。等这 30 秒过去，你还是想去刷——那就去，没人拦你。</p></div></div>';
      if (ui.cool <= 0) {
        h += '<div class="fbtns"><button class="btn ghost" data-act="focus-resist">算了，不刷了 · 记一次拦下</button>' +
          '<button class="btn" data-act="focus-give">还是想去刷</button></div>';
      } else {
        h += '<div class="fbtns"><button class="btn ghost" data-act="focus-resist">算了，不刷了</button></div>';
      }
    } else if (mode === 'after') {
      h += '<div class="panel fafter"><div class="fa-t">这次你自己决定</div>' +
        '<p>如果刚才没刷，顺手喝一杯水，把这段时间记成"拦下 1 次"。</p>' +
        '<div class="fbtns"><button class="btn ghost" data-act="focus-resist">拦下了 · 记 1 次</button>' +
        '<button class="btn ghost" data-act="focus-give">还是刷了 · 记 1 次</button></div></div>';
    } else {
      h += '<div class="fhero"><div class="fh-ic" aria-hidden="true">🛑</div>' +
        '<div class="fh-t">想刷短视频了？</div>' +
        '<p>先按一下，给你 30 秒。不用意志力硬扛，只要延迟 30 秒，冲动通常会掉一半。</p></div>' +
        '<button class="btn fbig" data-act="focus-urge">我有点想刷 · 给我 30 秒</button>';
    }

    /* 近 7 天 */
    h += '<div class="bar2"><span>近 7 天</span><span>灰=去刷 · 蓝=拦下</span></div><div class="fweek">';
    for (var i = 6; i >= 0; i--) {
      var dd = C.addDays(t, -i);
      var f = focusDay(dd);
      h += '<div class="fw' + (i === 0 ? ' today' : '') + '"><div class="fw-bars">' +
        '<i class="ok" style="--h:' + Math.min(100, f.ok * 25) + '%"></i>' +
        '<i class="gave" style="--h:' + Math.min(100, f.gave * 25) + '%"></i></div>' +
        '<div class="fw-d">' + C.weekdayCN(dd).replace('周', '') + '</div></div>';
    }
    h += '</div>';

    h += '<div class="panel fhelp"><div class="fh-t2">真正能拦住的是系统，不是网页</div>' +
      '<p>这是一个网页 App，没有权限去关掉抖音、快手。能真正拦住的办法要用手机自带的功能，' +
      '一次设置好就不用再管：</p>' +
      '<ol>' +
      '<li>打开「设置」→「数字健康与家长控制」→「应用限时」，给抖音/快手设 <b>每天 20 分钟</b>。</li>' +
      '<li>同一页面开「专注模式」，把它加进快捷开关；想专心时下拉通知栏一键开启，被限时的 App 会变灰。</li>' +
      '<li>抖音里还有「设置 → 使用管理助手 → 时间锁」，设 15 分钟，到点会直接弹窗挡住。</li>' +
      '</ol>' +
      '<p class="dim">提示：不同品牌手机叫法略有不同（小米「屏幕时间管理」、华为「健康使用手机」、三星「数字健康」）。' +
      '这个页面负责记录你今天拦下几次、省下多少分钟，让你看得见进展。</p></div>';

    h += '</div></div>';
    return h;
  }

  /* ---------------- 照片存证（IndexedDB + 当天环形缓冲） ----------------
   * 目的：打卡时拍一张，过一会儿忘了到底吃没吃，就能翻出来看一眼。
   * 只保留「今天」的照片：换天自动清空；同一天最多 PHOTO_KEEP 张，超出按时间丢最旧的。 */
  var PHOTO_DB = 'medpad_photos', PHOTO_VER = 1, PHOTO_KEEP = 24;
  var photoIndex = {}, photoDbP = null, photoUrlCur = null;

  function photoOk() { try { return !!window.indexedDB; } catch (e) { return false; } }

  function photoOpen() {
    if (!photoOk()) return Promise.reject(new Error('no-idb'));
    if (photoDbP) return photoDbP;
    photoDbP = new Promise(function (res, rej) {
      var r;
      try { r = indexedDB.open(PHOTO_DB, PHOTO_VER); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blob')) db.createObjectStore('blob', { keyPath: 'id' });
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('idb')); };
      r.onblocked = function () { rej(new Error('idb-blocked')); };
    });
    return photoDbP;
  }

  /* fn 里返回的对象会在事务完成后带出结果 */
  function photoRun(stores, mode, fn) {
    return photoOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t, out;
        try { t = db.transaction(stores, mode); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error || new Error('idb')); };
        t.onabort = function () { rej(t.error || new Error('idb-abort')); };
        try { out = fn(t); } catch (e) { rej(e); }
      });
    });
  }

  function photoKey(medId, dateISO, slotId) { return medId + '@' + dateISO + '@' + slotId; }

  function photoLoad() {
    photoIndex = {};
    if (!photoOk()) return Promise.resolve();
    return photoRun(['meta'], 'readonly', function (t) {
      var req = t.objectStore('meta').getAll();
      req.onsuccess = function () {
        (req.result || []).forEach(function (m) { photoIndex[m.id] = m; });
      };
    }).catch(function () { });
  }

  /* 换天清空：所有 date !== 今天的都删掉（meta + blob 一起删） */
  function photoPurge() {
    if (!photoOk()) return Promise.resolve();
    var todayISO = C.today();
    return photoRun(['meta', 'blob'], 'readwrite', function (t) {
      var ms = t.objectStore('meta'), bs = t.objectStore('blob');
      var req = ms.getAll();
      req.onsuccess = function () {
        (req.result || []).forEach(function (m) {
          if (m.date !== todayISO) { ms.delete(m.id); bs.delete(m.id); }
        });
      };
    }).then(photoLoad).catch(function () { });
  }

  /* 同一天超过 PHOTO_KEEP 张就丢最旧的 */
  function photoTrim() {
    var todayISO = C.today(), list = [];
    Object.keys(photoIndex).forEach(function (k) {
      if (photoIndex[k].date === todayISO) list.push(photoIndex[k]);
    });
    if (list.length <= PHOTO_KEEP) return Promise.resolve();
    list.sort(function (a, b) { return a.ts - b.ts; });
    var drop = list.slice(0, list.length - PHOTO_KEEP);
    return photoRun(['meta', 'blob'], 'readwrite', function (t) {
      drop.forEach(function (m) {
        t.objectStore('meta').delete(m.id);
        t.objectStore('blob').delete(m.id);
      });
    });
  }

  /* 缩到最长边 720px 的 JPEG，一张约 40–80KB，不会把手机塞满 */
  function photoShrink(file, label) {
    return new Promise(function (res) {
      var url = null;
      try { url = URL.createObjectURL(file); } catch (e) { res(file); return; }
      var img = new Image();
      var done = function (b) { try { URL.revokeObjectURL(url); } catch (e) { } res(b || file); };
      img.onload = function () {
        try {
          var max = 720;
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var s = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          /* 把药名/剂量/时间烧进照片：以后翻出来看就知道是哪一次、几点拍的 */
          try {
            if (label) {
              var fs2 = Math.max(11, Math.round(cw / 24));
              ctx.font = '700 ' + fs2 + 'px system-ui,-apple-system,"Microsoft YaHei",sans-serif';
              var pad2 = Math.round(fs2 * 0.55);
              var bh = fs2 + pad2 * 2;
              ctx.fillStyle = 'rgba(0,0,0,.64)';
              ctx.fillRect(0, ch - bh, cw, bh);
              ctx.fillStyle = '#FFCC66';
              ctx.textBaseline = 'middle';
              ctx.fillText(label, pad2, ch - bh / 2, cw - pad2 * 2);
            }
          } catch (e9) { }
          if (cv.toBlob) cv.toBlob(done, 'image/jpeg', 0.72);
          else done(file);
        } catch (e) { done(file); }
      };
      img.onerror = function () { done(file); };
      img.src = url;
    });
  }

  function photoSave(pk, medId, dateISO, slotId, file, label) {
    return photoShrink(file, label).then(function (blob) {
      return photoRun(['meta', 'blob'], 'readwrite', function (t) {
        t.objectStore('blob').put({ id: pk, data: blob });
        t.objectStore('meta').put({
          id: pk, date: dateISO, ts: Date.now(), medId: medId, slotId: slotId,
          size: (blob && blob.size) || 0
        });
      });
    }).then(photoLoad).then(photoTrim).then(photoLoad);
  }

  function photoDelete(pk) {
    return photoRun(['meta', 'blob'], 'readwrite', function (t) {
      t.objectStore('meta').delete(pk);
      t.objectStore('blob').delete(pk);
    }).then(photoLoad);
  }

  function photoGetUrl(pk) {
    if (!photoOk()) return Promise.resolve('');
    return photoRun(['blob'], 'readonly', function (t) {
      var box = {};
      var req = t.objectStore('blob').get(pk);
      req.onsuccess = function () { box.v = req.result ? req.result.data : null; };
      return box;
    }).then(function (box) {
      if (!box || !box.v) return '';
      try { return URL.createObjectURL(box.v); } catch (e) { return ''; }
    }).catch(function () { return ''; });
  }

  function dropPhotoUrl() {
    if (photoUrlCur) { try { URL.revokeObjectURL(photoUrlCur); } catch (e) { } photoUrlCur = null; }
  }

  function hmOfTs(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function photoHTML() {
    var k = ui.photo && ui.photo.k;
    var m = k ? photoIndex[k] : null;
    var h = '<div class="mask" data-act="photo-close"><div class="pview" data-stop="1">' +
      '<div class="pview-head"><b>打卡照片</b><span>' + (m ? hmOfTs(m.ts) + ' · ' + (m.date || '') : '') + '</span></div>' +
      '<div class="pview-body">' + (ui.photo && ui.photo.url
        ? '<img src="' + ui.photo.url + '" alt="打卡照片" />'
        : '<div class="pview-none">照片读不出来了，可能已被系统清理。</div>') + '</div>' +
      '<div class="pview-foot">' +
      '<button class="btn ghost" data-act="photo-close">关闭</button>' +
      (k ? '<button class="btn ghost" data-act="photo-del" data-k="' + esc(k) + '" style="color:var(--red)">删除这张</button>' : '') +
      '</div></div></div>';
    return h;
  }

  function photoPick(cap, onFile, onCancel) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (cap) inp.setAttribute('capture', 'environment');
    inp.style.position = 'fixed';
    inp.style.left = '-9999px';
    var settled = false;
    inp.onchange = function () {
      settled = true;
      var f = inp.files && inp.files[0];
      try { if (inp.parentNode) inp.parentNode.removeChild(inp); } catch (e) { }
      if (!f) { if (onCancel) onCancel(); return; }
      if (onFile) { onFile(f); return; }
      if (ui.sheet && ui.sheet.type === 'dose') {
        photoAttach(ui.sheet.medId, ui.sheet.date, ui.sheet.slotId, f);
      }
    };
    document.body.appendChild(inp);
    inp.click();
    /* 有些浏览器取消选图不会触发 onchange：靠页面重新可见来兜底 */
    var onBack = function () {
      if (settled) return;
      settled = true;
      setTimeout(function () { if (onCancel) onCancel(); }, 500);
    };
    try {
      window.addEventListener('focus', function h() {
        window.removeEventListener('focus', h);
        onBack();
      });
    } catch (e2) { }
  }

  var thumbUrlCur = null;
  function attachThumb() {
    var img = document.getElementById('photoThumb');
    if (!img || !ui.sheet || ui.sheet.type !== 'dose') return;
    var pk = photoKey(ui.sheet.medId, ui.sheet.date, ui.sheet.slotId);
    if (!photoIndex[pk]) return;
    photoGetUrl(pk).then(function (u) {
      var el = document.getElementById('photoThumb');
      if (!el || !u) return;
      if (thumbUrlCur) { try { URL.revokeObjectURL(thumbUrlCur); } catch (e) { } }
      thumbUrlCur = u;
      el.src = u;
      el.setAttribute('data-act', 'photo-view');
      el.setAttribute('data-k', pk);
    }).catch(function () { });
  }

  function photoAttach(medId, dateISO, slotId, file, label, after) {
    var pk = photoKey(medId, dateISO, slotId);
    toast('正在保存照片…');
    photoSave(pk, medId, dateISO, slotId, file, label).then(function () {
      if (after) after();
      toast('照片已存好（只保留今天）');
      render();
    }).catch(function () {
      toast('照片保存失败：这台浏览器不允许，或空间不足');
    });
  }

  /* 强制拍照模式：没照片就先拍，拍完再执行 fn */
  function needPhoto() { return state.settings.photoRequired !== false; }
  function doseLabel(med, slot, dateISO) {
    return (med.name || '未命名') + ' · ' + slot.label + ' ' + C.fmtPills(C.slotDoseUnits(slot)) + ' 片 · ' +
      (dateISO === C.today() ? '今天 ' : fmtDateCN(dateISO) + ' ') + hm(slot.time);
  }
  function guardPhoto(med, slot, dateISO, fn) {
    if (!needPhoto() || dateISO !== C.today()) { fn(); return; }
    var pk = photoKey(med.id, dateISO, slot.id);
    if (photoIndex[pk]) { fn(); return; }
    if (!photoOk()) { fn(); return; } /* 浏览器存不了照片时不能把人卡死 */
    photoPick(true, function (file) {
      photoAttach(med.id, dateISO, slot.id, file, doseLabel(med, slot, dateISO), fn);
    }, function () {
      toast('没有照片就不算打卡（可在设置里关掉“打卡必须拍照”）', true);
    });
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    var act = t.getAttribute('data-act');
    var ds = t.dataset;

    /* 点击遮罩关闭（但点 sheet 内部不关） */
    if (act === 'sheet-close') {
      if (e.target !== t) return;
      closeLayer();
      return;
    }
    if (t.dataset.stop) return;

    switch (act) {
      case 'photo-take':
        photoPick(ds.cap === '1');
        break;
      case 'author-save': {
        var ai = document.querySelector('[data-f="author"]');
        var av = ai ? String(ai.value || '').trim().slice(0, 40) : '';
        state.settings.author = av;
        save(); render();
        toast(av ? ('署名已保存：' + av) : '已清空署名（会显示占位符）');
        break;
      }
      case 'photo-required':
        state.settings.photoRequired = !(state.settings.photoRequired !== false);
        save(); render();
        toast(state.settings.photoRequired ? '已开启：打卡必须拍照' : '已关闭：可以直接打卡');
        break;
      case 'photo-view':
        photoGetUrl(ds.k).then(function (u) {
          dropPhotoUrl();
          photoUrlCur = u;
          ui.photo = { k: ds.k, url: u };
          renderLayer();
        });
        break;
      case 'photo-del': {
        if (!window.confirm('删掉这张打卡照片？')) break;
        photoDelete(ds.k).then(function () {
          if (ui.photo) { dropPhotoUrl(); ui.photo = null; }
          toast('照片已删除');
          render();
        });
        break;
      }
      case 'photo-close':
        if (e.target !== t) return; /* 点内容不关 */
        dropPhotoUrl();
        ui.photo = null;
        renderLayer();
        break;
      case 'tab':
        ui.tab = ds.tab;
        ui.sheet = null;
        window.scrollTo(0, 0);
        render();
        break;
      case 'med-new':
        openEditor(null);
        break;
      case 'med-open':
        openEditor(medById(ds.id));
        break;
      case 'quick': {
        var med = medById(ds.med);
        if (!med) break;
        var slot = slotOf(med, ds.slot);
        if (!slot) break;
        var cur = C.getRec(state.checkins, med.id, C.today(), slot.id);
        if (cur && cur.status === 'taken') {
          setDose(med.id, C.today(), slot.id, null);
        } else {
          guardPhoto(med, slot, C.today(), function () {
            setDose(med.id, C.today(), slot.id, 'taken');
            toast('已打卡 · ' + slot.label + ' ' + C.fmtPills(C.slotDoseUnits(slot)) + ' 片');
          });
        }
        break;
      }
      case 'dose-sheet':
        ui.sheet = { type: 'dose', medId: ds.med, slotId: ds.slot, date: C.today() };
        renderLayer();
        break;
      case 'day-sheet':
        ui.sheet = { type: 'day', date: ds.date };
        renderLayer();
        break;
      case 'set': {
        var st = ds.status || null;
        var m2 = medById(ds.med);
        var sl2 = m2 ? slotOf(m2, ds.slot) : null;
        var amt;
        if (st === 'partial' && sl2) amt = C.toPills(C.slotDoseUnits(sl2)) / 2;
        var applySet = function () {
          setDose(ds.med, ds.date, ds.slot, st, amt);
          /* 保留弹层，刷新其内容 */
          if (ui.sheet && ui.sheet.type === 'dose') {
            var r = C.getRec(state.checkins, ds.med, ds.date, ds.slot);
            if (!r) ui.sheet = null;
          }
          renderLayer();
          if (st) toast('已记录：' + statusCN(st));
        };
        if (m2 && sl2 && (st === 'taken' || st === 'partial' || st === 'extra')) {
          guardPhoto(m2, sl2, ds.date, applySet);
        } else {
          applySet();
        }
        break;
      }
      case 'addbox': {
        var m3 = medById(ds.id);
        if (!m3) break;
        var pb = Number(m3.inventory.pillsPerBox) || 0;
        if (!pb) { toast('先填每盒片数', true); break; }
        m3.inventory.boxes = (Number(m3.inventory.boxes) || 0) + 1;
        m3.updatedAt = new Date().toISOString();
        cache.proj = null;
        save(); render();
        toast('已补 1 盒（+' + pb + ' 片）');
        break;
      }
      case 'ed-cancel':
        ui.draft = null;
        renderLayer();
        break;
      case 'ed-del': {
        if (!confirm('删除「' + (ui.draft.name || '未命名') + '」以及它的全部打卡记录？')) break;
        var id = ui.draft.id;
        state.meds = state.meds.filter(function (m) { return m.id !== id; });
        Object.keys(state.checkins).forEach(function (k) {
          if (k.indexOf(id + '@') === 0) delete state.checkins[k];
        });
        ui.draft = null;
        cache.proj = null;
        save(); render();
        toast('已删除');
        break;
      }
      case 'ed-icon':
        syncDraft();
        ui.draft.icon = ds.v;
        renderLayer();
        break;
      case 'ed-color':
        syncDraft();
        ui.draft.color = ds.v;
        renderLayer();
        break;
      case 'ed-slot': {
        syncDraft();
        var s3 = ui.draft.slots.filter(function (x) { return x.id === ds.slot; })[0];
        if (s3) s3.dose = C.slotDoseUnits(s3) > 0 ? 0 : 1;
        renderLayer();
        break;
      }
      case 'ed-save': {
        syncDraft();
        var d = ui.draft;
        if (!String(d.name || '').trim()) { toast('请先填药品名称', true); break; }
        if (C.dailyUnits(d) <= 0) { toast('至少给一个时段填片数', true); break; }
        d.name = String(d.name).trim();
        d.updatedAt = new Date().toISOString();
        var idx = -1;
        for (var i = 0; i < state.meds.length; i++) if (state.meds[i].id === d.id) idx = i;
        var norm = C.normalizeMed(d);
        if (idx >= 0) state.meds[idx] = norm; else state.meds.push(norm);
        ui.draft = null;
        cache.proj = null;
        save(); render();
        toast(idx >= 0 ? '已保存' : '已添加');
        break;
      }
      case 'menu-open':
        ui.menu = true;
        renderLayer();
        break;
      case 'menu-close':
        ui.menu = false;
        renderLayer();
        break;
      case 'menu-go':
        ui.menu = false;
        ui.sheet = null;
        ui.tab = ds.tab;
        window.scrollTo(0, 0);
        render();
        break;
      case 'sip':
        addSip(Number(ds.ml) || waterCfg().cupMl);
        break;
      case 'sip-custom': {
        var adv = 0;
        try { adv = Number(window.prompt('这次喝了多少 ml？', String(waterCfg().cupMl))) || 0; } catch (e) { adv = 0; }
        if (adv > 0) addSip(adv);
        break;
      }
      case 'sip-undo':
        undoSip();
        break;
      case 'drink-later':
        ui.waterAck = (lastSipHM() || 'start') + '@' + (waterDueNow() ? waterDueNow().dueHM : '');
        ui.drinkOn = false;
        render();
        break;
      case 'water-toggle':
        state.settings.water.on = !waterCfg().on;
        save();
        render();
        toast(waterCfg().on ? '喝水提醒已开启' : '喝水提醒已关闭');
        break;
      case 'water-sound':
        state.settings.water.sound = !waterCfg().sound;
        save();
        if (waterCfg().sound) chime();
        render();
        break;
      case 'water-set': {
        var wk = ds.k, wv = ds.v;
        var cfg = state.settings.water || {};
        if (wk === 'window') {
          var pair = String(wv).split('|');
          cfg.startHM = pair[0] || '08:00';
          cfg.endHM = pair[1] || '22:00';
        } else if (wk === 'targetMl' || wk === 'cupMl' || wk === 'intervalMin') {
          cfg[wk] = Number(wv) || cfg[wk];
        }
        state.settings.water = cfg;
        ui.waterAck = '';
        save();
        render();
        break;
      }
      case 'focus-open':
        ui.menu = false;
        ui.sheet = null;
        ui.focus = 'home';
        renderLayer();
        break;
      case 'focus-close':
        stopCool();
        ui.focus = null;
        render();
        break;
      case 'focus-urge':
        startCool();
        break;
      case 'focus-resist':
        stopCool();
        bumpFocus('ok');
        ui.focus = 'home';
        renderLayer();
        toast('拦下 1 次 · 今天省下 ' + (focusDay(C.today()).ok * SAVED_MIN) + ' 分钟');
        break;
      case 'focus-give':
        stopCool();
        bumpFocus('gave');
        ui.focus = 'home';
        renderLayer();
        toast('记下了。休息也是需要的，别怪自己。');
        break;
      case 'trip-open':
        ui.menu = false;
        ui.sheet = null;
        ui.trip = tripRange();
        saveTrip(ui.trip);
        renderLayer();
        break;
      case 'trip-close':
        ui.trip = null;
        render();
        break;
      case 'trip-range': {
        var dd = Math.max(1, Math.min(120, Number(ds.days) || 3));
        var t0 = C.today();
        ui.trip = { from: t0, to: C.addDays(t0, dd - 1) };
        saveTrip(ui.trip);
        renderLayer();
        break;
      }
      case 'extra-step': {
        if (!ui.sheet || ui.sheet.type !== 'dose') break;
        var med4 = medById(ui.sheet.medId);
        var sl4 = med4 ? slotOf(med4, ui.sheet.slotId) : null;
        if (!sl4) break;
        var plan4 = C.toPills(C.slotDoseUnits(sl4));
        if (ds.step === 'reset') {
          ui.sheet.extra = plan4;
        } else {
          var step = Number(ds.step) || 0;
          var cur4 = Number(ui.sheet.extra);
          if (!isFinite(cur4)) cur4 = plan4;
          ui.sheet.extra = Math.max(0, Math.min(plan4 + 20, cur4 + step));
        }
        renderLayer();
        break;
      }
      case 'set-extra': {
        var sh4 = ui.sheet;
        if (!sh4 || sh4.type !== 'dose') break;
        var m5 = medById(sh4.medId);
        var s5 = m5 ? slotOf(m5, sh4.slotId) : null;
        if (!m5 || !s5) break;
        var plan5 = C.toPills(C.slotDoseUnits(s5));
        var amt5 = Number(sh4.extra);
        if (!isFinite(amt5) || amt5 < 0) amt5 = plan5;
        amt5 = Math.round(amt5 * 4) / 4;
        var st5 = amt5 > plan5 ? 'extra' : (amt5 === plan5 ? 'taken' : (amt5 === 0 ? 'skipped' : 'partial'));
        var applyX = function () {
          setDose(m5.id, sh4.date, s5.id, st5, amt5);
          renderLayer();
          if (st5 === 'extra') {
            toast('已记录超量：实吃 ' + C.fmtPills(C.toUnits(amt5)) + ' 片，比计划多 ' +
              C.fmtPills(C.toUnits(amt5 - plan5)) + ' 片');
          } else {
            toast('已记录：实吃 ' + C.fmtPills(C.toUnits(amt5)) + ' 片');
          }
        };
        if (st5 === 'skipped') applyX(); else guardPhoto(m5, s5, sh4.date, applyX);
        break;
      }
      case 'day-extra':
        ui.sheet = { type: 'dose', medId: ds.med, slotId: ds.slot, date: ds.date };
        renderLayer();
        break;
      case 'ship-save': {
        var g = function (k) {
          var el = document.querySelector('[data-f="' + k + '"]');
          return el ? String(el.value || '') : '';
        };
        var nm = g('ship-name').trim().slice(0, 18) || SHIP_DEFAULT.name;
        var cl = g('ship-cls').trim().slice(0, 18) || SHIP_DEFAULT.cls;
        var nc = g('ship-ncc').replace(/[^0-9A-Za-z-]/g, '').toUpperCase().slice(0, 10) || SHIP_DEFAULT.ncc;
        state.settings.ship = { name: nm, cls: cl, ncc: nc };
        save(); render();
        toast('舰籍已更新 · NCC-' + nc);
        break;
      }
      case 'alert-toggle':
        state.settings.alertOn = !state.settings.alertOn;
        save(); render();
        toast(state.settings.alertOn ? '红色警报已开启' : '红色警报已关闭');
        break;
      case 'alert-sound-toggle':
        state.settings.alertSound = !state.settings.alertSound;
        save(); render();
        if (state.settings.alertSound) {
          klaxon(true); /* 立刻试响一声，确认真能听到 */
          toast('红警音已开启，刚响的就是它');
        } else {
          toast('红警音已关闭');
        }
        break;
      case 'alert-ack':
        ackAlerts(pendingAlerts().map(function (i) { return i.key; }));
        render();
        toast('已收起红警提示（今天内不再弹）');
        break;
      case 'alert-unack':
        clearAck();
        render();
        toast('红警提示已重新显示');
        break;
      case 'restore-bak': {
        var bak = null;
        try { bak = localStorage.getItem(BAK); } catch (e) { /* ignore */ }
        if (!bak) { toast('没有找到上一版本的备份', true); break; }
        if (!confirm('用升级前的备份覆盖当前数据？当前数据会先导出成文件供你留底。')) break;
        exportJSON();
        try {
          localStorage.setItem(KEY, bak);
          localStorage.removeItem(BAK);
        } catch (e2) { toast('恢复失败：存储写入被拒绝', true); break; }
        state = load();
        cache.proj = null;
        save(); render();
        toast('已恢复到升级前的数据');
        break;
      }
      case 'warn-days':
        state.settings.refillWarnDays = Number(ds.v) || 7;
        cache.proj = null;
        save(); render();
        break;
      case 'notify-on':
        if (!notifySupport()) { toast('浏览器不支持通知', true); break; }
        Notification.requestPermission().then(function (p) {
          if (p === 'granted') {
            state.settings.notifyOn = true;
            save();
            toast('通知已开启');
            tick();
          } else {
            toast('没有获得通知权限', true);
          }
          render();
        });
        break;
      case 'notify-toggle':
        state.settings.notifyOn = !state.settings.notifyOn;
        save(); render();
        if (state.settings.notifyOn) tick();
        break;
      case 'exp-json':
        exportJSON();
        break;
      case 'imp-json':
        importJSON();
        break;
      case 'exp-ics':
        exportICS();
        break;
      case 'wipe':
        if (!confirm('清空全部药品和打卡记录？此操作不可撤销，建议先导出备份。')) break;
        if (!confirm('真的确定要清空吗？')) break;
        state = blankState();
        save(); render();
        toast('已清空');
        break;
    }
  });

  /* 输入：只更新预览，不重绘（避免丢焦点） */
  document.addEventListener('input', function (e) {
    if (!ui.draft) return;
    var el = e.target;
    if (!el || !el.getAttribute) return;
    if (el.getAttribute('data-f')) {
      syncDraft();
      updatePreview();
    }
  });
  document.addEventListener('change', function (e) {
    var el0 = e.target;
    var f0 = el0 && el0.getAttribute ? el0.getAttribute('data-f') : '';
    /* 出行计算：出发/回来日期变了就重算（不改药品数据） */
    if (ui.trip && (f0 === 'trip-from' || f0 === 'trip-to')) {
      var v = String(el0.value || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      ui.trip = { from: ui.trip.from, to: ui.trip.to };
      if (f0 === 'trip-from') ui.trip.from = v; else ui.trip.to = v;
      if (ui.trip.to < ui.trip.from) ui.trip.to = ui.trip.from;
      saveTrip(ui.trip);
      renderLayer();
      return;
    }
    if (!ui.draft) return;
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-f')) {
      syncDraft();
      updatePreview();
    }
  });

  /* ---------------- 启动 ---------------- */
  state = load();
  /* 照片环形缓冲：先把不是今天的照片清掉，再回填索引 */
  photoPurge().then(function () { if (Object.keys(photoIndex).length) render(); });
  /* 调试/截图用：?menu=1 直接展开主菜单；?tab=log 直接进某个标签页 */
  try {
    var qs = String(location.search || '');
    var mt = qs.match(/[?&]tab=(today|water|meds|log|settings)/);
    if (mt) ui.tab = mt[1];
    if (qs.indexOf('menu=1') > -1) ui.menu = true;
    if (qs.indexOf('focus=1') > -1) ui.focus = 'home';
    /* ?dose=1 直接打开第一种药当前待打卡的面板（截图/排查用） */
    if (qs.indexOf('dose=1') > -1) {
      var dd0 = todayDoses()[0];
      var mm0 = dd0 ? dd0.med : state.meds[0];
      var ss0 = dd0 ? dd0.s : (mm0 ? C.activeSlots(mm0)[0] : null);
      if (mm0 && ss0) ui.sheet = { type: 'dose', medId: mm0.id, slotId: ss0.id, date: C.today() };
    }
    var tr = qs.match(/[?&]trip=(\d{1,3})/);
    if (tr) {
      var tn = Math.max(1, Math.min(120, parseInt(tr[1], 10) || 7));
      ui.trip = { from: C.today(), to: C.addDays(C.today(), tn - 1) };
    }
  } catch (e) {}
  render();
  tick();
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      render();
      tick();
    }
  });

  if ('serviceWorker' in navigator) {
    var hadCtl = !!navigator.serviceWorker.controller;
    var swReloaded = false;
    try {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadCtl || swReloaded) return;
        swReloaded = true;
        window.location.reload();
      });
    } catch (e0) { /* 老浏览器忽略 */ }
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () { /* 忽略 */ });
    });
  }

  /* 供调试/导出使用 */
  window.__medpad = {
    get state() { return state; },
    core: C,
    render: render,
    setTab: function (t) { if (['today', 'water', 'meds', 'log', 'settings'].indexOf(t) >= 0) { ui.tab = t; render(); } },
    water: {
      add: addSip, undo: undoSip, cfg: waterCfg, today: waterTodayMl,
      day: function (iso) { return waterDay(iso || C.today()); },
      due: function () { return C.waterDue(waterCfg(), lastSipHM(), C.nowHM()); },
      week: waterWeekHTML
    },
    focus: {
      open: function () { ui.focus = 'home'; renderLayer(); },
      close: function () { stopCool(); ui.focus = null; render(); },
      urge: function () { startCool(); },
      day: focusDay,
      cool: function () { return ui.cool; }
    },
    menu: function (on) { ui.menu = !!on; renderLayer(); },
    openDose: function (medId, slotId, dateISO) {
      ui.sheet = { type: 'dose', medId: medId, slotId: slotId, date: dateISO || C.today() };
      renderLayer();
    },
    openTrip: function (fromISO, toISO) {
      ui.trip = { from: fromISO || tripRange().from, to: toISO || tripRange().to };
      renderLayer();
    },
    tripPlan: function (fromISO, toISO) {
      return C.tripPlan(state.meds, state.checkins, fromISO, toISO, C.today());
    },
    alerts: function () { return alertItems(); },
    pendingAlerts: function () { return pendingAlerts(); },
    ackAll: function () {
      ackAlerts(pendingAlerts().map(function (i) { return i.key; }));
      render();
    },
    unackAll: function () { clearAck(); render(); },
    close: function () { ui.menu = false; ui.sheet = null; ui.draft = null; ui.trip = null; ui.focus = null; stopCool(); renderLayer(); }
  };
})();

