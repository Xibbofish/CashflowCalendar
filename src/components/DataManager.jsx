import { useState, useRef } from 'react';
import { createMarkdownExport } from '../markdown-export.js';
import { STORAGE_KEY } from '../storage.js';
import { prepareCashflowImport, readCashflowRecovery, createCashflowPackage, MAX_IMPORT_BYTES } from '../data-transfer.js';
import { exportAgentMarkdown } from '../../shared/compatibility/personal-data.js';

const MODULE_NAMES = { cashflow: '现金流', mood: '心情', period: '身体', zodiac: '星笺' };
function download(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const date = () => new Date().toLocaleDateString('sv-SE');

export default function DataManager({ state, currentBalance, onImport, onAdjustBalance, onClear }) {
  const [adjustAmount, setAdjustAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [redact, setRedact] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const run = fn => { try { fn(); setError(null); } catch (caught) { setError(caught?.message || '操作失败，原有数据未改动。'); } };
  const standardPackage = () => createCashflowPackage(state);
  const exportStandard = () => run(() => {
    download(JSON.stringify(standardPackage(), null, 2), `cashflow-standard-${date()}.json`);
    setMessage('标准单功能包已交给浏览器下载，可在现金流或生活日历中预览恢复。');
  });
  const exportLegacy = () => run(() => {
    download(JSON.stringify(state, null, 2), `cashflow-backup-${date()}.json`);
    setMessage('旧版 JSON 备份已交给浏览器下载。');
  });
  const exportMarkdown = () => run(() => {
    download(exportAgentMarkdown(standardPackage(), { redact }), `cashflow-agent-${redact ? 'redacted-' : ''}${date()}.md`, 'text/markdown');
    setMessage(redact ? '已生成脱敏阅读稿；金额和日期仍包含在内，不可用于完整恢复。' : 'Agent Markdown 已生成，含原始数据与字段说明；恢复请使用 JSON。');
  });
  const exportAnalysis = () => run(() => {
    const result = createMarkdownExport(state); download(result.markdown, result.filename, 'text/markdown');
    setMessage('原有完整计划与预测分析 Markdown 已交给浏览器下载。');
  });
  const handleImport = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setPreview(null); setError(null); setMessage('');
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('文件超过 15 MB，未读取。');
      const raw = localStorage.getItem(STORAGE_KEY);
      const result = prepareCashflowImport(await file.text(), state, { raw });
      setPreview({ ...result, filename: file.name });
    } catch (caught) { setError(caught?.message || '文件无法读取，未导入。'); }
    finally { setBusy(false); }
  };
  const confirmImport = () => run(() => {
    if (!preview || !window.confirm(`将用文件中的 ${preview.counts.real + preview.counts.simulation} 条计划替换当前 ${preview.counts.current} 条计划及初始余额。导入前会保存本机恢复点。确定继续？`)) return;
    onImport(preview);
    setMessage(preview.unchanged ? '数据内容相同，没有重复新增或替换。' : '导入成功；已保存本机导入前恢复点，可下载后重新导入恢复。');
    setPreview(null);
  });
  const downloadRecovery = () => run(() => {
    const recovery = readCashflowRecovery();
    if (!recovery) throw new Error('尚无导入前恢复点。第一次确认导入时会先保存。');
    download(JSON.stringify(recovery.data, null, 2), `cashflow-before-import-${date()}.json`);
    setMessage('上次导入前数据已下载；可选择该文件预览并恢复。');
  });
  const calibrate = () => run(() => {
    const value = Number(adjustAmount); if (!adjustAmount.trim() || !Number.isFinite(value)) throw new Error('请输入有效金额。');
    onAdjustBalance(value); setAdjustAmount(''); setMessage('已提交余额校准；如保存失败，请按页面提示保留备份。');
  });
  return <section className="data-manager" aria-labelledby="transfer-title">
    <h4 id="transfer-title">数据管理</h4>
    <p className="data-tip">数据只保存在当前浏览器。换设备或清除站点数据前，请下载 JSON 备份；这里不会自动上传或云同步。</p>
    <div className="transfer-options">
      <div><strong>单功能包 · 可恢复</strong><p>包含全部真实计划、模拟计划与初始余额，兼容生活日历。</p><button className="action-btn export" onClick={exportStandard}>导出标准单功能包</button></div>
      <div><strong>Agent Markdown · 阅读分析</strong><p>字段词典、计算规则和结构化记录。不是 JSON 恢复文件。</p><label className="transfer-check"><input type="checkbox" checked={redact} onChange={e => setRedact(e.target.checked)} />脱敏文字字段（金额、日期仍保留）</label><button className="action-btn export" onClick={exportMarkdown}>导出 Agent Markdown</button></div>
      <div><strong>整合包 · 跨工具</strong><p>前往生活日历选择多个模块导出。各模块独立存储，先通过文件互导。</p><a className="action-btn export" href="/life-calendar/#settings">前往生活日历数据中心</a></div>
    </div>
    <div className="data-actions">
      <button className="action-btn export" onClick={exportLegacy}>旧版 JSON 备份</button>
      <button className="action-btn export" onClick={exportAnalysis}>原版预测分析 Markdown</button>
      <button className="action-btn import" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '正在本地校验…' : '选择备份并预览'}</button>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleImport} aria-label="选择现金流备份文件" hidden />
      <button className="action-btn export" onClick={downloadRecovery}>下载上次导入前备份</button>
      <button className="action-btn danger" onClick={() => { if (window.confirm('将清除本浏览器的现金流计划、初始余额及导入前恢复点。建议先导出 JSON。确定清除全部？')) { onClear?.(); setPreview(null); } }}>清除全部</button>
    </div>
    {message && <p className="transfer-feedback" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <section className="import-preview" aria-labelledby="import-preview-title">
      <h5 id="import-preview-title">导入预览 · 尚未写入</h5><p className="transfer-filename">{preview.filename} · {preview.source}</p>
      <dl><dt>真实计划</dt><dd>{preview.counts.real} 条</dd><dt>模拟计划</dt><dd>{preview.counts.simulation} 条</dd><dt>初始余额</dt><dd>¥{preview.data.initialBalance.toLocaleString()}</dd><dt>当前数据</dt><dd>{preview.counts.current} 条计划将被替换</dd></dl>
      {preview.unchanged && <p>文件与当前内容相同，确认后不会重复创建记录。</p>}
      {(preview.ignoredModules.length > 0 || preview.workspaceIgnored) && <p>只导入现金流；不导入{preview.ignoredModules.map(id => MODULE_NAMES[id]).join('、')}{preview.workspaceIgnored ? '及工作台总结、布局等内容' : ''}。其它应用的数据不会改变。</p>}
      <p>当前不提供自动合并。确认前可下载当前 JSON；确认后也会先保存本机恢复点，失败则停止替换。</p>
      <div className="data-actions"><button className="action-btn export" onClick={exportLegacy}>下载当前数据备份</button><button className="action-btn danger" onClick={confirmImport}>确认替换现金流</button><button className="action-btn" onClick={() => { setPreview(null); setMessage('已取消，未写入任何数据。'); }}>取消导入</button></div>
    </section>}
    <div className="balance-adjust"><h5>校准当前余额</h5><p className="balance-tip">如果实际余额与计算结果不符，可以手动校准：</p><div className="adjust-controls"><label className="sr-only" htmlFor="adjust-balance">实际当前余额</label><input id="adjust-balance" type="number" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} placeholder={`当前: ¥${state.initialBalance.toLocaleString()}`} step="0.01" /><button className="adjust-btn" onClick={calibrate} disabled={!adjustAmount.trim()}>校准余额</button></div></div>
    <div className="data-info"><p><strong>当前数据统计：</strong></p><ul><li>当前余额: ¥{currentBalance.toLocaleString()}</li><li>初始基准: ¥{state.initialBalance.toLocaleString()}</li><li>真实事件: {state.events.length} 个</li><li>模拟事件: {state.simulationEvents.length} 个</li></ul></div>
  </section>;
}
