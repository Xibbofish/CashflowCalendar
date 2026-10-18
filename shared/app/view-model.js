/**
 * 聚合视图模型：日历格与当天卡片唯一的数据来源。
 *
 * 口径（docs/PRODUCT.md §3、docs/TECHNICAL.md §4）：
 * - 财务余额与独立应用一致：只从“今天 − 90 天”起累计，最远 3650 天；超出窗口返回 `null` 并给出原因，
 *   绝不返回伪造的 0，也绝不用新的起点重算初始余额。
 * - 事件展开与余额分开：**任何日期**的事件都照常展开显示（历史记录不会消失），
 *   只有余额受窗口限制。
 * - 模拟默认不计入格子汇总，可在财务详细视图开启。
 * - 摘要只显示有依据的信息：无心情记录不算 0 分；无身体记录不解释为无症状；无已记录经期不解释为医学状态。
 * - 已收藏星笺使用原始快照，未收藏使用当前内容库，并在数据里明确区分。
 * - 关闭的模块不留下日历标记，但数据保留在 envelope 中。
 */
import { ErrorCode, LifeCalendarError, describeError } from '../errors.js';
import { MODULE_REGISTRY, MODULE_IDS } from '../compatibility/envelope.js';
import { addDays, formatMonthDay, localDate, monthGrid, rangeLength, validDate } from '../date/index.js';
import { computeDailyBalances, expandEvents } from '../modules/cashflow/engine.js';
import * as cashflowModel from '../modules/cashflow/model.js';
import * as moodModel from '../modules/mood/model.js';
import * as periodModel from '../modules/period/model.js';
import * as zodiacModel from '../modules/zodiac/model.js';

/** 与独立应用一致：计算窗口从参考日前 90 天开始，最远 3650 天。 */
export const ANCHOR_DAYS = 90;
export const MAX_RANGE_DAYS = 3650;
export const CASHFLOW_SCOPE_NOTE = '金额为计划发生额，不代表已支付或已到账。';
export const BALANCE_REASONS = {
  'before-anchor': '早于余额计算起点（今天往前 90 天），余额未计算；当天事件仍完整显示。',
  'beyond-range': `超出余额计算范围（起点后 ${MAX_RANGE_DAYS} 天），余额未计算。`,
};

