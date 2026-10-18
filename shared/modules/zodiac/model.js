/**
 * 星笺模块：模型、内容库、生成、命令、旧格式读写。
 *
 * 旧数据形态（备份 `schemaVersion:1, sign, saved`，存储键 `zodiac-journal:v1`）：
 * saved = { id: `${date}:${sign}`, cardSnapshot, note, createdAt, updatedAt }
 *
 * 不变量：
 * - 同一日同一星座稳定生成同一张卡片（内容库版本固定时）。
 * - 收藏保留当时的完整快照；编辑感想不会更新旧快照。
 * - 日期范围 2000—2100，收敛在用户日历日期上。
 */
import { LifeCalendarError, ErrorCode, fail } from '../../errors.js';
import { ZODIAC_MAX_YEAR, ZODIAC_MIN_YEAR, dayNumber, resolveNowIso } from '../../date/index.js';
import { VERSION, care, colors, overall, relationship, signs, work } from './content.js';

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'zodiac-journal:v1';
export const SOURCE_TYPE = 'original-rotation';
export const LIMITS = {
  saved: 5000,
  text: 2000,
  short: 200,
  voice: 500,
  color: 100,
  contentVersion: 100,
  note: 5000,
};
export const SAVED_FIELDS = ['id', 'cardSnapshot', 'note', 'createdAt', 'updatedAt'];
export const CARD_FIELDS = ['date', 'sign', 'contentVersion', 'sourceType', 'title', 'body', 'voice', 'sections', 'color', 'hex'];
export const SECTION_FIELDS = ['relationship', 'work', 'care'];
export const DATA_FIELDS = ['schemaVersion', 'sign', 'saved'];

export { signs, VERSION };

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, sign: 'aries', saved: [] };
}

export function signOf(id) {
  return signs.find((sign) => sign.id === id) ?? null;
}

export function isValidSign(id) {
  return signs.some((sign) => sign.id === id);
}

/** 星笺日期校验：格式、真实性与 2000—2100 范围。 */
export function zodiacDayNumber(date) {
  return dayNumber(date, { minYear: ZODIAC_MIN_YEAR, maxYear: ZODIAC_MAX_YEAR });
}

/**
 * 未知字段处理（统一存储、统一备份、旧格式读取一律拒绝）：
 * 拒绝而不是保留，避免统一恢复时静默丢字段或语义漂移。
 */
function checkUnknownFields(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail(ErrorCode.UNKNOWN_FIELD, { path: `${path}.${key}`, scope: 'zodiac', message: `${path} 包含不认识的字段：${key}` });
  }
}

function checkString(value, max, path) {
  if (typeof value !== 'string' || value.length > max) fail(ErrorCode.TEXT_TOO_LONG, { path, scope: 'zodiac', message: `${path} 必须是字符串且不超过 ${max} 个字符。` });
  return value;
}

/**
 * 生成某日某星座的星笺。纯函数：不读时钟、不读存储，同一输入结果稳定。
 */
export function dailyCard(date, sign) {
  const index = signs.findIndex((item) => item.id === sign);
  if (index < 0) fail(ErrorCode.ENUM_INVALID, { scope: 'zodiac', message: '没有这个星座的内容' });
  const day = zodiacDayNumber(date);
  if (!overall.length || !relationship.length || !work.length || !care.length) {
    fail(ErrorCode.SCHEMA_INVALID, { scope: 'zodiac', message: '内容库暂不可用' });
  }
  const [title, body] = overall[(day + index * 7) % overall.length];
  const [color, hex] = colors[(day + index * 3) % colors.length];
  return {
    date,
    sign,
    contentVersion: VERSION,
    sourceType: SOURCE_TYPE,
    title,
    body,
    voice: signs[index].voice,
    sections: {
      relationship: relationship[(day + index * 5) % relationship.length],
      work: work[(day + index * 11) % work.length],
      care: care[(day + index * 3) % care.length],
    },
    color,
    hex,
  };
}

export function cardId(date, sign) {
  return `${date}:${sign}`;
}

