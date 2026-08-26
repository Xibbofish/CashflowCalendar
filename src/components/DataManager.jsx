import { useState, useRef } from 'react';
import { normalizeEvent } from '../engine';

export default function DataManager({ state, currentBalance, onImport, onAdjustBalance }) {
  const [adjustAmount, setAdjustAmount] = useState('');
  const [lastImport, setLastImport] = useState(null);
  const fileRef = useRef(null);

  const handleExport = () => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target.result);
        const data = {
          initialBalance: typeof raw.initialBalance === 'number' ? raw.initialBalance : 10000,
          events: (raw.events || []).map(normalizeEvent),
          simulationEvents: (raw.simulationEvents || []).map(normalizeEvent),
        };
        onImport(data);
        setLastImport(new Date().toLocaleString());
        alert('数据导入成功！');
      } catch {
        alert('文件读取失败，请选择有效的 JSON 备份文件。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCalibrate = () => {
    const val = parseFloat(adjustAmount);
    if (isNaN(val)) { alert('请输入有效金额'); return; }
    onAdjustBalance(val);
    setAdjustAmount('');
    alert(`当前余额已校准为: ¥${val.toLocaleString()}`);
  };

  const handleClear = () => {
    if (window.confirm('确定要清除所有数据吗？此操作不可恢复！')) {
      localStorage.removeItem('cashflow-calendar-data');
      onImport({ initialBalance: 10000, events: [], simulationEvents: [] });
      alert('所有数据已清除。');
    }
  };

  return (
    <div className="data-manager">
      <h4>数据管理</h4>

      <div className="data-actions">
        <button className="action-btn export" onClick={handleExport} title="导出数据到文件">📤 导出备份</button>
        <button className="action-btn import" onClick={() => fileRef.current?.click()} title="从文件导入数据">📥 导入备份</button>
        <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
        <button className="action-btn danger" onClick={handleClear} title="清除所有数据">🗑️ 清除全部</button>
      </div>

      <div className="balance-adjust">
        <h5>校准当前余额</h5>
        <p className="balance-tip">如果实际余额与计算结果不符，可以手动校准：</p>
        <div className="adjust-controls">
          <input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder={`当前: ¥${state.initialBalance.toLocaleString()}`} step="0.01" />
          <button className="adjust-btn" onClick={handleCalibrate} disabled={!adjustAmount.trim()}>校准余额</button>
        </div>
      </div>

      <div className="data-info">
        <p><strong>当前数据统计：</strong></p>
        <ul>
          <li>当前余额: ¥{currentBalance.toLocaleString()}</li>
          <li>初始基准: ¥{state.initialBalance.toLocaleString()}</li>
          <li>真实事件: {state.events.length} 个</li>
          <li>模拟事件: {state.simulationEvents.length} 个</li>
          {lastImport && <li>最后导入: {lastImport}</li>}
        </ul>
        <p className="data-tip">
          💡 数据自动保存到浏览器本地存储。<br />
          📁 建议定期导出备份以防数据丢失。
        </p>
      </div>
    </div>
  );
}
