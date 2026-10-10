import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvent,
  expandEvents,
  computeDailyBalances,
  getBalanceOnDate,
  EventType,
  RecurringType,
  eventCategoryLabel,
} from './engine.js';

const IN = EventType.INCOME;
const EX = EventType.EXPENSE;

test('每月六次从起始日计数，移动预测窗口不重置次数', () => {
  const events = [normalizeEvent({ isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-10-20', occurrenceCount: 6, amount: -100 })];
  assert.deepEqual(expandEvents(events, '2026-10-01', '2027-05-01').map((e) => e.date), ['2026-10-20', '2026-11-20', '2026-12-20', '2027-01-20', '2027-02-20', '2027-03-20']);
  assert.deepEqual(expandEvents(events, '2027-02-01', '2027-05-01').map((e) => e.date), ['2027-02-20', '2027-03-20']);
  assert.equal(getBalanceOnDate(1000, events, '2027-06-01'), 400);
});

test('次数模式支持每日、每周、每年，月底无对应日不占次数', () => {
  for (const recurringType of ['daily', 'weekly', 'yearly']) {
    const e = normalizeEvent({ isRecurring: true, recurringType, recurringStartDate: '2026-01-01', occurrenceCount: 2 });
    assert.equal(expandEvents([e], '2026-01-01', '2029-01-01').length, 2);
  }
  const monthly = normalizeEvent({ isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-01-31', occurrenceCount: 3 });
  assert.deepEqual(expandEvents([monthly], '2026-01-01', '2026-08-01').map((e) => e.date), ['2026-01-31', '2026-03-31', '2026-05-31']);
});

test('旧跳过记录保留且占次数，永久模式忽略次数，非法次数回退旧规则', () => {
  const event = normalizeEvent({ isRecurring: true, recurringType: 'daily', recurringStartDate: '2026-01-01', occurrenceCount: 2, canSkip: true, skippedDates: ['2026-01-01'] });
  assert.deepEqual(expandEvents([event], '2026-01-01', '2026-01-10').map((e) => e.date), ['2026-01-02']);
  assert.equal(expandEvents([{ ...event, isPermanent: true }], '2026-01-01', '2026-01-10').length, 9);
  for (const occurrenceCount of [0, -1, 1.5, 'abc']) assert.equal(normalizeEvent({ occurrenceCount }).occurrenceCount, null);
});

test('normalizeEvent 填充默认值', () => {
  const e = normalizeEvent({});
  assert.equal(e.type, EX);
  assert.equal(e.amount, 0);
  assert.equal(e.isRecurring, false);
  assert.equal(e.isSimulation, false);
  assert.equal(e.category, '');
  assert.deepEqual(e.skippedDates, []);
  assert.ok(e.id);
});

// 用足够宽的区间统一展开工具
const expand = (events, start = '2026-01-01', end = '2026-01-31') =>
  expandEvents(events, start, end);

test('单次事件：区间内展开，区间外忽略', () => {
  const inside = expand([normalizeEvent({ name: 'a', date: '2026-01-10', amount: 100 })]);
  assert.equal(inside.length, 1);
  assert.equal(inside[0].date, '2026-01-10');

  const outside = expand([normalizeEvent({ name: 'a', date: '2026-02-10', amount: 100 })]);
  assert.equal(outside.length, 0);
});

test('每日周期事件：区间内每天都展开', () => {
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.DAILY,
    recurringStartDate: '2026-01-01',
    isPermanent: true,
    amount: -10,
  })];
  const expanded = expand(events, '2026-01-01', '2026-01-10');
  assert.equal(expanded.length, 10);
});

test('每周周期事件：只在同样星期几展开', () => {
  // 2026-01-05 是周一；2026-01 的周一为 5/12/19/26
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.WEEKLY,
    recurringStartDate: '2026-01-05',
    isPermanent: true,
    amount: -10,
  })];
  const dates = expand(events, '2026-01-01', '2026-01-31').map((e) => e.date);
  assert.deepEqual(dates, ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
});

test('每月周期事件：只在开始日当天展开', () => {
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.MONTHLY,
    recurringStartDate: '2026-01-20',
    isPermanent: true,
    amount: -10,
  })];
  const dates = expand(events, '2026-01-01', '2026-03-31').map((e) => e.date);
  assert.deepEqual(dates, ['2026-01-20', '2026-02-20', '2026-03-20']);
});

test('canSkip + skippedDates：跳过具体某天', () => {
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.DAILY,
    recurringStartDate: '2026-01-01',
    isPermanent: true,
    canSkip: true,
    skippedDates: ['2026-01-03'],
    amount: -10,
  })];
  const expanded = expand(events, '2026-01-01', '2026-01-05').map((e) => e.date);
  assert.deepEqual(expanded, ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05']);
});

test('未开启 canSkip 时 skippedDates 不生效', () => {
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.DAILY,
    recurringStartDate: '2026-01-01',
    isPermanent: true,
    canSkip: false,
    skippedDates: ['2026-01-03'],
    amount: -10,
  })];
  const dates = expand(events, '2026-01-01', '2026-01-05').map((e) => e.date);
  assert.equal(dates.length, 5);
});

test('computeDailyBalances：逐日累加并区分收支', () => {
  const events = [
    normalizeEvent({ name: '工资', type: IN, amount: 1000, date: '2026-01-01' }),
    normalizeEvent({ name: '吃饭', type: EX, amount: -100, date: '2026-01-01' }),
    normalizeEvent({ name: '吃饭', type: EX, amount: -200, date: '2026-01-02' }),
  ];
  const data = computeDailyBalances(500, events, '2026-01-01', '2026-01-03');
  assert.equal(data[0].balance, 1400); // 500 + 1000 - 100
  assert.equal(data[0].income, 1000);
  assert.equal(data[0].expense, 100);
  assert.equal(data[1].balance, 1200); // 1400 - 200
  assert.equal(data[2].balance, 1200); // 无事件，余额保持
});

test('computeDailyBalances：跳过的周期事件不改变余额', () => {
  const events = [normalizeEvent({
    isRecurring: true,
    recurringType: RecurringType.DAILY,
    recurringStartDate: '2026-01-01',
    isPermanent: true,
    canSkip: true,
    skippedDates: ['2026-01-02'],
    amount: -100,
  })];
  const data = computeDailyBalances(0, events, '2026-01-01', '2026-01-03');
  assert.equal(data[0].balance, -100);
  assert.equal(data[1].balance, -100); // 1/2 被跳过，余额不变
  assert.equal(data[2].balance, -200);
});

test('getBalanceOnDate：考虑区间外的单次与周期事件', () => {
  const events = [
    normalizeEvent({ name: 'a', amount: 100, date: '2025-12-31' }), // 区间起始前
    normalizeEvent({ name: 'b', amount: 50, date: '2026-01-10' }),
    normalizeEvent({
      isRecurring: true, recurringType: RecurringType.MONTHLY,
      recurringStartDate: '2026-01-01', isPermanent: true, amount: -200,
    }),
  ];
  const bal = getBalanceOnDate(0, events, '2026-01-10');
  // 100(旧) + (-200 1月) + 50(1/10) = -50
  assert.equal(bal, -50);
});

test('eventCategoryLabel：空分类回退为未分类', () => {
  assert.equal(eventCategoryLabel({ category: '   ' }), '未分类');
  assert.equal(eventCategoryLabel({ category: '餐饮' }), '餐饮');
});