export function validateCard(input, path = 'card') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(ErrorCode.SNAPSHOT_INVALID, { path, scope: 'zodiac', message: '卡片内容无效' });
  checkUnknownFields(input, CARD_FIELDS, path);
  zodiacDayNumber(input.date);
  if (!isValidSign(input.sign)) fail(ErrorCode.ENUM_INVALID, { path: `${path}.sign`, scope: 'zodiac', message: '收藏星座无效' });
  if (!input.sections || typeof input.sections !== 'object') fail(ErrorCode.SNAPSHOT_INVALID, { path: `${path}.sections`, scope: 'zodiac', message: '卡片内容无效' });
  checkUnknownFields(input.sections, SECTION_FIELDS, `${path}.sections`);
  if (!/^#[0-9a-fA-F]{6}$/.test(input.hex ?? '')) fail(ErrorCode.SNAPSHOT_INVALID, { path: `${path}.hex`, scope: 'zodiac', message: '卡片颜色无效' });
  if (input.sourceType !== SOURCE_TYPE) fail(ErrorCode.SNAPSHOT_INVALID, { path: `${path}.sourceType`, scope: 'zodiac', message: '卡片来源无效' });
  return {
    date: input.date,
    sign: input.sign,
    contentVersion: checkString(input.contentVersion, LIMITS.contentVersion, `${path}.contentVersion`),
    sourceType: input.sourceType,
    title: checkString(input.title, LIMITS.short, `${path}.title`),
    body: checkString(input.body, LIMITS.text, `${path}.body`),
    voice: checkString(input.voice, LIMITS.voice, `${path}.voice`),
    sections: {
      relationship: checkString(input.sections.relationship, LIMITS.text, `${path}.sections.relationship`),
      work: checkString(input.sections.work, LIMITS.text, `${path}.sections.work`),
      care: checkString(input.sections.care, LIMITS.text, `${path}.sections.care`),
    },
    color: checkString(input.color, LIMITS.color, `${path}.color`),
    hex: input.hex,
  };
}

