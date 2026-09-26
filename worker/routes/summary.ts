// 月度汇总路由：统计当月收支 + 分类饼图数据 + 理财账户当日盈亏
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
  today_pnl: number | null; // null = 数据不足
  last_update_date: string | null;
}

/**
 * GET /api/summary?month=YYYY-MM
 */
export async function getSummary(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const monthParam = url.searchParams.get('month');

  const now = new Date();
  const month = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return fail('INVALID_MONTH', '月份格式错误，应为 YYYY-MM');
  }

  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr ?? '', 10);
  const m = parseInt(monthStr ?? '', 10);

  if (m < 1 || m > 12) {
    return fail('INVALID_MONTH', '月份范围无效');
  }

  const startDate = `${year}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(year, m, 0).getDate();
  const endDate = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // 4 个并行查询（窗口函数替代原 N+1）：
  // 1) 当月所有交易
  // 2) 所有未删除账户
  // 3) 所有未删除分类
  // 4) 所有 asset_holding 账户的最新两条 adjustment（窗口函数）
  const [txsRes, accountsRes, categoriesRes, latestAdjRes] = await Promise.all([
    env
      .prepare(
        `SELECT * FROM transactions
         WHERE deleted = 0 AND date >= ? AND date <= ?
         AND type IN ('income', 'expense', 'transfer', 'adjustment')`,
      )
      .bind(startDate, endDate)
      .all<Transaction>(),
    env.prepare('SELECT * FROM accounts WHERE deleted = 0').all<Account>(),
    env.prepare('SELECT * FROM categories WHERE deleted = 0').all<Category>(),
    env
      .prepare(
        `WITH ranked AS (
           SELECT
             account_id,
             date,
             amount,
             ROW_NUMBER() OVER (
               PARTITION BY account_id
               ORDER BY date DESC, last_modified DESC
             ) AS rn
           FROM transactions
           WHERE deleted = 0 AND type = 'adjustment'
         )
         SELECT account_id, date, amount, rn
         FROM ranked
         WHERE rn <= 2`,
      )
      .all<{ account_id: string; date: string; amount: number; rn: number }>(),
  ]);

  const txs = txsRes.results;
  const accounts = accountsRes.results;
  const categories = categoriesRes.results;
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));

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
      void accountMap;
    } else if (tx.type === 'adjustment') {
      // 调整（市值记录）：不计入收支汇总，仅按分类聚合（finance scope）
      accumulate(categoryStats, tx.category_id, categoryMap, tx.amount, 'finance');
    }
  }

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

  // 理财账户 P&L：聚合窗口函数结果
  // 语义修正：仅 1 条 adjustment 时 today_pnl = null（数据不足）
  const adjByAccount = new Map<string, Array<{ amount: number; date: string }>>();
  for (const row of latestAdjRes.results) {
    const arr = adjByAccount.get(row.account_id) ?? [];
    arr.push({ amount: row.amount, date: row.date });
    adjByAccount.set(row.account_id, arr);
  }

  const financeAccounts = accounts.filter((a) => a.type === 'asset_holding');
  const financePnls: FinancePnl[] = financeAccounts.map((acc) => {
    const arr = adjByAccount.get(acc.id) ?? [];
    // 窗口函数已按 rn 升序，即 arr[0] = 最新, arr[1] = 上一次
    const today = arr[0];
    const yesterday = arr[1];
    let todayPnl: number | null = null;
    if (today && yesterday) {
      todayPnl = round2(today.amount - yesterday.amount);
    }
    return {
      account_id: acc.id,
      account_name: acc.name,
      current_value: today?.amount ?? null,
      today_pnl: todayPnl,
      last_update_date: today?.date ?? null,
    };
  });

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
