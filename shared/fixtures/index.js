/**
 * 虚构 fixtures：四种旧备份、统一备份、病态样例与兼容矩阵数据。
 *
 * 约束：
 * - 全部为虚构内容，不含任何真实个人记录。
 * - 时间戳固定，保证测试与黄金文件可重复。
 * - `life-calendar/fixtures/*.json` 由本文件生成（`scripts/write-fixtures.mjs`），不要手工改 JSON。
 */
import { dailyCard } from '../modules/zodiac/model.js';

/** 固定参考点，避免测试依赖当前时间。 */
export const FIXTURE_NOW = '2026-10-10';
export const FIXTURE_TODAY_ISO = '2026-10-10T01:00:00.000Z';
export const FIXTURE_T2 = '2026-10-09T22:00:00.000Z';

const at = (iso) => iso;

/** 心情旧备份（`version:1`，键 `liuyiye-journal-v1`）。 */
export function moodFixture() {
  return {
    version: 1,
    tags: [
      { id: 'walk', name: '散步' },
      { id: 'work', name: '工作' },
      { id: 'sleep', name: '睡眠' },
    ],
    entries: [
      { id: 'm-1001', localDate: '2026-10-08', time: '08:10', mood: 4, tagIds: ['walk'], content: '虚构：早上的风很轻。', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
      { id: 'm-1002', localDate: '2026-10-10', time: '09:20', mood: 3, tagIds: ['work', 'sleep'], content: '虚构：开会前有一点困。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: 'm-1003', localDate: '2026-10-10', time: '21:40', mood: 5, tagIds: ['walk'], content: '虚构：晚上散步遇到了猫。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: 'm-1004', localDate: '2026-09-30', time: '23:00', mood: 1, tagIds: [], content: '', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
    ],
  };
}

/** 带来标签重映射的同名/占位标签副本（用于冲突与映射测试）。 */
export function moodFixtureRemap() {
  const base = moodFixture();
  return {
    version: 1,
    tags: [
      { id: 'walk', name: '散步' },
      { id: 'remote-sleep', name: '睡眠' },
    ],
    entries: [
      { id: 'm-2001', localDate: '2026-10-10', time: '07:00', mood: 2, tagIds: ['remote-sleep'], content: '虚构：换设备后的记录。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      // 与 m-1001 同 ID 不同内容 → 冲突
      { id: 'm-1001', localDate: '2026-10-08', time: '08:10', mood: 2, tagIds: ['walk'], content: '虚构：同 ID 的不同内容。', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
    ],
  };
}

/** 月经旧备份（键 `period-journal:v1`）。 */
export function periodFixture() {
  return {
    version: 1,
    periods: [
      { id: 'p-sep', startDate: '2026-09-12', endDate: '2026-09-16', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
      { id: 'p-oct', startDate: '2026-10-08', endDate: null, createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
    ],
    daily: [
      { id: 'd-1008', date: '2026-10-08', flow: '少量', symptoms: ['疲倦'], note: '虚构：第一天。' },
      { id: 'd-1010', date: '2026-10-10', flow: '适中', symptoms: ['腹部不适', '疲倦'], note: '虚构：今天好一些。' },
    ],
  };
}

/** 跨月区间 + 冲突样本：与基础数据同一天不同内容、区间重叠。 */
export function periodFixtureConflicts() {
  return {
    version: 1,
    periods: [
      // 与 p-oct 重叠：不能“保留两份”
      { id: 'p-overlap', startDate: '2026-10-10', endDate: '2026-10-13', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: 'p-cross', startDate: '2026-09-28', endDate: '2026-10-02', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
    ],
    daily: [
      // 与 d-1010 同一天不同内容 → 冲突
      { id: 'd-dup', date: '2026-10-10', flow: '较多', symptoms: ['头痛'], note: '虚构：同一天的不同记录。' },
    ],
  };
}

/** 星笺旧备份（键 `zodiac-journal:v1`）。 */
export function zodiacFixture() {
  const snapshot = dailyCard('2026-10-10', 'aries');
  return {
    schemaVersion: 1,
    sign: 'aries',
    saved: [
      { id: '2026-10-10:aries', cardSnapshot: snapshot, note: '虚构：这句刚好说到我。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: '2026-10-09:virgo', cardSnapshot: dailyCard('2026-10-09', 'virgo'), note: '', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
    ],
  };
}

/** 快照与感想都不同的星笺副本（偏好 sign 变化单独选择）。 */
export function zodiacFixtureConflicts() {
  const base = zodiacFixture();
  const changed = { ...base.saved[0].cardSnapshot, title: '虚构：内容库更新后的新文案', contentVersion: 'original-2' };
  return {
    schemaVersion: 1,
    sign: 'pisces',
    saved: [
      { id: '2026-10-10:aries', cardSnapshot: changed, note: '虚构：改过的感想。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: '2026-10-11:pisces', cardSnapshot: dailyCard('2026-10-11', 'pisces'), note: '虚构：新的收藏。', createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
    ],
  };
}

/** 现金流旧备份（键 `cashflow-calendar-data`，无顶层版本）。 */
export function cashflowFixture() {
  return {
    initialBalance: 8600.5,
    events: [
      {
        id: 'cf-salary', name: '虚构工资', type: 'income', amount: 12000, date: '',
        isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-07-05', recurringEndDate: '',
        isPermanent: true, occurrenceCount: null, canSkip: false, isSimulation: false,
        category: '工资', description: '虚构：每月固定收入', skippedDates: [],
      },
      {
        id: 'cf-rent', name: '虚构房租', type: 'expense', amount: -3200, date: '',
        isRecurring: true, recurringType: 'monthly', recurringStartDate: '2026-07-01', recurringEndDate: '',
        // 永久周期同时保留历史次数与跳过字段：必须完整往返
        isPermanent: true, occurrenceCount: 6, canSkip: true, isSimulation: false,
        category: '房租', description: '', skippedDates: ['2026-09-01'],
      },
      {
        id: 'cf-insurance', name: '虚构保险', type: 'expense', amount: -1288.88, date: '',
        isRecurring: true, recurringType: 'yearly', recurringStartDate: '2024-02-29', recurringEndDate: '',
        isPermanent: false, occurrenceCount: 2, canSkip: false, isSimulation: false,
        category: '保险', description: '虚构：闰日起算', skippedDates: [],
      },
      {
        id: 'cf-single', name: '虚构退款', type: 'income', amount: 68, date: '2026-10-10',
        isRecurring: false, recurringType: 'none', recurringStartDate: '', recurringEndDate: '',
        isPermanent: false, occurrenceCount: null, canSkip: false, isSimulation: false,
        category: '其他', description: '虚构：当天到账', skippedDates: [],
      },
      // 金额为 0 的陈旧记录：必须保留，不能丢弃或改写符号
      {
        id: 'cf-zero', name: '虚构零额记录', type: 'expense', amount: 0, date: '2026-10-10',
        isRecurring: false, recurringType: 'none', recurringStartDate: '', recurringEndDate: '',
        isPermanent: false, occurrenceCount: null, canSkip: false, isSimulation: false,
        category: '', description: '虚构：金额为 0 的历史记录', skippedDates: [],
      },
      {
        id: 'cf-old', name: '虚构基准前记录', type: 'income', amount: 1000, date: '2026-06-01',
        isRecurring: false, recurringType: 'none', recurringStartDate: '', recurringEndDate: '',
        isPermanent: false, occurrenceCount: null, canSkip: false, isSimulation: false,
        category: '其他', description: '虚构：早于计算基准', skippedDates: [],
      },
    ],
    simulationEvents: [
      {
        id: 'cf-sim', name: '虚构模拟换机', type: 'expense', amount: -5000, date: '2026-11-15',
        isRecurring: false, recurringType: 'none', recurringStartDate: '', recurringEndDate: '',
        isPermanent: false, occurrenceCount: null, canSkip: false, isSimulation: true,
        category: '购物', description: '虚构：模拟方案', skippedDates: [],
      },
    ],
  };
}

/** 与基础数据冲突的现金流副本：initialBalance 不同、同 ID 不同内容、疑似重复。 */
export function cashflowFixtureConflicts() {
  const base = cashflowFixture();
  const renamedRent = { ...base.events[1], name: '虚构房租（改过）', amount: -3400 };
  return {
    initialBalance: 9000,
    events: [
      renamedRent,
      // 不同 ID、同名同金额 → 只提示疑似重复
      { ...base.events[2], id: 'cf-insurance-copy' },
    ],
    simulationEvents: [],
  };
}

/** 默认设置。 */
export function defaultSettings() {
  return {
    enabledModules: { cashflow: true, mood: true, period: true, zodiac: true },
    moduleOrder: ['mood', 'cashflow', 'period', 'zodiac'],
    defaultSign: 'aries',
    calendarIncludeSimulation: false,
  };
}

/** 统一 envelope 的“生活”部分样例。 */
export function lifeFixture() {
  return {
    schemaVersion: 1,
    summaries: [
      { id: 'sum-1010', date: '2026-10-10', content: '虚构：今天把计划理清楚了。', tagIds: ['st-plan'], createdAt: FIXTURE_TODAY_ISO, updatedAt: FIXTURE_TODAY_ISO },
      { id: 'sum-1009', date: '2026-10-09', content: '虚构：早睡的一天。', tagIds: [], createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 },
    ],
    tags: [
      { id: 'st-plan', name: '计划' },
      { id: 'st-rest', name: '休息' },
    ],
  };
}

/** 统一备份（完整 envelope，用于“恢复完整备份”）。 */
export function unifiedFixture({ revision = 7 } = {}) {
  return {
    format: 'life-calendar',
    schemaVersion: 1,
    revision,
    updatedAt: FIXTURE_TODAY_ISO,
    settings: defaultSettings(),
    life: lifeFixture(),
    modules: {
      cashflow: { schemaVersion: 1, data: { schemaVersion: 1, ...cashflowFixture() } },
      mood: { schemaVersion: 1, data: moodFixture() },
      period: { schemaVersion: 1, data: periodFixture() },
      zodiac: { schemaVersion: 1, data: zodiacFixture() },
    },
    provenance: [
      { at: FIXTURE_TODAY_ISO, source: 'file', format: 'unified', module: null, added: 0, identical: 0, conflicts: 0, batches: 1 },
    ],
  };
}

/** 空 envelope：第一次使用时的初始化状态。 */
export function emptyEnvelope() {
  return {
    format: 'life-calendar',
    schemaVersion: 1,
    revision: 0,
    updatedAt: FIXTURE_TODAY_ISO,
    settings: defaultSettings(),
    life: { schemaVersion: 1, summaries: [], tags: [] },
    modules: {
      cashflow: { schemaVersion: 1, data: { schemaVersion: 1, initialBalance: 10000, events: [], simulationEvents: [] } },
      mood: { schemaVersion: 1, data: { version: 1, entries: [], tags: [{ id: 'tag-0', name: '睡眠' }] } },
      period: { schemaVersion: 1, data: { version: 1, periods: [], daily: [] } },
      zodiac: { schemaVersion: 1, data: { schemaVersion: 1, sign: 'aries', saved: [] } },
    },
    provenance: [],
  };
}

/** 未来版本样例：必须拒绝写入并允许保留原文件。 */
export function futureEnvelopeFixture() {
  return { ...unifiedFixture(), schemaVersion: 2, futureField: { note: '由更高版本写入' } };
}

/** 未来版本的旧格式样例。 */
export function futureLegacyFixture(format = 'mood') {
  const base = format === 'period' ? periodFixture() : format === 'zodiac' ? zodiacFixture() : format === 'cashflow' ? cashflowFixture() : moodFixture();
  const key = format === 'zodiac' ? 'schemaVersion' : 'version';
  return { ...base, [key]: 2 };
}

/** 损坏样例（可 JSON 解析但结构错误）。 */
export function corruptFixtureSample() {
  return { version: 1, entries: [{ id: 'x', localDate: '2026-02-30', time: '25:00', mood: 9, tagIds: ['missing'], content: null, createdAt: 'bad', updatedAt: 'bad' }], tags: [] };
}

/** 含未知字段的样例：必须被拒绝（统一与旧格式一致）。 */
export function unknownFieldFixture(format = 'mood') {
  const base = format === 'period' ? periodFixture() : format === 'zodiac' ? zodiacFixture() : format === 'cashflow' ? cashflowFixture() : moodFixture();
  return { ...base, unrecognizedFutureField: '保留还是拒绝由契约决定：拒绝' };
}

/** 存储不可用/配额失败用的假 storage。 */
export function fakeStorage({ initial = {}, failOnSet = null, failOnGet = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      if (failOnGet) throw new Error('storage disabled');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (failOnSet) {
        const error = new Error(failOnSet);
        error.name = failOnSet;
        throw error;
      }
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    _map: map,
  };
}

/** 同源旧键集合：用于“从本站旧应用读取”的测试。 */
export function legacyKeyMap({ includeCashflow = true } = {}) {
  return {
    'liuyiye-journal-v1': JSON.stringify(moodFixture()),
    'period-journal:v1': JSON.stringify(periodFixture()),
    'zodiac-journal:v1': JSON.stringify(zodiacFixture()),
    ...(includeCashflow ? { 'cashflow-calendar-data': JSON.stringify(cashflowFixture()) } : {}),
  };
}

/** 压力样例：条数上限附近的虚构数据（默认小规模，测试按需放大）。 */
export function stressFixture({ entries = 500, periods = 200, saved = 300, events = 400 } = {}) {
  const moods = { version: 1, tags: [{ id: 'walk', name: '散步' }], entries: [] };
  for (let i = 0; i < entries; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    moods.entries.push({
      id: `stress-m-${i}`, localDate: `2026-09-${day}`, time: `${String(i % 24).padStart(2, '0')}:00`,
      mood: (i % 5) + 1, tagIds: [], content: `虚构压力样本 ${i}`,
      createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2,
    });
  }
  const period = { version: 1, periods: [], daily: [] };
  for (let i = 0; i < periods; i += 1) {
    const month = String((i % 9) + 1).padStart(2, '0');
    const start = `2025-${month}-01`;
    period.periods.push({ id: `stress-p-${i}`, startDate: start, endDate: `2025-${month}-05`, createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 });
  }
  const zodiac = { schemaVersion: 1, sign: 'leo', saved: [] };
  const signs = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
  for (let i = 0; i < saved; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const date = `2026-08-${day}`;
    const sign = signs[i % signs.length];
    zodiac.saved.push({ id: `${date}:${sign}`, cardSnapshot: dailyCard(date, sign), note: '', createdAt: FIXTURE_T2, updatedAt: FIXTURE_T2 });
  }
  const cashflow = { initialBalance: 1000, events: [], simulationEvents: [] };
  for (let i = 0; i < events; i += 1) {
    cashflow.events.push({
      id: `stress-cf-${i}`, name: `虚构样本 ${i}`, type: i % 2 ? 'income' : 'expense', amount: i % 2 ? 100 : -100,
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, isRecurring: false, recurringType: 'none',
      recurringStartDate: '', recurringEndDate: '', isPermanent: false, occurrenceCount: null, canSkip: false,
      isSimulation: false, category: '', description: '', skippedDates: [],
    });
  }
  return { mood: moods, period, zodiac, cashflow };
}

/** 兼容矩阵驱动数据：格式 → { sample, maxBytes, notes }。 */
export const FORMAT_MATRIX = [
  { id: 'mood', label: '心情日记', key: 'liuyiye-journal-v1', versionField: 'version', maxBytes: 20 * 1024 * 1024 },
  { id: 'period', label: '月经记录本', key: 'period-journal:v1', versionField: 'version', maxBytes: 5 * 1024 * 1024 },
  { id: 'zodiac', label: '每日星笺', key: 'zodiac-journal:v1', versionField: 'schemaVersion', maxBytes: 10 * 1024 * 1024 },
  { id: 'cashflow', label: '现金流日历', key: 'cashflow-calendar-data', versionField: null, maxBytes: 15 * 1024 * 1024 },
  { id: 'unified', label: '生活日历完整备份', key: 'life-calendar:v1', versionField: 'schemaVersion', maxBytes: 40 * 1024 * 1024 },
];

/** 旧键 → 模块 id。 */
export const LEGACY_KEYS = {
  'liuyiye-journal-v1': 'mood',
  'period-journal:v1': 'period',
  'zodiac-journal:v1': 'zodiac',
  'cashflow-calendar-data': 'cashflow',
};

export { at };
