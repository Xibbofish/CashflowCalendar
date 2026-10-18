/**
 * Cashflow 数据模型：严格校验、命令、查询、旧格式读写。
 *
 * 与旧应用的关系（docs/TECHNICAL.md §4）：
 * - 备份顶层是 `initialBalance / events / simulationEvents`，没有版本号；
 *   统一存储内部增加本文件自己的 `schemaVersion` 包装，兼容导出时移除包装。
 * - `normalizeEvent` 会静默填默认值，因此严格校验必须先生效，不能用默认值掩盖非法金额或字段。
 * - 周期源事件只存一次，按日期展开的结果不保存成新的交易。
 */
import { LifeCalendarError, ErrorCode, fail } from '../../errors.js';
import { isDateString, validDate } from '../../date/index.js';
import { DEFAULT_CATEGORIES, EventType, RECURRING_TYPES, RecurringType, UNCATEGORIZED_LABEL, eventCategoryLabel, expandEvents, normalizeEvent } from './engine.js';

export const SCHEMA_VERSION = 1;
export const LIMITS = {
  initialBalanceAbs: 1e12,
  amountAbs: 1e12,
  events: 2000,
  name: 200,
  category: 100,
  description: 2000,
  id: 100,
  skippedDates: 400,
  occurrenceCount: 10000,
  rangeDays: 3650,
};

export const EVENT_FIELDS = [
  'id', 'name', 'type', 'amount', 'date', 'isRecurring', 'recurringType',
  'recurringStartDate', 'recurringEndDate', 'isPermanent', 'occurrenceCount',
  'canSkip', 'isSimulation', 'category', 'description', 'skippedDates',
];
export const DATA_FIELDS = ['schemaVersion', 'initialBalance', 'events', 'simulationEvents'];
/** 旧格式允许的字段（无 schemaVersion 包装）。 */
export const LEGACY_FIELDS = ['initialBalance', 'events', 'simulationEvents'];

/**
 * 关键安全字段：这些字段决定事件的实际发生与归属，缺失时不能用默认值掩盖。
 * 旧应用 `normalizeEvent` 会把缺失值填成默认值，掩盖非法输入；
 * 旧格式读取必须仍然拒绝缺失这些字段的备份。
 */
export const CRITICAL_EVENT_FIELDS = ['id', 'type', 'amount', 'isRecurring', 'recurringType', 'isPermanent', 'canSkip', 'isSimulation'];

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, initialBalance: 10000, events: [], simulationEvents: [] };
}

function checkObject(value, path, code = ErrorCode.SCHEMA_INVALID) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, { path, scope: 'cashflow', message: `${path} 必须是对象。` });
}

/**
 * 未知字段处理（统一存储、统一备份、旧格式读取一律拒绝）：
 * 拒绝而不是保留，避免统一恢复时出现静默丢字段或语义漂移。
 */
function checkUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${key}`, scope: 'cashflow', message: `${path} 包含不认识的字段：${key}` });
  }
}

/** 旧格式读取时必须存在、且不能被默认值替代的字段。 */
function checkRequiredEventFields(input, path, required = []) {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] === undefined) {
      fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.${key}`, scope: 'cashflow', message: `${path} 缺少必需字段：${key}。为避免默认值掩盖数据，该备份不会被读取。` });
    }
  }
}

function checkString(value, max, path, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path, scope: 'cashflow', message: `${path} 必须是字符串。` });
  if (!allowEmpty && !value.trim()) fail(ErrorCode.SCHEMA_INVALID, { path, scope: 'cashflow', message: `${path} 不能为空。` });
  if (value.length > max) fail(ErrorCode.TEXT_TOO_LONG, { path, scope: 'cashflow', message: `${path} 超过 ${max} 个字符。` });
  return value;
}

function checkMoney(value, path, { maxAbs }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(ErrorCode.AMOUNT_INVALID, { path, scope: 'cashflow', message: `${path} 必须是有限数字。` });
  }
  if (Math.abs(value) > maxAbs) fail(ErrorCode.AMOUNT_INVALID, { path, scope: 'cashflow', message: `${path} 超出金额范围。` });
  return value;
}

function checkDateValue(value, path, { optional = true } = {}) {
  if (optional && (value === '' || value === null || value === undefined)) return '';
  if (!isDateString(value) || !validDate(value)) fail(ErrorCode.DATE_INVALID, { path, scope: 'cashflow', message: `${path} 不是有效日期。` });
  return value;
}

/**
 * 严格校验单个事件，未知字段与非法金额都拒绝，不填默认值。
 * - `amount` 允许 0，也允许与 `type` 的符号方向不一致：旧应用 `normalizeEvent`
 *   保留原符号与原 `type`，引擎一律按金额正负计算收/支。这里原样保留，不“修正”用户数据。
 * - `isPermanent` 为真时仍保留 `occurrenceCount`：引擎在永久模式下忽略次数，字段必须原样往返。
 * - `required` 列出旧格式读取时必须显式存在的安全字段。
 */
