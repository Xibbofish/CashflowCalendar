/**
 * 现金流日历本机存储的纯函数测试：不需要浏览器、不需要构建。
 *
 * 运行：`npm test`（由 package.json 里的 test 脚本带上本文件）。
 * 重点覆盖本次审查发现的真实缺陷：
 * - 本机存储 getter 抛 SecurityError 不能让页面崩溃；
 * - 损坏 / 未来版本数据必须只读且保留原始字符串；
 * - 未知字段与未来 `schemaVersion` 绝不能被“顺手改成 1”；
 * - 写入失败（配额 / 被拒绝）必须抛出可见错误，且不改变已存内容。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readState, writeState, parseBackup, clearState, STORAGE_KEY, DEFAULT_STATE } from './storage.js';

const KEY = STORAGE_KEY;

/** 内存存储替身，可选注入故障。 */
function memoryStorage({ read = null, onGet, onSet, onRemove } = {}) {
  const map = new Map();
  if (read !== null) map.set(KEY, read);
  return {
    map,
    getItem(key) {
      if (onGet) return onGet(key);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (onSet) onSet(key, value);
      map.set(key, String(value));
    },
    removeItem(key) {
      if (onRemove) onRemove(key);
      map.delete(key);
    },
  };
}

const legacy = (overrides = {}) => ({
  initialBalance: 100,
  events: [{
    id: 'e1', name: '虚构：房租', type: 'expense', amount: -1200, date: '2026-10-01',
    isRecurring: false, recurringType: 'none', isPermanent: false, occurrenceCount: null,
    canSkip: false, isSimulation: false, category: '居住', description: '', skippedDates: [],
  }],
  simulationEvents: [],
  ...overrides,
});

test('没有数据 → empty，可写', () => {
  const reading = readState(memoryStorage());
  assert.equal(reading.kind, 'empty');
  assert.equal(reading.readonly, false);
  assert.equal(reading.data, null);
});

