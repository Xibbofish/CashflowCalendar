/**
 * 统一 envelope：组装、严格校验、设置与专属内容命令。
 *
 * 不变量（docs/TECHNICAL.md §3）：
 * - 单键 `life-calendar:v1`，一次序列化提交。
 * - 未知字段拒绝；未来版本拒绝写入。
 * - 模块 data 保留原生语义，模块版本与原备份版本分别管理。
 * - `summary.date` 唯一；`life` 标签与心情标签相互独立。
 */
import { ErrorCode, fail, LifeCalendarError } from '../errors.js';
import { isValidSign, signs } from '../modules/zodiac/model.js';
import * as cashflow from '../modules/cashflow/model.js';
import * as mood from '../modules/mood/model.js';
import * as period from '../modules/period/model.js';
import * as zodiac from '../modules/zodiac/model.js';
import { validDate, nowIso } from '../date/index.js';

export const STORAGE_KEY = 'life-calendar:v1';
export const FORMAT = 'life-calendar';
export const SCHEMA_VERSION = 1;
export const MODULE_IDS = ['cashflow', 'mood', 'period', 'zodiac'];
export const DEFAULT_MODULE_ORDER = ['mood', 'cashflow', 'period', 'zodiac'];
export const LIMITS = {
  summaries: 20000,
  summaryContent: 5000,
  tagName: 24,
  lifeTags: 200,
  provenance: 50,
  provenanceBatches: 1000,
};

export const ENVELOPE_FIELDS = ['format', 'schemaVersion', 'revision', 'updatedAt', 'settings', 'life', 'modules', 'provenance'];
/** 导出文件才有的外层字段：只允许这一个，且必须是 ISO 时间；读取时按存储 envelope 剥离。 */
export const EXPORT_ONLY_FIELDS = ['exportedAt'];
export const SETTINGS_FIELDS = ['enabledModules', 'moduleOrder', 'defaultSign', 'calendarIncludeSimulation'];
export const LIFE_FIELDS = ['schemaVersion', 'summaries', 'tags'];
export const SUMMARY_FIELDS = ['id', 'date', 'content', 'tagIds', 'createdAt', 'updatedAt'];
export const LIFE_TAG_FIELDS = ['id', 'name'];
export const PROVENANCE_FIELDS = ['at', 'source', 'format', 'module', 'added', 'identical', 'conflicts', 'batches', 'note'];

/** 模块注册表：统一各模块的校验/空数据/旧格式读写入口。
 *
 * 选项统一为 `{ today, now }`：
 * - `today` 是本地日期字符串（`YYYY-MM-DD`），用于“今天或过去”这类校验；
 * - `now` 是 ISO 时间串，用于写入时间戳。核心不读时钟，全部由调用方显式给出。
 * 月经模块沿用旧的 `(data, nowString)` 签名，在这里转换。
 */
export const MODULE_REGISTRY = {
  cashflow: {
    id: 'cashflow',
    label: '收支',
    wrapped: true,
    emptyData: cashflow.emptyData,
    validate: (data) => cashflow.validate(data),
    readLegacy: (raw) => cashflow.readLegacy(raw),
    writeLegacy: (data) => cashflow.writeLegacy(data),
    applyCommand: (data, command) => cashflow.applyCommand(data, command),
  },
  mood: {
    id: 'mood',
    label: '心情与日记',
    wrapped: false,
    emptyData: mood.emptyData,
    validate: (data) => mood.validate(data),
    readLegacy: (raw) => mood.readLegacy(raw),
    writeLegacy: (data) => mood.writeLegacy(data),
    applyCommand: (data, command, options = {}) => mood.applyCommand(data, command, {
      now: typeof options.now === 'string' ? options.now : null,
      createId: options.createId ?? null,
    }),
  },
  period: {
    id: 'period',
    label: '身体与月经',
    wrapped: false,
    emptyData: period.emptyData,
    // 月经模块沿用旧签名 `(data, nowString)`；注册表统一成 `(data, { today })`，
    // 在这里转换，避免把 options 对象当成日期字符串比较（那样未来日期会静默通过）。
    validate: (data, options = {}) => period.validate(data, options.today ?? null),
    readLegacy: (raw, options = {}) => period.readLegacy(raw, options.today ?? null),
    writeLegacy: (data, options = {}) => period.writeLegacy(data, options.today ?? null),
    applyCommand: (data, command, options = {}) => period.applyCommand(data, command, { today: options.today ?? null, now: timeOf(options) }),
  },
  zodiac: {
    id: 'zodiac',
    label: '当日星笺',
    wrapped: true,
    emptyData: zodiac.emptyData,
    validate: (data) => zodiac.validate(data),
    readLegacy: (raw) => zodiac.readLegacy(raw),
    writeLegacy: (data) => zodiac.writeLegacy(data),
    applyCommand: (data, command, options = {}) => zodiac.applyCommand(data, command, { now: options.now ?? null }),
  },
};

