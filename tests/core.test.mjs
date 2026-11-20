/* 核心算法单元测试：node --test tests/  （零依赖） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../js/core.js');

const T = M.today();

function mkMed(over) {
  return M.normalizeMed(Object.assign({
    name: '测试药',
    startDate: T,
    inventory: { boxes: 3, pillsPerBox: 28, loosePills: 0 }
  }, over || {}));
}

test('单位换算：四分之一片为整数', () => {
  assert.equal(M.fmtPills(1), '0.25');
  assert.equal(M.fmtPills(2), '0.5');
  assert.equal(M.fmtPills(3), '0.75');
  assert.equal(M.fmtPills(4), '1');
  assert.equal(M.fmtPills(6), '1.5');
  assert.equal(M.toUnits(0.25), 1);
  assert.equal(M.toUnits(1.5), 6);
});

test('验收1：28片×3盒 + 早1片/晚0.5片 => 84片、每日1.5片、56天', () => {
  const m = mkMed({
    slots: [
      { id: 'morning', time: '08:00', dose: 1 },
      { id: 'evening', time: '18:30', dose: 0.5 }
    ]
  });
  assert.equal(M.supplyUnits(m), 84 * M.QS);
  assert.equal(M.dailyUnits(m), 1.5 * M.QS);
  const p = M.projectEnd(m, T, {});
  assert.equal(p.daysLeft, 56);
  assert.equal(p.lastDoseISO, M.addDays(T, 55));   // 今天算第 1 天
  assert.equal(p.runOutISO, M.addDays(T, 56));     // 第 57 天没药
  assert.equal(p.shortfallUnits, 0);
});

test('验收2：早0.5/晚0.5 => 每日1片 => 84天', () => {
  const m = mkMed({
    slots: [
      { id: 'morning', dose: 0.5 },
      { id: 'evening', dose: 0.5 }
    ]
  });
  assert.equal(M.dailyUnits(m), 4);
  const p = M.projectEnd(m, T, {});
  assert.equal(p.daysLeft, 84);
  assert.equal(p.lastDoseISO, M.addDays(T, 83));
});

test('验收3：今早打卡后余量立刻减少，吃完日不变', () => {
  const m = mkMed({
    slots: [
      { id: 'morning', dose: 1 },
      { id: 'evening', dose: 0.5 }
    ]
  });
  const ck = {};
  ck[M.ck(m.id, T, 'morning')] = { status: 'taken' };
  assert.equal(M.consumedUnits(m, T, ck), 4);          // 已吃 1 片
  assert.equal(M.remainingUnits(m, T, ck), 332);       // 剩 83 片
  assert.equal(M.pendingTodayUnits(m, T, ck), 2);      // 今晚还要 0.5 片
  const p = M.projectEnd(m, T, ck);
  assert.equal(p.daysLeft, 56);
});

test('过去无记录视为已服；标「跳过」把药退回来', () => {
  const start = M.addDays(T, -2);
  const m = mkMed({
    startDate: start,
    slots: [{ id: 'morning', dose: 1 }, { id: 'evening', dose: 0.5 }]
  });
  // 前天 + 昨天 = 2 天 × 6 units
  assert.equal(M.consumedUnits(m, T, {}), 12);

  const skip = {};
  skip[M.ck(m.id, M.addDays(T, -1), 'evening')] = { status: 'skipped' };
  assert.equal(M.consumedUnits(m, T, skip), 10);       // 退回 0.5 片

  const part = {};
  part[M.ck(m.id, M.addDays(T, -1), 'morning')] = { status: 'partial', amountPills: 0.5 };
  assert.equal(M.consumedUnits(m, T, part), 10);       // 少吃 0.5 片
});

test('依从率：无记录=100%，标跳过后下降', () => {
  const start = M.addDays(T, -2);
  const m = mkMed({
    startDate: start,
    slots: [{ id: 'morning', dose: 1 }, { id: 'evening', dose: 0.5 }]
  });
  const a1 = M.adherence([m], {}, start, M.addDays(T, -1));
  assert.equal(a1.planUnits, 12);
  assert.equal(a1.takenUnits, 12);
  assert.equal(a1.pct, 100);

  const skip = {};
  skip[M.ck(m.id, M.addDays(T, -1), 'evening')] = { status: 'skipped' };
  const a2 = M.adherence([m], skip, start, M.addDays(T, -1));
  assert.equal(a2.takenUnits, 10);
  assert.equal(a2.pct, 83);
});

test('医生指定结束日期：到那天就停', () => {
  const m = mkMed({
    endDate: M.addDays(T, 9),
    slots: [{ id: 'morning', dose: 1 }]
  });
  assert.equal(M.dailyUnits(m), 4);
  const p = M.projectEnd(m, T, {});
  assert.equal(p.lastDoseISO, M.addDays(T, 9));
  assert.equal(p.daysLeft, 10);
  assert.equal(M.isDoseDay(m, M.addDays(T, 10)), false);
});

test('结束日期早于今天：只算到结束日', () => {
  const m = mkMed({
    startDate: M.addDays(T, -10),
    endDate: M.addDays(T, -5),
    slots: [{ id: 'morning', dose: 1 }]
  });
  // T-10 .. T-5 共 6 天，每天 1 片
  assert.equal(M.consumedUnits(m, T, {}), 6 * M.QS);
});

test('每天剂量为 0 时不乱算', () => {
  const m = mkMed({ slots: [{ id: 'morning', dose: 0 }] });
  assert.equal(M.dailyUnits(m), 0);
  const p = M.projectEnd(m, T, {});
  assert.equal(p.lastDoseISO, null);
  assert.equal(p.daysLeft, 0);
});

test('星期几规则', () => {
  let d = T;
  while (M.parseISO(d).getDay() !== 1) d = M.addDays(d, 1); // 找到最近的周一
  const m = mkMed({ weekdays: [1], slots: [{ id: 'morning', dose: 1 }] });
  assert.equal(M.isDoseDay(m, d), true);
  assert.equal(M.isDoseDay(m, M.addDays(d, 1)), false);
});

test('补药预警：剩 7 天时提醒', () => {
  const m = mkMed({
    inventory: { boxes: 1, pillsPerBox: 7, loosePills: 0 },
    slots: [{ id: 'morning', dose: 1 }]
  });
  const r = M.refillInfo(m, T, {}, 7);
  assert.equal(r.daysLeft, 7);
  assert.equal(r.needRefill, true);
  assert.equal(r.refillByISO, M.addDays(r.lastDoseISO, -7));
});

test('囤药盒数换算', () => {
  const m = mkMed({
    slots: [{ id: 'morning', dose: 1 }, { id: 'evening', dose: 0.5 }]
  });
  assert.equal(M.boxesNeeded(m, 56), 3);
  assert.equal(M.boxesNeeded(m, 1), 1);
});

test('ICS 日历：每个时段一条重复事件', () => {
  const m = mkMed({
    slots: [
      { id: 'morning', time: '08:00', dose: 1 },
      { id: 'evening', time: '18:30', dose: 0.5 }
    ]
  });
  const ics = M.buildICS([m], T, {});
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));
  const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(n, 2);
  assert.ok(ics.includes('RRULE:FREQ=DAILY;UNTIL='));
  assert.ok(ics.includes('SUMMARY:💊 测试药 1 片'));
  assert.ok(ics.includes('BEGIN:VALARM'));
});

test('非法输入不会崩，字段被收敛', () => {
  const m = M.normalizeMed({
    name: '  药A  ',
    startDate: 'not-a-date',
    slots: [{ id: 'morning', dose: -5 }],
    inventory: { boxes: -3, pillsPerBox: 'x' }
  });
  assert.ok(M.parseISO(m.startDate));
  assert.equal(M.dailyUnits(m), 0);
  assert.equal(m.inventory.boxes, 0);
  assert.equal(m.inventory.pillsPerBox, 0);
  assert.equal(m.slots.length, 4);
});

test('暂停区间内不排药', () => {
  const m = mkMed({
    pauses: [{ from: M.addDays(T, -1), to: M.addDays(T, 1) }],
    slots: [{ id: 'morning', dose: 1 }]
  });
  assert.equal(M.isDoseDay(m, T), false);
  assert.equal(M.isDoseDay(m, M.addDays(T, 2)), true);
});

/* ---------- v2：多吃 / 超量 ---------- */

