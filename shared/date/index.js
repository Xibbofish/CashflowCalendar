/**
 * 本地日期工具：统一“用户日历日期”的口径。
 *
 * 约定（docs/TECHNICAL.md §3）：
 * - 用户日期一律使用本地 `YYYY-MM-DD` 字符串，时间使用 `HH:mm`，时间戳使用 ISO 字符串。
 * - 日序号用 UTC 算术计算，禁止用 UTC 截取替代用户日期，也禁止把本地时间转成 UTC 再取日期。
 *
 * 本文件是四个应用与统一应用的唯一手工维护来源。
 */

/**
 * 统一日历支持的年份范围：1000—9999。
 *
 * 这是“总日历”的范围，不是各模块范围的交集：
 * - 心情模块的真实旧口径就是 1000—9999（见 `validLegacyLocalDate`），日历必须能显示 1800 或 2200 的记录；
 * - 月经模块自己限制在 1900—2100；
 * - 星笺内容库限制在 2000—2100。
 * 越界的模块在日历上按“该模块不支持这一天”降级显示，而不是让整个日历无法打开。
 */
export const CALENDAR_MIN_YEAR = 1000;
export const CALENDAR_MAX_YEAR = 9999;
/** 原月经记录本的年份范围（旧应用行为，保持不变）。 */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;
/** 星笺内容库支持范围（与原独立应用一致）。 */
export const ZODIAC_MIN_YEAR = 2000;
export const ZODIAC_MAX_YEAR = 2100;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `dateRange` 的默认天数上限（十年）：避免一次枚举出上百万个日期。 */
export const DEFAULT_RANGE_DAYS = 3650;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MS_PER_DAY = 86400000;
export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 把本地 Date 转成用户日历日期。 */
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 把本地 Date 转成 `HH:mm`。 */
export function localTime(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function isDateString(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

export function isTimeString(value) {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** 把 Date 或本地日期字符串统一成本地日期字符串；未知输入返回 null。 */
export function toLocalDateString(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return DATE_PATTERN.test(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : localDate(value);
  return null;
}

/**
 * 本地日期校验：格式、年月日范围与真实存在性（含闰年）。
 *
 * 默认范围是**统一日历**的 1000—9999；需要旧月经范围的调用方必须显式传入
 * `{ minYear: 1900, maxYear: 2100 }`（见 `shared/modules/period/model.js` 与旧入口）。
 */
export function validDate(value, { minYear = CALENDAR_MIN_YEAR, maxYear = CALENDAR_MAX_YEAR } = {}) {
  if (!isDateString(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < minYear || y > maxYear || m < 1 || m > 12) return false;
  return d >= 1 && d <= new Date(y, m, 0).getDate();
}

/**
 * 旧心情模块的真实日期口径（必须保持，不能替换成 1900—2100）。
 *
 * 旧校验等价于 `localDate(new Date(`${v}T12:00:00`)) === v`，并以**未补零**的年份做比较，
 * 因此实际接受的是 1000—9999 年、且写足四位（含前导零）的本地日历日期：
 * - `1000-01-01` 通过；
 * - `0999-12-31` 被拒（`getFullYear()` 得到 `999`，与 `'0999'` 不相等）；
 * - `2026-02-30`、`2026-04-31`、`2026-13-01` 被拒（溢出后与输入不一致）；
 * - 不使用 `new Date(y, m, d)` 的年份 0—99 传递路径，避免 1900 偏移造成误判。
 *
 * 目的：统一应用读旧备份时不能比旧应用更严格，也不能更宽松。
 */
export function validLegacyLocalDate(value) {
  if (!isDateString(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 1000 || y > 9999 || m < 1 || m > 12) return false;
  const probe = new Date(value + 'T12:00:00');
  if (Number.isNaN(probe.getTime())) return false;
  return localDate(probe) === value;
}

/** 旧心情日期的日序号；仅在 `validLegacyLocalDate` 通过后调用。 */
export function legacyDayNumber(value) {
  if (!validLegacyLocalDate(value)) throw new Error('日期无效');
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(2000, m - 1, d));
  // 年份 0—99 会被 Date.UTC 映射到 1900—1999，因此显式用 setUTCFullYear 修正
  utc.setUTCFullYear(y);
  return Math.round(utc.getTime() / MS_PER_DAY);
}

/** 该年该月的天数。 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * 日序号：自 1970-01-01 起的天数（可为负）。
 * 与原星笺 `dayNumber` 一致的数值；年份范围默认取统一日历范围，星笺等模块显式收窄。
 * 注意：`Date.UTC` 会把 0—99 年映射到 1900—1999，因此用 `setUTCFullYear` 显式修正。
 */
export function dayNumber(value, { minYear = CALENDAR_MIN_YEAR, maxYear = CALENDAR_MAX_YEAR } = {}) {
  if (!isDateString(value)) throw new Error('日期格式无效');
  const [y, m, d] = value.split('-').map(Number);
  if (!validDate(value, { minYear, maxYear })) throw new Error(`日期无效（支持 ${minYear}—${maxYear} 年）`);
  const utc = new Date(Date.UTC(2000, m - 1, d));
  utc.setUTCFullYear(y);
  return Math.round(utc.getTime() / MS_PER_DAY);
}

/** 两个日期之间的整天差（b - a），跨月、跨年、闰日均按日历天计算。 */
export function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

/** 在日期上加减天数，返回本地日期字符串。 */
export function addDays(value, amount) {
  const [y, m, d] = value.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + Number(amount)));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** 月份（`YYYY-MM`）加减。 */
export function addMonths(month, amount) {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + Number(amount), 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}`;
}

/** 周一起始的星期序号：0 = 周一 … 6 = 周日。1970 年前也保证返回 0—6（不出现 -0）。 */
export function weekdayIndex(value) {
  return (((dayNumber(value) + 3) % 7) + 7) % 7;
}

/** `2026-10-10` → `10 月 10 日`。 */
export function formatMonthDay(value) {
  return `${Number(value.slice(5, 7))} 月 ${Number(value.slice(8, 10))} 日`;
}

/** `2026-10-10` → `10 月 10 日 · 星期六`。 */
export function formatDateWithWeekday(value) {
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][localWeekday(value)];
  return `${formatMonthDay(value)} · ${weekday}`;
}

/** 用户本地星期（0 = 周日）。 */
export function localWeekday(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** 该月第一天的星期序号（周一起始），用于七列日历填充。 */
export function leadingBlanks(month) {
  return weekdayIndex(`${month}-01`);
}

/**
 * 生成七列日历网格：前后补齐整周，单元格带 inMonth 标记。
 * 统一应用与原生应用共用同一实现，避免列对齐差异。
 *
 * 边界：整月任何一格都可能落到 `MIN_YEAR` 之前或 `MAX_YEAR` 之后。
 * 越界时不再生成五位年份的“日期”（`addDays` 会产出 `10000-01-01`，
 * 字符串比较与切片都会失真），而是标记 `outOfRange: true` 并保留最近的有效日期字符串。
 */
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const total = daysInMonth(y, m);
  const lead = leadingBlanks(month);
  const cells = [];
  let cursor = addDays(`${month}-01`, -lead);
  const cellCount = Math.ceil((lead + total) / 7) * 7;
  let outOfRange = false;
  for (let i = 0; i < cellCount; i += 1) {
    const inRange = validDate(cursor);
    if (!inRange) outOfRange = true;
    cells.push({
      date: inRange ? cursor : null,
      rawDate: cursor,
      inMonth: inRange && cursor.slice(0, 7) === month,
      day: inRange ? Number(cursor.slice(8, 10)) : null,
      outOfRange: !inRange,
    });
    cursor = addDays(cursor, 1);
  }
  if (outOfRange) cells.outOfRange = true;
  return cells;
}

/**
 * 描述一个闭区间（含起止日）。
 * 用日序数比较与计数，不用字符串循环：四位与五位年份混在一起时 `'10000-01-01' <= '9999-12-31'`
 * 会因为字典序而成立，导致死循环。
 *
 * 上限是**必须**的：用户完全可能选一个跨世纪的区间，枚举出上百万个日期会直接把页面拖死。
 * 默认上限 3650 天（十年），超过时返回空数组；调用方必须改用 `daysBetween` / `rangeLength`
 * 并把“范围太大”明确告诉用户，而不是悄悄给出错误结果。
 */
export function dateRange(start, end, { maxDays = DEFAULT_RANGE_DAYS } = {}) {
  const dates = [];
  if (!isDateString(start) || !isDateString(end)) return dates;
  if (!validDate(start) || !validDate(end)) return dates;
  const span = daysBetween(start, end);
  if (span < 0) return dates;
  if (maxDays > 0 && span + 1 > maxDays) return dates;
  let cursor = start;
  for (let i = 0; i <= span; i += 1) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

/** 闭区间的天数（含首尾）；越界或顺序颠倒返回 0。 */
export function rangeLength(start, end) {
  if (!validDate(start) || !validDate(end)) return 0;
  const span = daysBetween(start, end);
  return span < 0 ? 0 : span + 1;
}

/** 日期比较：按日序数比较，避免字符串比较在五位年份时失真。 */
export function compareDate(a, b) {
  if (!validDate(a) || !validDate(b)) return String(a).localeCompare(String(b));
  return daysBetween(a, b);
}

/** 本地日期 + 秒级时间戳，用于 createdAt/updatedAt。 */
export function nowIso(now = new Date()) {
  return now.toISOString();
}

/**
 * 可注入的时钟。
 *
 * 核心逻辑不读时钟：时间一律由调用方（store / 界面 / 测试）显式传入。
 * 但旧的独立应用直接调用 `upsert(...)` 这类函数时没有传时间，
 * 这些入口需要有一个默认值 —— 默认值集中在**这一处**，测试可以整体替换，
 * 从而既保持旧接口可用，又保证核心可注入、可复现。
 */
let nowProvider = () => new Date();

export function setNowProvider(provider) {
  nowProvider = typeof provider === 'function' ? provider : () => new Date();
}

export function resolveNowIso(value = null) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? nowProvider().toISOString() : value.toISOString();
  if (typeof value === 'string' && value) return value;
  return nowProvider().toISOString();
}

export function currentDate() {
  return nowProvider();
}

/** 排序键：日期 → 时间 → 创建时间，稳定且与原应用一致。 */
export function compareDayTime(a, b) {
  return String(b.date ?? b.localDate ?? '').localeCompare(String(a.date ?? a.localDate ?? ''))
    || String(b.time ?? '').localeCompare(String(a.time ?? ''))
    || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
}
