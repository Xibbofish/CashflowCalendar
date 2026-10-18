/**
 * 月经模块：模型、校验、统计、命令、旧格式读写。
 *
 * 旧数据形态（备份 `version:1, periods, daily`，存储键 `period-journal:v1`）：
 * period = { id, startDate, endDate|null, createdAt, updatedAt }
 * daily  = { id, date, flow, symptoms[], note }（date 唯一）
 *
 * 不变量：
 * - 只允许今天或过去的日期；结束不得早于开始；区间不重叠；最多一个进行中。
 * - 每日感受与经期区间互相独立：删除经期不删除每日记录，反之亦然。
 * - `now` 显式传入，模块不读取浏览器时钟。
 */
import { LifeCalendarError, ErrorCode, fail } from '../../errors.js';
import { MAX_YEAR, MIN_YEAR, addDays, daysBetween, validDate as validCalendarDate } from '../../date/index.js';

/**
 * 月经模块自己的日期范围：1900—2100（与旧应用完全一致）。
 *
 * 统一日历本身支持 1000—9999（`shared/date` 的默认范围），但月经记录不能借用这个宽度：
 * - 旧应用只允许 1900—2100，放宽会让旧入口与统一入口对同一份数据给出不同结论；
 * - 超出范围时模块要明确报“日期无效”，而不是让日历或冲突检测去猜测。
 */
function validDate(value) {
  return validCalendarDate(value, { minYear: MIN_YEAR, maxYear: MAX_YEAR });
}

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'period-journal:v1';
export const FLOWS = ['未记录', '点滴', '少量', '适中', '较多', '无'];
export const SYMPTOMS = ['腹部不适', '腰酸', '疲倦', '头痛', '乳房胀痛', '情绪波动', '睡眠不佳', '感觉良好'];
export const LIMITS = {
  periods: 10000,
  daily: 30000,
  note: 2000,
  id: 100,
  timestamp: 50,
};
export const PERIOD_FIELDS = ['id', 'startDate', 'endDate', 'createdAt', 'updatedAt'];
export const DAILY_FIELDS = ['id', 'date', 'flow', 'symptoms', 'note'];
export const DATA_FIELDS = ['version', 'periods', 'daily'];

export function emptyData() {
  return { version: SCHEMA_VERSION, periods: [], daily: [] };
}

function checkObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(ErrorCode.SCHEMA_INVALID, { path, scope: 'period', message: `${path} 必须是对象。` });
}

/**
 * 未知字段处理（统一存储、统一备份、旧格式读取一律拒绝）：
 * 拒绝而不是保留，避免统一恢复时静默丢字段或语义漂移。
 */
function checkUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${key}`, scope: 'period', message: `${path} 包含不认识的字段：${key}` });
  }
}

function checkId(id, seen, path) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id)) {
    fail(ErrorCode.ID_INVALID, { path, scope: 'period', message: '记录 ID 无效或重复。' });
  }
  seen.add(id);
}

function checkTimestamp(value, path) {
  if (typeof value !== 'string' || value.length > LIMITS.timestamp || !Number.isFinite(Date.parse(value))) {
    fail(ErrorCode.SCHEMA_INVALID, { path, scope: 'period', message: '记录时间格式不正确。' });
  }
  return value;
}

/** 严格校验整个模块数据。`now` 是本地日期字符串，默认由调用方提供。 */
export function validate(input, now = null) {
  checkObject(input, 'period');
  checkUnknownFields(input, DATA_FIELDS, 'period');
  if (input.version !== SCHEMA_VERSION) {
    const code = typeof input.version === 'number' && input.version > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: 'period.version', scope: 'period', message: `月经备份版本 ${input.version} 不受支持，需要版本 1。` });
  }
  if (!Array.isArray(input.periods) || !Array.isArray(input.daily)) {
    fail(ErrorCode.SCHEMA_INVALID, { scope: 'period', message: '文件格式不正确，需要月经记录本 v1 的 JSON 备份。' });
  }
  if (input.periods.length > LIMITS.periods || input.daily.length > LIMITS.daily) {
    fail(ErrorCode.LIMIT_EXCEEDED, { scope: 'period', message: '记录数量超过支持范围。' });
  }
  const ids = new Set();
  const periods = input.periods.map((raw, index) => {
    const path = `period.periods[${index}]`;
    checkObject(raw, path);
    checkUnknownFields(raw, PERIOD_FIELDS, path);
    checkId(raw.id, ids, `${path}.id`);
    if (!validDate(raw.startDate) || (raw.endDate !== null && raw.endDate !== undefined && !validDate(raw.endDate))) {
      fail(ErrorCode.DATE_INVALID, { path: `${path}.startDate`, scope: 'period', message: '周期日期无效。' });
    }
    const endDate = raw.endDate ?? null;
    if (now && (raw.startDate > now || (endDate && endDate > now))) {
      fail(ErrorCode.DATE_IN_FUTURE, { path: `${path}.startDate`, scope: 'period', message: '只能记录今天或过去的日期。' });
    }
    if (endDate && endDate < raw.startDate) {
      fail(ErrorCode.RANGE_ORDER, { path: `${path}.endDate`, scope: 'period', message: '结束日期不能早于开始日期。' });
    }
    return { id: raw.id, startDate: raw.startDate, endDate, createdAt: checkTimestamp(raw.createdAt, `${path}.createdAt`), updatedAt: checkTimestamp(raw.updatedAt, `${path}.updatedAt`) };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (periods.filter((period) => !period.endDate).length > 1) {
    fail(ErrorCode.MULTIPLE_ACTIVE, { scope: 'period', message: '只能有一个进行中的周期，请先记录结束日期。' });
  }
  for (let i = 1; i < periods.length; i += 1) {
    if (!periods[i - 1].endDate || periods[i].startDate <= periods[i - 1].endDate) {
      fail(ErrorCode.RANGE_OVERLAP, { scope: 'period', message: '周期日期重叠，请调整开始或结束日期。' });
    }
  }
  const dates = new Set();
  const daily = input.daily.map((raw, index) => {
    const path = `period.daily[${index}]`;
    checkObject(raw, path);
    checkUnknownFields(raw, DAILY_FIELDS, path);
    checkId(raw.id, ids, `${path}.id`);
    if (!validDate(raw.date) || (now && raw.date > now) || dates.has(raw.date)) {
      fail(ErrorCode.DAY_DUPLICATE, { path: `${path}.date`, scope: 'period', message: '每日记录日期无效、重复或在未来。' });
    }
    dates.add(raw.date);
    if (!FLOWS.includes(raw.flow) || !Array.isArray(raw.symptoms) || raw.symptoms.some((s) => !SYMPTOMS.includes(s)) || new Set(raw.symptoms).size !== raw.symptoms.length || typeof raw.note !== 'string' || raw.note.length > LIMITS.note) {
      fail(ErrorCode.ENUM_INVALID, { path, scope: 'period', message: '每日记录的经量、标签或备注无效。' });
    }
    return { id: raw.id, date: raw.date, flow: raw.flow, symptoms: [...raw.symptoms], note: raw.note };
  });
  return { version: SCHEMA_VERSION, periods, daily };
}

/**
 * 旧格式读取：必须显式声明 `version: 1`，未知字段一律拒绝。
 * 缺失版本不能被默认成 1，否则未标明版本的备份会被当作有效数据。
 */
export function readLegacy(raw, now = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(ErrorCode.SCHEMA_INVALID, { scope: 'period', message: '不是有效的月经记录备份。' });
  if (!Object.prototype.hasOwnProperty.call(raw, 'version') || raw.version === undefined || raw.version === null) {
    fail(ErrorCode.UNSUPPORTED_VERSION, { scope: 'period', message: '备份没有标明版本，无法确认格式，未读取。' });
  }
  return validate(raw, now);
}

export function writeLegacy(data, now = null) {
  const valid = validate(data, now);
  return { version: SCHEMA_VERSION, periods: valid.periods, daily: valid.daily };
}

/** 命中某日的经期区间（进行中的只延伸到 now）。 */
export function periodAt(data, date, now) {
  return data.periods.find((period) => period.startDate <= date && (period.endDate || now) >= date);
}

/** 进行中的周期（最多一个）。 */
export function activePeriod(data) {
  return data.periods.find((period) => !period.endDate) ?? null;
}

/** 已记录经期的第几天（含当天）。 */
export function cycleDay(period, date) {
  return daysBetween(period.startDate, date) + 1;
}

/** 旧路径使用的别名：`days(a, b)` 返回 b 与 a 之间的整天数。 */
export function days(from, to) {
  return daysBetween(from, to);
}

export function dailyRecord(data, date) {
  return data.daily.find((record) => record.date === date) ?? null;
}

export function getDay(data, date, now = null) {
  const period = periodAt(data, date, now);
  return {
    date,
    period: period ?? null,
    active: Boolean(period && !period.endDate),
    cycleDay: period ? cycleDay(period, date) : null,
    daily: dailyRecord(data, date) ?? null,
  };
}

/** 写入/覆盖一条经期记录。`today` 用于日期校验，`now` 是写入时间戳（ISO 串）。 */
export function upsertPeriod(data, record, today = null, now = null) {
  const existing = data.periods.find((item) => item.id === record.id);
  const stamp = record.updatedAt ?? now ?? existing?.updatedAt ?? null;
  const created = record.createdAt ?? existing?.createdAt ?? stamp;
  // 时间字段是必填的：没有可用时间时宁可让校验报错，也不写入空时间
  const stamped = stamp && created ? { ...record, createdAt: created, updatedAt: stamp } : { ...record };
  return validate({ ...data, periods: [...data.periods.filter((item) => item.id !== record.id), stamped] }, today);
}

/** 写入/覆盖一条每日感受。`today` 用于日期校验；每日记录本身不带时间戳字段。 */
export function upsertDaily(data, record, today = null) {
  return validate({ ...data, daily: [...data.daily.filter((item) => item.date !== record.date), { ...record }] }, today);
}

/**
 * 旧应用合并策略（保持既有行为）：相同 ID 不同内容、同日不同内容都拒绝。
 * 统一导入的冲突判定不复用该函数，而由 import-plan 报告冲突。
 */
export function mergeData(current, incoming, now = null) {
  const incomingData = validate(incoming, now);
  const periods = [...current.periods];
  for (const period of incomingData.periods) {
    const byId = periods.find((item) => item.id === period.id);
    if (byId) {
      if (JSON.stringify(byId) !== JSON.stringify(period)) fail(ErrorCode.IDENTITY_CONFLICT, { scope: 'period', message: '合并存在相同 ID 的不同周期，请先导出当前记录，再选择覆盖或调整备份。' });
    } else if (!periods.some((item) => item.startDate === period.startDate && item.endDate === period.endDate)) {
      periods.push(period);
    }
  }
  const daily = [...current.daily];
  for (const record of incomingData.daily) {
    const existing = daily.find((item) => item.date === record.date);
    if (existing && (existing.flow !== record.flow || existing.note !== record.note || [...existing.symptoms].sort().join('|') !== [...record.symptoms].sort().join('|'))) {
      fail(ErrorCode.IDENTITY_CONFLICT, { scope: 'period', message: '合并存在同一天的不同记录，不会自动覆盖。' });
    }
    if (!existing) daily.push(record);
  }
  return validate({ ...current, version: SCHEMA_VERSION, periods, daily }, now);
}

export function stats(data) {
  const complete = data.periods.filter((period) => period.endDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lengths = complete.map((period) => daysBetween(period.startDate, period.endDate) + 1);
  const intervals = complete.slice(1).map((period, index) => daysBetween(complete[index].startDate, period.startDate));
  const mean = (list) => (list.length ? Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 10) / 10 : null);
  return { complete: complete.length, duration: mean(lengths), interval: mean(intervals), intervals: intervals.length };
}

export function getRangeSummary(data, range, now = null) {
  const periods = data.periods.filter((period) => (period.endDate ?? range.end) >= range.start && period.startDate <= range.end);
  const records = data.daily.filter((record) => record.date >= range.start && record.date <= range.end);
  const symptomCounts = new Map();
  for (const record of records) for (const symptom of record.symptoms) symptomCounts.set(symptom, (symptomCounts.get(symptom) ?? 0) + 1);
  return {
    start: range.start,
    end: range.end,
    periods: periods.map((period) => ({ ...period, days: daysBetween(period.startDate, period.endDate ?? (now ?? range.end)) + 1 })),
    completePeriods: periods.filter((period) => period.endDate).length,
    activePeriods: periods.filter((period) => !period.endDate).length,
    dailyRecords: records.length,
    symptomCounts: [...symptomCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    /** 回顾不提供医学推断，因此不返回任何预测字段。 */
    note: '经期按开始至结束日期（含两端）计算；进行中的记录只统计到参考日期。',
  };
}

/**
 * 命令入口。
 *
 * 选项统一为 `{ today, now }`：
 * - `today`：本地日期字符串，用于“今天或过去”的校验；
 * - `now`：ISO 时间串，用于写入时间戳。
 * 核心不读时钟，两者都由调用方显式给出。
 */
export function applyCommand(data, command, options = {}) {
  const today = typeof options === 'string' ? options : options?.today ?? null;
  const now = typeof options === 'string' ? null : options?.now ?? null;
  const { type, payload = {} } = command;
  switch (type) {
    case 'upsertPeriod': return upsertPeriod(data, payload.record, today, now ?? payload.now ?? null);
    case 'upsertDaily': return upsertDaily(data, payload.record, today, now ?? payload.now ?? null);
    case 'endPeriod': {
      const target = data.periods.find((period) => period.id === payload.id);
      if (!target) fail(ErrorCode.SCHEMA_INVALID, { scope: 'period', message: '找不到该周期。' });
      const endDate = payload.endDate ?? today;
      return upsertPeriod(data, { ...target, endDate, updatedAt: payload.updatedAt ?? now ?? target.updatedAt ?? null }, today, now);
    }
    case 'deletePeriod':
      // 删除经期不删除身体感受
      return validate({ ...data, periods: data.periods.filter((period) => period.id !== payload.id) }, today);
    case 'deleteDaily':
      // 删除每日记录不删除经期
      return validate({ ...data, daily: data.daily.filter((record) => record.id !== payload.id) }, today);
    default:
      fail(ErrorCode.SCHEMA_INVALID, { scope: 'period', message: `未知命令 ${type}。` });
      return null;
  }
}

export function persist(storage, data, now = null) {
  const validated = validate(data, now);
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
  return validated;
}

/** 展开经期为逐日标记，跨月连续显示；进行中只到今天。 */
export function expandPeriodDays(period, today) {
  const end = period.endDate ?? today;
  if (end < period.startDate) return [];
  const days = [];
  let cursor = period.startDate;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

export { LifeCalendarError, ErrorCode };
export { validDate, validDate as isValidDate, dayNumber } from '../../date/index.js';
