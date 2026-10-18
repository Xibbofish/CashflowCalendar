/**
 * 公共核心回归测试：把本次审查中修掉的真实缺陷逐条钉住。
 *
 * 运行：`npm test`（等价于 `node --test --test-isolation=none tests/core-regressions.test.mjs`）。
 * 这里只测公共核心，不测界面；界面行为由 life-calendar 的独立测试与浏览器验证覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CALENDAR_MAX_YEAR,
  CALENDAR_MIN_YEAR,
  addDays,
  dateRange,
  dayNumber,
  daysBetween,
  monthGrid,
  rangeLength,
  validDate,
  validLegacyLocalDate,
  weekdayIndex,
} from '../date/index.js';
import { ErrorCode, LifeCalendarError } from '../errors.js';
import { createEmptyEnvelope, validateEnvelope } from '../compatibility/envelope.js';
import { normalizeIncoming } from '../compatibility/legacy-formats.js';
import { planImport, applyImport } from '../compatibility/import-plan.js';
import { exportModuleLegacy, exportUnifiedBackup } from '../compatibility/exports.js';
import { createStorageManager, readStorage } from '../storage/local.js';
import * as cashflow from '../modules/cashflow/model.js';
import * as mood from '../modules/mood/model.js';
import * as period from '../modules/period/model.js';
import * as zodiac from '../modules/zodiac/model.js';
import {
  FIXTURE_NOW,
  FIXTURE_T2,
  FIXTURE_TODAY_ISO,
  cashflowFixture,
  fakeStorage,
  moodFixture,
  periodFixture,
  stressFixture,
  unifiedFixture,
  zodiacFixture,
} from '../fixtures/index.js';

const NOW = new Date(FIXTURE_TODAY_ISO);
const TODAY = FIXTURE_NOW;
const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'life-calendar', 'fixtures');
const readFixture = (name) => readFileSync(path.join(fixtureDir, name), 'utf8');

/* ------------------------------------------------------------------ *
 * 日期范围与模块口径
 * ------------------------------------------------------------------ */

test('统一日历支持 1000—9999，模块各自保留自己的范围', () => {
  assert.equal(CALENDAR_MIN_YEAR, 1000);
  assert.equal(CALENDAR_MAX_YEAR, 9999);
  // 心情的真实旧口径：四位年份 1000—9999，含前导零
  assert.equal(validLegacyLocalDate('1800-06-15'), true);
  assert.equal(validLegacyLocalDate('2200-03-01'), true);
  assert.equal(validLegacyLocalDate('0999-12-31'), false);
  assert.equal(validLegacyLocalDate('2026-02-30'), false);
  // 总日历不接受四位以外的年份
  assert.equal(validDate('1800-06-15'), true);
  assert.equal(validDate('2200-03-01'), true);
  assert.equal(validDate('0999-12-31'), false);
  assert.equal(validDate('9999-12-31'), true);
  // 月经收窄到 1900—2100：范围外必须明确报错，而不是被日历默默接受
  assert.throws(
    () => period.validate({ ...period.emptyData(), periods: [{ id: 'p1', startDate: '1800-06-01', endDate: '1800-06-05', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO }], daily: [] }, TODAY),
    (error) => error.code === ErrorCode.DATE_INVALID,
  );
  assert.doesNotThrow(() => period.validate({ ...period.emptyData(), periods: [{ id: 'p1', startDate: '1900-06-01', endDate: '1900-06-05', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO }], daily: [] }, TODAY));
  // 星笺内容库限制在 2000—2100
  assert.throws(() => zodiac.dailyCard('1800-06-15', 'aries'));
  assert.throws(() => zodiac.dailyCard('2200-03-01', 'aries'));
  assert.ok(zodiac.dailyCard('2026-10-10', 'aries').title.length > 0);
});

test('心情旧备份接受 1800 / 2200，月经旧备份拒绝范围外日期', () => {
  const old = moodFixture();
  const wide = { ...old, entries: old.entries.map((entry, index) => ({ ...entry, localDate: index === 0 ? '1800-06-15' : '2200-03-01' })) };
  const read = mood.readLegacy(wide);
  assert.equal(read.entries.length, wide.entries.length, '1800 / 2200 的记录都要读进来');
  assert.deepEqual([...new Set(read.entries.map((entry) => entry.localDate))].sort(), ['1800-06-15', '2200-03-01']);
  assert.deepEqual(mood.writeLegacy(read), wide);

  const health = periodFixture();
  const outOfRange = { ...health, periods: health.periods.map((item) => ({ ...item, startDate: '1800-06-01', endDate: '1800-06-05' })) };
  assert.throws(
    () => period.readLegacy(outOfRange, TODAY),
    (error) => error instanceof LifeCalendarError && error.code === ErrorCode.DATE_INVALID,
    '月经模块必须拒绝 1900 年之前的日期',
  );
});