test('多吃：extra 记录按实际总片数扣库存', () => {
  const m = mkMed({ slots: [{ id: 'morning', dose: 1 }] });
  assert.equal(M.consumedUnits(m, T, {}), 0);
  const ck = {};
  ck[M.ck(m.id, T, 'morning')] = { status: 'extra', amountPills: 2 };
  const rec = ck[M.ck(m.id, T, 'morning')];
  assert.equal(M.recUnits(rec, m.slots[0]), 2 * M.QS);
  assert.equal(M.overUnitsOf(rec, m.slots[0]), 1 * M.QS);
  assert.equal(M.consumedUnits(m, T, ck), 2 * M.QS);
  assert.equal(M.remainingUnits(m, T, ck), 84 * M.QS - 2 * M.QS);
});

test('多吃但没填片数：按计划量算，不算超量', () => {
  const m = mkMed({ slots: [{ id: 'morning', dose: 1 }] });
  const rec = { status: 'extra' };
  assert.equal(M.recUnits(rec, m.slots[0]), M.QS);
  assert.equal(M.overUnitsOf(rec, m.slots[0]), 0);
  assert.equal(M.consumedUnits(m, T, { [M.ck(m.id, T, 'morning')]: rec }), M.QS);
});

test('extra 但吃得比计划少：不算超量', () => {
  const m = mkMed({ slots: [{ id: 'morning', dose: 1 }] });
  const rec = { status: 'extra', amountPills: 0.5 };
  assert.equal(M.recUnits(rec, m.slots[0]), 2);
  assert.equal(M.overUnitsOf(rec, m.slots[0]), 0);
});

