/**
 * Cashflow 分析：范围预设与分类/分组汇总。
 *
 * 与原 xibbofish/cashflow/src/analysis.js 行为一致；唯一手工维护来源。
 * 分析输入必须是显式传入的 `days`（由调用方用同一基准展开），文件不读取时钟。
 */
import { addDays, addMonths, endOfMonth, format, startOfMonth, startOfWeek } from 'date-fns';
import { eventCategoryLabel } from './engine.js';

export function analysisRange(preset, now = new Date()) {
  const month = preset === 'next-month' ? addMonths(now, 1) : now;
  return preset.endsWith('month')
    ? [format(startOfMonth(month), 'yyyy-MM-dd'), format(endOfMonth(month), 'yyyy-MM-dd')]
    : [format(now, 'yyyy-MM-dd'), format(addDays(now, Number(preset) - 1), 'yyyy-MM-dd')];
}

export function filterAnalysis(days, selectedCategories, grouping = 'month') {
  const selected = new Set(selectedCategories);
  const groups = new Map();
  const categories = new Map();
  const events = [];
  for (const day of days) {
    const key = grouping === 'week' ? format(startOfWeek(new Date(`${day.date}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd') : day.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, { key, income: 0, expense: 0 });
    for (const event of day.events) {
      const category = eventCategoryLabel(event);
      if (selected.size && !selected.has(category)) continue;
      events.push(event);
      const type = event.amount >= 0 ? 'income' : 'expense';
      const mapKey = JSON.stringify([type, category]);
      if (!categories.has(mapKey)) categories.set(mapKey, { type, category, amount: 0 });
      categories.get(mapKey).amount += Math.abs(event.amount);
      groups.get(key)[type] += Math.abs(event.amount);
    }
  }
  return { months: [...groups.values()], categories: [...categories.values()], events };
}