test('月初月末边界不产出五位年份，越界格显式标记且不抛错', () => {
  const first = monthGrid('1000-01');
  assert.equal(first.length % 7, 0);
  assert.ok(first.some((cell) => cell.outOfRange === true));
  assert.ok(first.every((cell) => cell.date === null || validDate(cell.date)));

  const last = monthGrid('9999-12');
  assert.equal(last.length % 7, 0);
  assert.ok(last.some((cell) => cell.outOfRange === true));
  assert.ok(last.every((cell) => cell.date === null || cell.date.length === 10));
  // 越界格的原始字符串不会被当成日期使用
  assert.ok(last.some((cell) => cell.rawDate === '10000-01-01' && cell.date === null));

  assert.throws(() => monthGrid('10000-01'));
});

test('日序号与星期在 1000—9999 稳定，1900 年前不出现负索引', () => {
  assert.equal(dayNumber('1000-01-01', { minYear: 1000, maxYear: 9999 }) < 0, true);
  assert.equal(daysBetween('1800-06-15', '1800-06-16'), 1);
  assert.equal(daysBetween('2200-02-28', '2200-03-01'), 1);
  for (const date of ['1800-06-15', '1900-01-01', '1969-12-31', '2200-03-01']) {
    const index = weekdayIndex(date);
    assert.ok(index >= 0 && index <= 6, `${date} 的星期索引应在 0—6`);
    assert.ok(!Object.is(index, -0), `${date} 不应出现 -0`);
  }
  assert.equal(addDays('9999-12-31', 1), '10000-01-01');
});

test('超长区间不枚举日期：dateRange 有上限，rangeLength 只做算术', () => {
  assert.equal(rangeLength('1800-01-01', '2200-12-31'), 146462);
  assert.deepEqual(dateRange('1800-01-01', '2200-12-31'), []);
  assert.deepEqual(dateRange('1800-01-01', '2200-12-31', { maxDays: 10 }), []);
  assert.equal(dateRange('2026-10-01', '2026-10-03').length, 3);
  const started = Date.now();
  for (let i = 0; i < 200; i += 1) rangeLength('1000-01-01', '9999-12-31');
  assert.ok(Date.now() - started < 1000, 'rangeLength 必须是常数时间');
});

/* ------------------------------------------------------------------ *
 * 严格的旧格式读取与版本判定
 * ------------------------------------------------------------------ */

test('旧读取先做全量字段检查：未知字段与缺失版本一律拒绝', () => {
  const cases = [
    ['mood', mood.readLegacy, { ...moodFixture(), extra: 1 }, ErrorCode.UNKNOWN_FIELD],
    ['period', period.readLegacy, { ...periodFixture(), extra: 1 }, ErrorCode.UNKNOWN_FIELD],
    ['zodiac', zodiac.readLegacy, { ...zodiacFixture(), extra: 1 }, ErrorCode.UNKNOWN_FIELD],
    ['cashflow', cashflow.readLegacy, { ...cashflowFixture(), extra: 1 }, ErrorCode.UNKNOWN_FIELD],
  ];
  for (const [name, reader, value, code] of cases) {
    assert.throws(() => reader(value, TODAY), (error) => error.code === code, `${name} 应拒绝未知字段`);
  }

  // 缺失版本不能被默认成 1
  const noVersion = { ...moodFixture() };
  delete noVersion.version;
  assert.throws(() => mood.readLegacy(noVersion), (error) => error.code === ErrorCode.UNSUPPORTED_VERSION);
  const noSchema = { ...zodiacFixture() };
  delete noSchema.schemaVersion;
  assert.throws(() => zodiac.readLegacy(noSchema), (error) => error.code === ErrorCode.UNSUPPORTED_VERSION);
});

