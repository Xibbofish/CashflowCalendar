import { useState } from 'react';
import EventForm from './EventForm';

export default function SimulationPanel({ simulationEvents, onAddSimulation, onDeleteSimulation, onClose }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal simulation-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>模拟事件面板</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="panel-body">
          <div className="simulation-intro">
            <p><strong>试错机制：</strong>在决定是否添加真实事件前，先创建模拟事件观察对未来现金流的影响。</p>
            <div className="simulation-tips">
              <h4>使用提示：</h4>
              <ul>
                <li>模拟事件不会影响真实数据</li>
                <li>可以在日历上看到虚线标识的模拟事件</li>
                <li>观察现金曲线变化后再决定是否转为真实事件</li>
                <li>可以同时添加多个模拟事件进行对比</li>
              </ul>
            </div>
          </div>

          <div className="simulation-controls">
            <button className="add-simulation-btn" onClick={() => setShowForm(true)}>+ 添加模拟事件</button>
          </div>

          {simulationEvents.length > 0 ? (
            <div className="simulation-list">
              <h4>当前模拟事件 ({simulationEvents.length})</h4>
              <div className="simulation-events">
                {simulationEvents.map((e) => (
                  <div key={e.id} className="simulation-event-item">
                    <div className="event-info">
                      <div className="event-name">{e.name}</div>
                      <div className="event-details">
                        <span className="event-amount">¥{Math.abs(e.amount).toLocaleString()}</span>
                        <span className="event-date">{e.date || e.recurringStartDate}</span>
                        <span className={`event-type ${e.type}`}>{e.type === 'income' ? '收入' : '支出'}</span>
                      </div>
                    </div>
                    <div className="event-actions">
                      <button className="delete-btn" onClick={() => onDeleteSimulation(e.id)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-simulations">
              <p>暂无模拟事件</p>
              <p className="hint">点击上方按钮开始试错分析</p>
            </div>
          )}
        </div>

        {showForm && (
          <EventForm
            onSave={(e) => { onAddSimulation(e); setShowForm(false); }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}