/** 月经模块的时间戳：`now` 允许 Date 或 ISO 串，统一成 ISO 串。 */
function timeOf(options = {}) {
  const value = options.now;
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return typeof value === 'string' ? value : null;
}

export function defaultSettings() {
  return {
    enabledModules: { cashflow: true, mood: true, period: true, zodiac: true },
    moduleOrder: [...DEFAULT_MODULE_ORDER],
    defaultSign: 'aries',
    calendarIncludeSimulation: false,
  };
}

/** 空 envelope。模块 data 使用各模块的 emptyData。 */
export function createEmptyEnvelope({ now = new Date() } = {}) {
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: nowIso(now),
    settings: defaultSettings(),
    life: { schemaVersion: 1, summaries: [], tags: [] },
    modules: Object.fromEntries(MODULE_IDS.map((id) => [id, { schemaVersion: 1, data: MODULE_REGISTRY[id].emptyData() }])),
    provenance: [],
  };
}

/** 用给定模块数据组装 envelope（导入合并后使用）。 */
export function buildEnvelope({ modules, settings = null, life = null, provenance = [], revision = 0, now = new Date(), today = null }) {
  const envelope = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    revision,
    updatedAt: nowIso(now),
    settings: settings ? { ...defaultSettings(), ...settings } : defaultSettings(),
    life: life ?? { schemaVersion: 1, summaries: [], tags: [] },
    modules: Object.fromEntries(MODULE_IDS.map((id) => [id, { schemaVersion: 1, data: modules[id] ?? MODULE_REGISTRY[id].emptyData() }])),
    provenance: provenance.slice(-LIMITS.provenance),
  };
  return validateEnvelope(envelope, { now, today });
}

function checkObject(value, path, scope = 'unified') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(ErrorCode.SCHEMA_INVALID, { path, scope, message: `${path} 必须是对象。` });
  }
}

function checkUnknownFields(value, allowed, path, scope = 'unified') {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${key}`, scope, message: `${path} 包含不认识的字段：${key}` });
  }
}

function checkString(value, max, path, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path, message: `${path} 必须是字符串。` });
  if (!allowEmpty && !value.trim()) fail(ErrorCode.SCHEMA_INVALID, { path, message: `${path} 不能为空。` });
  if (value.length > max) fail(ErrorCode.TEXT_TOO_LONG, { path, message: `${path} 超过 ${max} 个字符。` });
  return value;
}

export function validateSettings(input, path = 'settings') {
  checkObject(input, path);
  checkUnknownFields(input, SETTINGS_FIELDS, path);
  const enabledModules = {};
  checkObject(input.enabledModules, `${path}.enabledModules`);
  checkUnknownFields(input.enabledModules, MODULE_IDS, `${path}.enabledModules`);
  for (const id of MODULE_IDS) {
    const value = input.enabledModules[id];
    if (typeof value !== 'boolean') fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.enabledModules.${id}`, message: '模块开关必须是布尔值。' });
    enabledModules[id] = value;
  }
  if (!Array.isArray(input.moduleOrder)) fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.moduleOrder`, message: '模块顺序必须是数组。' });
  const seen = new Set();
  for (const id of input.moduleOrder) {
    if (!MODULE_IDS.includes(id)) fail(ErrorCode.ENUM_INVALID, { path: `${path}.moduleOrder`, message: `模块顺序包含未知模块 ${String(id)}。` });
    if (seen.has(id)) fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.moduleOrder`, message: `模块顺序重复：${id}。` });
    seen.add(id);
  }
  if (seen.size !== MODULE_IDS.length) fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.moduleOrder`, message: '模块顺序必须恰好包含四个模块。' });
  if (!isValidSign(input.defaultSign)) fail(ErrorCode.ENUM_INVALID, { path: `${path}.defaultSign`, message: '默认星座无效。' });
  if (typeof input.calendarIncludeSimulation !== 'boolean') fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.calendarIncludeSimulation`, message: '模拟显示开关必须是布尔值。' });
  return { enabledModules, moduleOrder: [...input.moduleOrder], defaultSign: input.defaultSign, calendarIncludeSimulation: input.calendarIncludeSimulation };
}

