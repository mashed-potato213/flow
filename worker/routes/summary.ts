// 月度汇总路由：统计当月收支 + 分类饼图数据 + 理财账户当日盈亏
// 鉴权由 index.ts 的统一中间件处理，这里只负责业务逻辑
import { ok, fail } from '../lib/response';
import type { Account, Category, Transaction } from '../lib/types';

interface CategorySummary {
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

/**
 * GET /api/summary?month=YYYY-MM
 * 返回指定月份的收支汇总、按分类汇总、理财账户当日盈亏
 */
export async function getSummary(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month');

  // 默认本月
  const now = new Date();
  const month =
    monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 校验月份格式
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return fail('INVALID_MONTH', '月份格式错误，应为 YYYY-MM');
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);

  if (m < 1 || m > 12) {
    return fail('INVALID_MONTH', '月份范围无效');
  }

  // 计算月份起止
  const startDate = `${year}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // 拉取当月所有交易
  const { results: txs } = await env
    .prepare(
      `SELECT * FROM transactions
       WHERE deleted = 0 AND date >= ? AND date <= ?
       AND type IN ('income', 'expense', 'transfer', 'adjustment')`,
    )
    .bind(startDate, endDate)
    .all<Transaction>();

  // 拉取所有账户和分类（用于名字映射）
  const { results: accounts } = await env
    .prepare('SELECT * FROM accounts WHERE deleted = 0')
    .all<Account>();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const { results: categories } = await env
    .prepare('SELECT * FROM categories WHERE deleted = 0')
    .all<Category>();
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  // 计算当月汇总
  let totalIncome = 0;
  let totalExpense = 0;
  const categoryStats = new Map<string, CategorySummary>();

  for (const tx of txs) {
    if (tx.type === 'income') {
      totalIncome += tx.amount;
      accumulate(categoryStats, tx.category_id, categoryMap, tx.amount, 'income');
    } else if (tx.type === 'expense') {
      totalExpense += tx.amount;
      accumulate(categoryStats, tx.category_id, categoryMap, tx.amount, 'expense');
    } else if (tx.type === 'transfer') {
      // 转账：仅是资产移动，不计入收支汇总与分类饼图
      // accountMap 仅用于占位（确保 TS 编译用到，避免未使用警告）
      void accountMap;
    } else if (tx.type === 'adjustment') {
      // 调整（市值记录）：不计入收支汇总，仅按分类聚合（finance scope）
      accumulate(categoryStats, tx.category_id, categoryMap, tx.amount, 'finance');
    }
  }

  // 分类汇总：分离 expense、income、finance 三大类
  const byScope = {
    expense: Array.from(categoryStats.values())
      .filter((c) => c.scope === 'expense')
      .sort((a, b) => b.total - a.total),
    income: Array.from(categoryStats.values())
      .filter((c) => c.scope === 'income')
      .sort((a, b) => b.total - a.total),
    finance: Array.from(categoryStats.values())
      .filter((c) => c.scope === 'finance')
      .sort((a, b) => b.total - a.total),
  };

  // 理财账户 P&L：每个 asset_holding 账户计算当日盈亏
  const financeAccounts = accounts.filter((a) => a.type === 'asset_holding');
  const financePnls: FinancePnl[] = [];

  for (const acc of financeAccounts) {
    const { results: adjustments } = await env
      .prepare(
        `SELECT date, amount FROM transactions
         WHERE deleted = 0 AND type = 'adjustment' AND account_id = ?
         ORDER BY date DESC, last_modified DESC LIMIT 2`,
      )
      .bind(acc.id)
      .all<{ date: string; amount: number }>();

    const todayValue = adjustments[0]?.amount ?? null;
    const yesterdayValue = adjustments[1]?.amount ?? acc.opening_balance;
    const todayPnl = todayValue !== null ? todayValue - yesterdayValue : 0;

    financePnls.push({
      account_id: acc.id,
      account_name: acc.name,
      current_value: todayValue,
      today_pnl: todayPnl,
      last_update_date: adjustments[0]?.date || null,
    });
  }

  return ok({
    month,
    period: { start: startDate, end: endDate },
    total_income: round2(totalIncome),
    total_expense: round2(totalExpense),
    net: round2(totalIncome - totalExpense),
    by_scope: {
      expense: byScope.expense.map((s) => ({ ...s, total: round2(s.total) })),
      income: byScope.income.map((s) => ({ ...s, total: round2(s.total) })),
      finance: byScope.finance.map((s) => ({ ...s, total: round2(s.total) })),
    },
    finance_pnl: financePnls,
    tx_count: txs.length,
  });
}

/**
 * 累加分类统计
 */
function accumulate(
  stats: Map<string, CategorySummary>,
  categoryId: string | null,
  categoryMap: Map<string, Category>,
  amount: number,
  scope: string,
) {
  if (!categoryId) return;
  const cat = categoryMap.get(categoryId);
  const existing = stats.get(categoryId);
  if (existing) {
    existing.total += amount;
    existing.count += 1;
  } else {
    stats.set(categoryId, {
      category_id: categoryId,
      name: cat?.name || '已删除分类',
      icon: cat?.icon || null,
      scope: cat?.scope || scope,
      total: amount,
      count: 1,
    });
  }
}

/**
 * 金额四舍五入到 2 位小数
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
