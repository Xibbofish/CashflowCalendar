/**
 * 导入流程门面：读取文件 → 识别 → 校验 → 预览 → 提交。
 *
 * 界面只需要三个调用：`readImportFile`、`createImportPreview`、`commitImport`。
 * 预览取消不写数据；提交前重新校验修订与全量结构。
 */
import { ErrorCode, LifeCalendarError, fail } from '../errors.js';
import { DEFAULT_SIZE_LIMITS, FORMAT_LABELS, checkParsedLimits, formatBytes, readIncomingJson } from '../compatibility/detect.js';
import { MODULE_LABELS, normalizeIncoming, readLegacySource } from '../compatibility/legacy-formats.js';
import { planImport, applyImport, describeImportPlan } from '../compatibility/import-plan.js';
import { toLocalDateString } from '../date/index.js';
// 界面直接调用导入计划/落地时用这里的同一个实例，避免出现两份判定逻辑
export { planImport, applyImport };
export { detectLegacySources, LEGACY_STORAGE_KEYS } from '../compatibility/legacy-formats.js';
export { describeImportPlan, formatBytes, DEFAULT_SIZE_LIMITS, FORMAT_LABELS, MODULE_LABELS };


/**
 * 读取用户选择的文件。
 * 先检查大小（用文件自身报告的字节数，中文 UTF-8 通常大于字符数），
 * 再解析文本，最后识别格式与版本；任何失败都不改动数据。
 */
export async function readImportFile(file, { now = new Date() } = {}) {
  if (!file) fail(ErrorCode.FILE_EMPTY, { message: '没有选择文件。' });
  const size = Number(file.size ?? 0);
  const maxBytes = DEFAULT_SIZE_LIMITS.unified;
  if (size > maxBytes) {
    fail(ErrorCode.FILE_TOO_LARGE, { message: `文件 ${formatBytes(size)} 超过统一备份上限 ${formatBytes(maxBytes)}，未读取。` });
  }
  let text;
  try {
    text = await file.text();
  } catch {
    fail(ErrorCode.FILE_EMPTY, { message: '文件无法读取，请重新选择或换一个文件。' });
  }
  // 大小检查用真实字节数；解析后的结构上限另用字符数（见 detect.checkParsedLimits）
  const incoming = readIncomingJson({ text, size, name: file.name ?? null });
  checkParsedLimits(incoming.format, incoming.value);
  return { ...incoming, filename: file.name ?? null, bytes: size };
}

/**
 * 从同源旧键读取（只读取，不写入、不删除旧键）。
 * 返回**原始解析值**，由 `normalizeIncoming` 按旧格式解释一次，
 * 不能把已规范化的模块数据再当作旧格式读第二遍。
 */
export function readImportFromLegacyKey(storage, key, { now = new Date() } = {}) {
  const source = readLegacySource(storage, key, { now, today: toLocalDateString(now) });
  const rawJson = storage.getItem(key);
  return {
    format: source.format,
    value: JSON.parse(rawJson),
    bytes: typeof rawJson === 'string' ? rawJson.length : 0,
    sourceKey: key,
    moduleId: source.moduleId,
  };
}

/**
 * 生成导入预览：不写数据。
 *
 * @param current 当前 envelope
 * @param incoming `readImportFile` 或 `readImportFromLegacyKey` 的结果
 * @param options `{ baseRevision, now, today }`
 */
export function createImportPreview(current, incoming, { baseRevision = null, now = new Date(), today = null } = {}) {
  const started = now.getTime();
  // 只把“值 + 来源格式”交给统一的规范化入口：
  // normalizeIncoming 会用 Symbol 标记已规范化，普通字段无法伪造，用户文件也绕不过校验。
  const plan = planImport(current, { format: incoming.format, value: incoming.value }, {
    baseRevision,
    now,
    today: today ?? toLocalDateString(now),
    format: incoming.format,
  });
  plan.sourceKind = incoming.sourceKey ? 'legacy-key' : plan.sourceFormat === 'unified' ? 'unified-backup' : 'file';
  plan.sourceKey = incoming.sourceKey ?? null;
  plan.sourceFilename = incoming.filename ?? null;
  plan.sourceBytes = incoming.bytes ?? null;
  plan.previewedAt = new Date(now.getTime() + Math.max(0, Date.now() - started)).toISOString();
  return { plan, summary: describeImportPlan(plan) };
}

/**
 * 提交导入预览。
 *
 * @param store `createAppStore` 的实例（提供 commitEnvelope）
 * @param preview `createImportPreview` 的结果
 * @param decisions 冲突与范围选择
 */
export async function commitImport(store, preview, decisions = {}, { now = new Date(), today = null } = {}) {
  const plan = preview?.plan ?? preview;
  if (!plan) fail(ErrorCode.SCHEMA_INVALID, { message: '没有可提交的导入预览。' });
  const state = store.getState();
  if (plan.baseRevision !== null && plan.baseRevision !== state.revision && state.revision !== null) {
    fail(ErrorCode.IMPORT_STALE, {
      message: '数据在打开预览后被改动，已停止提交。请重新生成导入预览后再试；本次没有写入任何数据。',
    });
  }
  const { envelope, stats } = applyImport(plan, decisions, { current: state.data, now, today });
  const result = await store.commitEnvelope(envelope, {
    baseRevision: plan.baseRevision,
    action: 'import',
    stats,
    source: plan.sourceKind ?? 'file',
    format: plan.sourceFormat,
    module: plan.sourceModuleId ?? null,
    sourceKey: plan.sourceKey ?? null,
  });
  return { ...result, stats };
}

/** 失败恢复：把异常转成界面可显示的结构（不泄露数据正文）。 */
export function describeFailure(error) {
  if (error instanceof LifeCalendarError) return error.toJSON();
  return { code: ErrorCode.SCHEMA_INVALID, message: error?.message ? String(error.message) : '未知错误', scope: null, path: null, detail: null };
}
