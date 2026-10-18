/**
 * 存储层：单键 `life-calendar:v1`、读取状态、修订检查、写入锁、串行提交。
 *
 * 不变量（docs/TECHNICAL.md §7）：
 * - 读取结果区分 `ok / empty / corrupt / unsupported / unavailable`，只有 `empty` 可以初始化。
 * - `corrupt` 保留原字符串并停止写入，提供原始数据下载；用户明确清空后才能恢复。
 * - `unsupported`（未来版本）进入只读，不降级写入。
 * - 每次保存检查打开时的原始字符串与修订是否仍一致；外部变化时停止提交并保留草稿。
 * - 优先使用 `navigator.locks`，在锁内重读；不支持时用同页面命令队列串行提交，并说明并发窗口。
 * - 不写、不读、不删除四个旧应用的存储键。
 */
import { ErrorCode, LifeCalendarError, fail } from '../errors.js';
import { SCHEMA_VERSION, STORAGE_KEY, validateEnvelope } from '../compatibility/envelope.js';
import { localDate } from '../date/index.js';

export { STORAGE_KEY };

export const READ_KINDS = ['ok', 'empty', 'corrupt', 'unsupported', 'unavailable'];
export const READONLY_KINDS = ['corrupt', 'unsupported', 'unavailable'];

function toError(error, fallbackCode, scope = 'storage') {
  if (error instanceof LifeCalendarError) return error;
  return new LifeCalendarError(error?.code ?? fallbackCode, { message: error?.message ? String(error.message) : undefined, scope });
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError'
    || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error?.code === 22
    || error?.code === 1014;
}

/**
 * 读取本机数据。
 * 返回结构：
 * ```
 * { kind, data, raw, revision, code, message, readonly, downloadable, bytes, updatedAt }
 * ```
 */
export function readStorage(storage, { now = new Date(), today = null } = {}) {
  const base = { kind: 'empty', data: null, raw: null, revision: null, code: null, message: null, readonly: false, downloadable: false, bytes: 0, updatedAt: null };
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    return {
      ...base,
      kind: 'unavailable',
      readonly: true,
      code: ErrorCode.STORAGE_UNAVAILABLE,
      message: '当前浏览器不允许访问本机存储（可能处于无痕模式或已禁用站点数据）。本次修改只能留在页面上，无法保存。',
      detail: String(error?.message ?? ''),
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
      bytes: raw.length,
      readonly: true,
      downloadable: true,
      code: ErrorCode.STORAGE_CORRUPT,
      message: '本机数据无法解析（JSON 已损坏）。已停止写入并保留原始内容，可先下载原始数据再做修复或清空。',
    };
  }

  // 未来版本优先判定：更高版本可能带有本版本不认识的字段，
  // 必须先按版本分类为“只读的未来数据”，不能因为未知字段被归成“损坏”。
  if (isFutureVersion(parsed)) {
    return {
      ...base,
      kind: 'unsupported',
      raw,
      bytes: raw.length,
      readonly: true,
      downloadable: true,
      code: ErrorCode.STORAGE_FUTURE,
      message: '本机数据来自更高版本的生活日历，当前版本只读显示，不会覆盖写入。请使用更新版本打开，或先下载原始数据备份。',
      detail: `schemaVersion=${String(parsed?.schemaVersion)}`,
    };
  }

  try {
    // 存储里的 envelope 不允许导出专用字段：那是备份文件的外层字段
    const envelope = validateEnvelope(parsed, { now, today, allowExportedAt: false });
    return {
      ...base,
      kind: 'ok',
      data: envelope,
      raw,
      revision: envelope.revision,
      bytes: raw.length,
      updatedAt: envelope.updatedAt,
    };
  } catch (error) {
    const code = error?.code ?? ErrorCode.STORAGE_CORRUPT;
    const future = code === ErrorCode.FUTURE_VERSION;
    return {
      ...base,
      kind: future ? 'unsupported' : 'corrupt',
      raw,
      bytes: raw.length,
      readonly: true,
      downloadable: true,
      code: future ? ErrorCode.STORAGE_FUTURE : ErrorCode.STORAGE_CORRUPT,
      message: future
        ? '本机数据来自更高版本的生活日历，当前版本只读显示，不会覆盖写入。请使用更新版本打开，或先下载原始数据备份。'
        : `本机数据无法读取（${error?.message ?? '数据不符合约定'}）。已停止写入并保留原始内容，可先下载原始数据。`,
      detail: error?.message ?? null,
    };
  }
}

/** 未来版本判定：统一版本或任一模块版本高于当前支持版本。 */
function isFutureVersion(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const top = parsed.schemaVersion;
  if (typeof top === 'number' && Number.isFinite(top) && top > SCHEMA_VERSION) return true;
  if (parsed.format === 'life-calendar' && typeof top !== 'number') return false;
  const modules = parsed.modules;
  if (!modules || typeof modules !== 'object') return false;
  return Object.values(modules).some((entry) => {
    const version = entry?.schemaVersion;
    return typeof version === 'number' && Number.isFinite(version) && version > SCHEMA_VERSION;
  });
}

/** 序列化：一次 setItem 提交完整 envelope。 */
export function serializeEnvelope(envelope) {
  return JSON.stringify(envelope);
}

/**
 * 创建存储管理器。
 *
 * @param options.storage `localStorage` 兼容对象（必须提供 getItem/setItem）
 * @param options.lock `navigator.locks` 兼容对象（可选）
 * @param options.now 时钟（测试注入）
 * @param options.today 本地日期字符串提供者（测试注入）
 */
