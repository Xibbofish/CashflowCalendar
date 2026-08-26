import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subDays, addDays, parseISO } from 'date-fns';
import { computeDailyBalances, getBalanceOnDate } from './engine';
import { format as formatDate } from 'date-fns';
import CalendarView from './components/CalendarView';
import ChartView from './components/ChartView';
import EventForm from './components/EventForm';
import EventList from './components/EventList';
import SimulationPanel from './components/SimulationPanel';
import DataManager from './components/DataManager';
import './App.css';

const STORAGE_KEY = 'cashflow-calendar-data';

const defaultState = {
  initialBalance: 10000,
  events: [],
  simulationEvents: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return defaultState;
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month');
  const [showForm, setShowForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [showSimulation, setShowSimulation] = useState(false);

  useEffect(() => { saveState(state); }, [state]);

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

  const todayStr = format(new Date(), 'yyyy-MM-dd');
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
    const newEvent = { ...event, id: event.id || String(Date.now()) };
    if (event.isSimulation) {
      setState((s) => ({ ...s, simulationEvents: [...s.simulationEvents, newEvent] }));
    } else {
      setState((s) => ({ ...s, events: [...s.events, newEvent] }));
    }
    setShowForm(false);
    setEditingEvent(null);
  }, []);

  const handleEditEvent = useCallback((event) => {
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
  }, []);

  const handleDeleteEvent = useCallback((id, isSimulation) => {
    if (isSimulation) {
      setState((s) => ({ ...s, simulationEvents: s.simulationEvents.filter((e) => e.id !== id) }));
    } else {
      setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
    }
  }, []);

  const handleConvertToReal = useCallback((id) => {
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
  }, []);

  const handleImport = useCallback((data) => {
    setState({
      initialBalance: data.initialBalance,
      events: data.events,
      simulationEvents: data.simulationEvents,
    });
  }, []);

  const handleAdjustBalance = useCallback((newBalance) => {
    const today = new Date();
    const allEvents = [...state.events, ...state.simulationEvents];
    const currentComputed = getBalanceOnDate(state.initialBalance, allEvents, formatDate(today, 'yyyy-MM-dd'));
    const newInitial = state.initialBalance + (newBalance - currentComputed);
    setState((s) => ({ ...s, initialBalance: newInitial }));
  }, [state.events, state.simulationEvents]);

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
        <h1>现金流日历</h1>
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
        </div>

        <aside className="sidebar">
          <DataManager
            state={state}
            currentBalance={todayBalance}
            onImport={handleImport}
            onAdjustBalance={handleAdjustBalance}
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
