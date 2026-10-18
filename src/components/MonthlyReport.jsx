import { useMemo, useState } from 'react';
import { format, subDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { eventCategoryLabel, computeDailyBalances } from '../engine';
import { analysisRange, filterAnalysis } from '../analysis.js';
import ChartView from './ChartView';
import useLocalDay from '../useLocalDay.js';

const fmt = (n) => Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 从 cashFlowData 聚合出：按月的收入/支出/净额 与 按分类(分收入/支出)的总额
export default function MonthlyReport({ state }) {
  const [preset, setPreset] = useState('30');
  const [custom, setCustom] = useState(() => analysisRange('30'));
  const [includeSimulation, setIncludeSimulation] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [grouping, setGrouping] = useState('month');
  const today = useLocalDay();
  const now = parseISO(today);
  const anchor = format(subDays(now, 90), 'yyyy-MM-dd');
  const [start, end] = preset === 'custom' ? custom : analysisRange(preset, now);
  const invalid = !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start < anchor || start > end || !Number.isFinite(parseISO(end).getTime()) || differenceInCalendarDays(parseISO(end), parseISO(anchor)) > 3650;
  const scenarioEvents = useMemo(() => includeSimulation ? [...state.events, ...state.simulationEvents] : state.events, [state.events, state.simulationEvents, includeSimulation]);
  const availableCategories = [...new Set([...state.events, ...state.simulationEvents].map(eventCategoryLabel))].sort();
  const days = useMemo(() => invalid ? [] : computeDailyBalances(state.initialBalance, scenarioEvents, anchor, end).filter((day) => day.date >= start), [state.initialBalance, scenarioEvents, anchor, start, end, invalid]);
  const { months, categories, events } = useMemo(() => filterAnalysis(days, selectedCategories, grouping), [days, selectedCategories, grouping]);
  const minimum = days.reduce((min, day) => !min || day.balance < min.balance ? day : min, null);

  const incomeCats = categories.filter((c) => c.type === 'income').sort((a, b) => b.amount - a.amount);
  const expenseCats = categories.filter((c) => c.type === 'expense').sort((a, b) => b.amount - a.amount);
  const totalIncome = incomeCats.reduce((s, c) => s + c.amount, 0);
  const totalExpense = expenseCats.reduce((s, c) => s + c.amount, 0);
  const net = totalIncome - totalExpense;

  const renderCats = (list, total, colorKey) => (
    <div className={`cat-breakdown ${colorKey}`}>
      {list.length === 0 ? (
        <p className="cat-empty">暂无{colorKey === 'income' ? '收入' : '支出'}数据</p>
      ) : (
        list.map((c) => {
          const pct = total > 0 ? Math.round((Math.abs(c.amount) / total) * 100) : 0;
          return (
            <div key={`${c.type}-${c.category}`} className="cat-row">
              <div className="cat-row-head">
                <span className="cat-name">{c.category}</span>
                <span className="cat-amount">¥{fmt(c.amount)}</span>
                <span className="cat-pct">{pct}%</span>
              </div>
              <div className="cat-bar-track">
                <div className={`cat-bar ${colorKey}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="monthly-report">
      <div className="report-header">
        <h4>📊 收支分析</h4>
        <div className="analysis-controls">
          <label>时间范围<select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="this-month">本月</option><option value="next-month">下月</option><option value="30">未来 30 天</option><option value="90">未来 90 天</option><option value="180">未来 180 天</option><option value="custom">自定义</option></select></label>
          <label>数据情景<select value={includeSimulation ? 'all' : 'real'} onChange={(e) => setIncludeSimulation(e.target.value === 'all')}><option value="real">仅真实计划</option><option value="all">真实计划 + 模拟</option></select></label>
          <label>汇总方式<select value={grouping} onChange={(e) => setGrouping(e.target.value)}><option value="month">按月</option><option value="week">按周（周一开始）</option></select></label>
          {preset === 'custom' && <><label>开始日期<input type="date" min={anchor} value={start} onChange={(e) => setCustom((dates) => [e.target.value, dates[1]])} onBlur={(e) => setCustom((dates) => [e.target.value, dates[1]])} /></label><label>结束日期<input type="date" min={start || anchor} value={end} onChange={(e) => setCustom((dates) => [dates[0], e.target.value])} onBlur={(e) => setCustom((dates) => [dates[0], e.target.value])} /></label></>}
        </div>
        <fieldset className="analysis-categories"><legend>分类筛选（可多选）</legend><button type="button" className="action-btn" aria-pressed={!selectedCategories.length} onClick={() => setSelectedCategories([])}>全部分类</button>{availableCategories.map((category) => <label key={category}><input type="checkbox" checked={selectedCategories.includes(category)} onChange={(e) => setSelectedCategories((list) => e.target.checked ? [...list, category] : list.filter((c) => c !== category))} />{category}</label>)}</fieldset>
        <p className="data-tip">{start} 至 {end}，含起止日。收支与明细按分类筛选；余额和趋势按当前情景的全部事件计算。预测基准从 {anchor} 起累计，早于此日的数据不纳入；自定义范围最多延伸至基准后 10 年。</p>
        {invalid && <p role="alert">请填写有效日期，开始日期不早于 {anchor}，结束日期不早于开始日期，且距基准不超过 3650 天。</p>}
        {!invalid && minimum && <p className="report-summary">完整计划最低余额：¥{minimum.balance < 0 ? '-' : ''}{fmt(minimum.balance)}（{minimum.date}） · 期末余额：¥{days.at(-1).balance < 0 ? '-' : ''}{fmt(days.at(-1).balance)}</p>}
        <p className="report-summary">
          净额 <strong className={net >= 0 ? 'pos' : 'neg'}>¥{net < 0 ? '-' : ''}{fmt(net)}</strong>
          <span> · 收入 ¥{fmt(totalIncome)}</span>
          <span> · 支出 ¥{fmt(totalExpense)}</span>
        </p>
      </div>

      {!invalid && days.length > 0 && <ChartView cashFlowData={days} />}

      <div className="report-cats">
        <div className="report-col">
          <div className="report-col-title income">收入分类</div>
          {renderCats(incomeCats, totalIncome, 'income')}
        </div>
        <div className="report-col">
          <div className="report-col-title expense">支出分类</div>
          {renderCats(expenseCats, totalExpense, 'expense')}
        </div>
      </div>

      {months.length > 0 && (
        <div className="month-table-wrap">
          <table className="month-table">
            <thead>
              <tr>
                <th>{grouping === 'month' ? '月份' : '周起始日'}</th>
                <th>收入</th>
                <th>支出</th>
                <th>净额</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const mnet = m.income - m.expense;
                return (
                  <tr key={m.key}>
                    <td>{m.key}</td>
                    <td className="num income-num">¥{fmt(m.income)}</td>
                    <td className="num expense-num">¥{fmt(m.expense)}</td>
                    <td className={`num ${mnet >= 0 ? 'pos' : 'neg'}`}>{mnet >= 0 ? '' : '-'}¥{fmt(mnet)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!invalid && <details className="analysis-details"><summary>区间事件明细（{events.length} 次发生）</summary><p className="data-tip">仅列出所选日期内发生的事件；月／周汇总的首末段可能不完整。</p>{events.length ? <div className="month-table-wrap"><table className="month-table"><thead><tr><th>日期</th><th>名称</th><th>分类</th><th>金额</th><th>情景</th></tr></thead><tbody>{events.map((event, index) => <tr key={`${event.id}-${event.date}-${index}`}><td>{event.date}</td><td>{event.name}</td><td>{eventCategoryLabel(event)}</td><td>{event.amount < 0 ? '-' : '+'}¥{fmt(event.amount)}</td><td>{event.isSimulation ? '模拟' : '真实计划'}</td></tr>)}</tbody></table></div> : <p>此范围与分类下没有收支事件。</p>}</details>}
    </div>
  );
}

