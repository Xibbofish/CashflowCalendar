/**
 * ImportPlan 生成与落地：冲突判定、逐项选择、提交前再校验。
 *
 * 不变量（docs/TECHNICAL.md §5、docs/PRODUCT.md §5）：
 * - 生成计划与预览都不写数据；默认是“合并”，不是替换。
 * - 冲突不能靠更新时间静默判断胜者，也不能静默保留某一侧。
 * - 同一编号的日记冲突只提供“保留本机/采用导入”（不同编号的同日记录本来就都保留）。
 * - 经期区间重叠不可通过“保留两份”解决；每日记录同日只能择一。
 * - 财务 `initialBalance` 差异单独列为冲突，绝不相加。
 * - 星笺偏好、总结冲突、设置变化都必须显式选择，不静默改变。
 * - 提交前重跑全量校验，避免分别选择后产生组合冲突；修订号不符时明确过期。
 */
import { ErrorCode, LifeCalendarError, fail } from '../errors.js';
import {
  MODULE_IDS,
  MODULE_REGISTRY,
  buildEnvelope,
  cloneEnvelope,
  createEmptyEnvelope,
  validateEnvelope,
  validateLife,
  validateSettings,
} from './envelope.js';
import { MODULE_LABELS, NORMALIZED, isNormalized, normalizeIncoming } from './legacy-formats.js';

export const DECISIONS = ['merge', 'replace', 'skip'];
export const CONFLICT_OPTIONS = {
  keepLocal: 'keepLocal',
  useIncoming: 'useIncoming',
  keepBoth: 'keepBoth',
  manualMerge: 'manualMerge',
};

const MAX_LABEL = 80;
/** 比较时按语义处理的顺序无关数组字段。 */
const ORDER_INSENSITIVE_ARRAY_KEYS = new Set(['tagIds', 'symptoms']);

function label(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > MAX_LABEL ? `${value.slice(0, MAX_LABEL - 1)}…` : value;
}

/**
 * 语义规范化后再比较：忽略键顺序；`tagIds`、`symptoms` 等集合语义字段忽略元素顺序。
 * 顺序不同不等于内容不同，不能报成冲突。
 */
function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    const list = value.map(normalizeForCompare);
    return list;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      out[key] = ORDER_INSENSITIVE_ARRAY_KEYS.has(key) && Array.isArray(item)
        ? [...item].map((entry) => (typeof entry === 'string' ? entry : stableString(entry))).sort()
        : normalizeForCompare(item);
    }
    return out;
  }
  return value ?? null;
}

