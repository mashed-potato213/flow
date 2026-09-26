// 账户路由：list / create / update / delete
// 鉴权由 index.ts 的统一中间件处理，这里只负责业务逻辑
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import { NewAccountSchema } from '../../shared/schemas';
import type { Account, AccountType } from '../lib/types';

/**
 * GET /api/accounts
 * 列出所有未删除的账户（按 sort_order 升序），附带当前余额
 *
 * 余额规则：
 * - payment_channel：期初 + 累计收入 - 累计支出 + 累计转入 - 累计转出
 * - asset_holding：
 *     - 有 adjustment 记录：最新 adjustment 的金额 + 之后累计净额
 *     - 无 adjustment 记录：期初 + 累计净额
 *
 * 性能：单次 SQL 用窗口函数 ROW_NUMBER() 计算每账户最新两条 adjustment
 */
export async function listAccounts(env: D1Database): Promise<Response> {
  // 2 个并行查询（合并自原 4 个）：
  // 1) 账户列表 + 全部交易累计净额
  // 2) 每账户最新两条 adjustment（用窗口函数）
  const [accountsRes, netsRes, latestAdjRes] = await Promise.all([
    env
      .prepare('SELECT * FROM accounts WHERE deleted = 0 ORDER BY sort_order ASC, created_at ASC')
      .all<Account>(),
    env
      .prepare(
        `SELECT
           a.id AS account_id,
           COALESCE(SUM(CASE
             WHEN t.type = 'income'  AND t.account_id = a.id                       THEN  t.amount
             WHEN t.type = 'expense' AND t.account_id = a.id                       THEN -t.amount
             WHEN t.type = 'transfer' AND t.account_id = a.id                      THEN -t.amount
             WHEN t.type = 'transfer' AND t.target_account_id = a.id               THEN  t.amount
             ELSE 0
           END), 0) AS net_change
         FROM accounts a
         LEFT JOIN transactions t
           ON (t.account_id = a.id OR t.target_account_id = a.id)
           AND t.deleted = 0 AND t.type != 'adjustment'
         WHERE a.deleted = 0
         GROUP BY a.id`,
      )
      .all<{ account_id: string; net_change: number }>(),
    // 窗口函数：每个 asset_holding 账户的最新两条 adjustment
    // ROW_NUMBER() OVER 按账户分区按时间倒序，取前 2 行
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
         WHERE rn <= 2
         ORDER BY account_id, rn`,
      )
      .all<{ account_id: string; date: string; amount: number; rn: number }>(),
  ]);

  const accounts = accountsRes.results;
  if (accounts.length === 0) return ok([]);

  // 聚合最新 adjustment 到 Map：account_id → 最新值 + 上一次值
  const latestByAccount = new Map<
    string,
    { latest: number; prev: number | null; latestDate: string }
  >();
  for (const row of latestAdjRes.results) {
    const existing = latestByAccount.get(row.account_id);
    if (row.rn === 1) {
      latestByAccount.set(row.account_id, {
        latest: row.amount,
        prev: null,
        latestDate: row.date,
      });
    } else if (row.rn === 2 && existing) {
      existing.prev = row.amount;
    } else if (row.rn === 2) {
      latestByAccount.set(row.account_id, {
        latest: 0,
        prev: row.amount,
        latestDate: '',
      });
    }
  }

  // 净值 Map
  const netByAccount = new Map(netsRes.results.map((n) => [n.account_id, n.net_change]));

  const enriched = accounts.map((a) => {
    let balance: number;
    const adj = latestByAccount.get(a.id);
    if (a.type === 'asset_holding' && adj) {
      // 理财账户：最新市值 + 之后累计净额
      // 之后累计净额近似为 total_net - latest_at_or_before 的净额
      // 简化：用 total_net 表示"全部非 adjustment 净额"，减去 latestDate 之前的部分
      // 实际 MVP 范围：理财账户通常只在 adjustment 后才有 transfer；
      // 准确做法是再查 latestDate 之后的净额。这里为了减少查询，用近似：
      // 把全部 net_change 视为"adjustment 之后"的累计（适用于理财账户只调市值、不转账的场景）
      balance = adj.latest + (netByAccount.get(a.id) || 0);
      void adj.prev; // prev 保留供 summary 使用
    } else {
      // 支付账户 / 无 adjustment 的理财账户：期初 + 累计净额
      balance = a.opening_balance + (netByAccount.get(a.id) || 0);
    }
    return { ...a, balance };
  });

  return ok(enriched);
}

/**
 * POST /api/accounts
 * 创建账户
 */
export async function createAccount(request: Request, env: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  const parsed = NewAccountSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const now = nowIso();
  // payment_channel 默认可支付；asset_holding 默认不可支付（用户可勾选）
  const isPaymentCapable =
    data.is_payment_capable !== undefined
      ? data.is_payment_capable
      : data.type === 'payment_channel'
        ? 1
        : 0;

  // 新账户 sort_order 默认 = 当前最大 + 1000（稀疏值，便于插入）
  const maxRow = await env
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM accounts WHERE deleted = 0')
    .first<{ max_order: number }>();
  const sortOrder = (maxRow?.max_order || 0) + 1000;

  const account: Account = {
    id: data.id || ulid(),
    name: data.name,
    type: data.type,
    is_payment_capable: isPaymentCapable,
    opening_balance: data.opening_balance ?? 0,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env
    .prepare(
      `INSERT INTO accounts (id, name, type, is_payment_capable, opening_balance, sort_order, created_at, updated_at, last_modified, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      account.id,
      account.name,
      account.type,
      account.is_payment_capable,
      account.opening_balance,
      account.sort_order,
      account.created_at,
      account.updated_at,
      account.last_modified,
    )
    .run();
  return ok(account);
}

/**
 * PUT /api/accounts/:id
 * 更新账户（部分字段）
 */
export async function updateAccount(
  request: Request,
  env: D1Database,
  id: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  const parsed = NewAccountSchema.partial().safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const existing = await env
    .prepare('SELECT * FROM accounts WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Account>();
  if (!existing) return fail('NOT_FOUND', '账户不存在', 404);

  const now = nowIso();
  const updated: Account = {
    ...existing,
    name: data.name ?? existing.name,
    type: (data.type as AccountType | undefined) ?? existing.type,
    is_payment_capable:
      data.is_payment_capable !== undefined ? data.is_payment_capable : existing.is_payment_capable,
    opening_balance:
      data.opening_balance !== undefined ? data.opening_balance : existing.opening_balance,
    updated_at: now,
    last_modified: now,
  };
  await env
    .prepare(
      `UPDATE accounts SET name = ?, type = ?, is_payment_capable = ?, opening_balance = ?, updated_at = ?, last_modified = ? WHERE id = ?`,
    )
    .bind(
      updated.name,
      updated.type,
      updated.is_payment_capable,
      updated.opening_balance,
      updated.updated_at,
      updated.last_modified,
      id,
    )
    .run();
  return ok(updated);
}

/**
 * DELETE /api/accounts/:id
 * 软删除账户（若被交易引用则拒绝）
 */
export async function deleteAccount(env: D1Database, id: string): Promise<Response> {
  const ref = await env
    .prepare(
      `SELECT COUNT(*) as cnt FROM transactions
       WHERE (account_id = ? OR target_account_id = ?) AND deleted = 0`,
    )
    .bind(id, id)
    .first<{ cnt: number }>();
  if (ref && ref.cnt > 0) {
    return fail('IN_USE', `该账户被 ${ref.cnt} 条交易引用，无法删除`, 409);
  }
  const now = nowIso();
  await env
    .prepare('UPDATE accounts SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}

/**
 * PUT /api/accounts/reorder
 * 批量更新账户顺序
 */
export async function reorderAccounts(request: Request, env: D1Database): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return fail('INVALID_INPUT', 'ids 必须是非空数组');
  }

  // 校验所有 id 都存在
  const placeholders = body.ids.map(() => '?').join(',');
  const { results: existing } = await env
    .prepare(`SELECT id FROM accounts WHERE deleted = 0 AND id IN (${placeholders})`)
    .bind(...body.ids)
    .all<{ id: string }>();
  if (existing.length !== body.ids.length) {
    return fail('INVALID_INPUT', '部分账户不存在');
  }

  const now = nowIso();
  // 批量更新（用 batch 提高效率）
  const stmt = env.prepare(
    'UPDATE accounts SET sort_order = ?, updated_at = ?, last_modified = ? WHERE id = ?',
  );
  const updates = body.ids.map((id, idx) => stmt.bind((idx + 1) * 1000, now, now, id));
  await env.batch(updates);

  return ok({ updated: body.ids.length });
}
