import { addDays, isBefore, isEqual, isAfter, startOfDay, parseISO, format } from 'date-fns';

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
    canSkip: Boolean(raw.canSkip),
    isSimulation: Boolean(raw.isSimulation),
    category: raw.category || '',
    description: raw.description || '',
  };
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
      const recEnd = event.isPermanent
        ? end
        : (event.recurringEndDate ? startOfDay(parseISO(event.recurringEndDate)) : end);
      let current = new Date(Math.max(recStart.getTime(), start.getTime()));
      const stop = new Date(Math.min(recEnd.getTime(), end.getTime()));
      while (isBefore(current, stop) || isEqual(current, stop)) {
        if (matchesRecurring(event, current)) {
          expanded.push({ ...event, date: format(current, 'yyyy-MM-dd') });
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
