import { useState, useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, subMonths, addWeeks, subWeeks, startOfDay, isSameDay,
  isSameMonth, format, parseISO,
} from 'date-fns';
import { zhCN } from 'date-fns/locale/zh-CN';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function balanceClass(balance) {
  if (balance < 0) return 'danger';
  if (balance < 1000) return 'warn';
  return 'safe';
}

export default function CalendarView({ cashFlowData, currentDate, viewMode, onDateChange, onEventClick }) {
  const [hoveredDay, setHoveredDay] = useState(null);

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
    const d = new Date(dateObj);
    if (viewMode === 'month') {
      onDateChange(dir > 0 ? addMonths(d, 1) : subMonths(d, 1));
    } else {
      onDateChange(dir > 0 ? addWeeks(d, 1) : subWeeks(d, 1));
    }
  };

  const today = startOfDay(new Date());

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
                className={`calendar-day ${isCurrentMonth ? '' : 'other-month'} ${isToday ? 'today' : ''} ${balance !== null ? balanceClass(balance) : ''}`}
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

      {hoveredDay && balanceMap[hoveredDay] && (
        <div className="day-detail">
          <strong>{hoveredDay}</strong>
          <span>余额: ¥{balanceMap[hoveredDay].balance.toLocaleString()}</span>
          <span>收入: ¥{balanceMap[hoveredDay].income.toLocaleString()}</span>
          <span>支出: ¥{balanceMap[hoveredDay].expense.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
