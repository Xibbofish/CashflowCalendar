import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDay, watchLocalDay } from './local-day.js';
import { analysisRange } from './analysis.js';

test('使用本机年月日而非 UTC 截断，新启动直接读取新日期', () => {
  assert.equal(localDay(new Date(2026, 9, 11, 0, 1)), '2026-10-11');
  assert.equal(localDay(new Date(2026, 9, 10, 23, 59)), '2026-10-10');
  assert.deepEqual(analysisRange('30', new Date(2026, 9, 11)), ['2026-10-11', '2026-11-09']);
});

test('跨午夜、后台恢复与 focus/pageshow 只在日期变化时通知并清理监听', () => {
  for (const signal of ['tick', 'visibilitychange', 'focus', 'pageshow']) {
    const listeners = new Map();
    const target = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
    let day = '2026-10-10'; let changes = 0; let tick; let cancelled = false;
    const stop = watchLocalDay(() => changes++, { read: () => day, windowTarget: target, documentTarget: target, schedule: (fn) => { tick = fn; return 1; }, cancel: () => { cancelled = true; } });
    const check = signal === 'tick' ? tick : listeners.get(signal);
    check(); assert.equal(changes, 0);
    day = '2026-10-11'; check(); check(); assert.equal(changes, 1);
    stop(); assert.equal(listeners.size, 0); assert.ok(cancelled);
  }
});

test('日期通知与业务状态分离，不覆盖历史记录、浏览日期和未保存草稿', () => {
  const data = { events: [{ date: '2026-10-09', amount: -100 }], browsedDate: '2026-09-01', custom: ['2026-09-10', '2026-09-20'], draft: { name: '还款', date: '2026-10-10', amount: '300' } };
  const before = JSON.stringify(data);
  let day = '2026-10-10'; let tick; let current;
  const target = { addEventListener() {}, removeEventListener() {} };
  const stop = watchLocalDay(() => { current = day; }, { read: () => day, windowTarget: target, documentTarget: target, schedule: (fn) => { tick = fn; }, cancel() {} });
  day = '2026-10-11'; tick();
  assert.equal(current, '2026-10-11');
  assert.equal(JSON.stringify(data), before);
  stop();
});
