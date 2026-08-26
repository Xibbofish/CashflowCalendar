export default function EventList({ events, simulationEvents, onEdit, onDelete, onConvertToReal }) {
  const allEvents = [
    ...events.map((e) => ({ ...e, _isReal: true })),
    ...simulationEvents.map((e) => ({ ...e, _isReal: false })),
  ].sort((a, b) => {
    if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const recurringLabel = (t) => {
    const map = { daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年' };
    return map[t] || '';
  };

  return (
    <div className="event-list">
      <h4>事件列表</h4>

      {!events.length && !simulationEvents.length ? (
        <div className="empty-list">
          <p>暂无事件</p>
          <p className="hint">点击上方"添加事件"开始</p>
        </div>
      ) : (
        <div className="event-items">
          {allEvents.map((e) => (
            <div key={e.id} className={`event-item ${e._isReal ? '' : 'simulation'}`}>
              <div className="event-item-main">
                <div className="event-name">
                  {!e._isReal && <span className="sim-badge">模拟</span>}
                  {e.name}
                </div>
                <div className="event-meta">
                  <span className={`event-amount ${e.type}`}>
                    {e.type === 'income' ? '+' : ''}¥{Math.abs(e.amount).toLocaleString()}
                  </span>
                  {e.isRecurring ? (
                    <span className="event-period">{recurringLabel(e.recurringType)} · 从{e.recurringStartDate}起</span>
                  ) : (
                    <span className="event-date">{e.date}</span>
                  )}
                </div>
              </div>
              <div className="event-item-actions">
                <button className="icon-btn edit" onClick={() => onEdit(e)} title="编辑">✎</button>
                {e._isReal ? (
                  <button className="icon-btn delete" onClick={() => onDelete(e.id, false)} title="删除">✕</button>
                ) : (
                  <>
                    <button className="icon-btn convert" onClick={() => onConvertToReal(e.id)} title="转为真实事件">↻</button>
                    <button className="icon-btn delete" onClick={() => onDelete(e.id, true)} title="删除">✕</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
