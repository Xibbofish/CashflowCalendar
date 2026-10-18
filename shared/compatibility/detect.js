/**
 * 格式识别：只看结构与版本字段，不看文件名。
 *
 * 规则（docs/TECHNICAL.md §5）：
 * - 统一格式优先。
 * - 四种旧格式分别检查特征字段。
 * - 多重匹配时拒绝并说明歧义，不做猜测。
 * - 版本检查先于结构校验：未来版本直接拒绝，不做部分读取。
 */
import { ErrorCode, fail } from '../errors.js';

export const MODULE_IDS = ['cashflow', 'mood', 'period', 'zodiac'];
export const MODULE_LABELS = {
  cashflow: '收支',
  mood: '心情与日记',
  period: '身体与月经',
  zodiac: '当日星笺',
};

/** 默认大小上限（字节）。统一备份 40MB；旧格式沿用各自既有上限。 */
export const DEFAULT_SIZE_LIMITS = {
  'personal-data': 40 * 1024 * 1024,
  unified: 40 * 1024 * 1024,
  mood: 20 * 1024 * 1024,
  period: 5 * 1024 * 1024,
  zodiac: 10 * 1024 * 1024,
  cashflow: 15 * 1024 * 1024,
};

export const FORMAT_LABELS = {
  'personal-data': '标准个人数据包',
  unified: '生活日历完整备份',
  mood: '心情日记备份',
  period: '月经记录本备份',
  zodiac: '每日星笺备份',
  cashflow: '现金流日历备份',
};

/** 各格式的顶层版本字段与受支持版本。 */
export const FORMAT_VERSIONS = {
  'personal-data': { field: 'formatVersion', supported: '1.0.0' },
  unified: { field: 'schemaVersion', supported: 1 },
  mood: { field: 'version', supported: 1 },
  period: { field: 'version', supported: 1 },
  zodiac: { field: 'schemaVersion', supported: 1 },
  cashflow: { field: null, supported: null },
};

function looksLikeObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isArrayField(value, key) {
  return looksLikeObject(value) && Array.isArray(value[key]);
}

/**
 * 结构特征判定：返回所有匹配的格式 id。
 * 只使用顶层键与数组形状，不深入元素结构（元素校验属于严格校验阶段）。
 */
export function matchFormats(value) {
  const matches = [];
  if (!looksLikeObject(value)) return matches;
  if (value.format === 'xibbofish.personal-data') matches.push('personal-data');
  if (value.format === 'life-calendar' && 'modules' in value) matches.push('unified');
  if ('initialBalance' in value && (isArrayField(value, 'events') || isArrayField(value, 'simulationEvents'))) matches.push('cashflow');
  if (isArrayField(value, 'periods') || isArrayField(value, 'daily')) matches.push('period');
  if (isArrayField(value, 'entries') && (isArrayField(value, 'tags') || value.version === 1)) matches.push('mood');
  if (isArrayField(value, 'saved') && 'sign' in value) matches.push('zodiac');
  return [...new Set(matches)];
}

/** 版本字段读取（无版本字段的格式返回 null）。 */
export function readVersion(format, value) {
  const spec = FORMAT_VERSIONS[format];
  if (!spec || !spec.field) return null;
  const raw = value?.[spec.field];
  return raw === undefined ? undefined : raw;
}

/**
 * 版本支持检查。
 * - `null`：该格式没有版本字段。
 * - `undefined`：声明了版本字段却缺失 → 拒绝（不能默认成 1）。
 * - 大于支持版本 → `E_FUTURE_VERSION`（只读、保留原文件）。
 * - 其他不匹配 → `E_UNSUPPORTED_VERSION`。
 */
