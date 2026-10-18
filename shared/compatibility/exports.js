/**
 * 导出：完整备份、单模块兼容导出、损坏/未来版本的原始数据下载。
 *
 * 不变量：
 * - 单模块导出必须能被对应独立应用读取（调用模块 `writeLegacy`）。
 * - 导出说明必须写清包含与不包含的范围，以及“下载交给浏览器”的事实。
 * - 未来字段无法被旧格式表达时，声明有损并提示保留完整备份。
 */
import { ErrorCode, fail } from '../errors.js';
import { MODULE_IDS, MODULE_REGISTRY, SCHEMA_VERSION, validateEnvelope } from '../compatibility/envelope.js';
import { EXPORT_SCOPE_NOTES, MODULE_LABELS } from '../compatibility/legacy-formats.js';
import { localDate, nowIso } from '../date/index.js';

export { EXPORT_SCOPE_NOTES, MODULE_LABELS };

export const DOWNLOAD_NOTE = '“下载”由浏览器接管，本应用无法确认文件是否已保存到磁盘。';

/** 完整备份：包含所有模块（含隐藏模块）、专属总结与标签、应用设置。 */
export function exportUnifiedBackup(envelope, { now = new Date(), today = null } = {}) {
  const validated = validateEnvelope(envelope, { now, today });
  const payload = {
    ...validated,
    exportedAt: nowIso(now),
  };
  return {
    filename: `life-calendar-full-${localDate(now)}.json`,
    text: JSON.stringify(payload, null, 2),
    includes: '四个模块的全部数据（含已关闭模块）、当天总结与每日标签、应用设置、来源记录。',
    excludes: '不含浏览器缓存、不包含附件（第一版无附件功能）。',
    note: DOWNLOAD_NOTE,
    counts: describeCounts(validated),
  };
}

/** 单模块兼容导出：输出旧应用可读取的结构。 */
export function exportModuleLegacy(envelope, moduleId, { now = new Date(), today = null } = {}) {
  if (!MODULE_IDS.includes(moduleId)) fail(ErrorCode.ENUM_INVALID, { message: `未知模块 ${String(moduleId)}。` });
  const validated = validateEnvelope(envelope, { now, today });
  const legacy = MODULE_REGISTRY[moduleId].writeLegacy(validated.modules[moduleId].data, { now: today });
  const scope = EXPORT_SCOPE_NOTES[moduleId];
  const lossy = detectLossy(validated, moduleId);
  return {
    moduleId,
    filename: `${moduleId}-backup-${localDate(now)}.json`,
    text: JSON.stringify(legacy, null, 2),
    includes: scope.includes,
    excludes: scope.excludes,
    targetApp: scope.app,
    targetPath: scope.targetPath,
    lossy,
    note: `${DOWNLOAD_NOTE}${lossy ? ' 该导出无法在旧格式中完整表达全部字段，请同时保留完整备份。' : ''} 旧应用的导入行为不同：有的覆盖、有的合并，导出说明不承诺自动合并。`,
    counts: describeModuleCounts(moduleId, validated.modules[moduleId].data),
  };
}

/**
 * 判断单模块导出是否有损：模块数据里是否含旧格式无法表达的模块级包装版本。
 * 目前四个模块的内部字段都在旧格式可表达范围内，因此只在发现额外顶层字段时报告。
 */
function detectLossy(envelope, moduleId) {
  const allowed = {
    cashflow: ['schemaVersion', 'initialBalance', 'events', 'simulationEvents'],
    mood: ['version', 'entries', 'tags'],
    period: ['version', 'periods', 'daily'],
    zodiac: ['schemaVersion', 'sign', 'saved'],
  }[moduleId];
  const data = envelope.modules[moduleId].data;
  const extra = Object.keys(data).filter((key) => !allowed.includes(key));
  return extra.length
    ? { reason: `${MODULE_LABELS[moduleId]} 数据含旧格式无法表达的字段：${extra.join('、')}。`, fields: extra }
    : null;
}

/** 损坏或未来版本的原始数据下载：字节级保留原字符串。 */
export function exportRawStorage(reading, { now = new Date() } = {}) {
  if (!reading || typeof reading.raw !== 'string') {
    fail(ErrorCode.EXPORT_UNSUPPORTED, { message: '当前状态没有可下载的原始数据。' });
  }
  const kindLabel = reading.kind === 'unsupported' ? '未来版本' : '无法读取';
  return {
    filename: `life-calendar-raw-${reading.kind}-${localDate(now)}.json`,
    text: reading.raw,
    includes: `本机存储键 life-calendar:v1 的原始内容（${kindLabel}，未做任何修改）。`,
    excludes: '不做修复、不写入、不删除任何数据。',
    note: `${DOWNLOAD_NOTE} 恢复流程：先保存该文件，再确认清空本机数据，然后用兼容版本修复或重新导入。`,
  };
}

/** 供界面显示的计数摘要。 */
export function describeCounts(envelope) {
  return {
    mood: envelope.modules.mood.data.entries.length,
    cashflow: envelope.modules.cashflow.data.events.length + envelope.modules.cashflow.data.simulationEvents.length,
    period: envelope.modules.period.data.periods.length + envelope.modules.period.data.daily.length,
    zodiac: envelope.modules.zodiac.data.saved.length,
    summaries: envelope.life.summaries.length,
    tags: envelope.life.tags.length,
  };
}

export function describeModuleCounts(moduleId, data) {
  switch (moduleId) {
    case 'mood': return { entries: data.entries.length, tags: data.tags.length };
    case 'period': return { periods: data.periods.length, daily: data.daily.length };
    case 'zodiac': return { saved: data.saved.length };
    case 'cashflow': return { events: data.events.length, simulationEvents: data.simulationEvents.length };
    default: return {};
  }
}

export const UNIFIED_SCHEMA_VERSION = SCHEMA_VERSION;
