import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale/zh-CN';

export default function ChartView({ cashFlowData }) {
  const [tooltip, setTooltip] = useState(null);

  if (!cashFlowData || cashFlowData.length === 0) {
    return (
      <div className="chart-container">
        <div className="chart-header"><h3>📈 现金流趋势分析</h3></div>
        <div className="empty-chart"><div className="empty-icon">📊</div><p>暂无数据，请先添加收入或支出事件</p></div>
      </div>
    );
  }

  const balances = cashFlowData.map((d) => d.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);
  const negDays = cashFlowData.filter((d) => d.balance < 0).length;
  const range = maxBalance - minBalance || 1;

  const W = 800;
  const H = 250;
  const PAD_L = 60;
  const PAD_R = 30;
  const PAD_T = 20;
  const PAD_B = 40;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const xScale = (i) => PAD_L + (i / (cashFlowData.length - 1)) * chartW;
  const yScale = (v) => PAD_T + chartH - ((v - minBalance) / range) * chartH;

  const linePath = cashFlowData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.balance)}`).join(' ');
  const areaPath = `${linePath} L ${xScale(cashFlowData.length - 1)} ${PAD_T + chartH} L ${xScale(0)} ${PAD_T + chartH} Z`;

  const trend = cashFlowData[cashFlowData.length - 1].balance > cashFlowData[0].balance ? 'up' : 'down';

  const yLabels = [];
  for (let i = 0; i <= 5; i++) {
    const val = minBalance + (i / 5) * range;
    yLabels.push({ y: yScale(val), val });
  }

  const xLabels = [];
  const step = Math.max(1, Math.floor(cashFlowData.length / 8));
  for (let i = 0; i < cashFlowData.length; i += step) {
    xLabels.push({ x: xScale(i), date: cashFlowData[i].date });
  }
  if ((cashFlowData.length - 1) % step !== 0) {
    const last = cashFlowData[cashFlowData.length - 1];
    xLabels.push({ x: xScale(cashFlowData.length - 1), date: last.date });
  }

  const zeroY = minBalance < 0 && maxBalance > 0 ? yScale(0) : null;

  return (
    <div className="chart-container">
      <div className="chart-header">
        <div className="chart-title">
          <h3>📈 现金流趋势分析</h3>
          <div className="trend-indicator">
            <span className={`trend ${trend}`}>{trend === 'up' ? '↗️ 上升' : '↘️ 下降'}</span>
          </div>
        </div>
        <div className="chart-stats">
          <div className="stat-card">
            <div className="stat-icon">📉</div>
            <div className="stat-content">
              <div className="stat-value">{minBalance < 0 ? '-' : ''}¥{Math.abs(minBalance).toLocaleString()}</div>
              <div className="stat-label">最低余额</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">📈</div>
            <div className="stat-content">
              <div className="stat-value">¥{maxBalance.toLocaleString()}</div>
              <div className="stat-label">最高余额</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⚠️</div>
            <div className="stat-content">
              <div className="stat-value">{negDays}</div>
              <div className="stat-label">负余额天数</div>
            </div>
          </div>
        </div>
      </div>

      <div className="chart-wrapper">
        <svg width={W} height={H} className="cashflow-chart">
          <defs>
            <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#667eea" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#764ba2" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f093fb" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#667eea" />
              <stop offset="50%" stopColor="#764ba2" />
              <stop offset="100%" stopColor="#f093fb" />
            </linearGradient>
          </defs>

          <rect width={W} height={H} fill="#fafbfc" />

          {yLabels.map((l, i) => (
            <g key={`y-${i}`}>
              <line x1={PAD_L} y1={l.y} x2={W - PAD_R} y2={l.y} stroke={i === 0 ? '#dee2e6' : '#f0f0f0'} strokeWidth={i === 0 ? '2' : '1'} />
              <text x={PAD_L - 10} y={l.y + 4} textAnchor="end" fontSize="11" fill="#6c757d" fontWeight={i === 0 ? '600' : '400'}>
                ¥{(l.val / 1000).toFixed(0)}k
              </text>
            </g>
          ))}

          {zeroY !== null && (
            <g>
              <line x1={PAD_L} y1={zeroY} x2={W - PAD_R} y2={zeroY} stroke="#ff6b6b" strokeWidth="2" strokeDasharray="5,5" opacity="0.7" />
              <text x={W - PAD_R + 5} y={zeroY - 5} fontSize="10" fill="#ff6b6b" fontWeight="500">零线</text>
            </g>
          )}

          <path d={areaPath} fill="url(#areaGrad)" opacity="0.6" />
          <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="3" />

          {cashFlowData.map((d, i) => {
            const isHovered = tooltip && tooltip.date === d.date;
            return (
              <circle
                key={d.date}
                cx={xScale(i)} cy={yScale(d.balance)}
                r={isHovered ? '6' : '4'}
                fill={d.balance >= 0 ? '#667eea' : '#ff6b6b'}
                stroke="white"
                strokeWidth="2"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setTooltip(d)}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          })}

          {xLabels.map((l, i) => {
            const d = parseISO(l.date);
            return (
              <text key={`x-${i}`} x={l.x} y={H - 10} textAnchor="middle" fontSize="11" fill="#6c757d">
                {format(d, 'M/d')}
              </text>
            );
          })}
        </svg>

        {tooltip && (
          <div className="chart-tooltip" style={{ left: xScale(cashFlowData.findIndex((d) => d.date === tooltip.date)) + PAD_L, top: yScale(tooltip.balance) - 70 }}>
            <div className="tooltip-date">{format(parseISO(tooltip.date), 'yyyy年MM月dd日', { locale: zhCN })}</div>
            <div className="tooltip-balance">余额: ¥{tooltip.balance.toLocaleString()}</div>
            <div className="tooltip-details">
              <div>收入: ¥{tooltip.income.toLocaleString()}</div>
              <div>支出: ¥{tooltip.expense.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      <div className="chart-legend">
        <div className="legend-item"><div className="legend-gradient" /><span>现金流余额趋势</span></div>
        {zeroY !== null && <div className="legend-item"><div className="legend-dashed" /><span>零平衡线</span></div>}
      </div>
    </div>
  );
}
