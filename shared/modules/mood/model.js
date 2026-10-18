/**
 * 心情模块：模型、标签、统计、命令、旧格式读写。
 *
 * 旧数据形态（备份 `version:1, entries, tags`，存储键 `liuyiye-journal-v1`）：
 * entry = { id, localDate, time, mood(1—5), tagIds, content, createdAt, updatedAt }
 *
 * 兼容不变量：
 * - `localDate` 字段名保留旧语义（本地日历日期），不改成 `date`。
 * - 一天允许任意多条记录；同日不同 ID 合法。
 * - `validate` 完成后会 trim 标签名并去重 tagIds；旧路径 re-export 保持这些行为。
 * - 标签同名映射：外部 ID 被不同名称占用时分配新 ID 并由调用方保存映射。
 */
import { LifeCalendarError, ErrorCode, fail } from '../../errors.js';
import { isTimeString, localDate, resolveNowIso, validLegacyLocalDate } from '../../date/index.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'liuyiye-journal-v1';
export const LIMITS = {
  entries: 20000,
  tags: 200,
  tagName: 24,
  content: 20000,
  id: 100,
  time: 5,
};
export const MAX_MOOD = 5;
export const MIN_MOOD = 1;

/** 心情五档（与原应用 `data.js` 的 MOODS 完全一致）。 */
export const MOODS = [
  { value: 1, label: '很低落', icon: '☂', color: '#8e9fb6' },
  { value: 2, label: '有点累', icon: '☁', color: '#ada8be' },
  { value: 3, label: '平平静静', icon: '◡', color: '#9db5a1' },
  { value: 4, label: '心情不错', icon: '❀', color: '#e2b569' },
  { value: 5, label: '超开心', icon: '☀', color: '#dd9273' },
];
export const DEFAULT_TAG_NAMES = ['睡眠', '工作', '运动', '朋友', '家人', '独处'];

export const ENTRY_FIELDS = ['id', 'localDate', 'time', 'mood', 'tagIds', 'content', 'createdAt', 'updatedAt'];
export const TAG_FIELDS = ['id', 'name'];
export const DATA_FIELDS = ['version', 'entries', 'tags'];

export function moodMeta(value) {
  return MOODS.find((mood) => mood.value === value) ?? null;
}

export function emptyData() {
  return {
    version: SCHEMA_VERSION,
    entries: [],
    tags: DEFAULT_TAG_NAMES.map((name, index) => ({ id: `tag-${index}`, name })),
  };
}

function checkObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(ErrorCode.SCHEMA_INVALID, { path, scope: 'mood', message: `${path} 必须是对象。` });
}

/**
 * 未知字段处理（统一存储、统一备份、旧格式读取一律拒绝）：
 * 拒绝而不是保留，避免统一恢复时静默丢字段或语义漂移。
 */
function checkUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${key}`, scope: 'mood', message: `${path} 包含不认识的字段：${key}` });
  }
}

export function validateTag(input, path = 'tag') {
  checkObject(input, path);
  checkUnknownFields(input, TAG_FIELDS, path);
  if (typeof input.id !== 'string' || !input.id) fail(ErrorCode.ID_INVALID, { path: `${path}.id`, scope: 'mood', message: '标签编号无效。' });
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > LIMITS.tagName) {
    fail(ErrorCode.TEXT_TOO_LONG, { path: `${path}.name`, scope: 'mood', message: `标签名必须是 1—${LIMITS.tagName} 个字符。` });
  }
  return { id: input.id, name: input.name.trim() };
}

/** 严格校验；与旧 `validate` 行为一致（含标签 trim、tagIds 去重、日期真实性）。 */
export function validate(input) {
  checkObject(input, 'mood');
  checkUnknownFields(input, DATA_FIELDS, 'mood');
  if (input.version !== SCHEMA_VERSION) {
    const code = typeof input.version === 'number' && input.version > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: 'mood.version', scope: 'mood', message: `心情备份版本 ${input.version} 不受支持，需要版本 1。` });
  }
  if (!Array.isArray(input.entries) || !Array.isArray(input.tags)) {
    fail(ErrorCode.SCHEMA_INVALID, { scope: 'mood', message: '备份格式不正确，需要版本 1 的 JSON 备份。' });
  }
  if (input.entries.length > LIMITS.entries || input.tags.length > LIMITS.tags) {
    fail(ErrorCode.LIMIT_EXCEEDED, { scope: 'mood', message: '记录或标签数量超过支持范围。' });
  }
  const ids = new Set();
  const tags = input.tags.map((raw, index) => {
    const tag = validateTag(raw, `mood.tags[${index}]`);
    if (ids.has(tag.id)) fail(ErrorCode.ID_DUPLICATE, { path: `mood.tags[${index}].id`, scope: 'mood', message: '标签编号重复。' });
    ids.add(tag.id);
    return tag;
  });
  const tagIds = new Set(tags.map((tag) => tag.id));
  const entryIds = new Set();
  const entries = input.entries.map((raw, index) => {
    const path = `mood.entries[${index}]`;
    checkObject(raw, path);
    checkUnknownFields(raw, ENTRY_FIELDS, path);
    if (typeof raw.id !== 'string' || !raw.id) fail(ErrorCode.ID_INVALID, { path: `${path}.id`, scope: 'mood', message: '记录编号无效。' });
    if (entryIds.has(raw.id)) fail(ErrorCode.ID_DUPLICATE, { path: `${path}.id`, scope: 'mood', message: '记录编号重复。' });
    entryIds.add(raw.id);
    if (!validLegacyLocalDate(raw.localDate)) {
      fail(ErrorCode.DATE_INVALID, { path: `${path}.localDate`, scope: 'mood', message: '记录日期无效。旧格式要求 1000—9999 年的四位本地日历日期，且必须是真实存在的日期。' });
    }
    if (!isTimeString(raw.time)) fail(ErrorCode.TIME_INVALID, { path: `${path}.time`, scope: 'mood', message: '记录时间无效。' });
    if (!Number.isInteger(raw.mood) || raw.mood < MIN_MOOD || raw.mood > MAX_MOOD) {
      fail(ErrorCode.ENUM_INVALID, { path: `${path}.mood`, scope: 'mood', message: `心情必须是 ${MIN_MOOD}—${MAX_MOOD} 的整数。` });
    }
    if (!Array.isArray(raw.tagIds) || raw.tagIds.some((id) => !tagIds.has(id))) {
      fail(ErrorCode.TAG_MISSING, { path: `${path}.tagIds`, scope: 'mood', message: '记录引用了不存在的标签。' });
    }
    if (typeof raw.content !== 'string') fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.content`, scope: 'mood', message: '正文必须是字符串。' });
    if (raw.content.length > LIMITS.content) fail(ErrorCode.TEXT_TOO_LONG, { path: `${path}.content`, scope: 'mood', message: '正文过长。' });
    for (const key of ['createdAt', 'updatedAt']) {
      if (typeof raw[key] !== 'string' || !Number.isFinite(Date.parse(raw[key]))) {
        fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.${key}`, scope: 'mood', message: '记录时间格式不正确。' });
      }
    }
    return {
      id: raw.id,
      localDate: raw.localDate,
      time: raw.time,
      mood: raw.mood,
      tagIds: [...new Set(raw.tagIds)],
      content: raw.content,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
  return { version: SCHEMA_VERSION, tags, entries };
}

/**
 * 旧格式读取：必须显式声明 `version: 1`，未知字段一律拒绝。
 * 缺失版本不能被默认成 1，否则未标明版本的备份会被当作有效数据。
 */
export function readLegacy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(ErrorCode.SCHEMA_INVALID, { scope: 'mood', message: '不是有效的心情备份。' });
  if (!Object.prototype.hasOwnProperty.call(raw, 'version') || raw.version === undefined || raw.version === null) {
    fail(ErrorCode.UNSUPPORTED_VERSION, { scope: 'mood', message: '备份没有标明版本，无法确认格式，未读取。' });
  }
  return validate(raw);
}

export function writeLegacy(data) {
  const valid = validate(data);
  return { version: SCHEMA_VERSION, entries: valid.entries, tags: valid.tags };
}

export function tagsById(data) {
  return new Map(data.tags.map((tag) => [tag.id, tag]));
}

/** 一天多条：按本地时间与创建时间倒序（与原应用 `sorted` 一致）。 */
export function entriesOfDay(data, date) {
  return data.entries
    .filter((entry) => entry.localDate === date)
    .sort((a, b) => (b.localDate + b.time + b.createdAt).localeCompare(a.localDate + a.time + a.createdAt));
}

/**
 * 每日平均心情。空白表示未记录，不按 0 分计算。
 * 返回 `{ [date]: 平均分 }`，与旧 `daily` 完全一致。
 */
export function daily(entries) {
  const result = {};
  for (const entry of entries) {
    result[entry.localDate] ??= [];
    result[entry.localDate].push(entry.mood);
  }
  return Object.fromEntries(Object.entries(result).map(([date, moods]) => [date, moods.reduce((a, b) => a + b, 0) / moods.length]));
}

export function getDay(data, date) {
  const entries = entriesOfDay(data, date);
  const average = entries.length ? entries.reduce((sum, entry) => sum + entry.mood, 0) / entries.length : null;
  return { date, entries, average, count: entries.length };
}

/**
 * 标签稳定重映射：同名合并到同一 ID；外部 ID 被本机不同名称占用时分配新 ID，
 * 并把映射写回 `tagIdMap`，保证重复导入结果一致而不是每次随机。
 */
export function remapTags(data, incomingTags, { createId }) {
  const tags = data.tags.map((tag) => ({ ...tag }));
  const tagIdMap = new Map();
  const byName = new Map(tags.map((tag) => [tag.name, tag.id]));
  for (const incoming of incomingTags) {
    const existingId = byName.get(incoming.name);
    if (existingId) {
      tagIdMap.set(incoming.id, existingId);
      continue;
    }
    const occupied = tags.find((tag) => tag.id === incoming.id);
    if (!occupied) {
      tags.push({ id: incoming.id, name: incoming.name });
      byName.set(incoming.name, incoming.id);
      tagIdMap.set(incoming.id, incoming.id);
      continue;
    }
    const fresh = createId();
    tags.push({ id: fresh, name: incoming.name });
    byName.set(incoming.name, fresh);
    tagIdMap.set(incoming.id, fresh);
  }
  return { tags, tagIdMap };
}

/** 旧应用使用的宽松合并：重复 ID 保留本机内容，同名标签合并。 */
export function merge(current, incoming) {
  const out = structuredClone(current);
  const map = new Map();
  for (const tag of incoming.tags) {
    let target = out.tags.find((item) => item.name === tag.name);
    if (!target) {
      target = { id: (globalThis.crypto?.randomUUID?.() ?? `tag-${out.tags.length}-${Date.now()}`), name: tag.name };
      out.tags.push(target);
    }
    map.set(tag.id, target.id);
  }
  let added = 0;
  for (const entry of incoming.entries) {
    if (!out.entries.some((item) => item.id === entry.id)) {
      out.entries.push({ ...entry, tagIds: entry.tagIds.map((id) => map.get(id)) });
      added += 1;
    }
  }
  return { data: out, added };
}

export function stats(data) {
  const dates = new Set(data.entries.map((entry) => entry.localDate));
  const total = data.entries.length;
  return {
    entries: total,
    days: dates.size,
    average: total ? data.entries.reduce((sum, entry) => sum + entry.mood, 0) / total : null,
    tags: data.tags.length,
  };
}

/** 使用统计只按每条记录计算，每条权重相同。 */
export function distribution(entries) {
  return MOODS.map((mood) => {
    const count = entries.filter((entry) => entry.mood === mood.value).length;
    return { ...mood, count, ratio: entries.length ? count / entries.length : 0 };
  });
}

export function getRangeSummary(data, range) {
  const entries = data.entries.filter((entry) => entry.localDate >= range.start && entry.localDate <= range.end);
  const dates = new Set(entries.map((entry) => entry.localDate));
  const tagCounts = new Map();
  for (const entry of entries) {
    for (const id of entry.tagIds) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }
  return {
    start: range.start,
    end: range.end,
    entries: entries.length,
    days: dates.size,
    average: entries.length ? entries.reduce((sum, entry) => sum + entry.mood, 0) / entries.length : null,
    distribution: distribution(entries),
    tagCounts: [...tagCounts.entries()].map(([id, count]) => ({ id, name: data.tags.find((tag) => tag.id === id)?.name ?? '', count })).sort((a, b) => b.count - a.count),
    firstDate: entries.length ? entries.map((entry) => entry.localDate).sort()[0] : null,
  };
}

/**
 * 新增或覆盖一条记录。
 * 时间优先使用显式传入的 `now`，其次沿用记录里的时间，最后回落到可注入时钟。
 */
export function upsertEntry(data, entry, now = null) {
  const stamp = resolveNowIso(now ?? entry.updatedAt ?? null);
  return validate({
    ...data,
    entries: [...data.entries.filter((item) => item.id !== entry.id), {
      ...entry,
      createdAt: entry.createdAt ?? stamp,
      updatedAt: stamp,
    }],
  });
}

/**
 * 命令入口。
 * `now` 由调用方显式给出（ISO 串或 Date）；不传时回落到可注入时钟。
 * `createId` 必须注入，避免同一毫秒内两条新记录拿到同一个编号。
 */
export function applyCommand(data, command, { now = null, createId = null } = {}) {
  const { type, payload = {} } = command;
  switch (type) {
    case 'upsertEntry': {
      const stamp = resolveNowIso(payload.now ?? now);
      if (!createId) fail(ErrorCode.SCHEMA_INVALID, { scope: 'mood', message: '写入心情记录需要显式的编号生成函数。' });
      const existing = data.entries.find((item) => item.id === payload.entry?.id);
      const entry = {
        id: payload.entry?.id ?? createId(),
        localDate: payload.entry?.localDate,
        time: payload.entry?.time,
        mood: payload.entry?.mood,
        tagIds: [...new Set(payload.entry?.tagIds ?? [])],
        content: payload.entry?.content ?? '',
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      };
      return validate({ ...data, entries: [...data.entries.filter((item) => item.id !== entry.id), entry] });
    }
    case 'deleteEntry':
      return validate({ ...data, entries: data.entries.filter((item) => item.id !== payload.id) });
    case 'upsertTags':
      return validate({ ...data, tags: payload.tags });
    case 'setTagName':
      return validate({ ...data, tags: data.tags.map((tag) => (tag.id === payload.id ? { ...tag, name: payload.name } : tag)) });
    case 'deleteTag':
      return validate({
        ...data,
        tags: data.tags.filter((tag) => tag.id !== payload.id),
        entries: data.entries.map((entry) => ({ ...entry, tagIds: entry.tagIds.filter((id) => id !== payload.id) })),
      });
    default:
      fail(ErrorCode.SCHEMA_INVALID, { scope: 'mood', message: `未知命令 ${type}。` });
      return null;
  }
}

/** 简化版写入：旧应用 `persist` 使用，保持抛错语义。 */
export function persist(storage, data) {
  const validated = validate(data);
  storage.setItem(STORAGE_KEY, JSON.stringify(validated));
  return validated;
}

/**
 * 新建草稿。`now` 允许 Date 或 ISO 串；核心不读时钟，界面可以自己给当前时间。
 * 不传时间时只返回日期与空时间，由界面决定当前时刻。
 */
export function newEntryDraft(date = null, time = null, now = null) {
  const stamp = now instanceof Date ? now : now ? new Date(now) : null;
  const resolvedDate = date ?? (stamp && !Number.isNaN(stamp.getTime()) ? localDate(stamp) : null);
  const resolvedTime = time ?? (stamp && !Number.isNaN(stamp.getTime())
    ? `${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
    : null);
  return {
    id: null,
    localDate: resolvedDate,
    time: resolvedTime,
    mood: null,
    tagIds: [],
    content: '',
  };
}

export { LifeCalendarError, ErrorCode };
