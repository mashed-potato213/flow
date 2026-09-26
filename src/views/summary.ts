// 月度汇总视图（Day 5 完整实现）
// - 月份切换
// - 总览卡片（收入/支出/净结余）
// - 支出/收入分类 Chart.js 环形饼图
// - 理财账户当日盈亏
import { api } from '../api';
import { renderTabBar, bindTabBar } from './tabbar';
import { formatMoney } from '../utils';
import Chart from 'chart.js/auto';

// 饼图实例持有：路由切换时统一销毁，避免内存泄漏
// 类型用宽口径 Chart（chart.js/auto 的类型），具体 doughnut chart 是其子类型
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chartInstances: any[] = [];

// 选中的月份（YYYY-MM）；空字符串表示本月（后端默认）
let currentMonth = '';

interface Summary {
  month: string;
  period: { start: string; end: string };
  total_income: number;
  total_expense: number;
  net: number;
  by_scope: {
    expense: CategorySummaryItem[];
    income: CategorySummaryItem[];
    finance: CategorySummaryItem[];
  };
  finance_pnl: FinancePnl[];
  tx_count: number;
}

interface CategorySummaryItem {
  category_id: string | null;
  name: string;
  icon: string | null;
  scope: string;
  total: number;
  count: number;
}

interface FinancePnl {
  account_id: string;
  account_name: string;
  current_value: number | null;
  today_pnl: number;
  last_update_date: string | null;
}

// 饼图配色（与前端设计风格统一：蓝/红/绿/橙/紫 等）
const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

/**
 * HTML 转义
 */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c,
  );
}

/**
 * 月份偏移（delta = -1 上月，+1 下月）
 */
function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const year = y ?? 0;
  const month = m ?? 1;
  const newDate = new Date(year, month - 1 + delta, 1);
  return `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 渲染汇总页面
 */
export async function renderSummary(root: HTMLElement, params: Record<string, string> = {}) {
  // 进入页面：清理上次渲染遗留的图表实例（避免 canvas 引用残留）
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];

  // 优先使用 URL 上的 month 参数（支持直接打开 #/summary?month=2026-09）
  // 模块变量 currentMonth 仍用于月份切换时传递状态
  if (params.month) {
    currentMonth = params.month;
  }

  root.innerHTML = `
    <div class="min-h-screen bg-gray-50 pb-tabbar">
      <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10">
        <h1 class="text-xl font-bold text-gray-900 py-4">月度汇总</h1>
      </header>
      <div class="p-4 space-y-4">
        <div id="content" class="text-center py-12 text-gray-400">加载中...</div>
      </div>
      ${renderTabBar()}
    </div>
  `;

  const content = root.querySelector<HTMLDivElement>('#content');
  if (!content) return;

  const query = currentMonth ? `?month=${encodeURIComponent(currentMonth)}` : '';
  const res = await api.get<Summary>(`/summary${query}`);
  if (!res.ok || !res.data) {
    content.innerHTML = `<div class="bg-white rounded-xl p-8 text-red-500 text-center">${escapeHtml(
      res.error?.message || '加载失败',
    )}</div>`;
    bindTabBar(root); // 错误分支也要绑定 tab，否则 tab 无法切换
    return;
  }

  const s = res.data;

  content.innerHTML = `
    <!-- 月份选择 -->
    <div class="flex items-center justify-between bg-white rounded-xl px-3 py-2">
      <button id="prev-month" class="px-3 py-1 text-sm text-primary active:opacity-60">← 上月</button>
      <span class="font-medium text-gray-900">${escapeHtml(s.month)}</span>
      <button id="next-month" class="px-3 py-1 text-sm text-primary active:opacity-60">下月 →</button>
    </div>

    <!-- 总览卡片 -->
    <div class="bg-white rounded-xl p-4 space-y-2">
      <div class="flex justify-between">
        <span class="text-gray-600">总收入</span>
        <span class="text-green-600 font-medium">+${formatMoney(s.total_income)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-600">总支出</span>
        <span class="text-red-600 font-medium">-${formatMoney(s.total_expense)}</span>
      </div>
      <div class="flex justify-between pt-2 border-t border-gray-100">
        <span class="text-gray-900 font-medium">净结余</span>
        <span class="font-bold ${s.net >= 0 ? 'text-green-600' : 'text-red-600'}">${
          s.net >= 0 ? '+' : ''
        }${formatMoney(s.net)}</span>
      </div>
      <div class="text-xs text-gray-400 text-center pt-1">共 ${s.tx_count} 条记录</div>
    </div>

    <!-- 支出饼图 -->
    ${renderScopeSection('支出分类', '🛒', s.by_scope.expense, 'expense')}
    <!-- 收入饼图 -->
    ${renderScopeSection('收入分类', '💰', s.by_scope.income, 'income')}
    <!-- 理财 P&L -->
    ${renderFinanceSection(s.finance_pnl)}

    ${
      s.by_scope.expense.length === 0 &&
      s.by_scope.income.length === 0 &&
      s.finance_pnl.length === 0
        ? `<div class="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">本月暂无数据</div>`
        : ''
    }
  `;

  // 月份切换
  content
    .querySelector<HTMLButtonElement>('#prev-month')
    ?.addEventListener('click', () => navigateMonth(-1, root));
  content
    .querySelector<HTMLButtonElement>('#next-month')
    ?.addEventListener('click', () => navigateMonth(1, root));

  // 渲染饼图（仅当存在数据时）
  if (s.by_scope.expense.length > 0) {
    renderPieChart(content, 'expense-chart', s.by_scope.expense);
  }
  if (s.by_scope.income.length > 0) {
    renderPieChart(content, 'income-chart', s.by_scope.income);
  }

  bindTabBar(root);
}

/**
 * 触发月份切换并重新渲染
 */
function navigateMonth(delta: number, _root: HTMLElement) {
  // 当前显示的月份：优先用 currentMonth；为空则取本月
  const base =
    currentMonth ||
    (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
  currentMonth = shiftMonth(base, delta);
  // 同步 hash（便于刷新 / 分享）
  location.hash = `#/summary?month=${currentMonth}`;
  // 注意：hashchange 监听会再次触发 handleRoute，从而再次调用 renderSummary
  // 这里不再额外调用 renderSummary，避免双重渲染
}

