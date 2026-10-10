import { useState } from 'react';
import { normalizeEvent, RecurringType, EventType, DEFAULT_CATEGORIES } from '../engine';
import { localDay } from '../local-day.js';

const emptyForm = () => ({
  name: '',
  type: EventType.EXPENSE,
  amount: '',
  date: localDay(),
  isRecurring: false,
  recurringType: RecurringType.MONTHLY,
  recurringStartDate: localDay(),
  recurringEndDate: '',
  isPermanent: true,
  duration: 'permanent',
  occurrenceCount: '6',
  category: '',
  description: '',
});

export default function EventForm({ event, onSave, onCancel }) {
  const [form, setForm] = useState(() => event ? {
        name: event.name || '',
        type: event.type || EventType.EXPENSE,
        amount: String(Math.abs(event.amount || 0)),
        date: event.date || '',
        isRecurring: Boolean(event.isRecurring),
        recurringType: event.recurringType || RecurringType.MONTHLY,
        recurringStartDate: event.recurringStartDate || (event.date || ''),
        recurringEndDate: event.recurringEndDate || '',
        isPermanent: Boolean(event.isPermanent),
        duration: event.isPermanent ? 'permanent' : event.occurrenceCount ? 'count' : 'date',
        occurrenceCount: String(event.occurrenceCount || 6),
        category: event.category || '',
        description: event.description || '',
      } : emptyForm());

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const amount = parseFloat(form.amount) || 0;
    const signedAmount = form.type === EventType.INCOME ? Math.abs(amount) : -Math.abs(amount);
    onSave(normalizeEvent({
      ...(event ? { id: event.id } : {}),
      name: form.name,
      type: form.type,
      amount: signedAmount,
      date: form.date,
      isRecurring: form.isRecurring,
      recurringType: form.isRecurring ? form.recurringType : RecurringType.NONE,
      recurringStartDate: form.isRecurring ? form.recurringStartDate : '',
      recurringEndDate: form.isRecurring && form.duration === 'date' ? form.recurringEndDate : '',
      isPermanent: form.isRecurring && form.duration === 'permanent',
      occurrenceCount: form.isRecurring && form.duration === 'count' ? Number(form.occurrenceCount) : null,
      canSkip: event?.canSkip || false,
      skippedDates: event?.skippedDates || [],
      category: form.category,
      description: form.description,
      isSimulation: event ? event.isSimulation : false,
    }));
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal event-form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{event ? '编辑事件' : '添加事件'}</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-body">
            <div className="form-group">
              <label>事件名称</label>
              <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="例如：工资" required />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>类型</label>
                <select value={form.type} onChange={(e) => update('type', e.target.value)}>
                  <option value={EventType.INCOME}>收入</option>
                  <option value={EventType.EXPENSE}>支出</option>
                </select>
              </div>
              <div className="form-group">
                <label>金额</label>
                <input type="number" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0" step="0.01" min="0" required />
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.isRecurring} onChange={(e) => update('isRecurring', e.target.checked)} />
                周期性事件
              </label>
            </div>

            {form.isRecurring ? (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label>周期类型</label>
                    <select value={form.recurringType} onChange={(e) => update('recurringType', e.target.value)}>
                      <option value={RecurringType.DAILY}>每日</option>
                      <option value={RecurringType.WEEKLY}>每周</option>
                      <option value={RecurringType.MONTHLY}>每月</option>
                      <option value={RecurringType.YEARLY}>每年</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>开始日期</label>
                    <input type="date" value={form.recurringStartDate} onChange={(e) => update('recurringStartDate', e.target.value)} required />
                  </div>
                </div>

                <div className="form-group">
                  <label>持续时间</label>
                  <div className="radio-group">
                    <label className="radio-label">
                      <input type="radio" name="duration" checked={form.duration === 'permanent'} onChange={() => update('duration', 'permanent')} />
                      永久
                    </label>
                    <label className="radio-label">
                      <input type="radio" name="duration" checked={form.duration === 'date'} onChange={() => update('duration', 'date')} />
                      至指定日期
                    </label>
                    <label className="radio-label">
                      <input type="radio" name="duration" checked={form.duration === 'count'} onChange={() => update('duration', 'count')} />
                      按次数结束
                    </label>
                  </div>
                </div>

                {form.duration === 'date' && (
                  <div className="form-group">
                    <label>结束日期</label>
                    <input type="date" value={form.recurringEndDate} onChange={(e) => update('recurringEndDate', e.target.value)} required />
                  </div>
                )}

                {form.duration === 'count' && (
                  <div className="form-group">
                    <label htmlFor="occurrence-count">发生次数</label>
                    <input id="occurrence-count" type="number" value={form.occurrenceCount} onChange={(e) => update('occurrenceCount', e.target.value)} min="1" max="10000" step="1" required />
                    <p className="data-tip">从开始日期算第 1 次。例如还有六次还款，开始日期填下一次还款日，次数填 6。</p>
                  </div>
                )}
              </>
            ) : (
              <div className="form-group">
                <label>日期</label>
                <input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} required />
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label>分类</label>
                <input
                  type="text"
                  list="category-suggestions"
                  value={form.category}
                  onChange={(e) => update('category', e.target.value)}
                  placeholder={form.type === EventType.INCOME ? '例如：工资' : '例如：餐饮'}
                />
                <datalist id="category-suggestions">
                  {DEFAULT_CATEGORIES[form.type].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="form-group">
                <label>备注</label>
                <input type="text" value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="选填" />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="cancel-btn" onClick={onCancel}>取消</button>
            <button type="submit" className="save-btn">{event ? '保存' : '添加'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