function stableString(value) {
  if (Array.isArray(value)) return `[${value.map((item) => (typeof item === 'string' ? JSON.stringify(item) : stableString(item))).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableString(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function equal(a, b) {
  return stableString(normalizeForCompare(a)) === stableString(normalizeForCompare(b));
}

/* ------------------------------------------------------------------ *
 * 各模块的合并策略
 * ------------------------------------------------------------------ */

/**
 * 心情：entry.id 为主身份；同日不同 ID 天然都保留。
 * 同一编号不同内容只提供“保留本机/采用导入”。
 * 标签同名映射；外部 ID 被本机不同名称占用时分配新 ID，并由 `tagIdMap` 稳定记录映射。
 */
function moodStrategy({ local, incoming }) {
  const added = [];
  const identical = [];
  const conflicts = [];
  const tagIdMap = new Map();
  const tags = local.tags.map((tag) => ({ ...tag }));
  const byName = new Map(tags.map((tag) => [tag.name, tag.id]));

  for (const tag of incoming.tags) {
    const existingId = byName.get(tag.name);
    if (existingId) {
      tagIdMap.set(tag.id, existingId);
      continue;
    }
    const occupied = tags.find((item) => item.id === tag.id);
    const id = occupied ? `${tag.id}-import` : tag.id;
    tags.push({ id, name: tag.name });
    byName.set(tag.name, id);
    tagIdMap.set(tag.id, id);
  }

  const remap = (entry) => ({ ...entry, tagIds: entry.tagIds.map((id) => tagIdMap.get(id) ?? id) });

  for (const entry of incoming.entries) {
    const candidate = remap(entry);
    const existing = local.entries.find((item) => item.id === entry.id);
    if (!existing) {
      added.push({ id: entry.id, label: label(`${entry.localDate} ${entry.time} · ${entry.content || '只有心情'}`), item: candidate });
      continue;
    }
    if (equal(existing, candidate)) {
      identical.push({ id: entry.id, label: label(`${entry.localDate} ${entry.time} · 内容相同`) });
      continue;
    }
    conflicts.push({
      key: `mood:${entry.id}`,
      kind: 'entry-content',
      moduleId: 'mood',
      label: label(`${entry.localDate} ${entry.time}`),
      localItem: existing,
      incomingItem: candidate,
      options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
      defaultOption: CONFLICT_OPTIONS.keepLocal,
      blocked: false,
      message: '同一条记录编号对应不同内容。不会按更新时间自动选择，也不会自动生成副本。',
    });
  }

  const apply = (resolved) => {
    const byId = new Map(local.entries.map((entry) => [entry.id, entry]));
    for (const conflict of conflicts) {
      if (resolved[conflict.key] !== CONFLICT_OPTIONS.useIncoming) continue;
      byId.set(conflict.incomingItem.id, conflict.incomingItem);
    }
    for (const item of added) if (!byId.has(item.item.id)) byId.set(item.item.id, item.item);
    // 保留模块自身的版本字段：合并结果必须仍是该模块的合法数据
    return { ...local, entries: [...byId.values()], tags: [...tags] };
  };

  return { added, identical, conflicts, apply, tagIdMap };
}

/** 月经：周期 ID 与区间；重叠不能“保留两份”；每日记录同日只能择一。 */
function periodStrategy({ local, incoming, today }) {
  const added = [];
  const identical = [];
  const conflicts = [];
  const localPeriods = local.periods.map((item) => ({ ...item }));
  const localDaily = local.daily.map((item) => ({ ...item }));

  const overlapWith = (candidate, list) => list.find((existing) => {
    if (existing.id === candidate.id) return false;
    const aEnd = existing.endDate ?? today ?? candidate.startDate;
    const bEnd = candidate.endDate ?? today ?? candidate.startDate;
    return existing.startDate <= bEnd && candidate.startDate <= aEnd;
  });

  for (const period of incoming.periods) {
    const byId = localPeriods.find((item) => item.id === period.id);
    if (byId) {
      if (equal(byId, period)) {
        identical.push({ id: period.id, label: label(`${period.startDate} — ${period.endDate ?? '进行中'} · 相同`) });
        continue;
      }
      conflicts.push({
        key: `period:${period.id}`,
        kind: 'period-content',
        moduleId: 'period',
        label: label(`${period.startDate} — ${period.endDate ?? '进行中'}`),
        localItem: byId,
        incomingItem: period,
        options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
        defaultOption: CONFLICT_OPTIONS.keepLocal,
        blocked: false,
        message: '相同周期编号对应不同内容。',
      });
      continue;
    }
    const sameRange = localPeriods.find((item) => item.startDate === period.startDate && item.endDate === period.endDate);
    if (sameRange) {
      identical.push({ id: period.id, label: label(`${period.startDate} — ${period.endDate ?? '进行中'} · 同区间已存在`) });
      continue;
    }
    const clash = overlapWith(period, localPeriods) ?? overlapWith(period, added.filter((item) => item.kind !== 'daily').map((item) => item.item));
    if (clash) {
      conflicts.push({
        key: `period:${period.id}`,
        kind: 'period-overlap',
        moduleId: 'period',
        label: label(`${period.startDate} — ${period.endDate ?? '进行中'}`),
        localItem: clash,
        incomingItem: period,
        // 重叠不可能通过“保留两份”解决
        options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
        defaultOption: CONFLICT_OPTIONS.keepLocal,
        blocked: true,
        message: `与 ${clash.startDate} — ${clash.endDate ?? '进行中'} 重叠，一次经期只能保留其中一份记录。`,
      });
      continue;
    }
    added.push({ id: period.id, label: label(`${period.startDate} — ${period.endDate ?? '进行中'}`), item: period, kind: 'period' });
  }

  for (const record of incoming.daily) {
    const existing = localDaily.find((item) => item.date === record.date);
    if (!existing) {
      added.push({ id: record.id, label: label(`${record.date} · ${record.flow}`), item: record, kind: 'daily' });
      continue;
    }
    if (equal(existing, record)) {
      identical.push({ id: record.id, label: label(`${record.date} · 当天记录相同`) });
      continue;
    }
    conflicts.push({
      key: `period-daily:${record.date}`,
      kind: 'daily-content',
      moduleId: 'period',
      label: label(`${record.date} 身体感受`),
      localItem: existing,
      incomingItem: record,
      options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
      defaultOption: CONFLICT_OPTIONS.keepLocal,
      blocked: false,
      message: '同一天只能有一份身体感受记录。',
    });
  }

  const apply = (resolved) => {
    const periodById = new Map(localPeriods.map((item) => [item.id, item]));
    for (const conflict of conflicts) {
      const choice = resolved[conflict.key];
      if (choice !== CONFLICT_OPTIONS.useIncoming) continue;
      if (conflict.kind === 'period-overlap') {
        // 采用导入的区间：移除本机被替代的那一份
        periodById.delete(conflict.localItem.id);
        periodById.set(conflict.incomingItem.id, conflict.incomingItem);
      } else if (conflict.kind === 'period-content') {
        periodById.set(conflict.incomingItem.id, conflict.incomingItem);
      }
    }
    for (const item of added) {
      if (item.kind !== 'period') continue;
      if (!periodById.has(item.item.id)) periodById.set(item.item.id, item.item);
    }

    const dailyList = localDaily.map((item) => ({ ...item }));
    for (const conflict of conflicts) {
      if (conflict.kind !== 'daily-content' || resolved[conflict.key] !== CONFLICT_OPTIONS.useIncoming) continue;
      const index = dailyList.findIndex((item) => item.date === conflict.incomingItem.date);
      if (index >= 0) dailyList[index] = conflict.incomingItem;
    }
    for (const item of added) {
      if (item.kind !== 'daily') continue;
      if (!dailyList.some((entry) => entry.date === item.item.date)) dailyList.push(item.item);
    }
    return { ...local, periods: [...periodById.values()], daily: dailyList };
  };

  return { added, identical, conflicts, apply };
}

/** 星笺：date:sign 为主身份；快照或感想不同都报告；偏好 sign 单独选择。 */
function zodiacStrategy({ local, incoming }) {
  const added = [];
  const identical = [];
  const conflicts = [];
  const byId = new Map(local.saved.map((item) => [item.id, item]));

  for (const record of incoming.saved) {
    const existing = byId.get(record.id);
    if (!existing) {
      added.push({ id: record.id, label: label(`${record.cardSnapshot.date} · ${record.cardSnapshot.title}`), item: record });
      continue;
    }
    if (equal(existing, record)) {
      identical.push({ id: record.id, label: label(`${record.cardSnapshot.date} · 相同`) });
      continue;
    }
    const snapshotChanged = !equal(existing.cardSnapshot, record.cardSnapshot);
    conflicts.push({
      key: `zodiac:${record.id}`,
      kind: snapshotChanged ? 'snapshot-content' : 'note-content',
      moduleId: 'zodiac',
      label: label(`${record.cardSnapshot.date}`),
      localItem: existing,
      incomingItem: record,
      options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
      defaultOption: CONFLICT_OPTIONS.keepLocal,
      blocked: false,
      message: snapshotChanged
        ? '收藏的原始快照与感想都不同。已收藏内容不会自动被新内容覆盖。'
        : '同一封星笺的感想不同。',
    });
  }

  const apply = (resolved) => {
    for (const conflict of conflicts) {
      if (resolved[conflict.key] !== CONFLICT_OPTIONS.useIncoming) continue;
      byId.set(conflict.incomingItem.id, conflict.incomingItem);
    }
    for (const item of added) if (!byId.has(item.item.id)) byId.set(item.item.id, item.item);
    return { ...local, sign: local.sign, saved: [...byId.values()] };
  };

  return {
    added,
    identical,
    conflicts,
    apply,
    signChange: local.sign === incoming.sign ? null : { key: 'zodiac:sign', local: local.sign, incoming: incoming.sign },
  };
}

/** 财务：跨集合身份矛盾、initialBalance 单独冲突、疑似重复只提示。 */
function cashflowStrategy({ local, incoming }) {
  const added = [];
  const identical = [];
  const conflicts = [];
  const warnings = [];

  const allLocal = new Map([
    ...local.events.map((event) => [event.id, 'events']),
    ...local.simulationEvents.map((event) => [event.id, 'simulationEvents']),
  ]);

  if (local.initialBalance !== incoming.initialBalance) {
    conflicts.push({
      key: 'cashflow:initialBalance',
      kind: 'initial-balance',
      moduleId: 'cashflow',
      label: '初始基准余额',
      localItem: { initialBalance: local.initialBalance },
      incomingItem: { initialBalance: incoming.initialBalance },
      options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
      defaultOption: CONFLICT_OPTIONS.keepLocal,
      blocked: false,
      message: `本机 ${local.initialBalance}，备份 ${incoming.initialBalance}。初始余额不会被相加。`,
    });
  }

  const pushEvents = (list, collection) => {
    for (const event of list) {
      const localCollection = allLocal.get(event.id);
      if (!localCollection) {
        added.push({ id: event.id, label: label(`${event.name} ${event.amount}`), item: event, collection });
        continue;
      }
      const localEvent = localCollection === 'events'
        ? local.events.find((item) => item.id === event.id)
        : local.simulationEvents.find((item) => item.id === event.id);
      const incomingItem = { ...event, isSimulation: collection === 'simulationEvents' };
      if (localCollection === collection && equal(localEvent, incomingItem)) {
        identical.push({ id: event.id, label: label(`${event.name} · 相同`) });
        continue;
      }
      conflicts.push({
        key: `cashflow:${event.id}`,
        kind: localCollection !== collection ? 'collection-mismatch' : 'event-content',
        moduleId: 'cashflow',
        label: label(event.name),
        localItem: localEvent,
        incomingItem,
        options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
        defaultOption: CONFLICT_OPTIONS.keepLocal,
        blocked: false,
        message: localCollection !== collection
          ? `同一编号在本机属于${localCollection === 'events' ? '真实计划' : '模拟'}，备份属于${collection === 'events' ? '真实计划' : '模拟'}。`
          : '同一编号的事件内容不同。',
      });
    }
  };
  pushEvents(incoming.events, 'events');
  pushEvents(incoming.simulationEvents, 'simulationEvents');

  // 疑似重复：不同编号、同名同金额（只提示，不自动去重）
  for (const event of [...incoming.events, ...incoming.simulationEvents]) {
    if (allLocal.has(event.id)) continue;
    const similar = [...local.events, ...local.simulationEvents].filter((item) => item.name === event.name && item.amount === event.amount);
    if (similar.length) {
      warnings.push({
        code: 'SUSPECTED_DUPLICATE',
        scope: 'cashflow',
        message: `备份中的「${label(event.name)}（${event.amount}）」与本机 ${similar.length} 条同名同金额记录相似，可能是重复导入，未自动去重。`,
      });
    }
  }

  const apply = (resolved) => {
    const events = new Map(local.events.map((event) => [event.id, event]));
    const simulationEvents = new Map(local.simulationEvents.map((event) => [event.id, event]));
    let initialBalance = local.initialBalance;

    for (const conflict of conflicts) {
      if (resolved[conflict.key] !== CONFLICT_OPTIONS.useIncoming) continue;
      if (conflict.kind === 'initial-balance') {
        initialBalance = conflict.incomingItem.initialBalance;
        continue;
      }
      const event = { ...conflict.incomingItem, isSimulation: conflict.incomingItem.isSimulation === true };
      if (event.isSimulation) {
        events.delete(event.id);
        simulationEvents.set(event.id, event);
      } else {
        simulationEvents.delete(event.id);
        events.set(event.id, event);
      }
    }

    for (const item of added) {
      const event = { ...item.item, isSimulation: item.collection === 'simulationEvents' };
      if (events.has(event.id) || simulationEvents.has(event.id)) continue;
      if (event.isSimulation) simulationEvents.set(event.id, event);
      else events.set(event.id, event);
    }
    return { ...local, schemaVersion: 1, initialBalance, events: [...events.values()], simulationEvents: [...simulationEvents.values()] };
  };

  return { added, identical, conflicts, apply, warnings };
}

const STRATEGIES = {
  mood: moodStrategy,
  period: periodStrategy,
  zodiac: zodiacStrategy,
  cashflow: cashflowStrategy,
};

/* ------------------------------------------------------------------ *
 * 专属内容（当天总结与每日标签）
 * ------------------------------------------------------------------ */

/**
 * 专属内容合并计划：同日不同正文必须逐项选择，不静默保留、不自动拼接。
 * `resolutions` 形如 `{ '2026-10-10': 'local' | 'incoming' }`。
 */
export function planLifeMerge(localLife, incomingLife, resolutions = {}) {
  const added = [];
  const identical = [];
  const conflicts = [];
  const tagIdMap = new Map();
  const tags = localLife.tags.map((tag) => ({ ...tag }));
  const byName = new Map(tags.map((tag) => [tag.name, tag.id]));

  for (const tag of incomingLife.tags) {
    const existingId = byName.get(tag.name);
    if (existingId) {
      tagIdMap.set(tag.id, existingId);
      continue;
    }
    const occupied = tags.find((item) => item.id === tag.id);
    const id = occupied ? `${tag.id}-import` : tag.id;
    tags.push({ id, name: tag.name });
    byName.set(tag.name, id);
    tagIdMap.set(tag.id, id);
  }

  const summaries = localLife.summaries.map((summary) => ({ ...summary }));
  for (const summary of incomingLife.summaries) {
    const remapped = { ...summary, tagIds: summary.tagIds.map((id) => tagIdMap.get(id) ?? id) };
    const existing = summaries.find((item) => item.date === summary.date);
    if (!existing) {
      added.push({ id: summary.id, label: label(`${summary.date} · ${remapped.content.slice(0, 24) || '（空总结）'}`), item: remapped });
      continue;
    }
    if (equal(existing, remapped)) {
      identical.push({ id: summary.id, label: label(`${summary.date} · 相同`) });
      continue;
    }
    conflicts.push({
      key: `life:${summary.date}`,
      kind: 'summary-content',
      moduleId: 'life',
      label: label(`${summary.date} 当天总结`),
      localItem: existing,
      incomingItem: remapped,
      options: [CONFLICT_OPTIONS.keepLocal, CONFLICT_OPTIONS.useIncoming],
      defaultOption: CONFLICT_OPTIONS.keepLocal,
      blocked: false,
      message: '同一天的总结正文不同。不会自动拼接，需要选择保留哪一份。',
    });
  }

  const apply = (resolutionsIn = {}) => {
    const list = [...summaries];
    for (const conflict of conflicts) {
      if (resolutionsIn[conflict.key] !== CONFLICT_OPTIONS.useIncoming) continue;
      const index = list.findIndex((item) => item.date === conflict.incomingItem.date);
      if (index >= 0) list[index] = conflict.incomingItem;
    }
    for (const item of added) {
      if (!list.some((entry) => entry.date === item.item.date)) list.push(item.item);
    }
    return { schemaVersion: 1, summaries: list, tags };
  };

  return { added, identical, conflicts, apply, tagIdMap, resolutions };
}

/* ------------------------------------------------------------------ *
 * 计划生成
 * ------------------------------------------------------------------ */

function isNormalizedIncoming(value) {
  return isNormalized(value);
}

/**
 * 生成 ImportPlan。不写入任何数据。
 *
 * @param current 当前 envelope（`store.getState().data`）
 * @param incoming 已解析的 JSON 值、`{ format, value }`，或 `normalizeIncoming()` 的返回值
 * @param options `{ baseRevision, now, today, format, sourceKind, sourceKey }`
 */
export function planImport(current, incoming, { baseRevision = null, now = new Date(), today = null, format = null, sourceKind = null, sourceKey = null } = {}) {
  const normalized = isNormalizedIncoming(incoming)
    ? { ...incoming, modules: { ...incoming.modules } }
    : normalizeIncoming(incoming?.value !== undefined && incoming?.format ? incoming.value : incoming, {
      format: format ?? incoming?.format,
      now,
      today,
    });
  // Even a branded normalized value may have been mutated after validation.
  // Validate all payloads again before constructing conflict strategies.
  for (const id of Object.keys(normalized.modules ?? {})) {
    if (!MODULE_IDS.includes(id)) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${id}。` });
    normalized.modules[id] = MODULE_REGISTRY[id].validate(normalized.modules[id], { today });
  }
  if (normalized.settings) normalized.settings = validateSettings(normalized.settings);
  if (normalized.life) normalized.life = validateLife(normalized.life, 'life', { today });
  const local = current ?? createEmptyEnvelope({ now });
  const modules = {};
  const warnings = [];

  for (const id of MODULE_IDS) {
    const incomingData = normalized.modules?.[id];
    if (!incomingData) {
      modules[id] = {
        decision: 'skip',
        available: false,
        added: [],
        identical: [],
        conflicts: [],
        unresolved: 0,
        warnings: [],
        signChange: null,
      };
      continue;
    }
    const strategy = STRATEGIES[id]({ local: local.modules[id].data, incoming: incomingData, today, now });
    modules[id] = {
      // 一律默认“合并”（含单模块文件）；界面可以显式改成“替换本模块”
      decision: 'merge',
      available: true,
      added: strategy.added,
      identical: strategy.identical,
      conflicts: strategy.conflicts,
      unresolved: strategy.conflicts.length,
      warnings: strategy.warnings ?? [],
      signChange: strategy.signChange ?? null,
      /** 内部策略对象：不用于渲染，提交时复用同一套判定 */
      _strategy: strategy,
    };
    for (const item of strategy.warnings ?? []) warnings.push(item);
  }

  const settings = { changes: [], keepLocalLayout: true, incoming: normalized.settings ?? null };
  if (normalized.settings) {
    const pairs = [
      ['defaultSign', '默认星座'],
      ['enabledModules', '模块开关'],
      ['moduleOrder', '模块顺序'],
      ['calendarIncludeSimulation', '日历是否含模拟'],
    ];
    for (const [key, labelText] of pairs) {
      if (!equal(local.settings[key], normalized.settings[key])) {
        settings.changes.push({ key, label: labelText, local: local.settings[key], incoming: normalized.settings[key] });
      }
    }
  }

  const lifeMerge = normalized.life
    ? planLifeMerge(local.life, normalized.life)
    : { added: [], identical: [], conflicts: [], apply: () => local.life };

  return {
    __plan: true,
    sourceFormat: normalized.format,
    sourceVersion: normalized.sourceFormatVersion ?? null,
    sourceModuleId: normalized.moduleId ?? null,
    sourceKind: sourceKind ?? (sourceKey ? 'legacy-key' : normalized.format === 'unified' ? 'unified-backup' : 'file'),
    sourceKey: sourceKey ?? null,
    baseRevision: baseRevision ?? local.revision,
    generatedAt: now.toISOString(),
    today: today ?? null,
    modules,
    settings,
    life: normalized.life ?? null,
    lifeMerge,
    lifeConflicts: lifeMerge.conflicts,
    provenance: normalized.provenance ?? [],
    warnings,
    normalized,
  };
}