export function validateEvent(input, path = 'event', { required = [] } = {}) {
  checkObject(input, path);
  checkUnknownFields(input, EVENT_FIELDS, path);
  checkRequiredEventFields(input, path, required);
  const id = checkString(input.id, LIMITS.id, `${path}.id`, { allowEmpty: false });
  if (!/^[A-Za-z0-9_:.-]{1,100}$/.test(id)) fail(ErrorCode.ID_INVALID, { path: `${path}.id`, scope: 'cashflow', message: `${path}.id 含不允许的字符。` });
  if (input.name !== undefined && typeof input.name !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.name`, scope: 'cashflow', message: `${path}.name 必须是字符串。` });
  const name = checkString(input.name ?? `事件 ${id}`, LIMITS.name, `${path}.name`, { allowEmpty: true });
  if (input.type !== EventType.INCOME && input.type !== EventType.EXPENSE) {
    fail(ErrorCode.ENUM_INVALID, { path: `${path}.type`, scope: 'cashflow', message: `${path}.type 只能是 income 或 expense。` });
  }
  const amount = checkMoney(input.amount, `${path}.amount`, { maxAbs: LIMITS.amountAbs });
  for (const key of ['isRecurring', 'isPermanent', 'canSkip', 'isSimulation']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.${key}`, scope: 'cashflow', message: `${path}.${key} 必须是布尔值。` });
    }
  }
  const isRecurring = input.isRecurring === true;
  // 永久周期保留次数字段：旧备份可能同时存在 occurrenceCount 与 isPermanent，
  // 引擎在永久模式下忽略次数，但字段本身必须原样保留，不能清空。
  const isPermanent = input.isPermanent === true;
  const canSkip = input.canSkip === true;
  const recurringType = input.recurringType ?? (isRecurring ? RecurringType.NONE : RecurringType.NONE);
  if (!RECURRING_TYPES.includes(recurringType)) {
    fail(ErrorCode.ENUM_INVALID, { path: `${path}.recurringType`, scope: 'cashflow', message: `${path}.recurringType 取值无效。` });
  }
  const date = checkDateValue(input.date, `${path}.date`);
  const recurringStartDate = checkDateValue(input.recurringStartDate, `${path}.recurringStartDate`);
  const recurringEndDate = checkDateValue(input.recurringEndDate, `${path}.recurringEndDate`);
  if (isRecurring) {
    if (recurringType === RecurringType.NONE) {
      fail(ErrorCode.ENUM_INVALID, { path: `${path}.recurringType`, scope: 'cashflow', message: '周期事件必须指定周期类型。' });
    }
    if (!recurringStartDate) fail(ErrorCode.DATE_INVALID, { path: `${path}.recurringStartDate`, scope: 'cashflow', message: '周期事件必须有开始日期。' });
    if (recurringEndDate && recurringEndDate < recurringStartDate) {
      fail(ErrorCode.RANGE_ORDER, { path: `${path}.recurringEndDate`, scope: 'cashflow', message: '周期结束日期不能早于开始日期。' });
    }
  } else if (recurringType !== RecurringType.NONE) {
    fail(ErrorCode.ENUM_INVALID, { path: `${path}.recurringType`, scope: 'cashflow', message: '非周期事件的周期类型必须是 none。' });
  }
  if (!isRecurring && !date) fail(ErrorCode.DATE_INVALID, { path: `${path}.date`, scope: 'cashflow', message: '单次事件必须有日期。' });
  let occurrenceCount = null;
  if (input.occurrenceCount !== null && input.occurrenceCount !== undefined) {
    if (!Number.isSafeInteger(input.occurrenceCount) || input.occurrenceCount < 1 || input.occurrenceCount > LIMITS.occurrenceCount) {
      fail(ErrorCode.ENUM_INVALID, { path: `${path}.occurrenceCount`, scope: 'cashflow', message: `发生次数必须是 1—${LIMITS.occurrenceCount} 的整数，或留空表示按截止日期结束。` });
    }
    occurrenceCount = input.occurrenceCount;
  }
  const rawSkipped = input.skippedDates ?? [];
  if (!Array.isArray(rawSkipped)) fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.skippedDates`, scope: 'cashflow', message: '历史跳过日期必须是数组。' });
  if (rawSkipped.length > LIMITS.skippedDates) fail(ErrorCode.LIMIT_EXCEEDED, { path: `${path}.skippedDates`, scope: 'cashflow', message: '历史跳过日期过多。' });
  const skippedDates = rawSkipped.map((value, index) => checkDateValue(value, `${path}.skippedDates[${index}]`, { optional: false }));
  return {
    id,
    name,
    type: input.type,
    amount,
    date,
    isRecurring,
    recurringType,
    recurringStartDate,
    recurringEndDate,
    isPermanent,
    occurrenceCount,
    canSkip,
    isSimulation: input.isSimulation === true,
    category: checkString(input.category ?? '', LIMITS.category, `${path}.category`),
    description: checkString(input.description ?? '', LIMITS.description, `${path}.description`),
    skippedDates,
  };
}

/** 严格校验整个模块数据，并检查跨集合身份矛盾。 */
export function validate(input, { path = 'cashflow', requiredEventFields = [] } = {}) {
  checkObject(input, path);
  checkUnknownFields(input, DATA_FIELDS, path);
  if (input.schemaVersion !== SCHEMA_VERSION) {
    const code = typeof input.schemaVersion === 'number' && input.schemaVersion > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: `${path}.schemaVersion`, scope: 'cashflow', message: `现金流模块数据版本 ${input.schemaVersion} 不受支持。` });
  }
  checkMoney(input.initialBalance, `${path}.initialBalance`, { maxAbs: LIMITS.initialBalanceAbs });
  for (const key of ['events', 'simulationEvents']) {
    if (!Array.isArray(input[key])) fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.${key}`, scope: 'cashflow', message: `${path}.${key} 必须是数组。` });
    if (input[key].length > LIMITS.events) fail(ErrorCode.LIMIT_EXCEEDED, { path: `${path}.${key}`, scope: 'cashflow', message: `${path}.${key} 超过 ${LIMITS.events} 条上限。` });
  }
  const seen = new Map();
  const collect = (list, key) => list.map((raw, index) => {
    // `isSimulation` 由集合归属决定：同一字段在两处出现时不得互相矛盾。
    if (raw && Object.prototype.hasOwnProperty.call(raw, 'isSimulation') && raw.isSimulation !== (key === 'simulationEvents')) {
      fail(ErrorCode.IDENTITY_CONFLICT, {
        path: `${path}.${key}[${index}].isSimulation`,
        scope: 'cashflow',
        message: `事件 ${raw.id} 的 isSimulation 与所在集合 ${key} 不一致，跨集合身份矛盾。`,
      });
    }
    const event = validateEvent({ ...raw, isSimulation: key === 'simulationEvents' }, `${path}.${key}[${index}]`, { required: requiredEventFields });
    if (seen.has(event.id)) {
      fail(ErrorCode.IDENTITY_CONFLICT, {
        path: `${path}.${key}[${index}].id`,
        scope: 'cashflow',
        message: `事件编号 ${event.id} 同时出现在 ${seen.get(event.id)} 与 ${key}，跨集合身份矛盾。`,
      });
    }
    seen.set(event.id, key);
    return event;
  });
  const events = collect(input.events, 'events');
  const simulationEvents = collect(input.simulationEvents, 'simulationEvents');
  return { schemaVersion: SCHEMA_VERSION, initialBalance: input.initialBalance, events, simulationEvents };
}

