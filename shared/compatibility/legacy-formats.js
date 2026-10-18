import { validatePersonalData } from './personal-data.js';
/**
 * 旧格式读取：四种旧备份与统一备份 → 统一模块数据。
 *
 * 规则：
 * - 旧格式读取也执行严格校验：未知字段、缺失版本、未来版本一律拒绝。
 * - 旧格式的顶层字段与模块内部数据一一对应（见 docs/COMPATIBILITY.md 兼容矩阵）。
 * - 不做“补齐默认值”的猜测；缺字段就报错，让用户修正备份。
 */
import { ErrorCode, fail } from '../errors.js';
import { MODULE_LABELS } from './detect.js';
import {
  MODULE_IDS,
  MODULE_REGISTRY,
  createEmptyEnvelope,
  validateEnvelope,
} from './envelope.js';
import * as cashflow from '../modules/cashflow/model.js';
import * as mood from '../modules/mood/model.js';
import * as period from '../modules/period/model.js';
import * as zodiac from '../modules/zodiac/model.js';
import { toLocalDateString } from '../date/index.js';

export { MODULE_IDS, MODULE_LABELS };

/**
 * “已规范化”的内部标记。
 *
 * 用 Symbol 而不是 `__normalized: true` 之类的普通字段：
 * 普通字段可以被用户文件里的同名字段伪造，从而绕过未知字段与版本校验。
 * Symbol 不参与 JSON 序列化，也无法由外部 JSON 构造出来。
 */
export const NORMALIZED = Symbol('life-calendar.normalized');

/** 判断一个值是否来自本模块的 `normalizeIncoming`。 */
export function isNormalized(value) {
  return Boolean(value) && typeof value === 'object' && value[NORMALIZED] === true;
}

/**
 * 把任意受支持的输入规范化成统一模块数据。
 *
 * `now` 可以是 Date 或本地日期字符串；模块内部一律使用本地日期字符串比较，
 * Date 必须在这里转成本地 `YYYY-MM-DD`，否则“今天或过去”的校验会静默失效。
 *
 * 返回 `{ format, moduleId?, modules, settings?, life?, provenance? }`。
 */
export function normalizeIncoming(input, { format, now = null, today = null } = {}) {
  if (!format) fail(ErrorCode.UNKNOWN_FORMAT, { message: '缺少来源格式，无法规范化。' });
  const todayDate = today ?? toLocalDateString(now) ?? toLocalDateString(new Date());
  const nowDate = now instanceof Date ? now : new Date();
  switch (format) {
    case 'personal-data': {
      const packet = validatePersonalData(input, { today: todayDate });
      const ids = Object.keys(packet.modules);
      return {
        [NORMALIZED]: true, format, sourceFormatVersion: packet.formatVersion,
        moduleId: ids.length === 1 ? ids[0] : null, moduleIds: ids,
        modules: Object.fromEntries(ids.map(id => [id, packet.modules[id].data])),
        dependencies: Object.fromEntries(ids.map(id => [id, packet.modules[id].dependencies])),
        ...(packet.workspace ? { settings: packet.workspace.settings, life: packet.workspace.life, provenance: packet.workspace.provenance } : {}),
      };
    }
    case 'unified': {
      // `today` 必须显式传给模块校验：月经的“今天或过去”约束只认本地日期字符串
      const envelope = validateEnvelope(input, { now: nowDate, today: todayDate });
      return {
        [NORMALIZED]: true,
        format,
        moduleId: null,
        moduleIds: MODULE_IDS.slice(),
        modules: Object.fromEntries(MODULE_IDS.map((id) => [id, envelope.modules[id].data])),
        settings: envelope.settings,
        life: envelope.life,
        provenance: envelope.provenance,
      };
    }
    case 'cashflow':
    case 'mood':
    case 'period':
    case 'zodiac': {
      const moduleId = format;
      return {
        [NORMALIZED]: true,
        format,
        moduleId,
        moduleIds: [moduleId],
        modules: { [moduleId]: readModuleLegacy(moduleId, input, { today: todayDate, now: nowDate }) },
      };
    }
    default:
      fail(ErrorCode.UNKNOWN_FORMAT, { message: `不支持的来源格式：${format}。` });
      return null;
  }
}

/**
 * 单模块旧格式读取。
 * `today` 是本地日期字符串：月经只允许今天或过去的日期。
 */
export function readModuleLegacy(moduleId, raw, { today = null, now = null } = {}) {
  const registry = MODULE_REGISTRY[moduleId];
  if (!registry) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${String(moduleId)}。` });
  const effectiveToday = today ?? toLocalDateString(now) ?? toLocalDateString(new Date());
  return registry.readLegacy(raw, { today: effectiveToday });
}

/** 单模块兼容导出（旧应用可读取的结构）。 */
export function writeModuleLegacy(moduleId, data, { today = null, now = null } = {}) {
  const registry = MODULE_REGISTRY[moduleId];
  if (!registry) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${String(moduleId)}。` });
  const effectiveToday = today ?? toLocalDateString(now) ?? toLocalDateString(new Date());
  return registry.writeLegacy(data, { today: effectiveToday });
}

