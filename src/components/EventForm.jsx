import { useState, useEffect } from 'react';
import { normalizeEvent, RecurringType, EventType } from '../engine';

const emptyForm = () => ({
  name: '',
  type: EventType.EXPENSE,
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  isRecurring: false,
  recurringType: RecurringType.MONTHLY,
  recurringStartDate: new Date().toISOString().slice(0, 10),
  recurringEndDate: '',
  isPermanent: true,
  canSkip: false,
  category: '',
  description: '',
});

export default function EventForm({ event, onSave, onCancel }) {
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    if (event) {
      setForm({
        name: event.name || '',
        type: event.type || EventType.EXPENSE,
        amount: String(Math.abs(event.amount || 0)),
        date: event.date || '',
        isRecurring: Boolean(event.isRecurring),
        recurringType: event.recurringType || RecurringType.MONTHLY,
        recurringStartDate: event.recurringStartDate || (event.date || ''),
        recurringEndDate: event.recurringEndDate || '',
        isPermanent: Boolean(event.isPermanent),
        canSkip: Boolean(event.canSkip),
        category: event.category || '',
        description: event.description || '',
      });
    }
  }, [event]);

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
      recurringEndDate: form.isRecurring && !form.isPermanent ? form.recurringEndDate : '',
      isPermanent: form.isRecurring ? form.isPermanent : false,
      canSkip: form.canSkip,
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
                      <input type="radio" name="duration" checked={form.isPermanent} onChange={() => update('isPermanent', true)} />
                      永久
                    </label>
                    <label className="radio-label">
                      <input type="radio" name="duration" checked={!form.isPermanent} onChange={() => update('isPermanent', false)} />
                      至指定日期
                    </label>
                  </div>
                </div>

                {!form.isPermanent && (
                  <div className="form-group">
                    <label>结束日期</label>
                    <input type="date" value={form.recurringEndDate} onChange={(e) => update('recurringEndDate', e.target.value)} required />
                  </div>
                )}

                <div className="form-group">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={form.canSkip} onChange={(e) => update('canSkip', e.target.checked)} />
                    可跳过单次
                  </label>
                </div>
              </>
            ) : (
              <div className="form-group">
                <label>日期</label>
                <input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} required />
              </div>
            )}

            <div className="form-group">
              <label>备注</label>
              <input type="text" value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="选填" />
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