export function validateLife(input, path = 'life', { today = null } = {}) {
  checkObject(input, path);
  checkUnknownFields(input, LIFE_FIELDS, path);
  if (input.schemaVersion !== 1) {
    const code = typeof input.schemaVersion === 'number' && input.schemaVersion > 1 ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: `${path}.schemaVersion`, message: `生活总结数据版本 ${input.schemaVersion} 不受支持。` });
  }
  if (!Array.isArray(input.summaries) || !Array.isArray(input.tags)) {
    fail(ErrorCode.SCHEMA_INVALID, { path, message: '总结与标签必须是数组。' });
  }
  if (input.summaries.length > LIMITS.summaries || input.tags.length > LIMITS.lifeTags) {
    fail(ErrorCode.LIMIT_EXCEEDED, { path, message: '总结或标签数量超过支持范围。' });
  }
  const tagIds = new Set();
  const tags = input.tags.map((raw, index) => {
    const tagPath = `${path}.tags[${index}]`;
    checkObject(raw, tagPath);
    checkUnknownFields(raw, LIFE_TAG_FIELDS, tagPath);
    if (typeof raw.id !== 'string' || !raw.id) fail(ErrorCode.ID_INVALID, { path: `${tagPath}.id`, message: '总结标签编号无效。' });
    if (tagIds.has(raw.id)) fail(ErrorCode.ID_DUPLICATE, { path: `${tagPath}.id`, message: '总结标签编号重复。' });
    tagIds.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > LIMITS.tagName) {
      fail(ErrorCode.TEXT_TOO_LONG, { path: `${tagPath}.name`, message: `总结标签名必须是 1—${LIMITS.tagName} 个字符。` });
    }
    return { id: raw.id, name: raw.name.trim() };
  });
  const dates = new Set();
  const summaryIds = new Set();
  const summaries = input.summaries.map((raw, index) => {
    const summaryPath = `${path}.summaries[${index}]`;
    checkObject(raw, summaryPath);
    checkUnknownFields(raw, SUMMARY_FIELDS, summaryPath);
    if (typeof raw.id !== 'string' || !raw.id) fail(ErrorCode.ID_INVALID, { path: `${summaryPath}.id`, message: '总结编号无效。' });
    if (summaryIds.has(raw.id)) fail(ErrorCode.ID_DUPLICATE, { path: `${summaryPath}.id`, message: '总结编号重复。' });
    summaryIds.add(raw.id);
    if (!validDate(raw.date)) fail(ErrorCode.DATE_INVALID, { path: `${summaryPath}.date`, message: '总结日期无效。' });
    if (today && raw.date > today) fail(ErrorCode.DATE_IN_FUTURE, { path: `${summaryPath}.date`, message: '当天总结只能记录今天或过去的日期，不能写未来的总结。' });
    if (dates.has(raw.date)) fail(ErrorCode.DAY_DUPLICATE, { path: `${summaryPath}.date`, message: `同一天只能有一份总结：${raw.date}。` });
    dates.add(raw.date);
    if (typeof raw.content !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path: `${summaryPath}.content`, message: '总结正文必须是字符串。' });
    if (raw.content.length > LIMITS.summaryContent) {
      fail(ErrorCode.TEXT_TOO_LONG, { path: `${summaryPath}.content`, message: `总结最多 ${LIMITS.summaryContent} 字。` });
    }
    if (!Array.isArray(raw.tagIds) || raw.tagIds.some((id) => !tagIds.has(id))) {
      fail(ErrorCode.TAG_MISSING, { path: `${summaryPath}.tagIds`, message: '总结引用了不存在的标签。' });
    }
    for (const key of ['createdAt', 'updatedAt']) {
      if (typeof raw[key] !== 'string' || !Number.isFinite(Date.parse(raw[key]))) {
        fail(ErrorCode.SCHEMA_INVALID, { path: `${summaryPath}.${key}`, message: '总结时间格式不正确。' });
      }
    }
    return {
      id: raw.id, date: raw.date, content: raw.content, tagIds: [...new Set(raw.tagIds)], createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { schemaVersion: 1, summaries, tags };
}

function validateProvenance(input, path = 'provenance') {
  if (!Array.isArray(input)) fail(ErrorCode.SCHEMA_INVALID, { path, message: '来源记录必须是数组。' });
  if (input.length > LIMITS.provenance) fail(ErrorCode.LIMIT_EXCEEDED, { path, message: `来源记录最多 ${LIMITS.provenance} 条。` });
  return input.map((raw, index) => {
    const itemPath = `${path}[${index}]`;
    checkObject(raw, itemPath);
    checkUnknownFields(raw, PROVENANCE_FIELDS, itemPath);
    if (typeof raw.at !== 'string' || !Number.isFinite(Date.parse(raw.at))) fail(ErrorCode.SCHEMA_INVALID, { path: `${itemPath}.at`, message: '来源时间无效。' });
    if (!['legacy-key', 'file', 'unified-backup', 'initial'].includes(raw.source)) fail(ErrorCode.ENUM_INVALID, { path: `${itemPath}.source`, message: '来源类型无效。' });
    if (raw.format !== null && raw.format !== undefined && typeof raw.format !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path: `${itemPath}.format`, message: '来源格式无效。' });
    if (raw.module !== null && raw.module !== undefined && !MODULE_IDS.includes(raw.module)) fail(ErrorCode.ENUM_INVALID, { path: `${itemPath}.module`, message: '来源模块无效。' });
    for (const key of ['added', 'identical', 'conflicts', 'batches']) {
      if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) fail(ErrorCode.SCHEMA_INVALID, { path: `${itemPath}.${key}`, message: '来源计数必须是非负整数。' });
    }
    if (raw.batches > LIMITS.provenanceBatches) fail(ErrorCode.LIMIT_EXCEEDED, { path: `${itemPath}.batches`, message: '来源批次过多。' });
    if (raw.note !== null && raw.note !== undefined && (typeof raw.note !== 'string' || raw.note.length > 200)) {
      fail(ErrorCode.TEXT_TOO_LONG, { path: `${itemPath}.note`, message: '来源说明过长。' });
    }
    return {
      at: raw.at,
      source: raw.source,
      format: raw.format ?? null,
      module: raw.module ?? null,
      added: raw.added,
      identical: raw.identical,
      conflicts: raw.conflicts,
      batches: raw.batches,
      ...(raw.note ? { note: raw.note } : {}),
    };
  });
}

