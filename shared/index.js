/**
 * 公共核心入口（桶文件）：只做转发，不含任何实现。
 *
 * 约定（docs/CONTRACT.md §0）：
 * - 模块命名空间以 `*Module` 导出，避免四个模块同名的 `validate` / `getDay` / `applyCommand` 互相覆盖；
 * - 应用门面（store / view-model / import-flow）在这里只做转发，具体见 `shared/app/`；
 * - 原生应用与统一应用都通过本文件或具体子路径引用同一份实现，不存在第二份手工维护的副本。
 */
export { CALENDAR_MAX_YEAR, CALENDAR_MIN_YEAR, MAX_YEAR, MIN_YEAR, ZODIAC_MAX_YEAR, ZODIAC_MIN_YEAR } from './date/index.js';
export * as date from './date/index.js';
export { ERROR_MESSAGES, ErrorCode, LifeCalendarError, describeError, fail, isErrorCode } from './errors.js';

export * as cashflowModule from './modules/cashflow/model.js';
export * as cashflowEngine from './modules/cashflow/engine.js';
export * as cashflowAnalysis from './modules/cashflow/analysis.js';
export * as moodModule from './modules/mood/model.js';
export * as periodModule from './modules/period/model.js';
export * as zodiacModule from './modules/zodiac/model.js';

export {
  DEFAULT_MODULE_ORDER,
  MODULE_IDS,
  MODULE_REGISTRY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  buildEnvelope,
  createEmptyEnvelope,
  defaultSettings,
  moduleLabel,
  validateEnvelope,
  validateLife,
  validateSettings,
} from './compatibility/envelope.js';
export { detectFormat, matchFormats, readIncomingJson, checkParsedLimits, DEFAULT_SIZE_LIMITS, FORMAT_LABELS } from './compatibility/detect.js';
export {
  EXPORT_SCOPE_NOTES,
  LEGACY_STORAGE_KEYS,
  MODULE_LABELS,
  detectLegacySources,
  normalizeIncoming,
  readLegacySource,
  readModuleLegacy,
  writeModuleLegacy,
} from './compatibility/legacy-formats.js';
export { CONFLICT_OPTIONS, DECISIONS, applyImport, describeImportPlan, planImport, revalidateImport } from './compatibility/import-plan.js';
export { exportModuleLegacy, exportRawStorage, exportUnifiedBackup, DOWNLOAD_NOTE } from './compatibility/exports.js';
export { READ_KINDS, createStorageManager, probeStorage, readStorage, serializeEnvelope } from './storage/local.js';

export { createAppStore, readOnlyState, STORE_STATUS } from './app/store.js';
export {
  ANCHOR_DAYS,
  BALANCE_REASONS,
  CASHFLOW_SCOPE_NOTE,
  MAX_RANGE_DAYS,
  abbreviateAmount,
  anchorFor,
  balanceAvailability,
  balanceWindow,
  buildCalendarMonth,
  buildDayView,
  buildMoodTrend,
  buildRangeReview,
} from './app/view-model.js';
export {
  commitImport,
  createImportPreview,
  describeFailure,
  readImportFile,
  readImportFromLegacyKey,
} from './app/import-flow.js';