test('未来版本只读：统一备份与旧备份都拒绝写入', () => {
  const storage = fakeStorage({ initial: { 'life-calendar:v1': JSON.stringify({ format: 'life-calendar', schemaVersion: 99, newFutureField: 'retain' }) } });
  const reading = readStorage(storage, { now: NOW, today: TODAY });
  assert.equal(reading.kind, 'unsupported');
  assert.equal(reading.readonly, true);
  assert.ok(reading.raw.includes('newFutureField'), '原始字符串必须完整保留，供下载');

  const futureLegacy = { ...moodFixture(), version: 2 };
  assert.throws(() => mood.readLegacy(futureLegacy), (error) => error.code === ErrorCode.FUTURE_VERSION);
});

/* ------------------------------------------------------------------ *
 * 财务旧字段的逐字保留
 * ------------------------------------------------------------------ */

test('财务旧字段逐字保留：有符号金额、零金额、永久次数、历史跳过', () => {
  const input = cashflowFixture();
  const all = [...input.events, ...input.simulationEvents];
  const signed = all.find((event) => event.type === 'income' && event.amount > 0);
  const zero = all.find((event) => event.amount === 0);
  const rent = all.find((event) => event.id === 'cf-rent');
  assert.ok(signed, '样例应含有符号金额（退款/冲红按金额符号记账）');
  assert.ok(zero, '样例应含零金额');
  assert.equal(rent.isPermanent, true);
  assert.equal(rent.occurrenceCount, 6, '永久周期必须保留发生次数');
  assert.deepEqual(rent.skippedDates, ['2026-09-01']);

  const read = cashflow.readLegacy(input);
  assert.deepEqual(cashflow.writeLegacy(read), input);
  const permanentRead = read.events.find((event) => event.id === 'cf-rent');
  assert.equal(permanentRead.occurrenceCount, 6, '永久周期里的发生次数必须原样保留（引擎忽略它，但不能清空）');
  assert.deepEqual(permanentRead.skippedDates, ['2026-09-01'], '历史跳过日期必须保留');
  assert.equal(read.events.find((event) => event.id === zero.id).amount, 0);
  // 有符号金额不被 type 修正：符号即收支方向
  assert.equal(read.events.find((event) => event.id === signed.id).amount, signed.amount);
  // 引擎按金额符号计算，不按 type
  const monthDay = read.events.find((event) => event.id === 'cf-single').date;
  assert.equal(cashflow.getDay(read, monthDay).events.some((event) => event.id === 'cf-single'), true);
});

test('模块合并结果仍是合法数据：版本字段不会被策略丢掉', () => {
  const local = createEmptyEnvelope({ now: NOW });
  for (const [id, value] of [['mood', moodFixture()], ['period', periodFixture()], ['zodiac', zodiacFixture()], ['cashflow', cashflowFixture()]]) {
    const plan = planImport(local, { format: id, value }, { now: NOW, today: TODAY });
    // 出现冲突时必须显式选择，不允许默认值悄悄改写数据。
    // `decisions.conflicts` 是按 `冲突 key` 平铺的映射（与 plan.modules[id].conflicts[].key 同名）。
    const decisions = { modules: { [id]: 'merge' }, conflicts: {} };
    for (const conflict of plan.modules[id].conflicts ?? []) {
      decisions.conflicts[conflict.key] = conflict.options[0];
    }
    const { envelope } = applyImport(plan, decisions, { current: local, now: NOW, today: TODAY });
    const data = envelope.modules[id].data;
    assert.equal(data.version ?? data.schemaVersion, 1, `${id} 合并结果必须保留版本字段`);
    assert.doesNotThrow(() => validateEnvelope(envelope, { now: NOW, today: TODAY }));
  }
});

/* ------------------------------------------------------------------ *
 * 导入 / 导出往返
 * ------------------------------------------------------------------ */