/**
 * 渲染单个分类区块（标题 + 饼图 + 图例 + 合计）
 */
function renderScopeSection(
  title: string,
  emoji: string,
  items: CategorySummaryItem[],
  chartId: string,
): string {
  if (items.length === 0) return '';
  const total = items.reduce((sum, item) => sum + item.total, 0);
  return `
    <div class="bg-white rounded-xl p-4">
      <h3 class="font-medium text-gray-900 mb-3">${emoji} ${escapeHtml(title)}</h3>
      <div class="flex items-center">
        <div class="w-32 h-32 flex-shrink-0">
          <canvas id="${chartId}-chart"></canvas>
        </div>
        <div class="flex-1 ml-4 space-y-1 text-sm">
          ${items
            .slice(0, 5)
            .map(
              (item, i) => `
            <div class="flex items-center">
              <span class="w-3 h-3 rounded-full mr-2 flex-shrink-0" style="background:${COLORS[i % COLORS.length]}"></span>
              <span class="flex-1 truncate text-gray-700">${
                item.icon ? escapeHtml(item.icon) + ' ' : ''
              }${escapeHtml(item.name)}</span>
              <span class="text-gray-900 ml-2 whitespace-nowrap">${formatMoney(item.total)}</span>
            </div>
          `,
            )
            .join('')}
          ${
            items.length > 5
              ? `<div class="text-xs text-gray-400 pt-1">+${items.length - 5} 项...</div>`
              : ''
          }
        </div>
      </div>
      <div class="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600 flex justify-between">
        <span>合计</span>
        <span class="font-medium">${formatMoney(total)}</span>
      </div>
    </div>
  `;
}

/**
 * 渲染理财账户 P&L 区块
 */
function renderFinanceSection(pnls: FinancePnl[]): string {
  if (pnls.length === 0) return '';
  return `
    <div class="bg-white rounded-xl p-4">
      <h3 class="font-medium text-gray-900 mb-3">📊 理财账户</h3>
      <div class="space-y-3">
        ${pnls
          .map(
            (p) => `
          <div class="flex justify-between items-center">
            <div class="min-w-0">
              <div class="text-gray-900 truncate">${escapeHtml(p.account_name)}</div>
              <div class="text-xs text-gray-400 mt-0.5">
                ${p.current_value !== null ? `当前市值 ${formatMoney(p.current_value)}` : '暂无记录'}
                ${p.last_update_date ? ` · ${escapeHtml(p.last_update_date)}` : ''}
              </div>
            </div>
            <div class="text-right ml-3 flex-shrink-0">
              <div class="text-sm font-medium ${
                p.today_pnl >= 0 ? 'text-green-600' : 'text-red-600'
              }">${p.today_pnl >= 0 ? '+' : ''}${formatMoney(p.today_pnl)}</div>
              <div class="text-xs text-gray-400">当日盈亏</div>
            </div>
          </div>
        `,
          )
          .join('')}
      </div>
    </div>
  `;
}

/**
 * 渲染 Chart.js 环形饼图
 * @param scope 父容器（避免使用全局 document.getElementById 抓取到旧 canvas）
 */
function renderPieChart(scope: HTMLElement, canvasId: string, items: CategorySummaryItem[]) {
  const canvas = scope.querySelector<HTMLCanvasElement>(`#${canvasId}`);
  if (!canvas || items.length === 0) return;

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => `${i.icon || ''} ${i.name}`.trim()),
      datasets: [
        {
          data: items.map((i) => i.total),
          backgroundColor: items.map((_, i) => COLORS[i % COLORS.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const value = typeof ctx.parsed === 'number' ? ctx.parsed : 0;
              return `${ctx.label}: ${formatMoney(value)}`;
            },
          },
        },
      },
    },
  });
  chartInstances.push(chart);
}
