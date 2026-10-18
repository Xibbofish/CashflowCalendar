/** Candidates become visible only after persistence succeeds. Stable React snapshots. */
import {ErrorCode, LifeCalendarError, describeError} from '../errors.js';
import {STORAGE_KEY, createEmptyEnvelope, validateEnvelope, applyModuleCommand, applyLifeCommand, applySettingsCommand} from '../compatibility/envelope.js';
import {createStorageManager, readStorage, probeStorage} from '../storage/local.js';
import {applyImport as resolveImport} from '../compatibility/import-plan.js';
import {localDate, validDate} from '../date/index.js';
export const STORE_STATUS=['loading','ready','empty','corrupt','unsupported','unavailable'];
export const IMPORT_RECOVERY_KEY='life-calendar:import-recovery:v1';
const id=(prefix)=>`${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

export function createAppStore({storage=null,lock=null,now=()=>new Date(),today=()=>localDate(now()),initialData=null}={}) {
 let manager=null,initialized=false,queue=Promise.resolve(),lastDraft=null;
 let state={status:'loading',data:null,revision:0,reading:null,readonly:false,pending:false,lastError:null,error:null,needsRefresh:false,externalChange:null,selectedDate:today(),today:today(),drafts:{},notices:[],dirty:false,lastSavedAt:null,storageKey:STORAGE_KEY,modules:null};
 let snapshot=Object.freeze({...state});const listeners=new Set();
 /** `modules` 是 `data.modules` 的稳定引用：界面可以只订阅快照，不必自己下钻。 */
 const moduleIds=()=>state.data?.modules??null;
 const emit=(patch={})=>{state={...state,...patch};snapshot=Object.freeze({...state,modules:moduleIds()});for(const fn of listeners)fn();return snapshot;};
 const recordError=(error)=>{const detail=describeError(error);emit({lastError:detail,error:detail});return error;};
 const unavailable=()=>({kind:'unavailable',raw:null,readonly:true,downloadable:false,code:ErrorCode.STORAGE_UNAVAILABLE,message:'当前浏览器不允许访问本机存储，无法保存改动。'});
 const loadReading=(reading)=>{
  const usable=reading.kind==='ok'||reading.kind==='empty';const data=reading.kind==='ok'?reading.data:createEmptyEnvelope({now:now()});
  return emit({status:reading.kind==='ok'?'ready':reading.kind,data,revision:data.revision,reading:usable?null:reading,readonly:!usable,needsRefresh:false,externalChange:null,dirty:false,lastError:usable?null:{code:reading.code,message:reading.message},error:usable?null:{code:reading.code,message:reading.message}});
 };
 const onStorage=(event)=>manager?.handleStorageEvent(event);
 function init(){
  if(initialized)return Promise.resolve(snapshot);initialized=true;
  if(!storage){loadReading(unavailable());return Promise.resolve(snapshot);}
  try{
   manager=createStorageManager({storage,lock:lock??globalThis.navigator?.locks??null,now,today,onExternalChange:(raw)=>emit({needsRefresh:true,externalChange:{raw},lastError:{code:ErrorCode.STORAGE_CONFLICT,message:'另一页面修改了数据。草稿仍保留，请重新加载或重新生成导入预览。'}})});
   const reading=manager.read();
   if(initialData&&reading.kind==='empty'){
    const data=validateEnvelope(initialData,{now:now(),today:today()});loadReading({...reading,kind:'ok',data,revision:data.revision});
   }else loadReading(reading);
   globalThis.window?.addEventListener('storage',onStorage);
  }catch(error){loadReading({...unavailable(),message:error?.message??unavailable().message});}
  return Promise.resolve(snapshot);
 }
 function ensureWritable(){
  if(state.readonly||!manager)throw new LifeCalendarError(state.status==='unsupported'?ErrorCode.STORAGE_FUTURE:state.status==='corrupt'?ErrorCode.STORAGE_CORRUPT:ErrorCode.STORAGE_UNAVAILABLE,{message:state.reading?.message??'当前存储不可写，输入仍保留。'});
  if(state.needsRefresh)throw new LifeCalendarError(ErrorCode.STORAGE_CONFLICT,{message:'另一页面修改了数据，请重新加载后再保存；当前输入仍保留。'});
 }
 function serial(task){
  const run=async()=>{await init();emit({pending:true});try{return await task();}catch(error){recordError(error);throw error;}finally{emit({pending:false});}};
  const result=queue.then(run,run);queue=result.catch(()=>{});return result;
 }
 async function persist(candidate,{baseRevision=state.revision,...meta}={}){
  ensureWritable();if(baseRevision!==state.revision)throw new LifeCalendarError(ErrorCode.IMPORT_STALE,{message:'数据修订已改变，导入预览过期，请重新生成。'});
  const next=validateEnvelope({...candidate,revision:state.revision+1,updatedAt:now().toISOString()},{now:now(),today:today()});
  try{
   const beforeWrite=meta.action==='import'
    ? ()=>storage.setItem(IMPORT_RECOVERY_KEY,JSON.stringify(validateEnvelope(state.data,{now:now(),today:today()})))
    : null;
   await manager.commit({envelope:next,baseRevision,beforeWrite});lastDraft=null;
   emit({status:'ready',data:next,revision:next.revision,reading:null,readonly:false,dirty:false,lastError:null,error:null,lastSavedAt:now().toISOString()});
   return {ok:true,saved:true,revision:next.revision,envelope:next,...meta};
  }catch(error){lastDraft=next;emit({dirty:true});throw error;}
 }
 const dispatchModule=(moduleId,command)=>serial(()=>{
  ensureWritable();const stamp=now().toISOString();const supplied={...command,payload:{...command.payload,now:stamp}};
  return persist(applyModuleCommand(state.data,moduleId,supplied,{now:stamp,today:today(),createId:()=>id(moduleId)}));
 });
 const dispatchSettings=(command)=>serial(()=>persist(applySettingsCommand(state.data,command)));
 const dispatchLife=(command)=>serial(()=>persist(applyLifeCommand(state.data,{...command,payload:{...command.payload,today:today()}},{now:now(),createId:()=>id('life')})));
 const reload=()=>serial(()=>{lastDraft=null;return loadReading(manager?manager.read():unavailable());});
 const clearStorage=()=>serial(async()=>{if(!manager)throw new LifeCalendarError(ErrorCode.STORAGE_UNAVAILABLE);if(storage.removeItem)storage.removeItem(IMPORT_RECOVERY_KEY);else storage.setItem(IMPORT_RECOVERY_KEY,'');await manager.clear();lastDraft=null;return loadReading(manager.read());});
 const applyImport=(preview,decisions={})=>serial(async()=>{
  ensureWritable();const plan=preview?.plan??preview;
  if(!plan||plan.baseRevision!==state.revision)throw new LifeCalendarError(ErrorCode.IMPORT_STALE,{message:'导入预览已过期，请重新生成；本次没有写入数据。'});
  const {envelope,stats}=resolveImport(plan,decisions,{current:state.data,now:now(),today:today()});return persist(envelope,{baseRevision:plan.baseRevision,stats,action:'import'});
 });
 const store={
  storageKey:STORAGE_KEY,init,initialize:init,getState:()=>snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  getImportRecovery(){const raw=storage?.getItem(IMPORT_RECOVERY_KEY);return raw?validateEnvelope(JSON.parse(raw),{now:now(),today:today()}):null;},
  runModuleCommand:dispatchModule,dispatchModule,applyModuleCommand:dispatchModule,dispatchSettings,applySettingsCommand:dispatchSettings,dispatchLife,applyLifeCommand:dispatchLife,
  setEnabledModule:(module,enabled)=>dispatchSettings({type:'setEnabledModule',payload:{module,enabled}}),
  setModuleOrder:(order)=>dispatchSettings({type:'setModuleOrder',payload:{order}}),
  setSetting:(key,value)=>serial(()=>{
   let next=applySettingsCommand(state.data,{type:'setSetting',payload:{key,value}});
   if(key==='defaultSign')next=applyModuleCommand(next,'zodiac',{type:'setSign',payload:{sign:value}},{now:now().toISOString()});return persist(next);
  }),
  saveSummary:(payload)=>dispatchLife({type:'saveSummary',payload}),deleteSummary:(date)=>dispatchLife({type:'deleteSummary',payload:{date}}),
  upsertSummaryTag:(tag)=>dispatchLife({type:'upsertSummaryTag',payload:typeof tag==='string'?{name:tag}:tag}),deleteSummaryTag:(tagId)=>dispatchLife({type:'deleteSummaryTag',payload:{id:tagId}}),
  selectDate(date){if(!validDate(date,{minYear:1000,maxYear:9999}))throw new LifeCalendarError(ErrorCode.DATE_INVALID);return emit({selectedDate:date});},
  refreshToday(){const next=today();if(next!==state.today)return emit({today:next});return snapshot;},
  reload,retryStorage:reload,clearStorage,applyImport,commitEnvelope:(envelope,meta)=>serial(()=>persist(envelope,meta)),
  setDraft(draft){return emit({drafts:{...state.drafts,[draft.form]:draft.value}});},clearDraft(form){const drafts={...state.drafts};delete drafts[form];return emit({drafts});},
  clearError(){return emit({lastError:null,error:null});},exportDraft:()=>lastDraft??state.data,handleStorageEvent:onStorage,getManager:()=>manager,
  concurrencyNote:()=>manager?.concurrencyNote??'本机存储不可用，当前不能保存。',probe:()=>storage?probeStorage(storage):{available:false,code:ErrorCode.STORAGE_UNAVAILABLE},
  dispose(){globalThis.window?.removeEventListener('storage',onStorage);listeners.clear();},
 };return store;
}
export function readOnlyState(storage,{now=()=>new Date(),today=()=>localDate(now())}={}){
 if(!storage)return{kind:'unavailable',raw:null,data:null,readonly:true,code:ErrorCode.STORAGE_UNAVAILABLE};return readStorage(storage,{now:now(),today:today()});
}
export {LifeCalendarError,ErrorCode,STORAGE_KEY};