/** 旧格式读取：允许没有 schemaVersion，但仍执行严格校验，未知字段一律拒绝。 */
export function readLegacy(raw, { path = 'cashflow' } = {}) {
  checkObject(raw, path);
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) {
    const code = typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: `${path}.schemaVersion`, scope: 'cashflow', message: `现金流备份版本 ${raw.schemaVersion} 不受支持。` });
  }
  checkUnknownFields(raw, LEGACY_FIELDS, path);
  return validate(
    { schemaVersion: SCHEMA_VERSION, initialBalance: raw.initialBalance, events: raw.events, simulationEvents: raw.simulationEvents },
    { path, requiredEventFields: CRITICAL_EVENT_FIELDS },
  );
}

/** 兼容导出：移除模块包装，输出旧应用可读取的结构；键集合与旧备份完全一致。 */
export function writeLegacy(data) {
  const { schemaVersion: _ignored, ...legacy } = validate(data);
  return legacy;
}

/** 供旧应用导入使用的宽松归一化（保持旧行为不变）。 */
export function normalizeLegacyImport(raw) {
  return {
    initialBalance: typeof raw?.initialBalance === 'number' ? raw.initialBalance : 10000,
    events: (raw?.events || []).map(normalizeEvent),
    simulationEvents: (raw?.simulationEvents || []).map(normalizeEvent),
  };
}

function findEvent(data, id) {
  return data.events.find((event) => event.id === id) ?? data.simulationEvents.find((event) => event.id === id) ?? null;
}

