/**
 * 统一错误码：导入、校验、存储、导出共用。
 *
 * 不变量（docs/TECHNICAL.md §5、§7）：
 * - 失败必须能定位到阶段与范围，界面据此显示可执行说明，不能显示“成功”。
 * - 数据内容（日记、健康、财务文本）不得进入日志或错误消息。
 */

export const ErrorCode = {
  // 读取与解析
  FILE_TOO_LARGE: 'E_FILE_TOO_LARGE',
  FILE_EMPTY: 'E_FILE_EMPTY',
  JSON_INVALID: 'E_JSON_INVALID',
  // 识别
  UNKNOWN_FORMAT: 'E_UNKNOWN_FORMAT',
  AMBIGUOUS_FORMAT: 'E_AMBIGUOUS_FORMAT',
  // 版本
  FUTURE_VERSION: 'E_FUTURE_VERSION',
  UNSUPPORTED_VERSION: 'E_UNSUPPORTED_VERSION',
  // 结构校验
  SCHEMA_INVALID: 'E_SCHEMA_INVALID',
  UNKNOWN_FIELD: 'E_UNKNOWN_FIELD',
  LIMIT_EXCEEDED: 'E_LIMIT_EXCEEDED',
  ID_INVALID: 'E_ID_INVALID',
  ID_DUPLICATE: 'E_ID_DUPLICATE',
  DATE_INVALID: 'E_DATE_INVALID',
  DATE_IN_FUTURE: 'E_DATE_IN_FUTURE',
  TIME_INVALID: 'E_TIME_INVALID',
  AMOUNT_INVALID: 'E_AMOUNT_INVALID',
  TEXT_TOO_LONG: 'E_TEXT_TOO_LONG',
  ENUM_INVALID: 'E_ENUM_INVALID',
  RANGE_ORDER: 'E_RANGE_ORDER',
  RANGE_OVERLAP: 'E_RANGE_OVERLAP',
  MULTIPLE_ACTIVE: 'E_MULTIPLE_ACTIVE',
  DAY_DUPLICATE: 'E_DAY_DUPLICATE',
  IDENTITY_CONFLICT: 'E_IDENTITY_CONFLICT',
  SNAPSHOT_INVALID: 'E_SNAPSHOT_INVALID',
  TAG_MISSING: 'E_TAG_MISSING',
  // 导入计划
  IMPORT_UNRESOLVED: 'E_IMPORT_UNRESOLVED',
  IMPORT_STALE: 'E_IMPORT_STALE',
  IMPORT_OVERLAP_UNRESOLVABLE: 'E_IMPORT_OVERLAP_UNRESOLVABLE',
  IMPORT_MERGE_UNSAFE: 'E_IMPORT_MERGE_UNSAFE',
  // 存储
  STORAGE_UNAVAILABLE: 'E_STORAGE_UNAVAILABLE',
  STORAGE_CORRUPT: 'E_STORAGE_CORRUPT',
  STORAGE_FUTURE: 'E_STORAGE_FUTURE',
  STORAGE_QUOTA: 'E_STORAGE_QUOTA',
  STORAGE_CONFLICT: 'E_STORAGE_CONFLICT',
  STORAGE_FAILED: 'E_STORAGE_FAILED',
  // 导出
  EXPORT_LOSSY: 'E_EXPORT_LOSSY',
  EXPORT_UNSUPPORTED: 'E_EXPORT_UNSUPPORTED',
};