/** 金额缩写的判定阈值（格子内显示用）。 */
export function abbreviateAmount(value) {
  const amount = Math.abs(value);
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(amount >= 10000000 ? 0 : 1)}M`;
  if (amount >= 10000) return `${(amount / 10000).toFixed(amount >= 100000 ? 0 : 1)}万`;
  return amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export function anchorFor(reference) {
  return addDays(reference, -ANCHOR_DAYS);
}

/** 余额窗口：`[anchor, anchor + 3650]`。 */
export function balanceWindow(today) {
  const anchor = anchorFor(today);
  return { anchor, limit: addDays(anchor, MAX_RANGE_DAYS) };
}

export function balanceAvailability(date, today) {
  const { anchor, limit } = balanceWindow(today);
  if (date < anchor) return { available: false, reason: 'before-anchor', anchor, limit };
  if (date > limit) return { available: false, reason: 'beyond-range', anchor, limit };
  return { available: true, reason: null, anchor, limit };
}

function failDate(date) {
  throw new LifeCalendarError(ErrorCode.DATE_INVALID, { message: `日期无效：${String(date)}。` });
}

function isOutsideZodiacRange(date) {
  const year = Number(date.slice(0, 4));
  return year < 2000 || year > 2100;
}

function sumBy(list, predicate) {
  return list.filter(predicate).reduce((total, event) => total + event.amount, 0);
}

/**
 * 批量预计算财务数据。
 *
 * - 事件：`expandEvents(events, start, end)` 一次展开，窗口由调用方给出（**不受余额窗口限制**）。
 * - 余额：只有与余额窗口相交时才计算，且始终 `computeDailyBalances(initialBalance, events, anchor, end)`，
 *   保证任何视图的余额都基于同一个起点。
 */
function prepareCashflow(envelope, { start, end, reference }) {
  const data = envelope.modules.cashflow.data;
  const { anchor, limit } = balanceWindow(reference);
  const events = expandEvents([...data.events, ...data.simulationEvents], start, end);
  const balanceEnd = end < limit ? end : limit;
  const balances = balanceEnd >= anchor
    ? computeDailyBalances(data.initialBalance, [...data.events, ...data.simulationEvents], anchor, balanceEnd)
    : [];
  return {
    data,
    anchor,
    limit,
    events,
    balances,
    eventsOf(day) {
      return events.filter((event) => event.date === day);
    },
    balanceOf(day) {
      if (day < anchor || day > limit) return null;
      return balances.find((item) => item.date === day)?.balance ?? null;
    },
    /** 把一批日期一次性算成当天视图数据，避免逐格从 anchor 重算。 */
    dayMap(dates) {
      const map = new Map();
      const index = new Map(balances.map((item) => [item.date, item]));
      for (const day of dates) map.set(day, buildCashflowDay(data, events, index, day, anchor, limit));
      return map;
    },
  };
}

function buildCashflowDay(data, events, balanceIndex, date, anchor, limit) {
  const dayEvents = events.filter((event) => event.date === date);
  const realEvents = dayEvents.filter((event) => !event.isSimulation);
  const simulationEvents = dayEvents.filter((event) => event.isSimulation);
  const available = date >= anchor && date <= limit;
  return {
    realIncome: sumBy(realEvents, (event) => event.amount > 0),
    realExpense: Math.abs(sumBy(realEvents, (event) => event.amount < 0)),
    simulationIncome: sumBy(simulationEvents, (event) => event.amount > 0),
    simulationExpense: Math.abs(sumBy(simulationEvents, (event) => event.amount < 0)),
    events: realEvents,
    simulationEvents,
    balance: available ? balanceIndex.get(date)?.balance ?? null : null,
    balanceAvailable: available,
    balanceReason: available ? null : date < anchor ? 'before-anchor' : 'beyond-range',
    balanceNote: available ? null : BALANCE_REASONS[date < anchor ? 'before-anchor' : 'beyond-range'],
  };
}

function safeModule(moduleId, compute, errors, statuses) {
  try {
    statuses[moduleId] = 'ok';
    return compute();
  } catch (error) {
    errors[moduleId] = describeError(error);
    statuses[moduleId] = isUnsupportedDate(error) ? 'unsupported-date' : 'error';
    return null;
  }
}

/** 日期超出该模块支持范围（例如星笺的 2000—2100）与真正的数据错误必须区分。 */
function isUnsupportedDate(error) {
  return error instanceof LifeCalendarError && error.code === ErrorCode.DATE_INVALID;
}

/**
 * 单日视图。
 *
 * @param envelope 统一 envelope
 * @param options `{ date, today, now, includeSimulationInTotals }`
 */
export function buildDayView(envelope, { date, today = localDate(), now = new Date(), includeSimulationInTotals = null, financialReference = null } = {}) {
  if (!validDate(date)) failDate(date);
  // 财务基准：默认与今天一致；跨午夜后由界面保持为“页面打开时的今天”，
  // 这样余额窗口不会在页面上凭空移动。`today` 仍用于经期与“今天”标记。
  const reference = financialReference ?? today;
  const cashflow = prepareCashflow(envelope, { start: date, end: date, reference });
  return composeDayView(envelope, {
    date,
    today,
    now,
    includeSimulationInTotals,
    cashflow,
    cashflowDays: cashflow.dayMap([date]),
    financialReference: reference,
  });
}

/**
 * 组装单日视图。`cashflow` / `cashflowDays` 允许调用方预计算，月视图据此只算一次。
 */
function composeDayView(envelope, { date, today, now, includeSimulationInTotals, cashflow, cashflowDays }) {
  const settings = envelope.settings;
  const includeSimulation = includeSimulationInTotals ?? settings.calendarIncludeSimulation ?? false;
  const statuses = {};
  const errors = {};
  const enabled = settings.enabledModules;

  const cashflowView = enabled.cashflow
    ? safeModule('cashflow', () => {
      const day = cashflowDays.get(date);
      const totals = includeSimulation ? [...day.events, ...day.simulationEvents] : day.events;
      return {
        available: true,
        anchor: cashflow.anchor,
        limit: cashflow.limit,
        realIncome: day.realIncome,
        realExpense: day.realExpense,
        simulationIncome: day.simulationIncome,
        simulationExpense: day.simulationExpense,
        income: sumBy(totals, (event) => event.amount > 0),
        expense: Math.abs(sumBy(totals, (event) => event.amount < 0)),
        events: day.events,
        simulationEvents: day.simulationEvents,
        balance: day.balance,
        balanceAvailable: day.balanceAvailable,
        balanceUnavailableReason: day.balanceReason,
        balanceNote: day.balanceNote,
        includeSimulationInTotals: includeSimulation,
        scopeNote: CASHFLOW_SCOPE_NOTE,
      };
    }, errors, statuses)
    : null;

  const moodData = envelope.modules.mood.data;
  const moodView = enabled.mood
    ? safeModule('mood', () => {
      const entries = moodModel.entriesOfDay(moodData, date);
      const average = entries.length ? entries.reduce((sum, entry) => sum + entry.mood, 0) / entries.length : null;
      const tags = moodModel.tagsById(moodData);
      return {
        available: true,
        count: entries.length,
        entries: entries.map((entry) => ({ ...entry, moodMeta: moodModel.moodMeta(entry.mood), tagNames: entry.tagIds.map((id) => tags.get(id)?.name ?? '') })),
        average,
        averageLabel: average === null ? null : moodModel.moodMeta(Math.round(average))?.label ?? null,
        averageIcon: average === null ? null : moodModel.moodMeta(Math.round(average))?.icon ?? null,
        tagNames: [...new Set(entries.flatMap((entry) => entry.tagIds.map((id) => tags.get(id)?.name ?? '')))],
        emptyNote: '这一天没有心情记录。',
      };
    }, errors, statuses)
    : null;

  const periodData = envelope.modules.period.data;
  const periodView = enabled.period
    ? safeModule('period', () => {
      const day = periodModel.getDay(periodData, date, today);
      return {
        available: true,
        inPeriod: Boolean(day.period),
        active: day.active,
        cycleDay: day.cycleDay,
        period: day.period,
        daily: day.daily,
        emptyNote: day.daily ? null : '这一天没有身体感受记录。',
        futureNote: date > today ? '月经记录只允许今天或过去的日期。' : null,
      };
    }, errors, statuses)
    : null;

  const zodiacData = envelope.modules.zodiac.data;
  const zodiacView = enabled.zodiac
    ? safeModule('zodiac', () => {
      // 星笺的内容库只覆盖 2000—2100；范围外的日期必须报成“日期不受支持”，
      // 不能变成普通的 error（那会让界面以为是数据坏了）。
      if (isOutsideZodiacRange(date)) {
        throw new LifeCalendarError(ErrorCode.DATE_INVALID, {
          path: 'date',
          scope: 'zodiac',
          message: `${date} 超出星笺支持的年份范围（2000—2100），这一天没有星笺内容。`,
        });
      }
      const day = zodiacModel.getDay(zodiacData, date, now);
      return {
        available: true,
        sign: day.sign,
        saved: day.saved,
        savedAt: day.savedAt,
        source: day.source,
        card: day.snapshot ?? day.card,
        libraryCard: day.card,
        note: day.note,
        sourceNote: day.saved ? '显示收藏时保存的原始快照，内容库更新不会改变它。' : '显示当前内容库生成的内容；收藏后会保留当时的快照。',
        unsupportedRangeNote: isOutsideZodiacRange(date) ? '星笺只支持 2000—2100 年。' : null,
      };
    }, errors, statuses)
    : null;

  const summary = envelope.life.summaries.find((item) => item.date === date) ?? null;
  const lifeTags = new Map(envelope.life.tags.map((tag) => [tag.id, tag.name]));
  const summaryView = summary ? { ...summary, tagNames: summary.tagIds.map((id) => lifeTags.get(id) ?? '') } : null;

  for (const id of MODULE_IDS) if (!enabled[id]) statuses[id] = 'off';

  // 日历标记：关闭的模块一律不标记，避免出现无法解释的记号
  const mar = {
    period: enabled.period && Boolean(periodView?.inPeriod),
    cycleDay: enabled.period ? periodView?.cycleDay ?? null : null,
    moodAverage: enabled.mood ? moodView?.average ?? null : null,
    moodIcon: enabled.mood ? moodView?.averageIcon ?? null : null,
    expenseAmount: enabled.cashflow ? cashflowView?.expense ?? null : null,
    expenseAbbreviated: enabled.cashflow && cashflowView ? abbreviateAmount(cashflowView.expense) : null,
    incomeAmount: enabled.cashflow ? cashflowView?.income ?? null : null,
    diaryMarker: enabled.mood && Boolean(moodView?.entries.some((entry) => entry.content.trim())),
    zodiacMarker: enabled.zodiac && Boolean(zodiacView?.saved),
    summaryMarker: Boolean(summaryView && summaryView.content.trim()),
  };

  return {
    date,
    today,
    isToday: date === today,
    isFuture: date > today,
    weekdayLabel: formatMonthDay(date),
    modules: statuses,
    errors,
    enabled: { ...enabled },
    cashflow: cashflowView,
    mood: moodView,
    period: periodView,
    zodiac: zodiacView,
    summary: summaryView,
    mar,
  };
}

/**
 * 月视图：固定七列整周（周一起始）。
 * 财务事件与余额按整月一次批量准备，逐格取用；不会为 42 格各算一次从 anchor 到当天的余额。
 */
export function buildCalendarMonth(envelope, { month, today = localDate(), now = new Date(), includeSimulationInTotals = null, financialReference = null } = {}) {
  const reference = financialReference ?? today;
  const cells = monthGrid(month);
  const dates = cells.map((cell) => cell.date).filter(Boolean);
  const cashflow = prepareCashflow(envelope, {
    start: dates[0],
    end: dates[dates.length - 1],
    reference,
  });
  const cashflowDays = cashflow.dayMap(dates);
  const result = cells.map((cell) => {
    // 越界格（例如 9999-12 之后补出的整周）不做单日计算：
    // 那种日期根本不存在，硬算会产出五位年份的“日期”并让渲染崩溃。
    if (!cell.date) {
      return {
        ...cell,
        isToday: false,
        isFuture: false,
        summary: { mar: emptyMarkers(), enabled: shiftedEnabled(envelope), expenseAbbreviated: null, expenseAmount: null },
        dayView: null,
      };
    }
    const dayView = composeDayView(envelope, {
      date: cell.date,
      today,
      now,
      includeSimulationInTotals,
      cashflow,
      cashflowDays,
      financialReference: reference,
    });
    return {
      ...cell,
      isToday: cell.date === today,
      isFuture: cell.date > today,
      summary: {
        mar: dayView.mar,
        enabled: dayView.enabled,
        expenseAbbreviated: dayView.mar.expenseAbbreviated,
        expenseAmount: dayView.mar.expenseAmount,
      },
      dayView,
    };
  });
  return { month, weekdays: ['一', '二', '三', '四', '五', '六', '日'], cells: result };
}

function emptyMarkers() {
  return {
    period: false,
    cycleDay: null,
    moodAverage: null,
    moodIcon: null,
    expenseAmount: null,
    expenseAbbreviated: null,
    incomeAmount: null,
    diaryMarker: false,
    zodiacMarker: false,
    summaryMarker: false,
  };
}

function shiftedEnabled(envelope) {
  return {
    cashflow: envelope.settings.enabledModules.cashflow,
    mood: envelope.settings.enabledModules.mood,
    period: envelope.settings.enabledModules.period,
    zodiac: envelope.settings.enabledModules.zodiac,
  };
}

/**
 * 范围回顾：各模块保留自己的分母与口径。
 * 余额始终从同一 anchor 累计后再截取范围；超出窗口返回 `null` 与原因，不返回伪零。
 *
 * 边界：
 * - 日期分母用 `rangeLength`（`daysBetween + 1`）计算，**不枚举**每一天，
 *   避免用户选一个跨世纪的区间时枚举上百万个日期把页面冻住。
 * - 财务需要逐日余额，因此限制在 `MAX_RANGE_DAYS` 天以内；超出时明确报错，
 *   心情 / 身体 / 总结仍按记录过滤（它们不逐日展开）。
 */
export function buildRangeReview(envelope, { start, end, today = localDate(), now = new Date(), financialReference = null }) {
  if (!validDate(start) || !validDate(end) || start > end) {
    throw new LifeCalendarError(ErrorCode.DATE_INVALID, { message: '回顾范围无效：请填写有效且结束不早于开始的日期。' });
  }
  const dayCount = rangeLength(start, end);
  if (dayCount > MAX_RANGE_DAYS) {
    throw new LifeCalendarError(ErrorCode.RANGE_ORDER, {
      message: `回顾范围最多 ${MAX_RANGE_DAYS} 天（当前 ${dayCount} 天）。请分几次查看，避免一次计算过多日期。`,
    });
  }
  const reference = financialReference ?? today;
  const { anchor, limit } = balanceWindow(reference);
  const allEvents = expandEvents([...envelope.modules.cashflow.data.events, ...envelope.modules.cashflow.data.simulationEvents], start, end);
  const realEvents = allEvents.filter((event) => !event.isSimulation);
  const simulationEvents = allEvents.filter((event) => event.isSimulation);

  // 余额始终从固定 anchor 累计，再截取请求范围；窗口外不枚举余额。
  const balanceEnd = end < limit ? end : limit;
  const balances = balanceEnd >= anchor
    ? computeDailyBalances(
      envelope.modules.cashflow.data.initialBalance,
      [...envelope.modules.cashflow.data.events, ...envelope.modules.cashflow.data.simulationEvents],
      anchor,
      balanceEnd,
    )
    : [];
  const windowStart = start < anchor ? anchor : start;
  const windowEnd = balanceEnd;
  const balanceAvailable = end >= anchor && end <= limit;
  const balanceReason = balanceAvailable ? null : end < anchor ? 'before-anchor' : 'beyond-range';
  const windowBalances = balances.filter((item) => item.date >= windowStart && item.date <= windowEnd);

  const moodSummary = moodModel.getRangeSummary(envelope.modules.mood.data, { start, end });
  const periodSummary = periodModel.getRangeSummary(envelope.modules.period.data, { start, end }, today);
  const zodiacSummary = zodiacModel.getRangeSummary(envelope.modules.zodiac.data, { start, end });
  const summaries = envelope.life.summaries
    .filter((summary) => summary.date >= start && summary.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));
  const recordedDays = new Set([
    ...envelope.modules.mood.data.entries.filter((entry) => entry.localDate >= start && entry.localDate <= end).map((entry) => entry.localDate),
    ...envelope.modules.period.data.daily.filter((record) => record.date >= start && record.date <= end).map((record) => record.date),
    ...summaries.map((summary) => summary.date),
  ]);

  return {
    range: { start, end, days: dayCount },
    cashflow: {
      /** 事件始终按请求范围统计，早于 anchor 的历史计划不会消失 */
      income: sumBy(realEvents, (event) => event.amount > 0),
      expense: Math.abs(sumBy(realEvents, (event) => event.amount < 0)),
      simulationIncome: sumBy(simulationEvents, (event) => event.amount > 0),
      simulationExpense: Math.abs(sumBy(simulationEvents, (event) => event.amount < 0)),
      eventCount: realEvents.length,
      simulationCount: simulationEvents.length,
      /** 余额：与当日视图同一个 anchor，窗口内先累计后截取 */
      balance: balanceAvailable ? windowBalances.at(-1)?.balance ?? null : null,
      balanceAvailable,
      balanceUnavailableReason: balanceReason,
      balanceNote: balanceReason ? BALANCE_REASONS[balanceReason] : null,
      minimumBalance: balanceAvailable
        ? windowBalances.reduce((min, day) => (min === null || day.balance < min.balance ? day : min), null)
        : null,
      countedDays: windowBalances.length,
      requestDays: dayCount,
      anchor,
      limit,
      scope: `真实计划（模拟单列）；余额自 ${anchor} 起累计到 ${limit}，与日历一致。`,
    },
    mood: { ...moodSummary, scope: '按每条记录计算，每条权重相同；未记录的日子不计入平均。' },
    period: { ...periodSummary },
    zodiac: { ...zodiacSummary, scope: '只统计已收藏的星笺；未收藏的日子不生成快照。' },
    summaries,
    summaryTagNames: envelope.life.tags,
    recordedDays: recordedDays.size,
    recordedDateList: [...recordedDays].sort(),
    modulesEnabled: { ...envelope.settings.enabledModules },
  };
}

/** 最近 N 天的心情趋势（空白表示未记录，不按 0 分计算）。 */
export function buildMoodTrend(envelope, { endDate = localDate(), days = 14 } = {}) {
  const list = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(endDate, -i);
    const entries = moodModel.entriesOfDay(envelope.modules.mood.data, date);
    list.push({
      date,
      average: entries.length ? entries.reduce((sum, entry) => sum + entry.mood, 0) / entries.length : null,
      count: entries.length,
    });
  }
  return list;
}

export { MODULE_REGISTRY, cashflowModel };