/** 供界面显示的摘要计数（不参与写入）。 */
export function describeImportPlan(plan) {
  const rows = [];
  for (const id of MODULE_IDS) {
    const module = plan.modules[id];
    if (!module?.available) continue;
    rows.push({
      id,
      label: MODULE_LABELS[id],
      decision: module.decision,
      added: module.added.length,
      identical: module.identical.length,
      conflicts: module.conflicts.length,
      blocked: module.conflicts.filter((item) => item.blocked).length,
      signChange: module.signChange,
      warnings: module.warnings,
    });
  }
  return {
    sourceFormat: plan.sourceFormat,
    sourceKind: plan.sourceKind,
    sourceKey: plan.sourceKey ?? null,
    totals: rows.reduce((total, row) => ({
      added: total.added + row.added,
      identical: total.identical + row.identical,
      conflicts: total.conflicts + row.conflicts,
    }), { added: 0, identical: 0, conflicts: 0 }),
    rows,
    settings: plan.settings.changes,
    lifeConflicts: plan.lifeConflicts ?? [],
    warnings: plan.warnings,
  };
}

/* ------------------------------------------------------------------ *
 * 计划落地
 * ------------------------------------------------------------------ */

/**
 * 校验用户给出的冲突选择合法，且没有遗留未处理的冲突。
 * 未提供选择即抛错：冲突绝不能静默按默认值落地，界面必须先让用户处理。
 */
