// 交易路由：list / get / create / update / delete
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import { NewTransactionSchema, NewTransactionBaseSchema } from '../../shared/schemas';
import type { Transaction, TransactionType } from '../lib/types';

const VALID_TYPES: TransactionType[] = ['income', 'expense', 'transfer', 'adjustment'];
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * 转义 LIKE 通配符（用户输入的 % 和 _ 需要转义，否则会被当作通配符）
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

/**
 * GET /api/transactions
 */
export async function listTransactions(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const account = url.searchParams.get('account');
  const category = url.searchParams.get('category');
  const type = url.searchParams.get('type');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const q = url.searchParams.get('q');

  const rawLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const rawOffset = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  const where: string[] = ['deleted = 0'];
  const params: unknown[] = [];

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
    // 转义 LIKE 通配符，防信息泄露扫描
    where.push("note LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(q)}%`);
  }

  const sql = `SELECT * FROM transactions WHERE ${where.join(' AND ')} ORDER BY date DESC, last_modified DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const { results } = await env
    .prepare(sql)
    .bind(...params)
    .all<Transaction>();
  return ok(results);
}

/**
 * GET /api/transactions/:id
 */
export async function getTransaction(env: D1Database, id: string): Promise<Response> {
  const row = await env
    .prepare('SELECT * FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Transaction>();
  if (!row) return fail('NOT_FOUND', '交易不存在', 404);
  return ok(row);
}

/**
 * POST /api/transactions
 */
export async function createTransaction(request: Request, env: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  const parsed = NewTransactionSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const now = nowIso();
  const tx: Transaction = {
    id: data.id || ulid(),
    date: data.date,
    amount: data.amount,
    type: data.type,
    account_id: data.account_id,
    target_account_id: data.type === 'transfer' ? (data.target_account_id ?? null) : null,
    category_id: data.type === 'transfer' ? null : (data.category_id ?? null),
    note: data.note ?? null,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env
    .prepare(
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
 * 白名单 spread：仅允许修改业务字段，id/deleted/created_at 不接受
 */
export async function updateTransaction(
  request: Request,
  env: D1Database,
  id: string,
): Promise<Response> {
  const existing = await env
    .prepare('SELECT * FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Transaction>();
  if (!existing) return fail('NOT_FOUND', '交易不存在', 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  // 仅接受 NewTransaction 字段（防篡改 id/deleted/created_at）
  const parsed = NewTransactionBaseSchema.partial().safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const now = nowIso();
  const updated: Transaction = {
    ...existing,
    date: data.date ?? existing.date,
    amount: data.amount ?? existing.amount,
    type: (data.type as TransactionType | undefined) ?? existing.type,
    account_id: data.account_id ?? existing.account_id,
    target_account_id:
      data.target_account_id !== undefined ? data.target_account_id : existing.target_account_id,
    category_id: data.category_id !== undefined ? data.category_id : existing.category_id,
    note: data.note !== undefined ? data.note : existing.note,
    updated_at: now,
    last_modified: now,
  };
  await env
    .prepare(
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
  const existing = await env
    .prepare('SELECT id FROM transactions WHERE id = ? AND deleted = 0')
    .bind(id)
    .first();
  if (!existing) return fail('NOT_FOUND', '交易不存在', 404);
  const now = nowIso();
  await env
    .prepare('UPDATE transactions SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}