test('依从率：超量单独统计，pct 不超过 100', () => {
  const y = M.addDays(T, -1);
  const m = mkMed({ startDate: y, slots: [{ id: 'morning', dose: 1 }] });
  const ck = {};
  ck[M.ck(m.id, y, 'morning')] = { status: 'extra', amountPills: 3 };
  const a = M.adherence([m], ck, y, y);
  assert.equal(a.planUnits, M.QS);
  assert.equal(a.takenUnits, 3 * M.QS);
  assert.equal(a.overUnits, 2 * M.QS);
  assert.equal(a.overCount, 1);
  assert.equal(a.pct, 100);
});

test('多吃会缩短吃完日期', () => {
  const m = mkMed({
    inventory: { boxes: 1, pillsPerBox: 8, loosePills: 0 },
    slots: [{ id: 'morning', dose: 1 }]
  });
  const before = M.projectEnd(m, T, {});
  const ck = {};
  ck[M.ck(m.id, T, 'morning')] = { status: 'extra', amountPills: 3 };
  const after = M.projectEnd(m, T, ck);
  assert.equal(before.daysLeft, 8);
  assert.equal(after.daysLeft, 6); // 今天已吃 3 片，只剩 5 片
});

/* ---------- 出行药量 ---------- */
test('出行药量：够用时给出片数与整盒数', () => {
  const m = mkMed({ slots: [{ id: 'morning', dose: 1 }] }); // 28×3=84 片，每天 1 片
  const p = M.tripPlan([m], {}, T, M.addDays(T, 6), T);
  assert.equal(p.days, 7);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].needPills, 7);
  assert.equal(p.rows[0].stashPills, 84);
  assert.equal(p.rows[0].boxes, 1);          // ceil(7/28)
  assert.equal(p.status, 'ok');
  assert.equal(p.shortCount, 0);
});

test('出行药量：不够时算出差多少片', () => {
  const m = mkMed({
    inventory: { boxes: 0, pillsPerBox: 0, loosePills: 4 },
    slots: [{ id: 'morning', dose: 1 }]
  });
  const p = M.tripPlan([m], {}, T, M.addDays(T, 6), T);
  assert.equal(p.needPills, 7);
  assert.equal(p.stashPills, 4);
  assert.equal(p.shortPills, 3);
  assert.equal(p.status, 'short');
  assert.equal(p.shortCount, 1);
  assert.equal(p.rows[0].enough, false);
});

