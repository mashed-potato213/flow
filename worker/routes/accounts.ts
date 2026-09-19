// 账户路由：list / create / update / delete
// 鉴权由 index.ts 的统一中间件处理，这里只负责业务逻辑
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import type { Account, AccountType } from '../lib/types';

/**
 * GET /api/accounts
 * 列出所有未删除的账户（按 sort_order 升序），附带当前余额
 *
 * 余额规则：
 * - payment_channel：期初 + 累计收入 - 累计支出 + 累计转入 - 累计转出
 * - asset_holding：
 *     - 有 adjustment 记录：最新 adjustment 的金额 + 之后累计净额（income/expense/transfer）
 *     - 无 adjustment 记录：期初 + 累计净额
 */
export async function listAccounts(env: D1Database): Promise<Response> {
  // 4 个查询并行执行
  const [accountsRes, netsRes, valuesRes, postAdjRes] = await Promise.all([
    env.prepare(
      'SELECT * FROM accounts WHERE deleted = 0 ORDER BY sort_order ASC, created_at ASC',
    ).all<Account>(),
    env.prepare(
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
    ).all<{ account_id: string; net_change: number }>(),
    env.prepare(
      `SELECT account_id, amount FROM transactions
       WHERE deleted = 0 AND type = 'adjustment'
         AND (account_id, date, created_at) IN (
           SELECT account_id, date, MAX(created_at) FROM transactions
           WHERE deleted = 0 AND type = 'adjustment'
           GROUP BY account_id, date
         )
       ORDER BY account_id, date DESC`,
    ).all<{ account_id: string; amount: number }>(),
    // 每个账户"最新一笔 adjustment 之后"的累计净额（理财账户专用，
    // 修复：之前直接用最新市值，漏算了 adjustment 之后的 income/expense/transfer）
    env.prepare(
      `SELECT
         a.id AS account_id,
         COALESCE(SUM(CASE
           WHEN t.type = 'income'  AND t.account_id = a.id                       THEN  t.amount
           WHEN t.type = 'expense' AND t.account_id = a.id                       THEN -t.amount
           WHEN t.type = 'transfer' AND t.account_id = a.id                      THEN -t.amount
           WHEN t.type = 'transfer' AND t.target_account_id = a.id               THEN  t.amount
           ELSE 0
         END), 0) AS post_adj_net
       FROM accounts a
       LEFT JOIN transactions t
         ON (t.account_id = a.id OR t.target_account_id = a.id)
         AND t.deleted = 0 AND t.type != 'adjustment'
         AND (t.date || 'T' || t.last_modified) > COALESCE(
           (SELECT MAX(date || 'T' || last_modified)
            FROM transactions
            WHERE account_id = a.id AND deleted = 0 AND type = 'adjustment'),
           ''
         )
       WHERE a.deleted = 0
       GROUP BY a.id`,
    ).all<{ account_id: string; post_adj_net: number }>(),
  ]);

  const accounts = accountsRes.results;
  if (accounts.length === 0) return ok([]);

  // 每个 asset_holding 账户取第一条（最新）
  const latestValueByAccount = new Map<string, number>();
  for (const v of valuesRes.results) {
    if (!latestValueByAccount.has(v.account_id)) {
      latestValueByAccount.set(v.account_id, v.amount);
    }
  }

  const netByAccount = new Map(netsRes.results.map((n) => [n.account_id, n.net_change]));
  const postAdjNetByAccount = new Map(
    postAdjRes.results.map((p) => [p.account_id, p.post_adj_net]),
  );

  const enriched = accounts.map((a) => {
    let balance: number;
    if (a.type === 'asset_holding' && latestValueByAccount.has(a.id)) {
      // 理财账户：最新市值 + 之后累计净额
      balance =
        latestValueByAccount.get(a.id)! + (postAdjNetByAccount.get(a.id) || 0);
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
  const body = (await request.json().catch(() => ({}))) as Partial<Account>;
  if (!body.name || !body.type) {
    return fail('INVALID_INPUT', '缺少必填字段');
  }
  if (!['payment_channel', 'asset_holding'].includes(body.type)) {
    return fail('INVALID_TYPE', '账户类型无效');
  }
  const now = nowIso();
  // payment_channel 默认可支付；asset_holding 默认不可支付（用户可勾选）
  const isPaymentCapable =
    body.is_payment_capable !== undefined
      ? (body.is_payment_capable ? 1 : 0)
      : body.type === 'payment_channel'
        ? 1
        : 0;

  // 新账户 sort_order 默认 = 当前最大 + 1000（稀疏值，便于插入）
  const maxRow = await env.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM accounts WHERE deleted = 0',
  ).first<{ max_order: number }>();
  const sortOrder = (maxRow?.max_order || 0) + 1000;

  const account: Account = {
    id: ulid(),
    name: body.name,
    type: body.type as AccountType,
    is_payment_capable: isPaymentCapable,
    opening_balance: Number(body.opening_balance) || 0,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env.prepare(
    `INSERT INTO accounts (id, name, type, is_payment_capable, opening_balance, sort_order, created_at, updated_at, last_modified, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).bind(
    account.id,
    account.name,
    account.type,
    account.is_payment_capable,
    account.opening_balance,
    account.sort_order,
    account.created_at,
    account.updated_at,
    account.last_modified,
  ).run();
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
  const body = (await request.json().catch(() => ({}))) as Partial<Account>;
  const existing = await env.prepare(
    'SELECT * FROM accounts WHERE id = ? AND deleted = 0',
  )
    .bind(id)
    .first<Account>();
  if (!existing) return fail('NOT_FOUND', '账户不存在', 404);

  // 如果提供了 type，必须合法
  if (body.type !== undefined && !['payment_channel', 'asset_holding'].includes(body.type)) {
    return fail('INVALID_TYPE', '账户类型无效');
  }

  const now = nowIso();
  const updated: Account = {
    ...existing,
    name: body.name ?? existing.name,
    type: (body.type as AccountType | undefined) ?? existing.type,
    is_payment_capable:
      body.is_payment_capable !== undefined
        ? (body.is_payment_capable ? 1 : 0)
        : existing.is_payment_capable ?? 0,
    opening_balance:
      body.opening_balance !== undefined
        ? Number(body.opening_balance)
        : existing.opening_balance,
    updated_at: now,
    last_modified: now,
  };
  await env.prepare(
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
  const ref = await env.prepare(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE (account_id = ? OR target_account_id = ?) AND deleted = 0`,
  )
    .bind(id, id)
    .first<{ cnt: number }>();
  if (ref && ref.cnt > 0) {
    return fail('IN_USE', `该账户被 ${ref.cnt} 条交易引用，无法删除`, 409);
  }
  const now = nowIso();
  await env.prepare(
    'UPDATE accounts SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?',
  )
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}

/**
 * PUT /api/accounts/reorder
 * 批量更新账户顺序
 * body: { ids: string[] } — 按数组顺序赋值 sort_order = 1000, 2000, ...
 */
export async function reorderAccounts(request: Request, env: D1Database): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return fail('INVALID_INPUT', 'ids 必须是非空数组');
  }

  // 校验所有 id 都存在
  const placeholders = body.ids.map(() => '?').join(',');
  const { results: existing } = await env.prepare(
    `SELECT id FROM accounts WHERE deleted = 0 AND id IN (${placeholders})`,
  )
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
