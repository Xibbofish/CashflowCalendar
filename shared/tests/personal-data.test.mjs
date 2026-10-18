import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPersonalData, exportModulePackage, validatePersonalData, extractModulePackage, combinePersonalData, personalDataToLegacy, exportAgentMarkdown } from '../compatibility/personal-data.js';
import { unifiedFixture, cashflowFixture, fakeStorage } from '../fixtures/index.js';
import { createEmptyEnvelope, validateEnvelope, MODULE_IDS, MODULE_REGISTRY, STORAGE_KEY } from '../compatibility/envelope.js';
import { normalizeIncoming } from '../compatibility/legacy-formats.js';
import { readIncomingJson } from '../compatibility/detect.js';
import { planImport, applyImport } from '../compatibility/import-plan.js';
import { createImportPreview } from '../app/import-flow.js';
const now = new Date('2026-10-18T08:00:00Z');
const options = { now, today: '2026-10-18' };
const envelope = () => validateEnvelope(unifiedFixture(), options);
const packet = () => exportPersonalData(envelope(), options);
const preview = (current, input) => createImportPreview(current, readIncomingJson({ text: JSON.stringify(input) }), options);
test('DATA-01/03 single cashflow package restores independent legacy payload exactly', () => {
  const full = packet();
  const single = extractModulePackage(full, 'cashflow', options);
  assert.deepEqual(single.modules.cashflow, full.modules.cashflow);
  assert.deepEqual(MODULE_REGISTRY.cashflow.readLegacy(personalDataToLegacy(single, 'cashflow')), full.modules.cashflow.data);
});
test('DATA-02 single import preserves all other modules, settings and life', () => {
  const current = envelope();
  const incoming = exportModulePackage('cashflow', { ...current.modules.cashflow.data, initialBalance: 731.25 }, options);
  const { plan } = preview(current, incoming);
  const { envelope: result } = applyImport(plan, { modules: { cashflow: 'replace' } }, { current, ...options });
  assert.equal(result.modules.cashflow.data.initialBalance, 731.25);
  for (const id of MODULE_IDS.filter(id => id !== 'cashflow')) assert.deepEqual(result.modules[id], current.modules[id]);
  assert.deepEqual(result.life, current.life); assert.deepEqual(result.settings, current.settings);
});
test('DATA-04 combine and split preserve identical canonical payloads', () => {
  const full = packet();
  const singles = MODULE_IDS.map(id => extractModulePackage(full, id, options));
  const combined = combinePersonalData(singles, options);
  assert.deepEqual(combined.modules, full.modules);
  assert.equal(combined.workspace, undefined);
  assert.throws(() => combinePersonalData([singles[0], singles[0]], options));
});
test('workspace roundtrip retains summaries/settings and explicit full replace restores them', () => {
  const input = packet(); const current = createEmptyEnvelope(options);
  const { plan } = preview(current, input);
  const result = applyImport(plan, { mode: 'full-replace', modules: Object.fromEntries(MODULE_IDS.map(id => [id, 'replace'])) }, { current, ...options }).envelope;
  assert.deepEqual(result.life, envelope().life); assert.deepEqual(result.settings, envelope().settings);
  assert.throws(() => validatePersonalData({ ...extractModulePackage(input, 'cashflow'), workspace: input.workspace }));
});
test('DATA-05 legacy cashflow remains accepted with critical values unchanged', () => {
  const legacy = cashflowFixture(); const normalized = normalizeIncoming(legacy, { format: 'cashflow', ...options });
  assert.equal(normalized.modules.cashflow.initialBalance, legacy.initialBalance);
  assert.deepEqual(MODULE_REGISTRY.cashflow.writeLegacy(normalized.modules.cashflow), legacy);
});
test('DATA-06 repeat import is identical and skipping selected module changes no module data', () => {
  const current = envelope(); const { plan } = preview(current, packet());
  assert.equal(plan.modules.cashflow.conflicts.length, 0);
  const result = applyImport(plan, { modules: Object.fromEntries(MODULE_IDS.map(id => [id, 'skip'])), life: 'keep' }, { current, ...options }).envelope;
  assert.deepEqual(result.modules, current.modules);
});
test('DATA-07 invalid package, unknown fields/version and IDs rejected before writes', () => {
  for (const mutate of [p => p.formatVersion = '2.0.0', p => p.extra = true, p => p.modules.cashflow.schemaVersion = 2, p => delete p.modules.cashflow.data, p => p.modules.fake = p.modules.cashflow, p => p.modules.cashflow.data.events.push(p.modules.cashflow.data.events[0])]) {
    const p = packet(); mutate(p); assert.throws(() => preview(envelope(), p));
  }
  assert.throws(() => readIncomingJson({text: '{broken'}));
  const normalized = normalizeIncoming(packet(), { format: 'personal-data', ...options });
  normalized.modules.cashflow.initialBalance = NaN;
  assert.throws(() => planImport(envelope(), normalized, options));
  assert.throws(() => preview(envelope(), {__normalized: true, modules: packet().modules}));
});
test('DATA-10 Markdown includes dictionary, rules, raw JSON and irreversible redaction notice', () => {
  const p = packet(); const plain = exportAgentMarkdown(p); const redacted = exportAgentMarkdown(p, {redact:true});
  for (const term of ['数据字段词典', '计算逻辑', '```json', 'skippedDates', 'YYYY-MM-DD', '浮点']) assert.ok(plain.includes(term));
  assert.ok(plain.includes(JSON.stringify(p, null, 2))); assert.ok(redacted.includes('不能用于无损恢复'));
  assert.ok(!redacted.includes('虚构：早上的风很轻。'));
});
test('DATA-11 dates, simulation, recurring settings and floating amounts preserved', () => {
  const source = envelope(); const result = personalDataToLegacy(packet(), 'cashflow');
  assert.deepEqual(result, MODULE_REGISTRY.cashflow.writeLegacy(source.modules.cashflow.data));
});
test('DATA-12 missing dependencies and illegal extraction fail explicitly', () => {
  const p = packet(); p.modules.cashflow.dependencies = ['mood']; validatePersonalData(p);
  assert.throws(() => extractModulePackage(p, 'cashflow'));
  delete p.modules.mood; delete p.workspace; assert.throws(() => validatePersonalData(p));
});
import { createStorageManager } from '../storage/local.js';
import { readFileSync } from 'node:fs';
test('DATA-08 standard import quota failure leaves exact original storage bytes', async () => {
  const original = JSON.stringify(envelope()); let raw = original;
  const storage = { getItem: () => raw, setItem: () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; } };
  const manager = createStorageManager({storage, now: () => now}); manager.read();
  const current = envelope(); const { plan } = preview(current, packet());
  const next = applyImport(plan, {modules:Object.fromEntries(MODULE_IDS.map(id => [id,'replace']))}, {current,...options}).envelope;
  await assert.rejects(() => manager.commit({envelope:next, baseRevision:current.revision}));
  assert.equal(raw, original);
});
test('DATA-09 transport stays pure under network spies and never modifies source envelope', () => {
  const source = envelope(); const before = JSON.stringify(source); const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network'); };
  try { const p = exportPersonalData(source, options); exportAgentMarkdown(p); validatePersonalData(p); personalDataToLegacy(p,'cashflow'); }
  finally { globalThis.fetch = previous; }
  assert.equal(JSON.stringify(source),before);
  const code = readFileSync(new URL('../compatibility/personal-data.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|localStorage)\s*\(/);
});
test('review: package timestamps reject normalized impossible dates and require zone', () => {
  for (const value of ['2026-02-30T12:00:00Z','2026-04-31T12:00:00Z','2026-10-18T24:00:00Z','2026-10-18T12:00:00','2026-13-01T12:00:00Z']) {
    const p=packet();p.exportedAt=value;assert.throws(()=>validatePersonalData(p));
  }
  const p=packet();p.exportedAt='2024-02-29T12:00:00+08:00';validatePersonalData(p);
});
test('review: versions use numeric semantic comparison and reject malformed markers', () => {
  for (const value of ['2.0.0','10.0.0','1.10.0','1.0.10']) {
    const p=packet();p.formatVersion=value;assert.throws(()=>validatePersonalData(p),e=>e.code==='E_FUTURE_VERSION');
  }
  for (const value of ['01.0.0','1.0','garbage',null,{},1]) {
    const p=packet();p.formatVersion=value;assert.throws(()=>validatePersonalData(p),e=>e.code==='E_UNSUPPORTED_VERSION');
  }
});
test('review: workspace cannot silently default a missing field and poison keys rejected', () => {
  for (const key of Object.keys(packet().workspace)) {
    const p=packet();delete p.workspace[key];assert.throws(()=>validatePersonalData(p));
  }
  const p=packet();p.producer.app='x'.repeat(101);assert.throws(()=>validatePersonalData(p));
  const poisoned=JSON.parse(JSON.stringify(packet()).replace('"producer": {','"__proto__": {}, "producer": {'));
  // JSON stringify without spaces needs a separate explicit own property.
  Object.defineProperty(poisoned.modules,'__proto__',{value:{},enumerable:true});assert.throws(()=>validatePersonalData(poisoned));
  assert.equal({}.polluted,undefined);
});
import { createAppStore, IMPORT_RECOVERY_KEY } from '../app/store.js';
function recoveryStorage() {
  const values = new Map([[STORAGE_KEY,JSON.stringify(envelope())],[IMPORT_RECOVERY_KEY,JSON.stringify(envelope())]]);
  const calls=[];let failure=null;
  return {values,calls,fail(key){failure=key;},getItem:key=>values.get(key)??null,setItem(key,value){calls.push(key);if(key===failure){const error=new Error('full');error.name='QuotaExceededError';throw error;}values.set(key,value);}};
}
const replacement = current => { const p=packet();p.modules.cashflow.data.initialBalance=2929;return preview(current,p); };
const replaceAll = {modules:Object.fromEntries(MODULE_IDS.map(id=>[id,'replace']))};
test('recovery: successful import snapshots complete previous envelope before main write', async()=>{
  const storage=recoveryStorage();const store=createAppStore({storage,now:()=>now,today:()=>options.today});await store.init();
  const current=store.getState().data;await store.applyImport(replacement(current),replaceAll);
  assert.deepEqual(store.getImportRecovery(),current);
  assert.deepEqual(storage.calls,[IMPORT_RECOVERY_KEY,STORAGE_KEY]);
  assert.equal(store.getState().data.modules.cashflow.data.initialBalance,2929);
});
test('recovery: quota failure on recovery or main preserves main data and revision', async()=>{
  for(const key of [IMPORT_RECOVERY_KEY,STORAGE_KEY]){
    const storage=recoveryStorage();const original=storage.getItem(STORAGE_KEY);const store=createAppStore({storage,now:()=>now,today:()=>options.today});await store.init();const revision=store.getState().revision;
    storage.fail(key);await assert.rejects(()=>store.applyImport(replacement(store.getState().data),replaceAll), e=>e.code==='E_STORAGE_QUOTA');
    assert.equal(storage.getItem(STORAGE_KEY),original);assert.equal(store.getState().revision,revision);assert.ok(store.getState().error);
    assert.ok(storage.getItem(IMPORT_RECOVERY_KEY));
  }
});
test('recovery: concurrent external write while waiting for lock does not overwrite recovery',async()=>{
  const storage=recoveryStorage();let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const lock={request:async(name,opts,callback)=>{entered();await new Promise(resolve=>{release=resolve;});return callback();}};
  const store=createAppStore({storage,lock,now:()=>now,today:()=>options.today});await store.init();
  const previousRecovery=storage.getItem(IMPORT_RECOVERY_KEY);const task=store.applyImport(replacement(store.getState().data),replaceAll);
  await waiting;assert.equal(storage.calls.length,0);
  const external=envelope();external.revision+=1;external.modules.cashflow.data.initialBalance=3939;const raw=JSON.stringify(external);storage.values.set(STORAGE_KEY,raw);
  release();await assert.rejects(()=>task,e=>e.code==='E_STORAGE_CONFLICT');
  assert.equal(storage.getItem(STORAGE_KEY),raw);assert.equal(storage.getItem(IMPORT_RECOVERY_KEY),previousRecovery);assert.equal(storage.calls.length,0);
});
test('recovery: malformed or future recovery is rejected without touching main storage',async()=>{
  const storage=recoveryStorage();const original=storage.getItem(STORAGE_KEY);const store=createAppStore({storage,now:()=>now,today:()=>options.today});await store.init();
  storage.values.set(IMPORT_RECOVERY_KEY,'{broken');assert.throws(()=>store.getImportRecovery());
  const future=envelope();future.schemaVersion=2;storage.values.set(IMPORT_RECOVERY_KEY,JSON.stringify(future));assert.throws(()=>store.getImportRecovery());
  assert.equal(storage.getItem(STORAGE_KEY),original);assert.equal(storage.calls.length,0);
});
test('review: dependency cannot be lost through module selection at commit',()=>{
  const p=packet();p.modules.cashflow.dependencies=['mood'];const current=envelope();const {plan}=preview(current,p);
  assert.throws(()=>applyImport(plan,{modules:{cashflow:'replace',mood:'skip'}},{current,...options}),/依赖模块/);
  applyImport(plan,{modules:{cashflow:'skip',mood:'skip'}},{current,...options});
  applyImport(plan,{modules:{cashflow:'replace',mood:'replace'}},{current,...options});
});
test('explicit clear removes both personal records and import recovery snapshot',async()=>{
  const storage=recoveryStorage();storage.removeItem=key=>storage.values.delete(key);
  const store=createAppStore({storage,now:()=>now,today:()=>options.today});await store.init();
  await store.clearStorage();
  assert.equal(storage.getItem(STORAGE_KEY),null);assert.equal(storage.getItem(IMPORT_RECOVERY_KEY),null);assert.equal(store.getImportRecovery(),null);
});
