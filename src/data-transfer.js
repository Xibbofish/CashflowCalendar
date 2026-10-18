/** Local-only transfer: preview never writes, replacement saves a recovery point first. */
import { parseBackup, STORAGE_KEY, RECOVERY_KEY, writeState, readState } from './storage.js';
import { PERSONAL_DATA_FORMAT, validatePersonalData, personalDataToLegacy, exportModulePackage } from '../shared/compatibility/personal-data.js';
import { readLegacy } from '../shared/modules/cashflow/model.js';
export { RECOVERY_KEY };
export const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const clone = value => JSON.parse(JSON.stringify(value));
export function createCashflowPackage(state) {
  return exportModulePackage('cashflow', readLegacy(state), { producer: { app: 'cashflow', appVersion: '0.1.0' } });
}
export function prepareCashflowImport(text, currentState, { raw = null, today = null } = {}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('请选择不超过 15 MB 的 JSON 备份。');
  const input = JSON.parse(text);
  let legacy = input, ignoredModules = [], workspaceIgnored = false;
  if (input?.format === PERSONAL_DATA_FORMAT) {
    const valid = validatePersonalData(input, { today });
    legacy = personalDataToLegacy(valid, 'cashflow', { today });
    ignoredModules = Object.keys(valid.modules).filter(id => id !== 'cashflow');
    workspaceIgnored = Boolean(valid.workspace);
  }
  const data = parseBackup(JSON.stringify(legacy));
  const before = parseBackup(JSON.stringify(currentState));
  return { data: clone(data), before: clone(before), baseState: JSON.stringify(before), baseRaw: raw,
    source: input?.format === PERSONAL_DATA_FORMAT ? '标准数据包' : '旧版现金流备份', ignoredModules, workspaceIgnored,
    unchanged: JSON.stringify(data) === JSON.stringify(before),
    counts: { current: before.events.length + before.simulationEvents.length, real: data.events.length, simulation: data.simulationEvents.length } };
}
export function commitCashflowImport(preview, currentState, storage = globalThis.localStorage) {
  if (!preview || JSON.stringify(parseBackup(JSON.stringify(currentState))) !== preview.baseState) throw new Error('预览后数据已发生变化，请重新选择文件并核对。');
  if (readState(storage).readonly) throw new Error('本机数据当前不可写，未导入。请先保存原始数据。');
  if (storage.getItem(STORAGE_KEY) !== preview.baseRaw) throw new Error('其他页面已修改本机数据，请刷新后重新预览。');
  const data = parseBackup(JSON.stringify(preview.data));
  if (JSON.stringify(data) === preview.baseState) return data;
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify({ format: 'cashflow-import-recovery', version: 1, savedAt: new Date().toISOString(), data: parseBackup(JSON.stringify(currentState)) }));
  } catch {
    throw new Error('无法保存导入前恢复点，已停止替换。请先下载当前数据备份，并检查浏览器存储空间与权限。');
  }
  writeState(data, storage);
  return data;
}
export function readCashflowRecovery(storage = globalThis.localStorage) {
  const raw = storage.getItem(RECOVERY_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (value.format !== 'cashflow-import-recovery' || value.version !== 1) throw new Error('恢复点版本无法识别，未读取。');
  return { savedAt: value.savedAt, data: parseBackup(JSON.stringify(value.data)) };
}