/**
 * 单模块导出的“包含/不包含”说明。
 * 第一版只提供全量模块导出，不做日期范围导出（会切断周期计划与初始余额的含义）。
 */
export const EXPORT_SCOPE_NOTES = {
  cashflow: {
    includes: '初始余额、全部真实计划事件、模拟事件、周期次数与永久周期、历史跳过日期、分类与备注。',
    excludes: '不含统一应用专属的当天总结、每日标签与其他模块数据。',
    app: '现金流日历',
    targetPath: '/cashflow/',
  },
  mood: {
    includes: '全部心情记录（日期、时间、心情分、标签、正文）与自定义标签。',
    excludes: '不含统一应用专属的当天总结、每日标签与其他模块数据。',
    app: '心情日记本',
    targetPath: '/mood-journal/',
  },
  period: {
    includes: '全部经期区间与每日记录（经量、身体感受、备注）。',
    excludes: '不含统一应用专属的当天总结与其他模块数据。',
    app: '月经记录本',
    targetPath: '/period-journal/',
  },
  zodiac: {
    includes: '星座偏好、收藏记录与原始内容快照、感想。',
    excludes: '不含统一应用专属的当天总结与其他模块数据；内容库版本可能与独立应用不同。',
    app: '每日星笺',
    targetPath: '/zodiac-journal/',
  },
};

/**
 * 同源旧键读取器。
 * 只读取、不写回、不删除旧数据；读取结果走与其他导入完全相同的管线。
 */
export const LEGACY_STORAGE_KEYS = [
  { key: 'liuyiye-journal-v1', moduleId: 'mood' },
  { key: 'period-journal:v1', moduleId: 'period' },
  { key: 'zodiac-journal:v1', moduleId: 'zodiac' },
  { key: 'cashflow-calendar-data', moduleId: 'cashflow' },
];

/**
 * 检测同源旧数据（只检测存在性与可解析性，不改动存储）。
 * 返回 `[{ key, moduleId, label, present, readable, code, message, bytes }]`。
 */
export function detectLegacySources(storage, { now = new Date() } = {}) {
  const results = [];
  for (const entry of LEGACY_STORAGE_KEYS) {
    const base = { ...entry, label: MODULE_LABELS[entry.moduleId] };
    let raw = null;
    try {
      raw = storage.getItem(entry.key);
    } catch {
      results.push({ ...base, present: false, readable: false, code: ErrorCode.STORAGE_UNAVAILABLE, message: '当前浏览器不允许读取本机存储。', bytes: 0 });
      continue;
    }
    if (raw === null || raw === undefined || raw === '') {
      results.push({ ...base, present: false, readable: false, code: null, message: null, bytes: 0 });
      continue;
    }
    try {
      const value = JSON.parse(raw);
      readModuleLegacy(entry.moduleId, value, { now });
      results.push({ ...base, present: true, readable: true, code: null, message: null, bytes: raw.length });
    } catch (error) {
      results.push({ ...base, present: true, readable: false, code: error?.code ?? ErrorCode.SCHEMA_INVALID, message: error?.message ?? '旧数据无法读取。', bytes: raw.length });
    }
  }
  return results;
}

/**
 * 读取某一个同源旧键并规范化。返回 `{ format, moduleId, modules }`，可直接进入导入管线。
 */
export function readLegacySource(storage, key, { now = new Date() } = {}) {
  const entry = LEGACY_STORAGE_KEYS.find((item) => item.key === key);
  if (!entry) fail(ErrorCode.UNKNOWN_FORMAT, { message: `不是已知的旧应用存储键：${key}。` });
  let raw;
  try {
    raw = storage.getItem(key);
  } catch {
    fail(ErrorCode.STORAGE_UNAVAILABLE, { message: '当前浏览器不允许读取本机存储。' });
  }
  if (raw === null || raw === undefined || raw === '') {
    fail(ErrorCode.FILE_EMPTY, { message: `${MODULE_LABELS[entry.moduleId]} 在本站没有可读取的旧数据。` });
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(ErrorCode.JSON_INVALID, { message: `${MODULE_LABELS[entry.moduleId]} 的旧数据无法解析，已保留原样。` });
  }
  const modules = { [entry.moduleId]: readModuleLegacy(entry.moduleId, value, { now }) };
  return { format: entry.moduleId, moduleId: entry.moduleId, modules, sourceKey: key };
}

/** 空 envelope 中某模块的空数据（导入“跳过”该模块时使用）。 */
export function emptyModuleData(moduleId) {
  return MODULE_REGISTRY[moduleId].emptyData();
}

export function emptyEnvelope(options) {
  return createEmptyEnvelope(options);
}