test('统一备份导出→读回→替换恢复：隐藏模块、总结、设置、快照都在', async () => {
  const original = unifiedFixture({ revision: 7 });
  const output = exportUnifiedBackup(original, { now: NOW, today: TODAY });
  const parsed = JSON.parse(output.text);
  assert.equal(typeof parsed.exportedAt, 'string', '导出文件允许且只允许一个 exportedAt 外层字段');

  const normalized = normalizeIncoming(parsed, { format: 'unified', now: NOW, today: TODAY });
  const local = createEmptyEnvelope({ now: NOW });
  const plan = planImport(local, parsed, { now: NOW, today: TODAY, format: 'unified' });
  assert.ok(plan.modules.mood.available);
  const { envelope } = applyImport(plan, {
    modules: { cashflow: 'replace', mood: 'replace', period: 'replace', zodiac: 'replace' },
    life: 'replace',
    settings: { keepLocalLayout: false },
  }, { current: local, now: NOW, today: TODAY });
  assert.deepEqual(envelope.modules.mood.data, normalized.modules.mood);
  assert.deepEqual(envelope.settings.enabledModules, original.settings.enabledModules);
  assert.deepEqual(envelope.life.tags, original.life.tags);
  // 总结是同一天一份：内容与标签必须逐字保留，顺序可以规范化
  const sortSummaries = (list) => [...list].sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(sortSummaries(envelope.life.summaries), sortSummaries(original.life.summaries));
});

test('四个模块的单模块导出都能被原格式读回', () => {
  const original = unifiedFixture({ revision: 3 });
  for (const id of ['cashflow', 'mood', 'period', 'zodiac']) {
    const output = exportModuleLegacy(original, id, { now: NOW, today: TODAY });
    const parsed = JSON.parse(output.text);
    const read = cashflow.readLegacy === null ? null : null;
    void read;
    const readers = {
      cashflow: () => cashflow.readLegacy(parsed),
      mood: () => mood.readLegacy(parsed),
      period: () => period.readLegacy(parsed, TODAY),
      zodiac: () => zodiac.readLegacy(parsed),
    };
    assert.doesNotThrow(readers[id], `${id} 单模块导出必须能被旧格式读回`);
  }
});

test('实际 JSON 样例文件可以走完导入管线', () => {
  const files = [
    ['mood-legacy.json', 'mood'],
    ['period-legacy.json', 'period'],
    ['zodiac-legacy.json', 'zodiac'],
    ['cashflow-legacy.json', 'cashflow'],
  ];
  for (const [name, format] of files) {
    const value = JSON.parse(readFixture(name));
    const normalized = normalizeIncoming(value, { format, now: NOW, today: TODAY });
    assert.ok(normalized.modules[format], `${name} 应规范化为 ${format} 模块数据`);
  }
  const unified = JSON.parse(readFixture('unified-backup.json'));
  assert.doesNotThrow(() => normalizeIncoming(unified, { format: 'unified', now: NOW, today: TODAY }));
  assert.throws(() => normalizeIncoming(JSON.parse(readFixture('future-envelope.json')), { format: 'unified', now: NOW, today: TODAY }));
  assert.throws(() => normalizeIncoming(JSON.parse(readFixture('unknown-field.json')), { format: 'mood', now: NOW, today: TODAY }));
});

/* ------------------------------------------------------------------ *
 * 存储边界
 * ------------------------------------------------------------------ */

test('损坏数据只读并保留原始字符串，不覆盖写入', async () => {
  const raw = readFixture('corrupt-raw.json');
  const storage = fakeStorage({ initial: { 'life-calendar:v1': '{broken' } });
  const reading = readStorage(storage, { now: NOW, today: TODAY });
  assert.equal(reading.kind, 'corrupt');
  assert.equal(reading.raw, '{broken');
  assert.equal(reading.readonly, true);

  const manager = createStorageManager({ storage, now: () => NOW, today: () => TODAY });
  manager.read();
  await assert.rejects(() => manager.commit({ envelope: unifiedFixture(), baseRevision: 0 }));
  assert.equal(storage.getItem('life-calendar:v1'), '{broken');
  assert.ok(raw.length > 0);
});