test('本机存储 getter 抛 SecurityError 时返回 unavailable，不抛异常', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('denied', 'SecurityError'); },
  });
  try {
    const reading = readState();
    assert.equal(reading.kind, 'unavailable');
    assert.equal(reading.readonly, true);
    assert.match(reading.error.message, /本机存储/);
    assert.throws(() => writeState(legacy()), (error) => error.code === 'E_STORAGE_UNAVAILABLE');
    assert.throws(() => clearState(), (error) => error.code === 'E_STORAGE_UNAVAILABLE');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('getItem 抛错时也返回 unavailable，而不是崩溃', () => {
  const reading = readState(memoryStorage({ onGet: () => { throw new DOMException('denied', 'SecurityError'); } }));
  assert.equal(reading.kind, 'unavailable');
  assert.equal(reading.readonly, true);
});

test('损坏的 JSON → corrupt，保留原始字符串且只读', () => {
  const raw = '{"initialBalance":100,"events":[';
  const storage = memoryStorage({ read: raw });
  const reading = readState(storage);
  assert.equal(reading.kind, 'corrupt');
  assert.equal(reading.raw, raw);
  assert.equal(reading.readonly, true);
  assert.equal(reading.downloadable, true);
  assert.equal(reading.error.code, 'E_STORAGE_CORRUPT');
  // 只读：写入被拒绝，原文不动
  assert.throws(() => writeState(legacy(), storage), (error) => error.code === 'E_STORAGE_CORRUPT');
  assert.equal(storage.getItem(KEY), raw);
});

test('结构非法（日期错误）→ corrupt，不静默补默认值', () => {
  const bad = JSON.stringify({ initialBalance: 100, events: [{ id: 'x', type: 'expense', amount: -1, date: '2026-02-30', isRecurring: false, recurringType: 'none', isPermanent: false, canSkip: false, isSimulation: false }], simulationEvents: [] });
  const reading = readState(memoryStorage({ read: bad }));
  assert.equal(reading.kind, 'corrupt');
  assert.equal(reading.raw, bad);
});

test('更高版本的 schemaVersion → unsupported，只读且不覆盖', () => {
  const raw = JSON.stringify({ schemaVersion: 7, initialBalance: 1, events: [], simulationEvents: [], futureField: true });
  const storage = memoryStorage({ read: raw });
  const reading = readState(storage);
  assert.equal(reading.kind, 'unsupported');
  assert.equal(reading.readonly, true);
  assert.equal(reading.error.code, 'E_STORAGE_FUTURE');
  assert.equal(storage.getItem(KEY), raw);
});

test('统一应用的 envelope 落在旧键上 → unsupported，不当成损坏数据清掉', () => {
  const raw = JSON.stringify({ format: 'life-calendar', schemaVersion: 1, revision: 3, settings: {}, life: {}, modules: {}, provenance: [] });
  const reading = readState(memoryStorage({ read: raw }));
  assert.equal(reading.kind, 'corrupt');
  assert.equal(reading.readonly, true);
  assert.equal(reading.raw, raw);
});

test('写入未知字段被拒绝，已存内容不变', () => {
  const storage = memoryStorage({ read: JSON.stringify(legacy()) });
  const before = storage.getItem(KEY);
  assert.throws(() => writeState({ ...legacy(), bogus: 1 }, storage), (error) => error.code === 'E_UNKNOWN_FIELD');
  assert.equal(storage.getItem(KEY), before);
});

test('写入带未来 schemaVersion 的输入被拒绝，不被改写成 1', () => {
  const storage = memoryStorage({ read: JSON.stringify(legacy()) });
  const before = storage.getItem(KEY);
  assert.throws(() => writeState({ ...legacy(), schemaVersion: 9 }, storage), (error) => error.code === 'E_FUTURE_VERSION');
  assert.equal(storage.getItem(KEY), before);
  // 旧备份没有版本字段，内部模块包装不接受为旧输入。
  assert.throws(() => writeState({ ...legacy(), schemaVersion: 1 }, storage), error => error.code === 'E_UNKNOWN_FIELD');
  assert.equal(storage.getItem(KEY), before);
});

test('配额失败 → E_STORAGE_QUOTA，原有内容保持', () => {
  const storage = memoryStorage({ read: JSON.stringify(legacy()), onSet: () => { const error = new Error('quota'); error.name = 'QuotaExceededError'; throw error; } });
  const before = storage.getItem(KEY);
  assert.throws(() => writeState(legacy({ initialBalance: 999 }), storage), (error) => error.code === 'E_STORAGE_QUOTA');
  assert.equal(storage.getItem(KEY), before);
});

test('写入被浏览器拒绝 → E_STORAGE_FAILED（区分于配额）', () => {
  const storage = memoryStorage({ onSet: () => { throw new DOMException('denied', 'SecurityError'); } });
  assert.throws(() => writeState(legacy(), storage), (error) => error.code === 'E_STORAGE_FAILED');
});

test('正常写入：键与落盘字段与旧应用完全一致', () => {
  const storage = memoryStorage();
  const valid = writeState(legacy(), storage);
  assert.deepEqual(Object.keys(JSON.parse(storage.getItem(KEY))).sort(), ['events', 'initialBalance', 'simulationEvents']);
  assert.equal(valid.initialBalance, 100);
  assert.equal(valid.events[0].amount, -1200);
});

test('备份解析：合法备份可读，未知字段 / 未来版本 / 坏 JSON 都拒绝', () => {
  assert.equal(parseBackup(JSON.stringify(legacy())).events.length, 1);
  assert.throws(() => parseBackup(JSON.stringify({ ...legacy(), version: 2 })), (error) => error.code === 'E_UNKNOWN_FIELD');
  assert.throws(() => parseBackup(JSON.stringify({ ...legacy(), schemaVersion: 5 })), (error) => error.code === 'E_FUTURE_VERSION');
  assert.throws(() => parseBackup('not json'), (error) => error.code === 'E_JSON_INVALID');
  assert.throws(() => parseBackup(JSON.stringify({ initialBalance: '100' })), (error) => error.code === 'E_SCHEMA_INVALID' || error.code === 'E_AMOUNT_INVALID');
});

test('有符号金额、零金额、永久次数原样往返', () => {
  const input = legacy({
    initialBalance: 0,
    events: [
      { id: 'r1', name: '虚构：冲红', type: 'expense', amount: 80, date: '2026-10-02', isRecurring: false, recurringType: 'none', isPermanent: false, canSkip: false, isSimulation: false },
      { id: 'z1', name: '虚构：零额', type: 'income', amount: 0, date: '2026-10-03', isRecurring: false, recurringType: 'none', isPermanent: false, canSkip: false, isSimulation: false },
      { id: 'p1', name: '虚构：永久', type: 'expense', amount: -30, date: '2026-10-04', isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-10-04', recurringEndDate: '', isPermanent: true, occurrenceCount: 1, canSkip: true, isSimulation: false, skippedDates: ['2026-11-04'] },
    ],
  });
  const parsed = parseBackup(JSON.stringify(input));
  for (const original of input.events) {
    const restored = parsed.events.find(event => event.id === original.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(restored[key], value);
  }
  const permanent = parsed.events.find((event) => event.id === 'p1');
  assert.equal(permanent.occurrenceCount, 1);
  assert.deepEqual(permanent.skippedDates, ['2026-11-04']);
  assert.equal(parsed.events.find((event) => event.id === 'r1').amount, 80);
  assert.equal(parsed.events.find((event) => event.id === 'z1').amount, 0);
});

test('清除：删除键并回到默认状态', () => {
  const storage = memoryStorage({ read: JSON.stringify(legacy()) });
  clearState(storage);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(readState(storage).kind, 'empty');
  assert.deepEqual(DEFAULT_STATE, { initialBalance: 10000, events: [], simulationEvents: [] });
  const broken = memoryStorage({ onRemove: () => { throw new Error('nope'); } });
  assert.throws(() => clearState(broken), (error) => error.code === 'E_STORAGE_FAILED');
});
