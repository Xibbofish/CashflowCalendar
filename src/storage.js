/**
 * 现金流日历的本机存储：严格读取 + 只保护写。
 *
 * 背景：旧实现用 `JSON.parse(localStorage.getItem(...)) || 默认值`，
 * 数据一旦损坏或被更高版本写过，下一次自动保存就会**静默洗掉**用户原有记录。
 * 这里改成显式状态机：
 *
 * - `ok`：数据通过严格校验（未知字段、版本、金额、ID 一律拒绝）；
 * - `empty`：确实没有数据，可以初始化；
 * - `corrupt`：JSON 损坏或结构不合法 —— 停止写入，保留原始字符串供下载；
 * - `unsupported`：来自更高版本 —— 只读，不覆盖；
 * - `unavailable`：浏览器不允许访问本机存储。
 *
 * 存储键与写入格式与旧版完全一致（`cashflow-calendar-data`，去掉内部包装后落盘），
 * 因此旧用户升级后不会看到“数据丢了”，统一应用也能继续读同一份数据。
 */
import { LifeCalendarError, ErrorCode } from '../shared/errors.js';
import { readLegacy, writeLegacy } from '../shared/modules/cashflow/model.js';

export const STORAGE_KEY = 'cashflow-calendar-data';
export const RECOVERY_KEY = 'cashflow-calendar:import-recovery:v1';

export const DEFAULT_STATE = {
  initialBalance: 10000,
  events: [],
  simulationEvents: [],
};

function describe(error) {
  if (error instanceof LifeCalendarError) return { code: error.code, message: error.message };
  return { code: ErrorCode.SCHEMA_INVALID, message: String(error?.message ?? '数据无法读取。') };
}

/**
 * 安全获取浏览器本机存储。
 *
 * `globalThis.localStorage` 的**取值本身**就可能抛错（沙箱 iframe、被禁用的第三方存储、
 * 某些隐私模式会直接抛 SecurityError）。如果把它写成默认参数，异常会在函数体外抛出，
 * 整个页面直接白屏；所以必须先捕获，再判断可用性。
 */
function resolveStorage(storage) {
  if (storage !== undefined && storage !== null) return { storage, error: null };
  try {
    const found = globalThis.localStorage ?? null;
    if (!found) return { storage: null, error: null };
    return { storage: found, error: null };
  } catch (error) {
    return { storage: null, error: String(error?.message ?? '本机存储不可访问。') };
  }
}

/**
 * 读取本机数据。**只读**，不写入、不删除。
 *
 * @returns {{ kind: string, data: object|null, raw: string|null, error: object|null, downloadable: boolean, readonly: boolean }}
 */