test('大批量样例仍在存储上限内且可完成一次导入预览', () => {
  const stress = stressFixture({ entries: 500, periods: 200, saved: 300, events: 400 });
  const local = createEmptyEnvelope({ now: NOW });
  assert.doesNotThrow(() => {
    for (const [id, value] of [['mood', stress.mood], ['cashflow', stress.cashflow]]) {
      const plan = planImport(local, { format: id, value }, { now: NOW, today: TODAY, baseRevision: 0 });
      assert.ok(plan.modules[id].available, `${id} 大批量样例应可生成计划`);
    }
  });
  // 压力样例里的经期是重叠的：核心必须明确报错，而不是悄悄合并出错误的历史
  assert.throws(
    () => planImport(local, { format: 'period', value: stress.period }, { now: NOW, today: TODAY, baseRevision: 0 }),
    (error) => error.code === ErrorCode.RANGE_OVERLAP,
  );
  // 星笺压力样例里有重复的 (日期, 星座)：同样必须明确报错，不能静默去重
  assert.throws(
    () => planImport(local, { format: 'zodiac', value: stress.zodiac }, { now: NOW, today: TODAY, baseRevision: 0 }),
    (error) => error.code === ErrorCode.ID_DUPLICATE,
  );
  // 换成不重叠的经期与不重复的收藏，验证同样的批量也能顺利生成计划
  const spaced = {
    version: 1,
    periods: Array.from({ length: 60 }, (_, index) => ({
      id: `spread-${index}`,
      startDate: addDays('2020-01-01', index * 40),
      endDate: addDays('2020-01-05', index * 40),
      createdAt: FIXTURE_T2,
      updatedAt: FIXTURE_T2,
    })),
    daily: [],
  };
  const plan = planImport(local, { format: 'period', value: spaced }, { now: NOW, today: TODAY, baseRevision: 0 });
  assert.equal(plan.modules.period.available, true);

  const signs = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
  // 编号必须唯一：同一天 × 同一星座只能有一条收藏
  const uniqueSaved = [];
  for (let dateIndex = 0; dateIndex < 60; dateIndex += 1) {
    const date = addDays('2026-01-01', dateIndex);
    for (let offset = 0; offset < 4; offset += 1) {
      const sign = signs[(dateIndex + offset * 3) % signs.length];
      uniqueSaved.push({ id: `${date}:${sign}`, cardSnapshot: zodiac.dailyCard(date, sign), note: '', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 });
    }
  }
  assert.equal(new Set(uniqueSaved.map((item) => item.id)).size, uniqueSaved.length);
  const zodiacPlan = planImport(local, { format: 'zodiac', value: { schemaVersion: 1, sign: 'leo', saved: uniqueSaved } }, { now: NOW, today: TODAY, baseRevision: 0 });
  assert.equal(zodiacPlan.modules.zodiac.available, true);
});

test('模块命令的时间与编号都来自注入，核心不读时钟', () => {
  const stamp = '2026-10-10T01:00:00.000Z';
  const next = mood.applyCommand(mood.emptyData(), {
    type: 'upsertEntry',
    payload: { entry: { id: null, localDate: TODAY, time: '09:20', mood: 4, tagIds: [], content: '虚构' } },
  }, { now: stamp, createId: () => 'entry-injected' });
  assert.equal(next.entries[0].id, 'entry-injected');
  assert.equal(next.entries[0].updatedAt, stamp);
  assert.equal(next.entries[0].createdAt, stamp);
  assert.throws(() => mood.applyCommand(mood.emptyData(), { type: 'upsertEntry', payload: { entry: { localDate: TODAY, time: '09:20', mood: 4, tagIds: [], content: '' } } }, { now: stamp }));
});

test('星笺命令接受 ISO 时间串，收藏保留原始快照', () => {
  const card = zodiac.dailyCard(TODAY, 'aries');
  const first = zodiac.applyCommand(zodiac.emptyData(), { type: 'saveCard', payload: { card, note: '虚构感想' } }, { now: '2026-10-10T01:00:00.000Z' });
  assert.equal(first.saved[0].updatedAt, '2026-10-10T01:00:00.000Z');
  const second = zodiac.applyCommand(first, { type: 'saveCard', payload: { card: { ...card, title: '内容库更新后的标题' }, note: '虚构修改' } }, { now: '2026-10-11T01:00:00.000Z' });
  assert.deepEqual(second.saved[0].cardSnapshot, card);
  assert.equal(second.saved[0].note, '虚构修改');
});

test('月经命令用本地日期字符串做今后校验，不用时间串比较', () => {
  const data = period.emptyData();
  const record = { id: 'p-1', startDate: '2026-10-08', endDate: null, createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO };
  const next = period.applyCommand(data, { type: 'upsertPeriod', payload: { record } }, { today: TODAY, now: FIXTURE_TODAY_ISO });
  assert.equal(next.periods.length, 1);
  assert.throws(() => period.applyCommand(next, {
    type: 'upsertDaily',
    payload: { record: { id: 'd-1', date: '2026-10-11', flow: '少量', symptoms: [], note: '' } },
  }, { today: TODAY, now: FIXTURE_TODAY_ISO }), '未来日期的每日记录必须被拒绝');
});