export function getDay(data, date) {
  const real = data.events.filter((event) => !event.isRecurring && event.date === date).map((event) => ({ ...event, isSimulation: false }));
  const simulation = data.simulationEvents.filter((event) => !event.isRecurring && event.date === date).map((event) => ({ ...event, isSimulation: true }));
  return {
    date,
    events: [...real, ...simulation],
    /** 单次事件按日期直接命中；周期事件需要展开区间，由聚合层用 expandRange 处理。 */
    recurringCandidates: [...data.events.filter((event) => event.isRecurring), ...data.simulationEvents.filter((event) => event.isRecurring)],
    real: real.reduce((sum, event) => sum + event.amount, 0),
    simulation: simulation.reduce((sum, event) => sum + event.amount, 0),
  };
}

/**
 * 新增/编辑/删除事件。
 * 命令只返回新数据，不写存储；`isSimulation` 由集合归属决定，不接受调用方跨集合漂移。
 */
export function applyCommand(data, command) {
  const { type, payload = {} } = command;
  switch (type) {
    case 'upsertEvent': {
      const event = validateEvent({ ...payload.event, isSimulation: Boolean(payload.event?.isSimulation) }, 'command.event');
      const key = event.isSimulation ? 'simulationEvents' : 'events';
      const otherKey = event.isSimulation ? 'events' : 'simulationEvents';
      if (data[otherKey].some((item) => item.id === event.id)) {
        fail(ErrorCode.IDENTITY_CONFLICT, { scope: 'cashflow', message: `事件编号 ${event.id} 已存在于另一集合，不能直接改情景，请先删除再用新编号保存。` });
      }
      return validate({ ...data, [key]: [...data[key].filter((item) => item.id !== event.id), event] });
    }
    case 'deleteEvent': {
      const exists = findEvent(data, payload.id);
      if (!exists) fail(ErrorCode.SCHEMA_INVALID, { scope: 'cashflow', message: `找不到事件 ${payload.id}。` });
      return validate({
        ...data,
        events: data.events.filter((item) => item.id !== payload.id),
        simulationEvents: data.simulationEvents.filter((item) => item.id !== payload.id),
      });
    }
    case 'convertToReal': {
      const source = data.simulationEvents.find((item) => item.id === payload.id);
      if (!source) fail(ErrorCode.SCHEMA_INVALID, { scope: 'cashflow', message: '找不到该模拟事件。' });
      const real = validateEvent({ ...source, isSimulation: false, id: payload.newId }, 'command.event');
      return validate({
        ...data,
        events: [...data.events, real],
        simulationEvents: data.simulationEvents.filter((item) => item.id !== payload.id),
      });
    }
    case 'setInitialBalance':
      return validate({ ...data, initialBalance: checkMoney(payload.initialBalance, 'command.initialBalance', { maxAbs: LIMITS.initialBalanceAbs }) });
    default:
      fail(ErrorCode.SCHEMA_INVALID, { scope: 'cashflow', message: `未知命令 ${type}。` });
      return null;
  }
}

/**
 * 范围查询：用显式传入的 anchor（基准日）展开，模拟事件单独返回，便于口径说明。
 * 不返回“已发生交易”的判断，应用只记录计划。
 */
export function getRangeSummary(data, range, { expand = expandEvents } = {}) {
  const anchor = range.anchor ?? range.start;
  if (!validDate(anchor) || !validDate(range.start) || !validDate(range.end)) fail(ErrorCode.DATE_INVALID, { scope: 'cashflow', message: '范围日期无效。' });
  if (range.start > range.end) fail(ErrorCode.RANGE_ORDER, { scope: 'cashflow', message: '结束日期不能早于开始日期。' });
  const real = expand(data.events, anchor, range.end).filter((event) => event.date >= range.start);
  const simulation = expand(data.simulationEvents, anchor, range.end).filter((event) => event.date >= range.start);
  const sum = (list, predicate) => list.filter(predicate).reduce((total, event) => total + event.amount, 0);
  return {
    start: range.start,
    end: range.end,
    anchor,
    income: sum(real, (event) => event.amount > 0),
    expense: Math.abs(sum(real, (event) => event.amount < 0)),
    simulationIncome: sum(simulation, (event) => event.amount > 0),
    simulationExpense: Math.abs(sum(simulation, (event) => event.amount < 0)),
    real,
    simulation,
    /** 余额是否可用由聚合层按基准与上限判断；这里不做零值填充。 */
    balanceAvailable: range.start >= anchor,
    rangeLimited: range.balanceLimited === true,
  };
}

export function categoryOptions(data) {
  const list = [...data.events, ...data.simulationEvents].map(eventCategoryLabel);
  return [...new Set(list)].sort();
}

export { EventType, RecurringType, DEFAULT_CATEGORIES, UNCATEGORIZED_LABEL, eventCategoryLabel };
export { LifeCalendarError, ErrorCode };