function resolveModuleConflicts(module, moduleId, resolved = {}) {
  const choices = {};
  for (const conflict of module.conflicts) {
    const choice = resolved[conflict.key];
    if (choice === undefined || choice === null) {
      fail(conflict.blocked ? ErrorCode.IMPORT_OVERLAP_UNRESOLVABLE : ErrorCode.IMPORT_UNRESOLVED, {
        scope: moduleId,
        message: `冲突「${conflict.label}」还没有处理（可选：${conflict.options.join(' / ')}）。`,
      });
    }
    if (!conflict.options.includes(choice)) {
      fail(ErrorCode.SCHEMA_INVALID, {
        scope: moduleId,
        message: `冲突「${conflict.label}」收到了不支持的处理方式 ${String(choice)}（可选：${conflict.options.join(' / ')}）。`,
      });
    }
    choices[conflict.key] = choice;
  }
  return choices;
}

/**
 * 把“本机数据”规范化：完整 envelope 必须通过全量校验；
 * 仅模块数据为空的 envelope（例如界面构造的空壳）按空数据补齐后再继续。
 * 其他任何不合法内容都会抛出，不会被静默修复。
 */
function normalizeLocalEnvelope(input, { now, today }) {
  if (!input) return createEmptyEnvelope({ now });
  try {
    return validateEnvelope(input, { now, today });
  } catch (error) {
    const base = createEmptyEnvelope({ now });
    if (!input.modules || typeof input.modules !== 'object') throw error;
    const modules = {};
    for (const id of MODULE_IDS) {
      const entry = input.modules[id];
      modules[id] = { schemaVersion: 1, data: MODULE_REGISTRY[id].validate(entry?.data ?? base.modules[id].data, { today }) };
    }
    return {
      ...base,
      revision: Number.isSafeInteger(input.revision) ? input.revision : base.revision,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
      settings: input.settings ? validateEnvelope({ ...base, settings: input.settings }, { now, today }).settings : base.settings,
      life: input.life ? validateEnvelope({ ...base, life: input.life }, { now, today }).life : base.life,
      modules,
      provenance: Array.isArray(input.provenance) ? input.provenance : base.provenance,
    };
  }
}