export function createStorageManager({ storage, lock = null, now = () => new Date(), today = () => localDate(now()), onExternalChange = null } = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    fail(ErrorCode.STORAGE_UNAVAILABLE, { message: '没有可用的本机存储实现。' });
  }
  let queue = Promise.resolve();
  let baselineRaw = null;
  let hasBaseline = false;

  function read() {
    const result = readStorage(storage, { now: now(), today: today() });
    baselineRaw = result.raw;
    hasBaseline = true;
    return result;
  }

  /**
   * 单次提交。
   *
   * @param options.envelope 待写入的完整 envelope（调用方已校验）
   * @param options.baseRevision 生成草稿/导入预览时的修订号
   * @returns `{ ok: true, revision }`，失败时抛出带错误码的 `LifeCalendarError`
   */
  async function commit({ envelope, baseRevision = null }) {
    /**
     * 真正的提交体。**必须在锁内运行**：锁内才重新读取、比较修订、写入。
     */
    const run = async () => {
      let currentRaw;
      try {
        currentRaw = storage.getItem(STORAGE_KEY);
      } catch (error) {
        throw toError(error, ErrorCode.STORAGE_UNAVAILABLE);
      }
      const expected = baselineRaw;
      if (currentRaw !== expected) {
        throw new LifeCalendarError(ErrorCode.STORAGE_CONFLICT, {
          scope: 'storage',
          message: '数据在打开后已被其他页面或另一个标签页改动。已停止提交，你的输入仍然保留；请刷新后重新执行这次操作。',
        });
      }
      if (baseRevision !== null && currentRaw) {
        let currentRevision = null;
        try {
          currentRevision = JSON.parse(currentRaw)?.revision ?? null;
        } catch {
          throw new LifeCalendarError(ErrorCode.STORAGE_CORRUPT, { scope: 'storage', message: '本机数据已损坏，已停止写入以保留原始内容。' });
        }
        if (currentRevision !== null && currentRevision !== baseRevision) {
          throw new LifeCalendarError(ErrorCode.STORAGE_CONFLICT, {
            scope: 'storage',
            message: '数据修订号已变化（可能来自另一个标签页）。已停止提交，请刷新后重新生成预览。',
          });
        }
      }
      const validated = validateEnvelope(envelope, { now: now(), today: today() });
      const text = serializeEnvelope(validated);
      try {
        storage.setItem(STORAGE_KEY, text);
      } catch (error) {
        if (isQuotaError(error)) {
          throw new LifeCalendarError(ErrorCode.STORAGE_QUOTA, {
            scope: 'storage',
            message: '本机存储空间不足，保存失败。原有数据未改变，你的输入仍保留在页面上；请先导出备份并清理浏览器数据。',
          });
        }
        throw toError(error, ErrorCode.STORAGE_FAILED);
      }
      baselineRaw = text;
      hasBaseline = true;
      return { ok: true, revision: validated.revision };
    };

    // 同页面串行执行体；锁请求本身就是串行队列里的一环，
    // 因此“读取—比较—写入”整体在锁内完成（不存在先跑后加锁的窗口）。
    const task = async () => {
      if (lock && typeof lock.request === 'function') {
        return lock.request('life-calendar:v1', { mode: 'exclusive' }, () => run());
      }
      return run();
    };

    const chained = queue.then(task, task);
    // 队列本身不吞掉调用方的异常，只保证下一个任务不因上一个失败而被拒绝
    queue = chained.then(() => undefined, () => undefined);
    return chained;
  }

  /** 明确清空：只在用户确认后调用；损坏状态下这是唯一的恢复路径。 */
  async function clear() {
    try {
      storage.removeItem?.(STORAGE_KEY);
      if (!storage.removeItem) storage.setItem(STORAGE_KEY, '');
    } catch (error) {
      throw toError(error, ErrorCode.STORAGE_FAILED);
    }
    baselineRaw = null;
    hasBaseline = true;
    return { ok: true };
  }

  /**
   * 存储事件：其他标签页写入了数据。
   *
   * 关键点：**不能**把基线更新成外部值。基线代表“本页面草稿所基于的版本”，
   * 若在这里跟随外部值，旧草稿就会被误判为基于最新数据而覆盖别人的写入。
   * 因此只上报外部变化，由界面决定“重新加载 / 保留草稿 / 另存备份”。
   */
  function handleStorageEvent(event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return { changed: false, externalRaw: null };
    const next = event.newValue ?? null;
    const changed = next !== baselineRaw;
    if (changed && typeof onExternalChange === 'function') onExternalChange(next);
    return { changed, externalRaw: next };
  }

  return {
    key: STORAGE_KEY,
    read,
    commit,
    clear,
    handleStorageEvent,
    get baselineRaw() {
      return baselineRaw;
    },
    /** 并发能力说明，界面需要如实展示。 */
    concurrencyNote: lock && typeof lock.request === 'function'
      ? '写入使用浏览器写入锁，并在锁内重新读取数据检查修订。'
      : '当前浏览器不支持写入锁：同一页面内的提交会串行执行，多标签页同时写入存在极小并发窗口。',
  };
}

/** 检测存储可用性（不写入）。 */
export function probeStorage(storage) {
  try {
    const key = '__life-calendar-probe__';
    storage.setItem(key, '1');
    storage.removeItem?.(key);
    return { available: true, code: null };
  } catch (error) {
    if (isQuotaError(error)) return { available: false, code: ErrorCode.STORAGE_QUOTA, message: '本机存储空间已满，无法保存新的改动。' };
    return { available: false, code: ErrorCode.STORAGE_UNAVAILABLE, message: '当前浏览器不允许访问本机存储。' };
  }
}
