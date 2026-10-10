import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisRange, filterAnalysis } from './analysis.js';
test('时间快捷范围包含起止日，跨年和闰年月份正确', () => {
  assert.deepEqual(analysisRange('30', new Date(2026, 11, 20)), ['2026-12-20', '2027-01-18']);
  assert.deepEqual(analysisRange('next-month', new Date(2028, 0, 10)), ['2028-02-01', '2028-02-29']);
});
test('分类筛选只改变收支，余额数据不变，支出绝对值与未分类正确', () => {
  const days = [{ date: '2026-10-10', balance: 900, events: [{ id: 'a', date: '2026-10-10', amount: 100, category: '工资' }, { id: 'b', date: '2026-10-10', amount: -200, category: '' }] }];
  const all = filterAnalysis(days, []);
  assert.equal(all.months[0].income, 100);
  assert.equal(all.months[0].expense, 200);
  assert.equal(filterAnalysis(days, ['工资']).months[0].expense, 0);
  assert.equal(filterAnalysis(days, ['未分类']).categories[0].amount, 200);
  assert.equal(days[0].balance, 900);
  assert.equal(filterAnalysis(days, [], 'week').months[0].key, '2026-10-05');
});