/**
 * 严格校验 envelope。未知字段与未来版本拒绝；模块数据调用各自模块的严格校验。
 *
 * `today` 是本地日期字符串（`YYYY-MM-DD`），传给需要“今天或过去”约束的模块
 * （月经）。不传时跳过该约束；调用方应尽量显式传入，避免校验依赖运行环境的时钟。
 */
export function validateEnvelope(input, { now = new Date(), today = null, allowExportedAt = true } = {}) {
  checkObject(input, FORMAT);
  // 备份文件允许一个受控的外层字段 `exportedAt`（ISO 时间），其它未知字段一律拒绝；
  // 返回值里不带它，落盘用的 envelope 与导出文件因此可以安全地互相转换。
  checkUnknownFields(input, allowExportedAt ? [...ENVELOPE_FIELDS, ...EXPORT_ONLY_FIELDS] : ENVELOPE_FIELDS, FORMAT);
  if (Object.prototype.hasOwnProperty.call(input, 'exportedAt')) {
    if (!allowExportedAt) fail(ErrorCode.UNKNOWN_FIELD, { path: 'exportedAt', message: '存储中的 envelope 不允许 exportedAt 字段。' });
    if (typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt))) {
      fail(ErrorCode.SCHEMA_INVALID, { path: 'exportedAt', message: '导出时间必须是以 ISO 格式写出的时间。' });
    }
  }
  if (input.format !== FORMAT) fail(ErrorCode.UNKNOWN_FORMAT, { path: 'format', message: `不是生活日历备份（format=${String(input.format)}）。` });
  if (input.schemaVersion !== SCHEMA_VERSION) {
    const code = typeof input.schemaVersion === 'number' && input.schemaVersion > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: 'schemaVersion', message: `统一备份版本 ${String(input.schemaVersion)} 不受支持，当前版本为 ${SCHEMA_VERSION}。` });
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(ErrorCode.SCHEMA_INVALID, { path: 'revision', message: '修订号必须是非负整数。' });
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) fail(ErrorCode.SCHEMA_INVALID, { path: 'updatedAt', message: '更新时间格式不正确。' });
  const settings = validateSettings(input.settings);
  const life = validateLife(input.life, 'life', { today });
  checkObject(input.modules, 'modules');
  checkUnknownFields(input.modules, MODULE_IDS, 'modules');
  const modules = {};
  for (const id of MODULE_IDS) {
    const entry = input.modules[id];
    checkObject(entry, `modules.${id}`, id);
    checkUnknownFields(entry, ['schemaVersion', 'data'], `modules.${id}`, id);
    if (entry.schemaVersion !== 1) {
      const code = typeof entry.schemaVersion === 'number' && entry.schemaVersion > 1 ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
      fail(code, { path: `modules.${id}.schemaVersion`, scope: id, message: `${MODULE_REGISTRY[id].label} 模块数据版本 ${String(entry.schemaVersion)} 不受支持。` });
    }
    modules[id] = { schemaVersion: 1, data: MODULE_REGISTRY[id].validate(entry.data, { today }) };
  }
  const provenance = validateProvenance(input.provenance ?? []);
  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    revision: input.revision,
    updatedAt: input.updatedAt,
    settings,
    life,
    modules,
    provenance,
  };
}