/** 各错误码的中文默认说明。界面可覆盖，但不得省略原因。 */
export const ERROR_MESSAGES = {
  [ErrorCode.FILE_TOO_LARGE]: '文件超过该格式支持的大小上限。',
  [ErrorCode.FILE_EMPTY]: '文件为空。',
  [ErrorCode.JSON_INVALID]: 'JSON 文件已损坏或格式不正确。',
  [ErrorCode.UNKNOWN_FORMAT]: '无法识别这个文件的来源格式。',
  [ErrorCode.AMBIGUOUS_FORMAT]: '文件同时匹配多种格式，无法确定来源。',
  [ErrorCode.FUTURE_VERSION]: '这是更高版本的备份，当前版本无法安全读取，不会写入。',
  [ErrorCode.UNSUPPORTED_VERSION]: '备份版本不受支持。',
  [ErrorCode.SCHEMA_INVALID]: '数据结构不符合约定。',
  [ErrorCode.UNKNOWN_FIELD]: '备份包含当前版本不认识的字段。',
  [ErrorCode.LIMIT_EXCEEDED]: '记录数量超过支持范围。',
  [ErrorCode.ID_INVALID]: '记录编号无效。',
  [ErrorCode.ID_DUPLICATE]: '记录编号重复。',
  [ErrorCode.DATE_INVALID]: '日期无效。',
  [ErrorCode.DATE_IN_FUTURE]: '只能记录今天或过去的日期。',
  [ErrorCode.TIME_INVALID]: '时间无效。',
  [ErrorCode.AMOUNT_INVALID]: '金额无效。',
  [ErrorCode.TEXT_TOO_LONG]: '文本超过长度上限。',
  [ErrorCode.ENUM_INVALID]: '取值不在允许范围内。',
  [ErrorCode.RANGE_ORDER]: '结束日期不能早于开始日期。',
  [ErrorCode.RANGE_OVERLAP]: '日期区间重叠。',
  [ErrorCode.MULTIPLE_ACTIVE]: '只能有一个进行中的记录。',
  [ErrorCode.DAY_DUPLICATE]: '同一天存在重复记录。',
  [ErrorCode.IDENTITY_CONFLICT]: '同一编号对应不同内容。',
  [ErrorCode.SNAPSHOT_INVALID]: '快照内容无效。',
  [ErrorCode.TAG_MISSING]: '引用了不存在的标签。',
  [ErrorCode.IMPORT_UNRESOLVED]: '还有冲突没有处理，不能提交。',
  [ErrorCode.IMPORT_STALE]: '数据在打开预览后被改动，请重新生成导入预览。',
  [ErrorCode.IMPORT_OVERLAP_UNRESOLVABLE]: '存在无法通过“保留两份”解决的区间重叠。',
  [ErrorCode.IMPORT_MERGE_UNSAFE]: '缺少可稳定映射的标识，无法安全合并。',
  [ErrorCode.STORAGE_UNAVAILABLE]: '当前浏览器不允许访问本机存储。',
  [ErrorCode.STORAGE_CORRUPT]: '本机数据无法读取，已停止写入并保留原始内容。',
  [ErrorCode.STORAGE_FUTURE]: '本机数据来自更高版本，已进入只读状态。',
  [ErrorCode.STORAGE_QUOTA]: '本机存储空间不足，保存失败，输入内容已保留。',
  [ErrorCode.STORAGE_CONFLICT]: '另一页面已修改数据，请刷新后再保存。',
  [ErrorCode.STORAGE_FAILED]: '保存失败，原有数据未改变。',
  [ErrorCode.EXPORT_LOSSY]: '该导出无法在旧格式中完整表达全部字段。',
  [ErrorCode.EXPORT_UNSUPPORTED]: '当前状态不支持导出。',
};

/** 统一错误类型：带错误码、范围与可显示说明。 */
export class LifeCalendarError extends Error {
  constructor(code, { message, scope = null, path = null, detail = null } = {}) {
    super(message || ERROR_MESSAGES[code] || code);
    this.name = 'LifeCalendarError';
    this.code = code;
    this.scope = scope;
    this.path = path;
    this.detail = detail;
  }

  toJSON() {
    return { code: this.code, message: this.message, scope: this.scope, path: this.path, detail: this.detail };
  }
}

export function fail(code, options) {
  throw new LifeCalendarError(code, options);
}

/** 把任意异常规范成带错误码的结果对象，避免界面读取 `message` 依赖。 */
export function describeError(error) {
  if (error instanceof LifeCalendarError) return error.toJSON();
  return { code: ErrorCode.SCHEMA_INVALID, message: error?.message ? String(error.message) : '未知错误', scope: null, path: null, detail: null };
}

export function isErrorCode(value, code) {
  return value instanceof LifeCalendarError && value.code === code;
}
