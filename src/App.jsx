import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subDays, addDays, parseISO } from 'date-fns';
import useLocalDay from './useLocalDay.js';
import { computeDailyBalances, getBalanceOnDate } from './engine';
import { format as formatDate } from 'date-fns';
import CalendarView from './components/CalendarView';
import ChartView from './components/ChartView';
import EventForm from './components/EventForm';
import EventList from './components/EventList';
import SimulationPanel from './components/SimulationPanel';
import DataManager from './components/DataManager';
import MonthlyReport from './components/MonthlyReport';
import { DEFAULT_STATE, clearState, readState, writeState } from './storage.js';
import { commitCashflowImport } from './data-transfer.js';
import './App.css';

/**
 * 本机数据状态（见 src/storage.js）。
 *
 * 关键要求：**打开页面时绝不覆盖写坏数据**。
 * - 数据损坏 / 来自更高版本 / 存储不可用 → 只读模式（`blocked`），保存被跳过并显示原因；
 * - 只有读取结果明确为 `ok` 或 `empty` 时才允许写入。
 */
function loadState() {
  return readState();
}

export default function App() {
  const [initial] = useState(loadState);

  const [state, setState] = useState(() => initial.data ?? DEFAULT_STATE);
  const [blocked, setBlocked] = useState(initial.readonly === true);
  const [rawBackup, setRawBackup] = useState(initial.raw ?? null);
  const [storageError, setStorageError] = useState(initial.error ?? null);
  const todayStr = useLocalDay();
  const [browsedDate, setCurrentDate] = useState(null);
  const currentDate = browsedDate || parseISO(todayStr);
  const [viewMode, setViewMode] = useState('month');
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showSimulation, setShowSimulation] = useState(false);

  /** 保存：任何一次失败都要让用户看见，并保留原始数据。 */
  useEffect(() => {
    if (blocked) return;
    try {
      writeState(state);
      setStorageError(null);
    } catch (error) {
      const message = error?.code === 'E_STORAGE_QUOTA'
        ? '本机存储空间不足，这次改动没有保存。请先导出备份并清理浏览器存储。'
        : `${error?.message ?? '本机存储写入失败'}这次改动没有保存。`;
      setStorageError({ code: error?.code ?? 'E_STORAGE_FAILED', message });
    }
  }, [state, blocked]);

  /** 只读模式下不接受任何改动：直接提示原因，不改内存数据，也不写盘。 */
  const blockIfReadonly = useCallback(() => {
    if (!blocked) return false;
    const reason = storageError?.message ?? '本机数据当前只能查看。';
    window.alert(`${reason}\n\n如需恢复：先下载原始数据备份，再清除本机数据。`);
    return true;
  }, [blocked, storageError]);

  /** 清除本机数据（只读模式下也允许：这是用户明确的恢复动作，且不覆盖未知数据以外的东西）。 */
  const handleClearAll = useCallback(() => {
    try {
      clearState();
    } catch (error) {
      setStorageError({ code: error?.code ?? 'E_STORAGE_FAILED', message: error?.message ?? '无法清除本机数据。' });
      return;
    }
    setState(DEFAULT_STATE);
    setRawBackup(null);
    setBlocked(false);
    setStorageError(null);
  }, []);

  const rangeStart = format(subDays(currentDate, 90), 'yyyy-MM-dd');
  const rangeEnd = format(addDays(currentDate, 180), 'yyyy-MM-dd');

  const allEvents = useMemo(
    () => [...state.events, ...state.simulationEvents],
    [state.events, state.simulationEvents]
  );

  const cashFlowData = useMemo(
    () => computeDailyBalances(state.initialBalance, allEvents, rangeStart, rangeEnd),
    [state.initialBalance, allEvents, rangeStart, rangeEnd]
  );

  const todayBalance = useMemo(() => {
    const today = cashFlowData.find((d) => d.date === todayStr);
    if (today) return today.balance;
    const past = cashFlowData.filter((d) => d.date <= todayStr).sort((a, b) => b.date.localeCompare(a.date));
    return past.length > 0 ? past[0].balance : state.initialBalance;
  }, [cashFlowData, todayStr, state.initialBalance]);

  const futureMinBalance = useMemo(() => {
    const future = cashFlowData.filter((d) => d.date >= todayStr);
    if (future.length === 0) return todayBalance;
    return Math.min(...future.map((d) => d.balance));
  }, [cashFlowData, todayStr, todayBalance]);

  const handleAddEvent = useCallback((event) => {
    if (blockIfReadonly()) return;
    const newEvent = { ...event, id: event.id || String(Date.now()) };
    if (event.isSimulation) {
      setState((s) => ({ ...s, simulationEvents: [...s.simulationEvents, newEvent] }));
    } else {
      setState((s) => ({ ...s, events: [...s.events, newEvent] }));
    }
    setShowForm(false);
    setEditingEvent(null);
  }, [blockIfReadonly]);

  const handleEditEvent = useCallback((event) => {
    if (blockIfReadonly()) return;
    if (event.isSimulation) {
      setState((s) => ({
        ...s,
        simulationEvents: s.simulationEvents.map((e) => e.id === event.id ? event : e),
      }));
    } else {
      setState((s) => ({
        ...s,
        events: s.events.map((e) => e.id === event.id ? event : e),
      }));
    }
    setShowForm(false);
    setEditingEvent(null);
  }, [blockIfReadonly]);

  const handleDeleteEvent = useCallback((id, isSimulation) => {
    if (blockIfReadonly()) return;
    if (isSimulation) {
      setState((s) => ({ ...s, simulationEvents: s.simulationEvents.filter((e) => e.id !== id) }));
    } else {
      setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
    }
  }, [blockIfReadonly]);

  const handleConvertToReal = useCallback((id) => {
    if (blockIfReadonly()) return;
    setState((s) => {
      const sim = s.simulationEvents.find((e) => e.id === id);
      if (!sim) return s;
      const real = { ...sim, isSimulation: false, id: String(Date.now()) };
      return {
        ...s,
        events: [...s.events, real],
        simulationEvents: s.simulationEvents.filter((e) => e.id !== id),
      };
    });
  }, [blockIfReadonly]);

  const handleImport = useCallback((preview) => {
    if (blockIfReadonly()) throw new Error('当前数据只读，请先备份并明确恢复，未导入。');
    const data = commitCashflowImport(preview, state);
    setStorageError(null);
    setState({
      initialBalance: data.initialBalance,
      events: data.events,
      simulationEvents: data.simulationEvents,
    });
  }, [blockIfReadonly, state]);

  const handleAdjustBalance = useCallback((newBalance) => {
    if (blockIfReadonly()) return;
    const today = new Date();
    const allEvents = [...state.events, ...state.simulationEvents];
    const currentComputed = getBalanceOnDate(state.initialBalance, allEvents, formatDate(today, 'yyyy-MM-dd'));
    const newInitial = state.initialBalance + (newBalance - currentComputed);
    setState((s) => ({ ...s, initialBalance: newInitial }));
  }, [blockIfReadonly, state.events, state.simulationEvents, state.initialBalance]);

  const handleOpenEdit = useCallback((event) => {
    setEditingEvent(event);
    setShowForm(true);
  }, []);

  const handleSave = useCallback((event) => {
    if (editingEvent) {
      handleEditEvent(event);
    } else {
      handleAddEvent(event);
    }
  }, [editingEvent, handleAddEvent, handleEditEvent]);

  return (
    <div className="app">
      <header className="app-header">
        <div><a className="return-tools" href="/tools/">← 返回工具列表</a><h1>现金流日历</h1></div>
        <div className="header-controls">
          <button className="header-btn" onClick={() => setShowSimulation(!showSimulation)}>
            {showSimulation ? '隐藏模拟' : '开启模拟'}
          </button>
          <button className="header-btn primary" onClick={() => { setEditingEvent(null); setShowForm(true); }}>
            添加事件
          </button>
          <select className="view-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            <option value="month">月视图</option>
            <option value="week">周视图</option>
          </select>
        </div>
      </header>

      <main className="app-main">
        <div className="main-content">
          {(storageError || blocked) && (
            <div className="storage-warning" role="alert">
              <strong>{blocked ? '本机数据当前只能查看' : '本机数据没有保存'}</strong>
              <p>{storageError?.message ?? '未知问题。'}</p>
              <p className="storage-warning-note">
                原始内容未被改动，也不会被自动覆盖。请先下载原始数据备份，再决定是否清除恢复。
              </p>
              <div className="storage-warning-actions">
                <button
                  type="button"
                  className="header-btn"
                  disabled={!rawBackup}
                  onClick={() => {
                    const blob = new Blob([rawBackup ?? ''], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `现金流日历-原始数据-${todayStr}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  下载原始数据
                </button>
                <button
                  type="button"
                  className="header-btn"
                  onClick={() => {
                    if (!window.confirm('清除本机数据并恢复为空白状态？\n\n请先下载原始数据备份，此操作无法撤销。')) return;
                    handleClearAll();
                  }}
                >
                  清除本机数据并恢复空白
                </button>
              </div>
            </div>
          )}

          <div className="balance-info">
            <h3>当前余额: ¥{todayBalance.toLocaleString()}</h3>
            <p>未来180天最低余额: ¥{futureMinBalance.toLocaleString()}</p>
          </div>

          <CalendarView
            cashFlowData={cashFlowData}
            currentDate={currentDate}
            viewMode={viewMode}
            onDateChange={setCurrentDate}
            onEventClick={handleOpenEdit}
          />

          <ChartView cashFlowData={cashFlowData} />

          <MonthlyReport state={state} />
        </div>

        <aside className="sidebar">
          <DataManager
            state={state}
            currentBalance={todayBalance}
            onImport={handleImport}
            onAdjustBalance={handleAdjustBalance}
            onClear={handleClearAll}
          />
          <EventList
            events={state.events}
            simulationEvents={state.simulationEvents}
            onEdit={handleOpenEdit}
            onDelete={handleDeleteEvent}
            onConvertToReal={handleConvertToReal}
          />
        </aside>
      </main>

      {showForm && (
        <EventForm
          event={editingEvent}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingEvent(null); }}
        />
      )}

      {showSimulation && (
        <SimulationPanel
          simulationEvents={state.simulationEvents}
          onAddSimulation={(e) => handleAddEvent({ ...e, isSimulation: true })}
          onDeleteSimulation={(id) => handleDeleteEvent(id, true)}
          onClose={() => setShowSimulation(false)}
        />
      )}
    </div>
  );
}


