/** Versioned transport over the existing domain registry; no storage or network access. */
import { ErrorCode, fail } from '../errors.js';
import { MODULE_IDS, MODULE_REGISTRY, validateEnvelope } from './envelope.js';

export const PERSONAL_DATA_FORMAT = 'xibbofish.personal-data';
export const PERSONAL_DATA_VERSION = '1.0.0';
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function object(v, path, fields) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(ErrorCode.SCHEMA_INVALID, { path, message: `${path} 必须是对象。` });
  for (const k of Object.keys(v)) if (!fields.includes(k)) fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${k}`, message: `${path} 包含未知字段 ${k}。` });
}
function version(value, supported, path) {
  if (value === supported) return;
  let future = typeof value === 'number' && typeof supported === 'number' && Number.isFinite(value) && value > supported;
  if (typeof value === 'string' && typeof supported === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    const incoming = value.split('.').map(BigInt), current = supported.split('.').map(BigInt);
    const differing = incoming.findIndex((part, index) => part !== current[index]);
    future = differing >= 0 && incoming[differing] > current[differing];
  }
  fail(future ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION, { path, message: `${path} 不受支持，请保留原文件并使用对应版本。` });
}
function timestamp(value, path) {
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  const year = parts ? Number(parts[1]) : 0, month = parts ? Number(parts[2]) : 0, day = parts ? Number(parts[3]) : 0;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (!parts || month < 1 || month > 12 || day < 1 || day > days[month-1] || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59 || !Number.isFinite(Date.parse(value))) fail(ErrorCode.SCHEMA_INVALID, { path, message: `${path} 必须是有效且包含时区的 ISO 时间。` });
}
export function validatePersonalData(input, { today = null } = {}) {
  object(input, 'package', ['format', 'formatVersion', 'exportedAt', 'producer', 'modules', 'workspace']);
  if (input.format !== PERSONAL_DATA_FORMAT) fail(ErrorCode.UNKNOWN_FORMAT, { message: '不是标准个人数据包。' });
  version(input.formatVersion, PERSONAL_DATA_VERSION, 'formatVersion');
  timestamp(input.exportedAt, 'exportedAt');
  object(input.producer, 'producer', ['app', 'appVersion']);
  if (typeof input.producer.app !== 'string' || !input.producer.app.trim() || input.producer.app.length > 100 || (own(input.producer, 'appVersion') && (typeof input.producer.appVersion !== 'string' || input.producer.appVersion.length > 100))) fail(ErrorCode.SCHEMA_INVALID, { message: 'producer 应包含应用名称和可选的版本字符串。' });
  object(input.modules, 'modules', MODULE_IDS);
  const ids = Object.keys(input.modules);
  if (!ids.length) fail(ErrorCode.SCHEMA_INVALID, { message: '数据包必须至少包含一个模块。' });
  const modules = {};
  for (const id of ids) {
    const entry = input.modules[id];
    object(entry, `modules.${id}`, ['schemaVersion', 'data', 'dependencies']);
    version(entry.schemaVersion, 1, `modules.${id}.schemaVersion`);
    if (!Array.isArray(entry.dependencies) || entry.dependencies.length > MODULE_IDS.length - 1 || new Set(entry.dependencies).size !== entry.dependencies.length) fail(ErrorCode.SCHEMA_INVALID, { message: `${id} 的 dependencies 必须是无重复模块 ID 数组。` });
    for (const dependency of entry.dependencies) if (!MODULE_IDS.includes(dependency) || dependency === id || !ids.includes(dependency)) fail(ErrorCode.SCHEMA_INVALID, { path: `modules.${id}.dependencies`, message: `${id} 引用了缺失、未知或自身依赖 ${String(dependency)}。` });
    modules[id] = { schemaVersion: 1, data: MODULE_REGISTRY[id].validate(entry.data, { today }), dependencies: [...entry.dependencies] };
  }
  const result = { format: PERSONAL_DATA_FORMAT, formatVersion: PERSONAL_DATA_VERSION, exportedAt: input.exportedAt, producer: { ...input.producer }, modules };
  if (own(input, 'workspace')) {
    object(input.workspace, 'workspace', ['format', 'schemaVersion', 'revision', 'updatedAt', 'settings', 'life', 'provenance']);
    for (const field of ['format', 'schemaVersion', 'revision', 'updatedAt', 'settings', 'life', 'provenance']) {
      if (!own(input.workspace, field)) fail(ErrorCode.SCHEMA_INVALID, { path: `workspace.${field}`, message: `工作台备份缺少 ${field}，不能安全恢复。` });
    }
    timestamp(input.workspace.updatedAt, 'workspace.updatedAt');
    if (ids.length !== MODULE_IDS.length) fail(ErrorCode.SCHEMA_INVALID, { message: 'workspace 只能随四模块完整包导出和恢复，避免丢失工作台内容。' });
    const envelope = validateEnvelope({ ...input.workspace, modules: Object.fromEntries(ids.map(id => [id, { schemaVersion: 1, data: modules[id].data }])) }, { today });
    const { modules: ignored, ...workspace } = envelope;
    result.workspace = workspace;
  }
  return result;
}
function metadata({ now = new Date(), producer = { app: 'life-calendar' } } = {}) {
  return { format: PERSONAL_DATA_FORMAT, formatVersion: PERSONAL_DATA_VERSION, exportedAt: now instanceof Date ? now.toISOString() : now, producer };
}
export function exportModulePackage(moduleId, data, options = {}) {
  if (!MODULE_IDS.includes(moduleId)) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${String(moduleId)}。` });
  return validatePersonalData({ ...metadata(options), modules: { [moduleId]: { schemaVersion: 1, data, dependencies: [] } } }, options);
}
export function exportPersonalData(envelope, options = {}) {
  const valid = validateEnvelope(envelope, options);
  const ids = options.moduleIds ?? MODULE_IDS;
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !MODULE_IDS.includes(id))) fail(ErrorCode.ENUM_INVALID, { message: '导出模块列表无效。' });
  const result = { ...metadata(options), modules: Object.fromEntries(ids.map(id => [id, { ...valid.modules[id], dependencies: [] }])) };
  if (options.includeWorkspace ?? ids.length === MODULE_IDS.length) {
    const { modules, ...workspace } = valid;
    result.workspace = workspace;
  }
  return validatePersonalData(result, options);
}
export function extractModulePackage(input, moduleId, options = {}) {
  const valid = validatePersonalData(input, options);
  if (!own(valid.modules, moduleId)) fail(ErrorCode.ENUM_INVALID, { message: `数据包未包含模块 ${String(moduleId)}。` });
  // A dependency cannot silently disappear while extracting a legal single package.
  return validatePersonalData({ ...metadata({ now: valid.exportedAt, producer: valid.producer, ...options }), modules: { [moduleId]: valid.modules[moduleId] } }, options);
}
export function combinePersonalData(packages, options = {}) {
  if (!Array.isArray(packages) || !packages.length) fail(ErrorCode.SCHEMA_INVALID, { message: '需要至少一个标准包。' });
  const modules = {};
  let workspace;
  for (const input of packages) {
    const valid = validatePersonalData(input, options);
    for (const [id, entry] of Object.entries(valid.modules)) {
      if (own(modules, id)) fail(ErrorCode.ID_DUPLICATE, { message: `模块 ${id} 重复，请先显式选择一个来源。` });
      modules[id] = entry;
    }
    if (valid.workspace) {
      if (workspace) fail(ErrorCode.ID_DUPLICATE, { message: '存在多个工作台来源。' });
      workspace = valid.workspace;
    }
  }
  return validatePersonalData({ ...metadata(options), modules, ...(workspace ? { workspace } : {}) }, options);
}
export function personalDataToLegacy(input, moduleId, options = {}) {
  const single = extractModulePackage(input, moduleId, options);
  return MODULE_REGISTRY[moduleId].writeLegacy(single.modules[moduleId].data, options);
}
const DICTIONARY = {
  cashflow: 'initialBalance 初始余额；events 真实计划源；simulationEvents 模拟计划源；amount 金额（沿用原币种单位与浮点存储，不转分）；type 收入/支出；date 日期；recurringType 周期；occurrenceCount 次数；skippedDates 跳过日期；isSimulation 模拟标记；category 分类；description 备注。',
  mood: 'entries 日记；id 稳定编号；localDate 本地日期；time 本地时间；mood 心情分；tagIds 标签引用；content 正文；tags 自定义标签；createdAt/updatedAt 时间戳。',
  period: 'periods 经期区间；startDate/endDate 起止日期，null 表示未结束；daily 每日记录；flow 经量；symptoms 身体感受；note 备注。',
  zodiac: 'sign 星座偏好；saved 收藏；date 本地日期；snapshot 原始内容快照；note 感想；id 稳定编号。',
};
export function exportAgentMarkdown(input, { redact = false, ...options } = {}) {
  const valid = validatePersonalData(input, options);
  const redacted = (value, key = '') => {
    if (Array.isArray(value)) return value.map(item => redacted(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redacted(v, k)]));
    return redact && typeof value === 'string' && ['content', 'description', 'note', 'name', 'title', 'text', 'message', 'reflection'].includes(key) ? '[已脱敏]' : value;
  };
  const data = redacted(valid);
  return [
    '# Xibbofish Agent 数据导出',
    `生成时间：${valid.exportedAt}；来源：${valid.producer.app}；协议：${valid.formatVersion}。`,
    '隐私提示：包含个人数据，仅在本机生成；导出本身不会上传记录。日期 YYYY-MM-DD 按设备本地日历解释，ISO 时间戳为绝对时间；未记录原设备时区，不能推断历史时区。币种未在原模型声明，不应擅自推断。',
    redact ? '**已脱敏：文本字段已替换；日期、金额、编号等仍可能敏感。本文件不是完整备份，不能用于无损恢复。**' : '**完整结构化原始数据位于下方；Markdown 供阅读分析，恢复请使用配套标准 JSON 包。**',
    '## 数据字段词典',
    'modules[id].schemaVersion 模块版本；data 原领域结构；dependencies 必须同包存在的模块 ID；workspace 为生活日历的设置、总结、标签与来源记录（单模块包不含）。',
    ...Object.keys(valid.modules).map(id => `- ${id}：${DICTIONARY[id]}`),
    '## 数据模型与关联关系',
    'ID 是稳定身份，不按数组序号关联；标签引用按 tagIds；工作台总结与心情正文独立。包中周期事件为源记录，展开的每日发生项不是额外交易。单包提取不包含 workspace。',
    '## 计算逻辑与统计口径',
    '现金流：余额 = 初始余额 + 收入发生额 - 支出发生额；真实与模拟情景分开，模拟开启时才叠加。周期按原引擎日历规则展开，保留起止、永久、次数和跳过日期；月末和闰年行为沿用原引擎。金额保留原浮点语义。心情统计由原始分数派生；身体模块仅记录历史经期与感受，不提供预测或医疗结论；星笺为文化娱乐内容。导出不改写日期、计划或计算派生结果。',
    '## 原始结构化记录',
    '```json', JSON.stringify(data, null, 2), '```',
    '## 已知限制与解释注意事项',
    '上述为原始记录，未混入计算结果。workspace 缺失意味着单模块范围，不表示工作台被清空。浏览器清理会导致本机记录丢失；请另存可恢复 JSON。脱敏只覆盖文本内容字段，不保证匿名。',
  ].join('\n\n');
}
