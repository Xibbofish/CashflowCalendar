import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownExport } from './markdown-export.js';
import { normalizeEvent } from './engine.js';

const now = new Date(2026, 9, 9, 12);
test('Markdown 说明次数规则和冲红，JSON 保留次数', () => {
  const state = { initialBalance: 1000, events: [normalizeEvent({ name: '还款', isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-10-20', occurrenceCount: 6, amount: -100 })], simulationEvents: [] };
  const { markdown } = createMarkdownExport(state, now);
  assert.match(markdown, /共 6 次/);
  assert.match(markdown, /"occurrenceCount": 6/);
  assert.match(markdown, /不能在预测窗口重新计数/);
  assert.match(markdown, /冲红/);
});
test('Markdown 保留完整备份，备注不能打断表格或 JSON 代码块', () => {
  const state = { initialBalance: 100, events: [normalizeEvent({ name: 'a|b\nc', date: '2026-10-09', amount: -10, description: '```\n<script>x</script>', extra: 1 })], simulationEvents: [], extraMetadata: { v: 2 } };
  const { markdown, filename } = createMarkdownExport(state, now);
  assert.equal(filename, 'cashflow-analysis-2026-10-09.md');
  assert.match(markdown, /a&#124;b<br>c/);
  assert.match(markdown, /&lt;script&gt;/);
  const match = markdown.match(/(`{4,})json\n([\s\S]*?)\n\1/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[2]), state);
});

test('真实与模拟分开计算，包含区间前的历史计划，180 天含今天', () => {
  const state = { initialBalance: 100, events: [normalizeEvent({ date: '2026-10-08', amount: 50 }), normalizeEvent({ date: '2026-10-09', amount: -20 }), normalizeEvent({ date: '2026-11-08', amount: -200 })], simulationEvents: [normalizeEvent({ date: '2026-10-09', amount: -10, isSimulation: true })] };
  const { markdown } = createMarkdownExport(state, now);
  assert.match(markdown, /2026-10-09 至 2027-04-06/);
  assert.ok(markdown.includes('| 仅真实计划 | 30 天 | 0.00 | 20.00 | -20.00 | 130.00 | 130.00 | 2026-10-09 | 0 | 无 |'));
  assert.ok(markdown.includes('| 真实计划 + 模拟 | 30 天 | 0.00 | 30.00 | -30.00 | 120.00 | 120.00 | 2026-10-09 | 0 | 无 |'));
  assert.ok(markdown.includes('| 仅真实计划 | 90 天 | 0.00 | 220.00 | -220.00 | -70.00 | -70.00 | 2026-11-08 | 60 | 2026-11-08 |'));
});

test('周期跳过与月末规则沿用引擎，空计划可导出，原状态不变', () => {
  const state = { initialBalance: 50, events: [normalizeEvent({ isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-10-31', isPermanent: true, amount: -5, canSkip: true, skippedDates: ['2026-10-31'] })], simulationEvents: [] };
  const before = JSON.stringify(state);
  const { markdown } = createMarkdownExport(state, now);
  assert.ok(markdown.includes('| 仅真实计划 | 90 天 | 0.00 | 5.00 | -5.00 | 45.00 | 45.00 | 2026-12-31 | 0 | 无 |'));
  assert.equal(JSON.stringify(state), before);
  const empty = createMarkdownExport({ initialBalance: -1, events: [], simulationEvents: [] }, now).markdown;
  assert.ok(empty.includes('| 仅真实计划 | 180 天 | 0.00 | 0.00 | 0.00 | -1.00 | -1.00 | 2026-10-09 | 180 | 2026-10-09 |'));
});