/**
 * 应用导入计划。
 *
 * @param plan `planImport` 的返回值
 * @param decisions `{ modules, conflicts, settings, sign, life, mode }`
 * @param options `{ current, now, today, currentRevision }`
 * @returns `{ envelope, stats }`（envelope 已重跑全量校验）
 */
export function applyImport(plan, decisions = {}, { current, now = new Date(), today = null, currentRevision = null } = {}) {
  const effectiveToday = today ?? plan.today ?? null;
  // 修订号检查放在最前面：过期预览绝不能改动任何数据
  if (currentRevision !== null && plan.baseRevision !== null && currentRevision !== plan.baseRevision) {
    fail(ErrorCode.IMPORT_STALE, {
      message: '数据在打开预览后被改动（修订号已变化），已停止提交。请重新生成导入预览后再试；本次没有写入任何数据。',
    });
  }
  const local = normalizeLocalEnvelope(current, { now, today: effectiveToday });
  if (plan.baseRevision !== null && local.revision !== plan.baseRevision) {
    fail(ErrorCode.IMPORT_STALE, {
      message: '数据在打开预览后被改动（修订号已变化），已停止提交。请重新生成导入预览后再试；本次没有写入任何数据。',
    });
  }

  const moduleDecisions = decisions.modules ?? {};
  const resolvedConflicts = decisions.conflicts ?? {};
  const modules = {};
  const importStats = [];
  const isFullReplace = decisions.mode === 'full-replace';
  for (const [id, dependencies] of Object.entries(plan.normalized.dependencies ?? {})) {
    const choice = moduleDecisions[id] ?? plan.modules[id]?.decision ?? 'merge';
    if (choice === 'skip') continue;
    for (const dependency of dependencies) {
      const dependencyChoice = moduleDecisions[dependency] ?? plan.modules[dependency]?.decision ?? 'merge';
      if (!plan.modules[dependency]?.available || dependencyChoice === 'skip') fail(ErrorCode.SCHEMA_INVALID, { path: `modules.${id}.dependencies`, message: `${id} 需要同时导入依赖模块 ${dependency}，请调整选择或取消此模块。` });
    }
  }

  for (const id of MODULE_IDS) {
    const module = plan.modules[id];
    if (!module?.available) {
      modules[id] = local.modules[id].data;
      continue;
    }
    const decision = moduleDecisions[id] ?? module.decision ?? 'merge';
    if (!DECISIONS.includes(decision)) {
      fail(ErrorCode.SCHEMA_INVALID, { scope: id, message: `未知的导入方式 ${String(decision)}。` });
    }
    if (decision === 'skip') {
      modules[id] = local.modules[id].data;
      importStats.push({ id, decision, added: 0, identical: module.identical.length, conflicts: 0 });
      continue;
    }

    let nextData;
    if (decision === 'replace') {
      nextData = plan.normalized.modules[id];
    } else {
      const choices = resolveModuleConflicts(module, id, resolvedConflicts);
      if (module.signChange && decisions.sign && decisions.sign[id]) {
        const chosen = decisions.sign[id];
        if (!['keepLocal', 'useIncoming'].includes(chosen)) {
          fail(ErrorCode.SCHEMA_INVALID, { scope: id, message: `默认星座的变化收到了不支持的处理方式 ${String(chosen)}。` });
        }
      }
      nextData = module._strategy.apply(choices);
      if (module.signChange && decisions.sign?.[id] === CONFLICT_OPTIONS.useIncoming) {
        nextData = { ...nextData, sign: module.signChange.incoming };
      }
    }

    modules[id] = MODULE_REGISTRY[id].validate(nextData, { today: effectiveToday });
    importStats.push({
      id,
      decision,
      added: module.added.length,
      identical: module.identical.length,
      conflicts: module.conflicts.length,
    });
  }

  // 设置：默认保留本机布局与开关，偏好变化需要显式选择
  let settings = local.settings;
  if (plan.settings.incoming) {
    const keepLocal = decisions.settings?.keepLocalLayout !== false;
    if (keepLocal && !isFullReplace) {
      settings = {
        ...local.settings,
        ...(decisions.settings?.defaultSign ? { defaultSign: decisions.settings.defaultSign } : {}),
        ...(decisions.settings?.enabledModules ? { enabledModules: decisions.settings.enabledModules } : {}),
        ...(decisions.settings?.moduleOrder ? { moduleOrder: decisions.settings.moduleOrder } : {}),
        ...(decisions.settings?.calendarIncludeSimulation !== undefined ? { calendarIncludeSimulation: decisions.settings.calendarIncludeSimulation } : {}),
      };
    } else {
      settings = {
        ...plan.settings.incoming,
        ...(decisions.settings?.enabledModules ? { enabledModules: decisions.settings.enabledModules } : {}),
        ...(decisions.settings?.moduleOrder ? { moduleOrder: decisions.settings.moduleOrder } : {}),
        ...(decisions.settings?.defaultSign ? { defaultSign: decisions.settings.defaultSign } : {}),
      };
    }
  }

  // 专属内容：完整替换随备份一起替换；否则按逐项选择合并
  let life = local.life;
  const lifeMode = decisions.life ?? (isFullReplace ? 'replace' : plan.life ? 'merge' : 'keep');
  if (lifeMode === 'replace' && plan.life) {
    life = plan.life;
  } else if (lifeMode === 'merge' && plan.life) {
    const lifeChoices = {};
    for (const conflict of plan.lifeConflicts ?? []) {
      const choice = resolvedConflicts[conflict.key];
      if (choice === undefined || choice === null) {
        fail(ErrorCode.IMPORT_UNRESOLVED, {
          scope: 'life',
          message: `当天总结「${conflict.label}」还没有处理（可选：${conflict.options.join(' / ')}）。`,
        });
      }
      if (!conflict.options.includes(choice)) {
        fail(ErrorCode.SCHEMA_INVALID, { scope: 'life', message: `当天总结「${conflict.label}」收到了不支持的处理方式 ${String(choice)}。` });
      }
      lifeChoices[conflict.key] = choice;
    }
    life = plan.lifeMerge.apply(lifeChoices);
  }

  const provenance = isFullReplace
    ? [...local.provenance, ...(plan.provenance ?? [])]
    : [...local.provenance];

  provenance.push({
    at: now.toISOString(),
    source: plan.sourceKind ?? 'file',
    format: plan.sourceFormat,
    module: plan.sourceModuleId ?? null,
    added: importStats.reduce((total, item) => total + item.added, 0),
    identical: importStats.reduce((total, item) => total + item.identical, 0),
    conflicts: importStats.reduce((total, item) => total + item.conflicts, 0),
    batches: 1,
    ...(plan.sourceKey ? { note: `来自本站旧应用（${plan.sourceKey}）` } : {}),
  });

  const envelope = buildEnvelope({
    modules,
    settings,
    life,
    provenance,
    revision: local.revision + 1,
    now,
    today: effectiveToday,
  });
  return { envelope, stats: importStats };
}

/** 提交前重校验：解决冲突后重新跑组合校验。 */
export function revalidateImport(envelope, { now = new Date(), today = null } = {}) {
  return validateEnvelope(cloneEnvelope(envelope), { now, today });
}

export { LifeCalendarError, ErrorCode, MODULE_LABELS };