test('出行药量：今天已经吃过的不重复计算', () => {
  const m = mkMed({
    inventory: { boxes: 0, pillsPerBox: 0, loosePills: 10 },
    slots: [{ id: 'morning', dose: 1 }]
  });
  const ck = {};
  ck[M.ck(m.id, T, 'morning')] = { status: 'taken', amountPills: 1 };
  const p = M.tripPlan([m], ck, T, M.addDays(T, 3), T); // 4 天，今天已吃 1 片
  assert.equal(p.rows[0].needPills, 3);
});

test('出行药量：只算真的要吃药的那几天（跳过错开的周几）', () => {
  const m = mkMed({ weekdays: [1], slots: [{ id: 'morning', dose: 1 }] }); // 只在周一吃
  const p = M.tripPlan([m], {}, T, M.addDays(T, 6), T);
  let mondays = 0;
  for (let i = 0; i < 7; i++) {
    if (M.parseISO(M.addDays(T, i)).getDay() === 1) mondays++;
  }
  assert.equal(p.rows[0].needPills, mondays);
});

test('出行药量：吃法有半片时按 0.25 片为单位精确累加', () => {
  const m = mkMed({
    inventory: { boxes: 0, pillsPerBox: 0, loosePills: 2 },
    slots: [{ id: 'morning', dose: 0.5 }]
  });
  const p = M.tripPlan([m], {}, T, M.addDays(T, 2), T); // 3 天 × 0.5 = 1.5 片
  assert.equal(p.needPills, 1.5);
  assert.equal(p.status, 'ok');
});

/* ================= v11：补水 ================= */
test('waterMl 合计与空值', () => {
  const C = MedCore;
  assert.equal(C.waterMl([]), 0);
  assert.equal(C.waterMl(null), 0);
  assert.equal(C.waterMl([{ ml: 250 }, { ml: 300 }, { ml: '150' }]), 700);
});

test('waterPct 百分比与上下限', () => {
  const C = MedCore;
  assert.equal(C.waterPct(0, 1800), 0);
  assert.equal(C.waterPct(900, 1800), 50);
  assert.equal(C.waterPct(9999, 1800), 100);
  assert.equal(C.waterPct(100, 0), 0);
  assert.equal(C.waterPct(450, 1800), 25);
});

test('waterDue：窗口外不提醒、到间隔才提醒、跨夜也算', () => {
  const C = MedCore;
  const cfg = { intervalMin: 60, startHM: '08:00', endHM: '22:00' };
  let r = C.waterDue(cfg, '09:00', '09:30');
  assert.equal(r.due, false);
  assert.equal(r.sinceMin, 30);
  assert.equal(r.dueHM, '10:00');
  r = C.waterDue(cfg, '09:00', '10:05');
  assert.equal(r.due, true);
  r = C.waterDue(cfg, '09:00', '23:30');
  assert.equal(r.inWindow, false);
  assert.equal(r.due, false);
  r = C.waterDue(cfg, '', '09:00');
  assert.equal(r.due, true, '今天还没喝过，进窗口就该提醒');
  r = C.waterDue(cfg, '23:50', '00:40');
  assert.equal(r.due, false, '00:40 不在 08:00-22:00 窗口');
  assert.equal(r.sinceMin, 50);
});

test('waterStreak：连续达标天数', () => {
  const C = MedCore;
  const t = C.today();
  const days = {};
  days[t] = [{ ml: 1800 }];
  days[C.addDays(t, -1)] = [{ ml: 900 }, { ml: 900 }];
  days[C.addDays(t, -2)] = [{ ml: 2000 }];
  days[C.addDays(t, -3)] = [{ ml: 300 }];
  assert.equal(C.waterStreak(days, 1800, t), 3);
  days[t] = [{ ml: 100 }];
  assert.equal(C.waterStreak(days, 1800, t), 2, '今天没达标就从昨天算');
  assert.equal(C.waterStreak({}, 1800, t), 0);
});
