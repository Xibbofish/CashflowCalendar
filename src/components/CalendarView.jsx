import { useState, useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, addWeeks, subWeeks, startOfDay, isSameDay,
  isSameMonth, format, parseISO,
} from 'date-fns';
import { zhCN } from 'date-fns/locale/zh-CN';
import useLocalDay from '../useLocalDay.js';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function balanceClass(balance) {
  if (balance < 0) return 'danger';
  if (balance < 1000) return 'warn';
  return 'safe';
}

export default function CalendarView({ cashFlowData, currentDate, viewMode, onDateChange, onEventClick }) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const localToday = useLocalDay();
  const [selectedDay, setSelectedDay] = useState(null);
  const detailDay = hoveredDay || selectedDay;

  const dateObj = typeof currentDate === 'string' ? parseISO(currentDate) : currentDate;

  const days = useMemo(() => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(dateObj);
      const monthEnd = endOfMonth(dateObj);
      const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
      const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
      return eachDayOfInterval({ start: calStart, end: calEnd });
    } else {
      const weekStart = startOfWeek(dateObj, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(dateObj, { weekStartsOn: 1 });
      return eachDayOfInterval({ start: weekStart, end: weekEnd });
    }
  }, [dateObj, viewMode]);

  const balanceMap = useMemo(() => {
    const map = {};
    for (const d of cashFlowData) {
      map[d.date] = d;
    }
    return map;
  }, [cashFlowData]);

  const navigate = (dir) => {
    setHoveredDay(null);
    setSelectedDay(null);
    const d = new Date(dateObj);
    if (viewMode === 'month') {
      onDateChange(dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
    } else {
      onDateChange(dir > 0 ? addWeeks(d, 1) : subWeeks(d, 1));
    }
  };

  const today = startOfDay(parseISO(localToday));

  return (
    <div className="calendar-view">
      <div className="calendar-nav">
        <button className="nav-btn" onClick={() => navigate(-1)}>&lt;</button>
        <h3 className="calendar-title">
          {viewMode === 'month'
            ? format(dateObj, 'yyyy年 M月', { locale: zhCN })
            : format(dateObj, 'yyyy年 M月 第w周', { locale: zhCN })}
        </h3>
        <button className="nav-btn" onClick={() => navigate(1)}>&gt;</button>
      </div>

      <div className="calendar-grid">
        <div className="calendar-weekdays">
          {WEEKDAYS.map((d) => (
            <div key={d} className="weekday">{d}</div>
          ))}
        </div>
        <div className="calendar-days">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const data = balanceMap[key];
            const isCurrentMonth = viewMode === 'month' ? isSameMonth(day, dateObj) : true;
            const isToday = isSameDay(day, today);
            const balance = data ? data.balance : null;
            const events = data ? data.events : [];
            const realEvents = events.filter((e) => !e.isSimulation);
            const simEvents = events.filter((e) => e.isSimulation);

            return (
              <div
                key={key}
                className={`calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''} ${selectedDay === key ? 'selected' : ''} ${balance !== null ? balanceClass(balance) : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${key}，${balance !== null ? `余额 ${balance.toLocaleString()} 元` : '无余额数据'}`}
                aria-pressed={selectedDay === key}
                onClick={() => setSelectedDay(key)}
                onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setSelectedDay(key); } }}
                onMouseEnter={() => setHoveredDay(key)}
                onMouseLeave={() => setHoveredDay(null)}
              >
                <div className="day-number">{format(day, 'd')}</div>
                {balance !== null && (
                  <div className="day-balance">¥{balance.toLocaleString()}</div>
                )}
                <div className="day-events">
                  {realEvents.slice(0, 3).map((e) => (
                    <span
                      key={e.id}
                      className={`event-dot ${e.type}`}
                      title={`${e.name}: ¥${e.amount}`}
                      onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
                    />
                  ))}
                  {simEvents.slice(0, 2).map((e) => (
                    <span
                      key={e.id}
                      className="event-dot simulation"
                      title={`[模拟] ${e.name}: ¥${e.amount}`}
                      onClick={(ev) => { ev.stopPropagation(); onEventClick(e); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detailDay && balanceMap[detailDay] && (
        <div className="day-detail">
          <div className="day-detail-top">
            <strong>{detailDay}</strong>
            <span>余额: ¥{balanceMap[detailDay].balance.toLocaleString()}</span>
            <span>收入: ¥{balanceMap[detailDay].income.toLocaleString()}</span>
            <span>支出: ¥{balanceMap[detailDay].expense.toLocaleString()}</span>
          </div>
          {balanceMap[detailDay].events.length > 0 && (
            <div className="day-detail-events">
              {balanceMap[detailDay].events.map((e) => (
                <div key={e.id} className={`day-detail-event ${e.isSimulation ? 'simulation' : ''}`}>
                  <span className="dde-name" title="点击编辑" onClick={() => onEventClick(e)}>
                    {e.isSimulation && <em>[模拟]</em>} {e.name}
                  </span>
                  <span className={`dde-amount ${e.type}`}>
                    {e.type === 'income' ? '+' : '-'}¥{Math.abs(e.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