export function readState(storage) {
  const base = { kind: 'empty', data: null, raw: null, error: null, downloadable: false, readonly: false };
  const resolved = resolveStorage(storage);
  if (resolved.error) {
    return {
      ...base,
      kind: 'unavailable',
      readonly: true,
      error: { code: ErrorCode.STORAGE_UNAVAILABLE, message: '当前浏览器不允许访问本机存储，本次只能查看，改动无法保存。', detail: resolved.error },
    };
  }
  const store = resolved.storage;
  if (!store) {
    return {
      ...base,
      kind: 'unavailable',
      readonly: true,
      error: { code: ErrorCode.STORAGE_UNAVAILABLE, message: '当前浏览器不允许访问本机存储，本次只能查看，改动无法保存。' },
    };
  }

  let raw = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (error) {
    return {
      ...base,
      kind: 'unavailable',
      readonly: true,
      error: { code: ErrorCode.STORAGE_UNAVAILABLE, message: '当前浏览器不允许访问本机存储，本次只能查看，改动无法保存。', detail: String(error?.message ?? '') },
    };
  }
  if (raw === null || raw === undefined || raw === '') return { ...base, kind: 'empty' };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ...base,
      kind: 'corrupt',
      raw,
      readonly: true,
      downloadable: true,
      error: { code: ErrorCode.STORAGE_CORRUPT, message: '本机数据无法解析（JSON 已损坏）。已停止写入并保留原始内容，可先下载原始数据。' },
    };
  }

  // 未来版本（含统一应用的 envelope）优先判定为只读，不能当成损坏数据清掉。
  // 任何显式的 schemaVersion 都不是旧格式：只有 `1` 可以按当前版本读，其他一律拒绝。
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'schemaVersion')) {
    if (parsed.schemaVersion !== 1) {
      return {
        ...base,
        kind: 'unsupported',
        raw,
        readonly: true,
        downloadable: true,
        error: { code: ErrorCode.STORAGE_FUTURE, message: '本机数据带有未知的版本标记，当前版本只读显示，不会覆盖写入。请使用对应版本打开，或先下载原始数据备份。' },
      };
    }
  }

  try {
    const wrapped = readLegacy(parsed);
    return {
      ...base,
      kind: 'ok',
      // 落盘格式不含内部包装：与旧应用读写同一份数据
      data: writeLegacy(wrapped),
      raw,
    };
  } catch (error) {
    return {
      ...base,
      kind: 'corrupt',
      raw,
      readonly: true,
      downloadable: true,
      error: { ...describe(error), message: `本机数据不符合约定：${error?.message ?? '未知问题'}。已停止写入并保留原始内容，可先下载原始数据。` },
    };
  }
}

/**
 * 写入：只接受通过严格校验的数据；失败抛出，由界面提示，不静默吞掉。
 *
 * 注意两点，都不允许“顺手修正”：
 * - 传入对象必须**原样**交给严格校验：未知字段、未知的 `schemaVersion`、非法金额一律拒绝，
 *   绝不先塞一个 `schemaVersion: 1` 再校验（那会把未来版本的数据洗成当前版本）。
 * - 内部包装（`schemaVersion`）在落盘时去掉，保持与旧应用读写同一份格式。
 */
export function writeState(state, storage) {
  const resolved = resolveStorage(storage);
  if (resolved.error || !resolved.storage) {
    throw new LifeCalendarError(ErrorCode.STORAGE_UNAVAILABLE, {
      message: '当前浏览器不允许访问本机存储，改动没有保存。',
      ...(resolved.error ? { detail: resolved.error } : {}),
    });
  }
  const previous = readState(resolved.storage);
  if (previous.readonly) throw new LifeCalendarError(previous.error.code, { message: previous.error.message });
  const valid = readLegacy(state);
  try {
    resolved.storage.setItem(STORAGE_KEY, JSON.stringify(writeLegacy(valid)));
  } catch (error) {
    const quota = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
    throw new LifeCalendarError(quota ? ErrorCode.STORAGE_QUOTA : ErrorCode.STORAGE_FAILED, {
      message: quota
        ? '本机存储空间不足，这次改动没有保存。'
        : '本机存储写入失败，这次改动没有保存。',
    });
  }
  return valid;
}

/** 备份文件解析：与读取本机数据同样的严格口径。 */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LifeCalendarError(ErrorCode.JSON_INVALID, { message: '备份文件不是有效的 JSON，未导入。' });
  }
  const wrapped = readLegacy(parsed);
  return writeLegacy(wrapped);
}

/** 恢复流程用：清除本机数据（只在用户明确确认后调用）。 */
export function clearState(storage) {
  const resolved = resolveStorage(storage);
  if (resolved.error || !resolved.storage) {
    throw new LifeCalendarError(ErrorCode.STORAGE_UNAVAILABLE, {
      message: '当前浏览器不允许访问本机存储。',
      ...(resolved.error ? { detail: resolved.error } : {}),
    });
  }
  try {
    resolved.storage.removeItem(RECOVERY_KEY);
    resolved.storage.removeItem(STORAGE_KEY);
  } catch (error) {
    throw new LifeCalendarError(ErrorCode.STORAGE_FAILED, { message: `无法清除本机数据：${error?.message ?? '未知问题'}` });
  }
  return DEFAULT_STATE;
}

