/* ============================================================
 * LCARS MedPad — core.js
 * 纯计算逻辑：无 DOM、无存储副作用，可直接 node --test。
 * 剂量内部一律用整数「四分之一片」为单位（QS=4），避免 0.5/0.25 浮点误差。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MedCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var QS = 4; // units per pill
  var ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  var SLOTS = [
    { id: 'morning', label: '早', time: '08:00' },
    { id: 'noon', label: '中', time: '12:30' },
    { id: 'evening', label: '晚', time: '18:30' },
    { id: 'night', label: '睡前', time: '22:00' }
  ];

  /* ---------- 日期工具 ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) {
    if (!s) return null;
    var p = String(s).slice(0, 10).split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(s, n) { var d = parseISO(s); if (!d) return s; d.setDate(d.getDate() + n); return iso(d); }
  function diffDays(a, b) {
    var A = parseISO(a), B = parseISO(b);
    if (!A || !B) return 0;
    return Math.round((B - A) / 86400000);
  }
  function today() { return iso(new Date()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function weekdayCN(day) {
    var d = parseISO(day);
    return d ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] : '';
  }
  function mmdd(day) {
    var d = (day instanceof Date) ? day : parseISO(day);
    return (d && !isNaN(d.getTime())) ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : '';
  }

  /* ---------- 单位换算 ---------- */
  function toUnits(pills) {
    var n = Number(pills);
    if (!isFinite(n)) n = 0;
    return Math.round(n * QS);
  }
  function toPills(units) { return (Number(units) || 0) / QS; }
  /** 84 units -> "21"，2 -> "0.5"，1 -> "0.25" */
  function fmtPills(units) {
    var p = Math.round((Number(units) || 0)) / QS;
    p = Math.round(p * 4) / 4;
    if (Number.isInteger(p)) return String(p);
    return String(p);
  }
  /** 每天几片 -> "1.5 片" */
  function fmtDoseLabel(units) { return fmtPills(units) + ' 片'; }

  /* ---------- 药品 / 时段 ---------- */
  function slotDoseUnits(slot) { return slot && slot.dose ? toUnits(slot.dose) : 0; }
  function activeSlots(med) {
    return (med && med.slots ? med.slots : []).filter(function (s) { return slotDoseUnits(s) > 0; });
  }
  function dailyUnits(med) { return activeSlots(med).reduce(function (a, s) { return a + slotDoseUnits(s); }, 0); }

  function isDoseDay(med, day) {
    if (!med || !day) return false;
    if (med.startDate && day < med.startDate) return false;
    if (med.endDate && day > med.endDate) return false;
    var d = parseISO(day);
    if (!d) return false;
    var w = (med.weekdays && med.weekdays.length) ? med.weekdays : ALL_DAYS;
    if (w.indexOf(d.getDay()) < 0) return false;
    var pz = med.pauses || [];
    for (var i = 0; i < pz.length; i++) {
      if (day >= pz[i].from && day <= pz[i].to) return false;
    }
    return true;
  }

  /* ---------- 库存 ---------- */
  function supplyUnits(med) {
    var inv = med.inventory || {};
    var boxes = Number(inv.boxes) || 0;
    var perBox = Number(inv.pillsPerBox) || 0;
    var loose = Number(inv.loosePills) || 0;
    var u = toUnits(boxes * perBox + loose);
    var adj = inv.adjustments || [];
    for (var i = 0; i < adj.length; i++) u += toUnits(adj[i].pills);
    return u;
  }

  /* ---------- 打卡记录 ---------- */
  function ck(medId, day, slotId) { return medId + '@' + day + '@' + slotId; }
  function getRec(checkins, medId, day, slotId) { return (checkins || {})[ck(medId, day, slotId)] || null; }

  /** 一条记录实际吃掉的 units；未记录返回 null */
  function recUnits(rec, slot) {
    if (!rec) return null;
    if (rec.status === 'taken') {
      return rec.amountPills != null ? toUnits(rec.amountPills) : slotDoseUnits(slot);
    }
    if (rec.status === 'partial') return toUnits(rec.amountPills || 0);
    /* 多吃：amountPills 是这次「实际总共吃了多少片」（含计划量） */
    if (rec.status === 'extra') {
      return rec.amountPills != null ? toUnits(rec.amountPills) : slotDoseUnits(slot);
    }
    return 0; // skipped / missed
  }

  /** 一条记录超出医嘱计划的部分（units）；没有超量返回 0 */
  function overUnitsOf(rec, slot) {
    if (!rec || !slot) return 0;
    if (rec.status !== 'extra' && rec.status !== 'taken') return 0;
    var got = recUnits(rec, slot);
    if (got == null) return 0;
    return Math.max(0, got - slotDoseUnits(slot));
  }

  /**
   * 已消耗 units（从 startDate 到今天）。
   * 规则：过去的日期若无记录，视为「按计划服用」；今天只按已有记录计。
   * 这样补标「漏服 / 跳过」会把药自动退回到剩余量里。
   */
  function consumedUnits(med, todayS, checkins) {
    if (!med || !med.startDate) return 0;
    var slots = activeSlots(med);
    if (!slots.length) return 0;
    var total = 0;
    var d = med.startDate;
    var lastPast = addDays(todayS, -1);
    var stop = (med.endDate && med.endDate < lastPast) ? med.endDate : lastPast;
    var guard = 0;
    while (d <= stop && guard++ < 5000) {
      if (isDoseDay(med, d)) {
        for (var i = 0; i < slots.length; i++) {
          var rec = getRec(checkins, med.id, d, slots[i].id);
          var u = recUnits(rec, slots[i]);
          total += (u === null ? slotDoseUnits(slots[i]) : u);
        }
      }
      d = addDays(d, 1);
    }
    if (isDoseDay(med, todayS)) {
      for (var j = 0; j < slots.length; j++) {
        var r2 = getRec(checkins, med.id, todayS, slots[j].id);
        var u2 = recUnits(r2, slots[j]);
        if (u2 !== null) total += u2;
      }
    }
    return total;
  }

  function remainingUnits(med, todayS, checkins) {
    return supplyUnits(med) - consumedUnits(med, todayS, checkins);
  }

  /** 今天还没打卡的剂量 units */
  function pendingTodayUnits(med, todayS, checkins) {
    if (!isDoseDay(med, todayS)) return 0;
    var slots = activeSlots(med);
    var u = 0;
    for (var i = 0; i < slots.length; i++) {
      if (getRec(checkins, med.id, todayS, slots[i].id) === null) u += slotDoseUnits(slots[i]);
    }
    return u;
  }

  /**
   * 推算吃完日期。
   * 返回 { lastDoseISO, runOutISO, daysLeft, shortfallUnits, daily, remaining }
   * lastDoseISO  = 最后一个能吃到药的日子（可能吃不满全天）
   * runOutISO    = 吃完的那一天（lastDoseISO 的下一天）
   * daysLeft     = 从今天算起还有几天有药（含今天）
   * shortfallUnits = 最后一天缺多少 units（0 表示刚好整除）
   */
  function projectEnd(med, todayS, checkins) {
    var daily = dailyUnits(med);
    var rem = remainingUnits(med, todayS, checkins);
    var out = {
      daily: daily, dailyPills: toPills(daily),
      remaining: rem, remainingPills: toPills(Math.max(0, rem)),
      lastDoseISO: null, runOutISO: null, daysLeft: 0, shortfallUnits: 0,
      ended: false
    };
    if (med.endDate) out.ended = true;
    if (daily <= 0) return out;
    if (rem <= 0) {
      out.runOutISO = todayS;
      return out;
    }
    var start = (med.startDate && med.startDate > todayS) ? med.startDate : todayS;
    var d = start, last = null, shortfall = 0, guard = 0;
    while (guard++ < 4000) {
      if (rem <= 0) break;
      if (med.endDate && d > med.endDate) break;
      if (!isDoseDay(med, d)) { d = addDays(d, 1); continue; }
      var need = (d === todayS) ? pendingTodayUnits(med, todayS, checkins) : daily;
      if (need === 0) { // 今天的药已全部打卡
        if (!last) last = d;
        d = addDays(d, 1); continue;
      }
      if (rem >= need) {
        rem -= need;
        last = d;
        d = addDays(d, 1);
        continue;
      }
      last = d;
      shortfall = need - rem;
      rem = 0;
      break;
    }
    out.lastDoseISO = last;
    out.runOutISO = last ? addDays(last, 1) : todayS;
    out.daysLeft = last ? diffDays(todayS, last) + 1 : 0;
    out.shortfallUnits = shortfall;
    return out;
  }

  /** 剩余天数是否已低于警戒线（默认 7 天） */
  function refillInfo(med, todayS, checkins, warnDays) {
    var p = projectEnd(med, todayS, checkins);
    var warn = Number(warnDays) || 7;
    p.warnDays = warn;
    p.needRefill = !!p.lastDoseISO && p.daysLeft <= warn;
    p.refillByISO = p.lastDoseISO ? addDays(p.lastDoseISO, -warn) : null;
    return p;
  }

  /** 若按当前计划吃 days 天，需要多少盒 */
  function boxesNeeded(med, days) {
    var perBox = Number((med.inventory || {}).pillsPerBox) || 0;
    if (!perBox) return null;
    var needPills = toPills(dailyUnits(med) * Math.max(0, Number(days) || 0));
    return Math.ceil(needPills / perBox);
  }

  /** fromISO..toISO（含）之间还需要多少 units（按计划） */
  function planUnitsBetween(med, fromISO, toISO) {
    var daily = dailyUnits(med);
    if (daily <= 0) return 0;
    var u = 0, d = fromISO, guard = 0;
    while (d <= toISO && guard++ < 4000) {
      if (isDoseDay(med, d)) u += daily;
      d = addDays(d, 1);
    }
    return u;
  }

  /**
   * 依从率：区间内（截止昨天）计划的剂量 vs 实际记录。
   * 无记录的过去日期按「已服」处理（与库存计算一致）；今天只算已记录的。
   * 返回 {planUnits, takenUnits, pct, recordedCount, count}
   */
  function adherence(meds, checkins, fromISO, toISO) {
    var plan = 0, taken = 0, count = 0, recorded = 0, over = 0, overCount = 0;
    (meds || []).forEach(function (med) {
      var slots = activeSlots(med);
      if (!slots.length) return;
      var d = fromISO;
      var guard = 0;
      while (d <= toISO && guard++ < 4000) {
        if (isDoseDay(med, d)) {
          for (var i = 0; i < slots.length; i++) {
            var du = slotDoseUnits(slots[i]);
            if (du <= 0) continue;
            var rec = getRec(checkins, med.id, d, slots[i].id);
            plan += du;
            count++;
            if (rec) {
              recorded++;
              var u = recUnits(rec, slots[i]);
              taken += (u === null ? du : u);
              var ov = overUnitsOf(rec, slots[i]);
              if (ov > 0) { over += ov; overCount++; }
            } else {
              taken += du;
            }
          }
        }
        d = addDays(d, 1);
      }
    });
    var pct = plan > 0 ? Math.round((taken / plan) * 100) : null;
    if (pct != null && pct > 100) pct = 100; /* 超过 100% 单独用 overUnits 表达 */
    return {
      planUnits: plan, takenUnits: taken, pct: pct,
      count: count, recordedCount: recorded,
      overUnits: over, overCount: overCount
    };
  }

  /* ---------- ICS 日历导出 ---------- */
  function icsEsc(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function fold(line) {
    if (line.length <= 74) return line;
    var out = [], rest = line;
    while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
    out.push(rest);
    return out.join('\r\n');
  }
  function icsStamp() {
    var s = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    return s.slice(0, 15) + 'Z';
  }
  function icsDT(day, hm) {
    var t = (hm || '08:00').split(':');
    return day.replace(/-/g, '') + 'T' + pad(+t[0] || 0) + pad(+t[1] || 0) + '00';
  }
  /**
   * 导出「每个时段的每日重复提醒」。
   * 用浮动本地时间（不带 TZID），手机自带日历导入后按本地时区走，最稳。
   */
  function buildICS(meds, todayS, checkins, opts) {
    opts = opts || {};
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LCARS MedPad//CN//',
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEsc('用药提醒')];
    (meds || []).forEach(function (med, mi) {
      var p = projectEnd(med, todayS, checkins);
      var last = p.lastDoseISO;
      if (!last) return;
      var slots = activeSlots(med);
      slots.forEach(function (s, si) {
        var summary = '💊 ' + med.name + ' ' + fmtPills(slotDoseUnits(s)) + ' 片';
        var desc = med.note ? med.note : ('每日 ' + fmtPills(slotDoseUnits(s)) + ' 片');
        L.push('BEGIN:VEVENT');
        L.push('UID:' + med.id + '-' + s.id + '-' + mi + si + '@lcars-medpad');
        L.push('DTSTAMP:' + icsStamp());
        L.push('DTSTART:' + icsDT(med.startDate > todayS ? med.startDate : todayS, s.time));
        L.push('RRULE:FREQ=DAILY;UNTIL=' + icsDT(last, '23:59').slice(0, 15) + 'Z');
        L.push('SUMMARY:' + icsEsc(summary));
        L.push('DESCRIPTION:' + icsEsc(desc));
        L.push('TRANSP:OPAQUE');
        L.push('BEGIN:VALARM');
        L.push('TRIGGER:-PT0M');
        L.push('ACTION:DISPLAY');
        L.push('DESCRIPTION:' + icsEsc(med.name + ' ' + fmtPills(slotDoseUnits(s)) + ' 片'));
        L.push('END:VALARM');
        L.push('END:VEVENT');
      });
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  /* ---------- 校验 / 迁移 ---------- */
  function uid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* ignore */ }
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newMed(overrides) {
    var t = today();
    var m = {
      id: uid(),
      name: '',
      icon: '💊',
      color: 'orange',
      note: '',
      startDate: t,
      endDate: '',
      weekdays: ALL_DAYS.slice(),
      pauses: [],
      slots: SLOTS.map(function (s, i) {
        return { id: s.id, label: s.label, time: s.time, dose: i === 0 ? 1 : 0 };
      }),
      inventory: { boxes: 1, pillsPerBox: 28, loosePills: 0, adjustments: [] },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return Object.assign(m, overrides || {});
  }

  function normalizeMed(raw) {
    var m = newMed();
    m.id = raw.id || m.id;
    m.name = String(raw.name || '').slice(0, 40);
    m.icon = raw.icon || '💊';
    m.color = raw.color || 'orange';
    m.note = String(raw.note || '').slice(0, 200);
    m.startDate = parseISO(raw.startDate) ? String(raw.startDate).slice(0, 10) : m.startDate;
    m.endDate = parseISO(raw.endDate) ? String(raw.endDate).slice(0, 10) : '';
    if (Array.isArray(raw.weekdays) && raw.weekdays.length) m.weekdays = raw.weekdays.filter(function (n) { return n >= 0 && n <= 6; });
    if (Array.isArray(raw.pauses)) m.pauses = raw.pauses.filter(function (p) { return p && p.from && p.to; });
    var byId = {};
    (raw.slots || []).forEach(function (s) { if (s && s.id) byId[s.id] = s; });
    m.slots = SLOTS.map(function (def, i) {
      var s = byId[def.id];
      if (!s) {
        /* 兼容老格式：无 id 的数组按位置对应 */
        var pos = (raw.slots || [])[i];
        if (pos && !pos.id) s = pos;
      }
      s = s || {};
      var dose = Number(s.dose);
      return {
        id: def.id,
        label: def.label,
        time: /^\d{1,2}:\d{2}$/.test(s.time || '') ? s.time : def.time,
        dose: isFinite(dose) && dose > 0 ? Math.round(dose * QS) / QS : 0
      };
    });
    var inv = raw.inventory || {};
    m.inventory = {
      boxes: Math.max(0, Number(inv.boxes) || 0),
      pillsPerBox: Math.max(0, Number(inv.pillsPerBox) || 0),
      loosePills: Math.max(0, Number(inv.loosePills) || 0),
      adjustments: Array.isArray(inv.adjustments) ? inv.adjustments.filter(function (a) {
        return a && isFinite(Number(a.pills));
      }).map(function (a) { return { date: String(a.date || m.startDate).slice(0, 10), pills: Number(a.pills) }; }) : []
    };
    m.createdAt = raw.createdAt || m.createdAt;
    m.updatedAt = raw.updatedAt || m.updatedAt;
    return m;
  }

  /**
   * 出行药量：fromISO..toISO（含）这几天一共要吃多少片、手上的够不够。
   * - 按服药计划算（会跳过「不吃的那几天」与暂停区间）
   * - 今天已经开始/吃过一部分的，只算还没吃的那部分
   * 返回 {fromISO,toISO,days,doseDays,rows,needPills,stashPills,shortPills,shortCount,medsCount,status}
   */
  function tripPlan(meds, checkins, fromISO, toISO, todayISO) {
    var today = todayISO || today();
    var from = String(fromISO || today).slice(0, 10);
    var to = String(toISO || from).slice(0, 10);
    if (to < from) { var tmp = from; from = to; to = tmp; }
    var days = Math.max(1, diffDays(from, to) + 1);
    var startEff = from < today ? today : from;

    var rows = [], needPills = 0, stashPills = 0, shortPills = 0;

    (meds || []).forEach(function (med) {
      if (!med) return;
      var daily = dailyUnits(med);
      if (daily <= 0) return;

      var doseDays = 0, d = from, guard = 0;
      while (d <= to && guard++ < 4000) {
        if (isDoseDay(med, d)) doseDays++;
        d = addDays(d, 1);
      }
      if (!doseDays) return;

      var needU = planUnitsBetween(med, startEff, to);
      if (startEff === today && isDoseDay(med, today)) {
        var pend = pendingTodayUnits(med, today, checkins);
        needU = Math.max(0, needU - (daily - pend));
      }
      var stashU = remainingUnits(med, today, checkins);
      var needP = toPills(needU);
      var stashP = Math.max(0, toPills(stashU));
      var shortP = Math.max(0, Math.round((needP - stashP) * 4) / 4);
      var perBox = Number((med.inventory || {}).pillsPerBox) || 0;

      rows.push({
        med: med,
        doseDays: doseDays,
        needUnits: needU,
        needPills: needP,
        stashUnits: stashU,
        stashPills: stashP,
        shortPills: shortP,
        enough: shortP <= 0.001,
        perBox: perBox,
        boxes: perBox ? Math.ceil(needP / perBox) : null
      });

      needPills += needP;
      stashPills += stashP;
      if (shortP > 0.001) shortPills += shortP;
    });

    var shortCount = rows.filter(function (r) { return r.needPills > r.stashPills + 0.001; }).length;

    return {
      fromISO: from,
      toISO: to,
      days: days,
      doseDays: rows.reduce(function (a, r) { return Math.max(a, r.doseDays); }, 0),
      rows: rows,
      medsCount: rows.length,
      needPills: Math.round(needPills * 4) / 4,
      stashPills: Math.round(stashPills * 4) / 4,
      shortPills: Math.round(shortPills * 4) / 4,
      shortCount: shortCount,
      status: shortCount ? 'short' : 'ok'
    };
  }

  return {
    QS: QS, SLOTS: SLOTS, ALL_DAYS: ALL_DAYS,
    iso: iso, parseISO: parseISO, addDays: addDays, diffDays: diffDays,
    today: today, nowHM: nowHM, weekdayCN: weekdayCN, mmdd: mmdd,
    toUnits: toUnits, toPills: toPills, fmtPills: fmtPills, fmtDoseLabel: fmtDoseLabel,
    slotDoseUnits: slotDoseUnits, activeSlots: activeSlots, dailyUnits: dailyUnits,
    isDoseDay: isDoseDay, supplyUnits: supplyUnits,
    ck: ck, getRec: getRec, recUnits: recUnits, overUnitsOf: overUnitsOf,
    consumedUnits: consumedUnits, remainingUnits: remainingUnits,
    pendingTodayUnits: pendingTodayUnits, projectEnd: projectEnd, refillInfo: refillInfo,
    boxesNeeded: boxesNeeded, planUnitsBetween: planUnitsBetween, adherence: adherence,
    tripPlan: tripPlan,
    buildICS: buildICS, uid: uid, newMed: newMed, normalizeMed: normalizeMed,
    /* v11：补水 */
    waterMl: waterMl, waterPct: waterPct, waterDue: waterDue, waterStreak: waterStreak
  };

  /* ---------------- v11：补水（纯函数） ---------------- */
  function _hm2min(hm) {
    var p = String(hm || '00:00').split(':');
    return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0);
  }

  function _min2hm(m) {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mi = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }

  /* 一天的水量合计（dayLog = [{ml, at}]） */
  function waterMl(dayLog) {
    if (!dayLog || !dayLog.length) return 0;
    var s = 0;
    for (var i = 0; i < dayLog.length; i++) s += Number(dayLog[i] && dayLog[i].ml) || 0;
    return Math.round(s);
  }

  /* 百分比 0..100（四舍五入，目标 <=0 视为 0） */
  function waterPct(ml, targetMl) {
    var tg = Number(targetMl) || 0;
    if (tg <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(ml) || 0) / tg * 100)));
  }

  /* 该不该喝水：返回 {due, sinceMin, inWindow, dueHM, intervalMin} */
  function waterDue(cfg, lastAtHM, nowHMv) {
    var c = cfg || {};
    var now = nowHMv || '00:00';
    var start = c.startHM || '08:00', end = c.endHM || '22:00';
    var inWin = _hm2min(now) >= _hm2min(start) && _hm2min(now) <= _hm2min(end);
    var iv = Math.max(10, Number(c.intervalMin) || 60);
    var out = { due: false, sinceMin: null, inWindow: inWin, dueHM: '', intervalMin: iv };
    if (!lastAtHM) {
      out.due = !!inWin;
      out.dueHM = start;
      return out;
    }
    var since = _hm2min(now) - _hm2min(lastAtHM);
    if (since < 0) since += 1440;
    out.sinceMin = since;
    out.dueHM = _min2hm(_hm2min(lastAtHM) + iv);
    out.due = !!inWin && since >= iv;
    return out;
  }

  /* 连续达标天数：今天没达标就从昨天起算 */
  function waterStreak(days, targetMl, todayISO) {
    var tg = Number(targetMl) || 0;
    if (tg <= 0) return 0;
    var d = days || {};
    var cur = todayISO || today();
    if (waterMl(d[cur]) < tg) cur = addDays(cur, -1);
    var n = 0;
    for (var i = 0; i < 400; i++) {
      if (waterMl(d[cur]) < tg) break;
      n++;
      cur = addDays(cur, -1);
    }
    return n;
  }
});