/** 深拷贝（结构化克隆回退到 JSON），用于纯函数命令前的隔离。 */
export function cloneEnvelope(input) {
  return typeof structuredClone === 'function' ? structuredClone(input) : JSON.parse(JSON.stringify(input));
}

/** 重算并返回新的 envelope（修订号 +1，更新时间刷新）。 */
export function withRevision(input, { now = new Date(), bump = 1 } = {}) {
  return validateEnvelope({ ...input, revision: input.revision + bump, updatedAt: nowIso(now) }, { now });
}

/** 设置命令：关闭模块只改开关，数据保留。 */
export function applySettingsCommand(input, command) {
  const { type, payload = {} } = command;
  switch (type) {
    case 'setEnabledModule': {
      if (!MODULE_IDS.includes(payload.module)) fail(ErrorCode.ENUM_INVALID, { path: 'settings.enabledModules', message: `未知模块 ${String(payload.module)}。` });
      return { ...input, settings: { ...input.settings, enabledModules: { ...input.settings.enabledModules, [payload.module]: Boolean(payload.enabled) } } };
    }
    case 'setModuleOrder': {
      const order = payload.order;
      if (!Array.isArray(order) || order.length !== MODULE_IDS.length) fail(ErrorCode.SCHEMA_INVALID, { path: 'settings.moduleOrder', message: '模块顺序必须包含全部四个模块。' });
      return { ...input, settings: { ...input.settings, moduleOrder: validateSettings({ ...input.settings, moduleOrder: order }).moduleOrder } };
    }
    case 'setSetting': {
      const { key, value } = payload;
      if (!SETTINGS_FIELDS.includes(key)) fail(ErrorCode.ENUM_INVALID, { path: 'settings', message: `未知设置项 ${String(key)}。` });
      return { ...input, settings: validateSettings({ ...input.settings, [key]: value }) };
    }
    default:
      fail(ErrorCode.SCHEMA_INVALID, { message: `未知设置命令 ${type}。` });
      return null;
  }
}

