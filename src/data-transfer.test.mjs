import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCashflowImport, commitCashflowImport, readCashflowRecovery, createCashflowPackage, RECOVERY_KEY } from './data-transfer.js';
import { STORAGE_KEY, DEFAULT_STATE } from './storage.js';
const current=()=>structuredClone(DEFAULT_STATE);
function storage(data=current(), failKey=null) {
  const map=new Map([[STORAGE_KEY,JSON.stringify(data)]]);
  return {map,getItem:key=>map.get(key)??null,setItem(key,value){if(key===failKey)throw new DOMException('full','QuotaExceededError');map.set(key,String(value));}};
}
test('canonical cashflow roundtrip preserves its native fields and unchanged import writes nothing',()=>{
 const before=current(),store=storage(before),raw=store.getItem(STORAGE_KEY);
 const packet=createCashflowPackage(before);
 const preview=prepareCashflowImport(JSON.stringify(packet),before,{raw});
 assert.deepEqual(preview.data,before);assert.equal(preview.unchanged,true);
 assert.deepEqual(commitCashflowImport(preview,before,store),before);assert.equal(store.getItem(RECOVERY_KEY),null);
});
test('preview does not write, replacement persists recovery before main data',()=>{
 const before=current(),incoming={...current(),initialBalance:789.12},store=storage(before),raw=store.getItem(STORAGE_KEY);
 const preview=prepareCashflowImport(JSON.stringify(incoming),before,{raw});
 assert.equal(store.getItem(STORAGE_KEY),raw);assert.equal(store.getItem(RECOVERY_KEY),null);
 commitCashflowImport(preview,before,store);
 assert.deepEqual(JSON.parse(store.getItem(STORAGE_KEY)),incoming);assert.deepEqual(readCashflowRecovery(store).data,before);
});
test('snapshot quota failure prevents replacing main data',()=>{
 const before=current(),store=storage(before,RECOVERY_KEY),raw=store.getItem(STORAGE_KEY);
 const preview=prepareCashflowImport(JSON.stringify({...before,initialBalance:44}),before,{raw});
 assert.throws(()=>commitCashflowImport(preview,before,store));assert.equal(store.getItem(STORAGE_KEY),raw);
});
test('main-key failure leaves prior data and a readable recovery point',()=>{
 const before=current(),store=storage(before,STORAGE_KEY),raw=store.getItem(STORAGE_KEY);
 const preview=prepareCashflowImport(JSON.stringify({...before,initialBalance:44}),before,{raw});
 assert.throws(()=>commitCashflowImport(preview,before,store));assert.equal(store.getItem(STORAGE_KEY),raw);assert.deepEqual(readCashflowRecovery(store).data,before);
});
test('changed browser or in-memory state rejects stale preview',()=>{
 const before=current(),store=storage(before),raw=store.getItem(STORAGE_KEY);
 const preview=prepareCashflowImport(JSON.stringify({...before,initialBalance:44}),before,{raw});
 assert.throws(()=>commitCashflowImport(preview,{...before,initialBalance:5},store));
 store.map.set(STORAGE_KEY,JSON.stringify({...before,initialBalance:1}));
 assert.throws(()=>commitCashflowImport(preview,before,store));assert.equal(store.getItem(RECOVERY_KEY),null);
});
test('unknown and future input fail before preview and before storage writes',()=>{
 const before=current(),packet=createCashflowPackage(before);
 assert.throws(()=>prepareCashflowImport(JSON.stringify({...before,surprise:true}),before));
 assert.throws(()=>prepareCashflowImport(JSON.stringify({...packet,formatVersion:'9.0.0'}),before));
 assert.throws(()=>createCashflowPackage({...before,schemaVersion:9}));
});