export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(ErrorCode.SCHEMA_INVALID, { scope: 'zodiac', message: '不是有效的星笺备份' });
  checkUnknownFields(input, DATA_FIELDS, 'zodiac');
  if (input.schemaVersion !== SCHEMA_VERSION) {
    const code = typeof input.schemaVersion === 'number' && input.schemaVersion > SCHEMA_VERSION ? ErrorCode.FUTURE_VERSION : ErrorCode.UNSUPPORTED_VERSION;
    fail(code, { path: 'zodiac.schemaVersion', scope: 'zodiac', message: `星笺备份版本 ${input.schemaVersion} 不受支持。` });
  }
  if (!isValidSign(input.sign)) fail(ErrorCode.ENUM_INVALID, { path: 'zodiac.sign', scope: 'zodiac', message: '不是有效的星笺备份' });
  if (!Array.isArray(input.saved) || input.saved.length > LIMITS.saved) fail(ErrorCode.LIMIT_EXCEEDED, { scope: 'zodiac', message: '不是有效的星笺备份' });
  const ids = new Set();
  const saved = input.saved.map((raw, index) => {
    const path = `zodiac.saved[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(ErrorCode.SNAPSHOT_INVALID, { path, scope: 'zodiac', message: '收藏记录无效' });
    checkUnknownFields(raw, SAVED_FIELDS, path);
    const cardSnapshot = validateCard(raw.cardSnapshot, `${path}.cardSnapshot`);
    const id = cardId(cardSnapshot.date, cardSnapshot.sign);
    if (raw.id !== id || ids.has(id)) fail(ErrorCode.ID_DUPLICATE, { path: `${path}.id`, scope: 'zodiac', message: '收藏编号重复或无效' });
    ids.add(id);
    for (const key of ['createdAt', 'updatedAt']) {
      if (typeof raw[key] !== 'string' || !Number.isFinite(Date.parse(raw[key]))) {
        fail(ErrorCode.SCHEMA_INVALID, { path: `${path}.${key}`, scope: 'zodiac', message: '记录时间无效' });
      }
    }
    return {
      id,
      cardSnapshot,
      note: checkString(raw.note, LIMITS.note, `${path}.note`),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
  return { schemaVersion: SCHEMA_VERSION, sign: input.sign, saved };
}

/**
 * 旧格式读取：必须显式声明 `schemaVersion: 1`，未知字段一律拒绝。
 * 缺失版本不能被默认成 1，否则未标明版本的备份会被当作有效数据。
 */
export function readLegacy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(ErrorCode.SCHEMA_INVALID, { scope: 'zodiac', message: '不是有效的星笺备份' });
  if (!Object.prototype.hasOwnProperty.call(raw, 'schemaVersion') || raw.schemaVersion === undefined || raw.schemaVersion === null) {
    fail(ErrorCode.UNSUPPORTED_VERSION, { scope: 'zodiac', message: '备份没有标明版本，无法确认格式，未读取。' });
  }
  return validate(raw);
}

export function writeLegacy(data) {
  const valid = validate(data);
  return { schemaVersion: SCHEMA_VERSION, sign: valid.sign, saved: valid.saved };
}

export function recordOf(data, date, sign) {
  return data.saved.find((record) => record.id === cardId(date, sign)) ?? null;
}

export function recordById(data, id) {
  return data.saved.find((record) => record.id === id) ?? null;
}

/**
 * 保存收藏或感想。旧快照不会被新生成的内容覆盖（`upsert` 行为）。
 * `now` 优先使用调用方显式给出的时间；旧应用不传时回落到可注入时钟（见 date/index.js）。
 */
export function upsert(data, card, note, now = null) {
  const id = cardId(card.date, card.sign);
  const old = recordOf(data, card.date, card.sign);
  const stamp = resolveNowIso(now);
  const record = {
    id,
    cardSnapshot: old?.cardSnapshot ?? structuredClone(card),
    note: String(note ?? '').slice(0, LIMITS.note),
    createdAt: old?.createdAt ?? stamp,
    updatedAt: stamp,
  };
  return { ...data, saved: [...data.saved.filter((item) => item.id !== id), record] };
}

/**
 * 单日星笺视图。
 * `now` 允许 Date 或 ISO 时间串；核心不读时钟，视图只把归一化后的时间原样带出。
 */
export function getDay(data, date, now = null) {
  const card = dailyCard(date, data.sign);
  const record = recordOf(data, date, data.sign);
  return {
    date,
    sign: data.sign,
    card,
    /** 已收藏使用原始快照；未收藏使用当前内容库。 */
    source: record ? 'snapshot' : 'library',
    snapshot: record?.cardSnapshot ?? null,
    note: record?.note ?? '',
    saved: Boolean(record),
    savedAt: record?.updatedAt ?? null,
    now: normalizeTimestamp(now),
  };
}

/** Date → ISO 串；字符串原样返回；空值回落到可注入时钟。 */
export function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return resolveNowIso(null);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? resolveNowIso(null) : value.toISOString();
  return typeof value === 'string' ? value : resolveNowIso(null);
}

export function getRangeSummary(data, range) {
  const saved = data.saved.filter((record) => record.cardSnapshot.date >= range.start && record.cardSnapshot.date <= range.end);
  return {
    start: range.start,
    end: range.end,
    saved: saved.length,
    withNote: saved.filter((record) => record.note.trim()).length,
    signs: [...new Set(saved.map((record) => record.cardSnapshot.sign))],
    contentVersions: [...new Set(saved.map((record) => record.cardSnapshot.contentVersion))],
  };
}

/**
 * 命令入口。
 * `now` 是调用方显式给出的时间（ISO 串或 Date）；核心不读时钟，测试可完全注入。
 */
export function applyCommand(data, command, { now = null } = {}) {
  const stamp = normalizeTimestamp(now);
  const { type, payload = {} } = command;
  switch (type) {
    case 'setSign':
      if (!isValidSign(payload.sign)) fail(ErrorCode.ENUM_INVALID, { scope: 'zodiac', message: '没有这个星座的内容' });
      return { ...data, sign: payload.sign };
    case 'saveCard': {
      if (data.saved.length >= LIMITS.saved && !recordOf(data, payload.card.date, payload.card.sign)) {
        fail(ErrorCode.LIMIT_EXCEEDED, { scope: 'zodiac', message: `收藏已达 ${LIMITS.saved} 封，请先导出并整理。` });
      }
      return validate(upsert(data, payload.card, payload.note ?? '', stamp));
    }
    case 'updateNote': {
      const record = recordById(data, payload.id);
      if (!record) fail(ErrorCode.SCHEMA_INVALID, { scope: 'zodiac', message: '找不到这封收藏。' });
      return validate({
        ...data,
        saved: data.saved.map((item) => (item.id === payload.id ? { ...item, note: String(payload.note ?? '').slice(0, LIMITS.note), updatedAt: stamp ?? item.updatedAt } : item)),
      });
    }
    case 'deleteCard':
      return validate({ ...data, saved: data.saved.filter((record) => record.id !== payload.id) });
    default:
      fail(ErrorCode.SCHEMA_INVALID, { scope: 'zodiac', message: `未知命令 ${type}。` });
      return null;
  }
}

export { LifeCalendarError, ErrorCode };