/** 当天总结命令：每天一份，只能记录过去或今天。 */
export function applyLifeCommand(input, command, { now = new Date(), createId = () => `sum-${Date.now()}` } = {}) {
  const { type, payload = {} } = command;
  const today = payload.today ?? null;
  switch (type) {
    case 'saveSummary': {
      const date = payload.date;
      if (!validDate(date)) fail(ErrorCode.DATE_INVALID, { path: 'life.summaries', message: '总结日期无效。' });
      if (today && date > today) fail(ErrorCode.DATE_IN_FUTURE, { path: 'life.summaries', message: '当天总结只能记录今天或过去的日期。' });
      const content = String(payload.content ?? '');
      if (content.length > LIMITS.summaryContent) fail(ErrorCode.TEXT_TOO_LONG, { path: 'life.summaries', message: `总结最多 ${LIMITS.summaryContent} 字。` });
      const existing = input.life.summaries.find((summary) => summary.date === date);
      const stamp = nowIso(now);
      const summary = {
        id: existing?.id ?? payload.id ?? createId(),
        date,
        content,
        tagIds: [...new Set(payload.tagIds ?? existing?.tagIds ?? [])],
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      const life = validateLife({
        ...input.life,
        summaries: [...input.life.summaries.filter((item) => item.date !== date), summary],
      });
      return { ...input, life };
    }
    case 'deleteSummary': {
      const life = validateLife({ ...input.life, summaries: input.life.summaries.filter((item) => item.date !== payload.date) });
      return { ...input, life };
    }
    case 'upsertSummaryTag': {
      const name = String(payload.name ?? '').trim();
      if (!name || name.length > LIMITS.tagName) fail(ErrorCode.TEXT_TOO_LONG, { path: 'life.tags', message: `总结标签名必须是 1—${LIMITS.tagName} 个字符。` });
      const existing = input.life.tags.find((tag) => tag.name === name);
      if (existing) return input;
      const life = validateLife({ ...input.life, tags: [...input.life.tags, { id: payload.id ?? createId(), name }] });
      return { ...input, life };
    }
    case 'deleteSummaryTag': {
      const life = validateLife({
        ...input.life,
        tags: input.life.tags.filter((tag) => tag.id !== payload.id),
        summaries: input.life.summaries.map((summary) => ({ ...summary, tagIds: summary.tagIds.filter((id) => id !== payload.id) })),
      });
      return { ...input, life };
    }
    default:
      fail(ErrorCode.SCHEMA_INVALID, { message: `未知生活内容命令 ${type}。` });
      return null;
  }
}

/** 模块命令：定位模块数据、执行、回写。 */
export function applyModuleCommand(input, moduleId, command, options = {}) {
  if (!MODULE_IDS.includes(moduleId)) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${String(moduleId)}。` });
  const registry = MODULE_REGISTRY[moduleId];
  const nextData = registry.applyCommand(input.modules[moduleId].data, command, options);
  return { ...input, modules: { ...input.modules, [moduleId]: { schemaVersion: 1, data: nextData } } };
}

/** 隐藏模块的数据仍进入完整备份；此函数返回所有模块（含关闭的）。 */
export function allModulesForBackup(input) {
  return MODULE_IDS.map((id) => ({ id, enabled: input.settings.enabledModules[id], data: input.modules[id].data }));
}

export function moduleLabel(id) {
  return MODULE_REGISTRY[id]?.label ?? id;
}

export { LifeCalendarError, ErrorCode, signs };
