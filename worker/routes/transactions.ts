// 交易路由：list / get / create / update / delete
// 鉴权由 index.ts 的统一中间件处理，这里只负责业务逻辑
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import type { Transaction, TransactionType } from '../lib/types';

const VALID_TYPES: TransactionType[] = ['income', 'expense', 'transfer', 'adjustment'];

/**
 * GET /api/transactions
 * 查询参数：
 *   - account     账户 ID（同时匹配 account_id 与 target_account_id）
 *   - category    分类 ID
 *   - type        类型（income/expense/transfer/adjustment）
 *   - start/end   日期范围 YYYY-MM-DD
 *   - q           备注模糊搜索
 *   - limit/offset 分页（默认 100/0，limit 上限 500）
 */
export async function listTransactions(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const account = url.searchParams.get('account');
  const category = url.searchParams.get('category');
  const type = url.searchParams.get('type');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const q = url.searchParams.get('q');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const where: string[] = ['deleted = 0'];
  const params: any[] = [];

  if (account) {
    where.push('(account_id = ? OR target_account_id = ?)');
    params.push(account, account);
  }
  if (category) {
    where.push('category_id = ?');
    params.push(category);
  }
  if (type && VALID_TYPES.includes(type as TransactionType)) {
    where.push('type = ?');
    params.push(type);
  }
  if (start) {
    where.push('date >= ?');
    params.push(start);
  }
  if (end) {
    where.push('date <= ?');
    params.push(end);
  }
  if (q) {
    where.push('note LIKE ?');
    params.push(`%${q}%`);
  }

  const sql = `SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, last_modified DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const { results } = await env.prepare(sql).bind(...params).all<Transaction>();
  return ok(results);
}

/**
 * GET /api/transactions/:id
 */
export async function getTransaction(env: D1Database, id: string): Promise<Response> {
  const row = await env.prepare('SELECT * FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Transaction>();
  if (!row) return fail('NOT_FOUND', '交易不存在', 404);
  return ok(row);
}

/**
 * 校验交易 payload
 */
function validateTransactionPayload(body: Partial<Transaction>): string | null {
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return '日期格式错误';
  if (typeof body.amount !== 'number' || body.amount <= 0) return '金额必须为正数';
  if (!body.type || !VALID_TYPES.includes(body.type as TransactionType)) return '类型无效';
  if (!body.account_id) return '缺少账户';
  if (body.type === 'transfer') {
    if (!body.target_account_id) return '转账需要目标账户';
    if (body.target_account_id === body.account_id) return '源账户和目标账户不能相同';
  }
  return null;
}

/**
 * POST /api/transactions
 */
export async function createTransaction(request: Request, env: D1Database): Promise<Response> {
  let body: Partial<Transaction>;
  try {
    body = (await request.json()) as Partial<Transaction>;
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }

  const err = validateTransactionPayload(body);
  if (err) return fail('INVALID_INPUT', err);

  const now = nowIso();
  const tx: Transaction = {
    id: ulid(),
    date: body.date!,
    amount: body.amount!,
    type: body.type as TransactionType,
    account_id: body.account_id!,
    target_account_id: body.type === 'transfer' ? body.target_account_id! : null,
    category_id: body.type === 'transfer' ? null : (body.category_id || null),
    note: body.note?.trim() || null,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env.prepare(
    `INSERT INTO transactions (id, date, amount, type, account_id, target_account_id, category_id, note, created_at, updated_at, last_modified, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(
      tx.id,
      tx.date,
      tx.amount,
      tx.type,
      tx.account_id,
      tx.target_account_id,
      tx.category_id,
      tx.note,
      tx.created_at,
      tx.updated_at,
      tx.last_modified,
    )
    .run();
  return ok(tx);
}

/**
 * PUT /api/transactions/:id
 */
export async function updateTransaction(
  request: Request,
  env: D1Database,
  id: string,
): Promise<Response> {
  const existing = await env.prepare('SELECT * FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Transaction>();
  if (!existing) return fail('NOT_FOUND', '交易不存在', 404);

  let body: Partial<Transaction>;
  try {
    body = (await request.json()) as Partial<Transaction>;
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }

  const err = validateTransactionPayload({ ...existing, ...body });
  if (err) return fail('INVALID_INPUT', err);

  const now = nowIso();
  const updated: Transaction = {
    ...existing,
    date: body.date ?? existing.date,
    amount: body.amount ?? existing.amount,
    type: (body.type as TransactionType) ?? existing.type,
    account_id: body.account_id ?? existing.account_id,
    target_account_id:
      body.target_account_id !== undefined ? body.target_account_id : existing.target_account_id,
    category_id: body.category_id !== undefined ? body.category_id : existing.category_id,
    note: body.note !== undefined ? body.note?.trim() || null : existing.note,
    updated_at: now,
    last_modified: now,
  };
  await env.prepare(
    `UPDATE transactions SET date = ?, amount = ?, type = ?, account_id = ?, target_account_id = ?, category_id = ?, note = ?, updated_at = ?, last_modified = ? WHERE id = ?`,
  )
    .bind(
      updated.date,
      updated.amount,
      updated.type,
      updated.account_id,
      updated.target_account_id,
      updated.category_id,
      updated.note,
      updated.updated_at,
      updated.last_modified,
      id,
    )
    .run();
  return ok(updated);
}

/**
 * DELETE /api/transactions/:id
 */
export async function deleteTransaction(env: D1Database, id: string): Promise<Response> {
  const existing = await env.prepare('SELECT id FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first();
  if (!existing) return fail('NOT_FOUND', '交易不存在', 404);
  const now = nowIso();
  await env.prepare(
    'UPDATE transactions SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?',
  )
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}