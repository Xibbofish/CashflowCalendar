/**
 * Cashflow 纯引擎：与原 xibbofish/cashflow/src/engine.js 行为一致。
 *
 * 该文件是唯一手工维护来源；旧路径 `src/engine.js` 只做 re-export。
 * 兼容要求（docs/TECHNICAL.md §4）：
 * - 金额精度与显示口径不变（元、浮点），不在抽取时迁移为分币整数。
 * - 计算基准由调用方显式传入（统一应用传入与独立应用相同的 anchor）。
 * - 早于基准的事件仍展开，但余额口径由调用方判断是否可用。
 */
import { addDays, format, isAfter, isBefore, isEqual, parseISO, startOfDay } from 'date-fns';

export const EventType = {
  INCOME: 'income',
  EXPENSE: 'expense',
};

export const RecurringType = {
  NONE: 'none',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

export const RECURRING_TYPES = [RecurringType.NONE, RecurringType.DAILY, RecurringType.WEEKLY, RecurringType.MONTHLY, RecurringType.YEARLY];

// 常用分类（仅作为表单建议，事件分类使用自由文本）
export const DEFAULT_CATEGORIES = {
  [EventType.INCOME]: ['工资', '兼职', '理财', '奖金', '其他'],
  [EventType.EXPENSE]: ['房租', '餐饮', '交通', '购物', '娱乐', '保险', '水电', '医疗', '其他'],
};

// 未分类时的展示名
export const UNCATEGORIZED_LABEL = '未分类';

/** 兼容旧备份：宽松归一化。只用于旧应用读取与表单回填，不能替代严格校验。 */
export function normalizeEvent(raw) {
  return {
    id: raw.id || String(Date.now()),
    name: raw.name || '未命名',
    type: raw.type === EventType.INCOME ? EventType.INCOME : EventType.EXPENSE,
    amount: Number(raw.amount) || 0,
    date: raw.date || '',
    isRecurring: Boolean(raw.isRecurring),
    recurringType: raw.recurringType || RecurringType.NONE,
    recurringStartDate: raw.recurringStartDate || '',
    recurringEndDate: raw.recurringEndDate || '',
    isPermanent: Boolean(raw.isPermanent),
    occurrenceCount: Number.isSafeInteger(Number(raw.occurrenceCount)) && Number(raw.occurrenceCount) > 0 ? Number(raw.occurrenceCount) : null,
    canSkip: Boolean(raw.canSkip),
    isSimulation: Boolean(raw.isSimulation),
    category: raw.category || '',
    description: raw.description || '',
    // canSkip=true 时，以下日期（yyyy-MM-dd）对应的本次发生被跳过
    skippedDates: Array.isArray(raw.skippedDates) ? raw.skippedDates : [],
  };
}

// 返回事件展示用分类名
export function eventCategoryLabel(event) {
  return event.category && event.category.trim() ? event.category.trim() : UNCATEGORIZED_LABEL;
}

function matchesRecurring(event, currentDate) {
  const current = startOfDay(typeof currentDate === 'string' ? parseISO(currentDate) : currentDate);
  const start = startOfDay(typeof event.recurringStartDate === 'string' ? parseISO(event.recurringStartDate) : event.recurringStartDate);
  if (isBefore(current, start)) return false;
  switch (event.recurringType) {
    case RecurringType.DAILY: return true;
    case RecurringType.WEEKLY: return current.getDay() === start.getDay();
    case RecurringType.MONTHLY: return current.getDate() === start.getDate();
    case RecurringType.YEARLY: return current.getMonth() === start.getMonth() && current.getDate() === start.getDate();
    default: return false;
  }
}

export function expandEvents(events, rangeStart, rangeEnd) {
  const expanded = [];
  const start = startOfDay(typeof rangeStart === 'string' ? parseISO(rangeStart) : rangeStart);
  const end = startOfDay(typeof rangeEnd === 'string' ? parseISO(rangeEnd) : rangeEnd);
  for (const event of events) {
    if (event.isRecurring) {
      const recStart = startOfDay(parseISO(event.recurringStartDate));
      const count = !event.isPermanent && Number.isSafeInteger(event.occurrenceCount) && event.occurrenceCount > 0 ? event.occurrenceCount : null;
      const recEnd = event.isPermanent || count
        ? end
        : (event.recurringEndDate ? startOfDay(parseISO(event.recurringEndDate)) : end);
      let current = count ? new Date(recStart) : new Date(Math.max(recStart.getTime(), start.getTime()));
      let occurrences = 0;
      const stop = new Date(Math.min(recEnd.getTime(), end.getTime()));
      const skipped = event.canSkip && Array.isArray(event.skippedDates)
        ? new Set(event.skippedDates)
        : null;
      while (isBefore(current, stop) || isEqual(current, stop)) {
        if (matchesRecurring(event, current)) {
          occurrences += 1;
          if (count && occurrences > count) break;
          const dateKey = format(current, 'yyyy-MM-dd');
          // 可跳过的周期事件：命中某个具体日期则跳过本次发生
          if (skipped && skipped.has(dateKey)) {
            current = addDays(current, 1);
            continue;
          }
          if (!isBefore(current, start)) expanded.push({ ...event, date: dateKey });
        }
        current = addDays(current, 1);
      }
    } else {
      if (!event.date) continue;
      const eventDate = startOfDay(parseISO(event.date));
      if ((isEqual(eventDate, start) || isAfter(eventDate, start)) && (isEqual(eventDate, end) || isBefore(eventDate, end))) {
        expanded.push({ ...event });
      }
    }
  }
  expanded.sort((a, b) => a.date.localeCompare(b.date));
  return expanded;
}

export function computeDailyBalances(initialBalance, events, rangeStart, rangeEnd) {
  const datedEvents = expandEvents(events, rangeStart, rangeEnd);
  const eventsByDay = {};
  for (const e of datedEvents) {
    if (!eventsByDay[e.date]) eventsByDay[e.date] = [];
    eventsByDay[e.date].push(e);
  }
  let balance = initialBalance;
  const result = [];
  let current = startOfDay(typeof rangeStart === 'string' ? parseISO(rangeStart) : rangeStart);
  const end = startOfDay(typeof rangeEnd === 'string' ? parseISO(rangeEnd) : rangeEnd);
  while (isBefore(current, end) || isEqual(current, end)) {
    const key = format(current, 'yyyy-MM-dd');
    const todayEvents = eventsByDay[key] || [];
    let dayIncome = 0;
    let dayExpense = 0;
    for (const e of todayEvents) {
      balance += e.amount;
      if (e.amount > 0) dayIncome += e.amount;
      else dayExpense += Math.abs(e.amount);
    }
    result.push({ date: key, balance, income: dayIncome, expense: dayExpense, events: todayEvents });
    current = addDays(current, 1);
  }
  return result;
}

export function getBalanceOnDate(initialBalance, events, targetDate) {
  const dateStr = typeof targetDate === 'string' ? targetDate : format(targetDate, 'yyyy-MM-dd');
  const datedEvents = expandEvents(events, '2000-01-01', dateStr);
  let balance = initialBalance;
  for (const e of datedEvents) balance += e.amount;
  return balance;
}

/**
 * 展开结果里，非模拟事件按“真实计划”计入口径说明；模拟默认不计入日历格子。
 * 返回某天真实计划发生额（支出为负），不区分是否已支付——应用不记录支付状态。
 */
export function realEventsOf(dayEvents) {
  return dayEvents.filter((event) => !event.isSimulation);
}

export function simulationEventsOf(dayEvents) {
  return dayEvents.filter((event) => event.isSimulation);
}