export function checkVersion(format, value) {
  const spec = FORMAT_VERSIONS[format];
  if (!spec || !spec.field) return null;
  const version = readVersion(format, value);
  if (version === undefined) {
    fail(ErrorCode.UNSUPPORTED_VERSION, { scope: format, message: `备份没有标明 ${spec.field}，无法确认格式版本，未读取。` });
  }
  if (version === spec.supported) return version;
  if (typeof version === 'number' && version > spec.supported) {
    fail(ErrorCode.FUTURE_VERSION, { scope: format, path: spec.field, message: `这是 ${FORMAT_LABELS[format]} 的更高版本（${spec.field}=${version}），当前版本无法安全读取，也不会写入。请保留原文件并使用更新版本打开。` });
  }
  fail(ErrorCode.UNSUPPORTED_VERSION, { scope: format, path: spec.field, message: `${FORMAT_LABELS[format]} 的版本 ${String(version)} 不受支持。` });
  return null;
}

/**
 * 识别一个已解析的 JSON 值。
 * 返回 `{ format, version, moduleId }`；无法识别或存在歧义时抛错。
 */
export function detectFormat(value, { allowed = null } = {}) {
  const matches = matchFormats(value).filter((format) => !allowed || allowed.includes(format));
  if (matches.length === 0) {
    fail(ErrorCode.UNKNOWN_FORMAT, { message: '无法识别这个文件的来源格式：既不是生活日历备份，也不是四种旧应用的备份。' });
  }
  if (matches.length > 1) {
    fail(ErrorCode.AMBIGUOUS_FORMAT, { message: `文件同时匹配多种格式（${matches.join('、')}），无法确定来源，请确认导出应用后重新提供。` });
  }
  const format = matches[0];
  const version = checkVersion(format, value);
  return { format, version, moduleId: ['unified', 'personal-data'].includes(format) ? null : format };
}

/** 解析 JSON 文本；空内容与语法错误分别给出明确错误码。 */
export function parseJsonText(text) {
  if (typeof text !== 'string' || !text.trim()) fail(ErrorCode.FILE_EMPTY, { message: '文件为空，没有可读取的内容。' });
  try {
    return JSON.parse(text);
  } catch {
    fail(ErrorCode.JSON_INVALID, { message: 'JSON 文件已损坏或格式不正确。' });
    return null;
  }
}

/**
 * 读取文件：先检查大小，再解析文本，最后识别格式。
 * `size` 由调用方提供（File.size 或字符串长度），避免在异常大文件上先解析。
 */
export function readIncomingJson({ text, size, name = null }) {
  const bytes = typeof size === 'number' ? size : typeof text === 'string' ? text.length : 0;
  const declared = sizeLimitForProbe(text, name);
  if (bytes > declared.limit) {
    fail(ErrorCode.FILE_TOO_LARGE, {
      message: `文件 ${formatBytes(bytes)} 超过${declared.label ?? '该格式'}支持的大小上限 ${formatBytes(declared.limit)}，未读取。`,
    });
  }
  const value = parseJsonText(text);
  const detected = detectFormat(value);
  const limit = DEFAULT_SIZE_LIMITS[detected.format];
  if (bytes > limit) {
    fail(ErrorCode.FILE_TOO_LARGE, {
      message: `文件 ${formatBytes(bytes)} 超过${FORMAT_LABELS[detected.format]}的大小上限 ${formatBytes(limit)}，未读取。`,
    });
  }
  return { ...detected, value, bytes };
}

/**
 * 大小预检：文件必须先看大小再看内容。
 * 解析前只知道文本长度，因此使用所有格式中最大的上限；识别后再按格式上限复核。
 */
function sizeLimitForProbe() {
  return { limit: DEFAULT_SIZE_LIMITS.unified, label: null };
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 数组与文本上限：解析后检查，避免超限数据进入规范化。 */
export function checkParsedLimits(format, value) {
  const limits = {
    mood: { entries: 20000, tags: 200 },
    period: { periods: 10000, daily: 30000 },
    zodiac: { saved: 5000 },
    cashflow: { events: 2000, simulationEvents: 2000 },
    unified: null,
  }[format];
  if (!limits) return;
  for (const [key, max] of Object.entries(limits)) {
    const list = value?.[key];
    if (Array.isArray(list) && list.length > max) {
      fail(ErrorCode.LIMIT_EXCEEDED, { scope: format, path: key, message: `${FORMAT_LABELS[format]} 的 ${key} 数量 ${list.length} 超过上限 ${max}。` });
    }
  }
}
