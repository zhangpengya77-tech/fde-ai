// 五大職業實訓課程｜資料與時數計算測試（node --test src/*.test.cjs 會一併執行）
// 驗證：每門課階段時數加總＝總時數、天數與最後一天時數、每日課表、職業飛手選課計算器所有組合。
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./data/vocational-programs.js');

const byId = Object.fromEntries(P.programs.map((p) => [p.id, p]));
const sum = (a) => a.reduce((s, x) => s + x, 0);

test('五門課程都在，順序與網址代號正確', () => {
  assert.deepEqual(P.programs.map((p) => p.id), ['license', 'seed', 'pilot', 'rd', 'mro']);
  assert.deepEqual(P.programs.map((p) => p.slug), ['drone-license', 'seed-teacher', 'pro-pilot', 'rd-engineer', 'maintenance-engineer']);
});

test('每日時數規則：最多 7 小時，上午 3＋下午 4，午休不計', () => {
  assert.equal(P.rules.dayHours, 7);
  assert.equal(sum(P.rules.sessions.map((s) => s.hours)), 7);
  assert.equal(P.dayEndTime(7), '17:00');
  assert.equal(P.dayEndTime(6), '16:00');
  assert.equal(P.dayEndTime(5), '15:00');
  assert.equal(P.dayEndTime(4), '14:00');
  assert.equal(P.dayEndTime(3), '12:00');
});

test('課程一 證照專班：32 小時、5 天、最後一天 4 小時，單元時數加總正確', () => {
  const p = byId.license;
  assert.equal(sum(p.stages.map((s) => s.hours)), 32);
  assert.deepEqual(p.stages.map((s) => s.hours), [4, 7, 7, 7, 7]);
  assert.deepEqual([p.schedule.days, p.schedule.lastDayHours], [5, 4]);
  assert.equal(p.daily.length, 5);
  assert.equal(sum(p.daily.map((d) => d.hours)), 32);
  assert.ok(p.daily.slice(0, -1).every((d) => d.hours === 7));
  assert.equal(p.daily.at(-1).hours, 4);
});

test('課程二 種子教師：160 小時、23 天、最後一天 6 小時，九個階段加總 160，5 人開班', () => {
  const p = byId.seed;
  assert.deepEqual(p.stages.map((s) => s.hours), [14, 28, 21, 21, 14, 14, 21, 21, 6]);
  assert.equal(sum(p.stages.map((s) => s.hours)), 160);
  assert.deepEqual([p.schedule.days, p.schedule.lastDayHours], [23, 6]);
  assert.equal(sum(p.daily.map((d) => d.hours)), 160);
  assert.equal(p.minClass, 5);
  assert.ok(p.stages.some((s) => s.title.includes('工廠產業實習')) && p.stages.some((s) => s.title.includes('助教實習')), '必須保留工廠實習與助教實習');
});

test('課程三 職業飛手：基礎 28、模組各 20、考核 8；48／68／96 三個方案', () => {
  const p = byId.pilot;
  assert.equal(p.base.hours, 28);
  assert.equal(p.modules.length, 5);
  assert.ok(p.modules.every((m) => m.hours === 20));
  assert.deepEqual(p.plans.map((x) => P.pilotPlan(x.modules).totalHours), [48, 68, 96]);
  assert.deepEqual([P.pilotPlan(1).days, P.pilotPlan(1).lastDayHours], [7, 6]);
  assert.deepEqual([P.pilotPlan(2).days, P.pilotPlan(2).lastDayHours], [10, 5]);
  assert.deepEqual([P.pilotPlan(3).days, P.pilotPlan(3).lastDayHours], [14, 5]);
});

test('選課計算器：所有模組組合（0～5 個、共 32 種）結果正確', () => {
  const codes = byId.pilot.modules.map((m) => m.code);
  let combos = 0;
  for (let mask = 0; mask < 1 << codes.length; mask++) {
    const n = codes.filter((_, i) => mask & (1 << i)).length;
    const r = P.pilotPlan(n);
    const expect = 28 + 20 * n + (n >= 3 ? 8 : 0);
    assert.equal(r.totalHours, expect, `選 ${n} 個模組`);
    assert.equal(r.extensionHours, Math.max(0, expect - 96));
    assert.equal(r.standardHours + r.extensionHours, expect);
    assert.equal(r.days, Math.ceil(expect / 7));
    assert.equal(r.lastDayHours, expect - 7 * (r.days - 1));
    assert.ok(r.lastDayHours >= 1 && r.lastDayHours <= 7);
    combos++;
  }
  assert.equal(combos, 32);
  assert.deepEqual([P.pilotPlan(4).totalHours, P.pilotPlan(4).extensionHours], [116, 20]);
  assert.deepEqual([P.pilotPlan(5).totalHours, P.pilotPlan(5).extensionHours], [136, 40]);
});

test('課程四 研發工程師：320 小時、46 天、最後一天 5 小時，第 1–46 天連續無缺漏', () => {
  const p = byId.rd;
  assert.deepEqual([p.schedule.days, p.schedule.lastDayHours], [46, 5]);
  assert.equal(sum(p.blocks.map((b) => b.hours)), 320);
  const days = p.blocks.flatMap((b) => Array.from({ length: b.days[1] - b.days[0] + 1 }, (_, i) => b.days[0] + i));
  assert.deepEqual(days, Array.from({ length: 46 }, (_, i) => i + 1));
  assert.equal(p.blocks.find((b) => b.title.includes('SITL')).hours, 42, 'AI 輔助開發、SITL 與 ROS 2 為 6 天 42 小時');
  assert.ok(p.blocks.find((b) => b.title.includes('測繪')).note.includes('無人船'));
  assert.equal(p.daily.at(-1).hours, 5);
});

test('課程五 裝調檢修：160 小時、23 天、最後一天 6 小時，D20–D22 大型機專題', () => {
  const p = byId.mro;
  assert.equal(p.days.length, 23);
  assert.deepEqual([p.schedule.days, p.schedule.lastDayHours], [23, 6]);
  assert.equal(sum(p.daily.map((d) => d.hours)), 160);
  assert.ok(p.days[19].title.includes('950 mm'));
  assert.ok(p.days[21].title.includes('AI 模組'));
  const groupDays = p.groups.flatMap((g) => Array.from({ length: g.days[1] - g.days[0] + 1 }, (_, i) => g.days[0] + i));
  assert.deepEqual(groupDays, Array.from({ length: 23 }, (_, i) => i + 1));
  assert.ok(!p.days.some((d) => d.title.includes('無人船')), '無人船不得列為已安排的實訓日');
});

test('用語檢查：不出現保證、政府認可、補助、可合法執業等字眼', () => {
  const text = JSON.stringify(P);
  for (const bad of ['保證就業', '保證取得', '保證通過', '政府認可', '政府核定', '已獲補助', '可合法執業', '通過率']) assert.ok(!text.includes(bad), `不得出現「${bad}」`);
  assert.ok(text.includes('依主管機關公告'));
  assert.ok(byId.mro.largeAircraft.items.some((x) => x.includes('須經當事人同意')));
});
