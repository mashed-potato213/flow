// 数据校验与白名单
// 防止 SQL 注入 + 导入数据校验
import type { Account, Category, Transaction } from './types';

// ============================================================
// 枚举白名单
// ============================================================
export const VALID_ACCOUNT_TYPES = ['payment_channel', 'asset_holding'] as const;
export const VALID_CATEGORY_SCOPES = ['expense', 'income', 'finance'] as const;
export const VALID_TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;

// ============================================================
// 数据库列白名单（防 SQL 注入：导入时只用这些列名）
// ============================================================
export const ACCOUNT_COLUMNS = [
  'id',
  'name',
  'type',
  'is_payment_capable',
  'opening_balance',
  'sort_order',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

export const CATEGORY_COLUMNS = [
  'id',
  'name',
  'icon',
  'scope',
  'is_preset',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

export const TRANSACTION_COLUMNS = [
  'id',
  'date',
  'amount',
  'type',
  'account_id',
  'target_account_id',
  'category_id',
  'note',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

// ============================================================
// 预编译 SQL（用固定列名，不再用 Object.keys 拼接）
// ============================================================
const placeholders = (n: number) => new Array(n).fill('?').join(',');

export const UPSERT_SQL = {
  accounts: `INSERT OR REPLACE INTO accounts (${ACCOUNT_COLUMNS.join(',')}) VALUES (${placeholders(
    ACCOUNT_COLUMNS.length,
  )})`,
  categories: `INSERT OR REPLACE INTO categories (${CATEGORY_COLUMNS.join(',')}) VALUES (${placeholders(
    CATEGORY_COLUMNS.length,
  )})`,
  transactions: `INSERT OR REPLACE INTO transactions (${TRANSACTION_COLUMNS.join(
    ',',
  )}) VALUES (${placeholders(TRANSACTION_COLUMNS.length)})`,
} as const;

// ============================================================
// 类型守卫
// ============================================================
function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isZeroOrOne(v: unknown): v is 0 | 1 {
  return v === 0 || v === 1;
}

// ============================================================
// 校验 + 清洗（输入任意 JSON，返回严格类型的对象）
// ============================================================

export interface SanitizeOk<T> {
  ok: true;
  data: T;
}
export interface SanitizeErr {
  ok: false;
  error: string;
}
export type SanitizeResult<T> = SanitizeOk<T> | SanitizeErr;

/**
 * 校验账户对象。未知字段会被丢弃（防止污染 schema）
 */
export function sanitizeAccount(input: unknown): SanitizeResult<Account> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'not an object' };
  const x = input as Record<string, unknown>;

  if (!isString(x.id)) return { ok: false, error: 'invalid id' };
  if (!isString(x.name)) return { ok: false, error: 'invalid name' };
  if (!isString(x.name) || x.name.length > 50) return { ok: false, error: 'name too long' };
  if (typeof x.type !== 'string' || !VALID_ACCOUNT_TYPES.includes(x.type as any)) {
    return { ok: false, error: 'invalid type' };
  }
  if (!isNumber(x.opening_balance) || x.opening_balance < 0) {
    return { ok: false, error: 'invalid opening_balance' };
  }
  if (typeof x.is_payment_capable !== 'number' || !isZeroOrOne(x.is_payment_capable)) {
    return { ok: false, error: 'invalid is_payment_capable' };
  }
  if (typeof x.sort_order !== 'number' || x.sort_order < 0) {
    return { ok: false, error: 'invalid sort_order' };
  }
  if (!isString(x.created_at)) return { ok: false, error: 'invalid created_at' };
  if (!isString(x.updated_at)) return { ok: false, error: 'invalid updated_at' };
  if (!isString(x.last_modified)) return { ok: false, error: 'invalid last_modified' };
  if (typeof x.deleted !== 'number' || !isZeroOrOne(x.deleted)) {
    return { ok: false, error: 'invalid deleted' };
  }

  return {
    ok: true,
    data: {
      id: x.id,
      name: x.name,
      type: x.type as Account['type'],
      is_payment_capable: x.is_payment_capable,
      opening_balance: x.opening_balance,
      sort_order: x.sort_order,
      created_at: x.created_at,
      updated_at: x.updated_at,
      last_modified: x.last_modified,
      deleted: x.deleted,
    },
  };
}

/**
 * 校验分类对象
 */
export function sanitizeCategory(input: unknown): SanitizeResult<Category> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'not an object' };
  const x = input as Record<string, unknown>;

  if (!isString(x.id)) return { ok: false, error: 'invalid id' };
  if (!isString(x.name) || x.name.length > 50) return { ok: false, error: 'invalid name' };
  if (typeof x.scope !== 'string' || !VALID_CATEGORY_SCOPES.includes(x.scope as any)) {
    return { ok: false, error: 'invalid scope' };
  }
  if (typeof x.icon !== 'string' && x.icon !== null) {
    return { ok: false, error: 'invalid icon' };
  }
  if (typeof x.is_preset !== 'number' || !isZeroOrOne(x.is_preset)) {
    return { ok: false, error: 'invalid is_preset' };
  }
  if (!isString(x.created_at)) return { ok: false, error: 'invalid created_at' };
  if (!isString(x.updated_at)) return { ok: false, error: 'invalid updated_at' };
  if (!isString(x.last_modified)) return { ok: false, error: 'invalid last_modified' };
  if (typeof x.deleted !== 'number' || !isZeroOrOne(x.deleted)) {
    return { ok: false, error: 'invalid deleted' };
  }

  return {
    ok: true,
    data: {
      id: x.id,
      name: x.name,
      icon: (x.icon as string | null) ?? null,
      scope: x.scope as Category['scope'],
      is_preset: x.is_preset,
      created_at: x.created_at,
      updated_at: x.updated_at,
      last_modified: x.last_modified,
      deleted: x.deleted,
    },
  };
}

/**
 * 校验交易对象（最严格）
 */
export function sanitizeTransaction(input: unknown): SanitizeResult<Transaction> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'not an object' };
  const x = input as Record<string, unknown>;

  if (!isString(x.id)) return { ok: false, error: 'invalid id' };
  if (!isString(x.date) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) {
    return { ok: false, error: 'invalid date (expect YYYY-MM-DD)' };
  }
  if (!isNumber(x.amount) || x.amount <= 0 || x.amount > 1e12) {
    return { ok: false, error: 'invalid amount' };
  }
  if (typeof x.type !== 'string' || !VALID_TRANSACTION_TYPES.includes(x.type as any)) {
    return { ok: false, error: 'invalid type' };
  }
  if (!isString(x.account_id)) return { ok: false, error: 'invalid account_id' };
  if (x.target_account_id !== null && !isString(x.target_account_id)) {
    return { ok: false, error: 'invalid target_account_id' };
  }
  if (x.category_id !== null && !isString(x.category_id)) {
    return { ok: false, error: 'invalid category_id' };
  }
  if (x.note !== null && typeof x.note !== 'string') {
    return { ok: false, error: 'invalid note' };
  }
  if (x.note !== null && typeof x.note === 'string' && x.note.length > 500) {
    return { ok: false, error: 'note too long' };
  }
  if (!isString(x.created_at)) return { ok: false, error: 'invalid created_at' };
  if (!isString(x.updated_at)) return { ok: false, error: 'invalid updated_at' };
  if (!isString(x.last_modified)) return { ok: false, error: 'invalid last_modified' };
  if (typeof x.deleted !== 'number' || !isZeroOrOne(x.deleted)) {
    return { ok: false, error: 'invalid deleted' };
  }

  // 业务规则：transfer 必须有 target_account_id 且不能相同
  if (x.type === 'transfer') {
    if (!isString(x.target_account_id)) {
      return { ok: false, error: 'transfer requires target_account_id' };
    }
    if (x.target_account_id === x.account_id) {
      return { ok: false, error: 'source and target accounts cannot be same' };
    }
  }

  return {
    ok: true,
    data: {
      id: x.id,
      date: x.date,
      amount: x.amount,
      type: x.type as Transaction['type'],
      account_id: x.account_id,
      target_account_id: (x.target_account_id as string | null) ?? null,
      category_id: (x.category_id as string | null) ?? null,
      note: (x.note as string | null) ?? null,
      created_at: x.created_at,
      updated_at: x.updated_at,
      last_modified: x.last_modified,
      deleted: x.deleted,
    },
  };
}

// ============================================================
// 提取固定列的值（按白名单顺序）
// ============================================================
export function pickColumns<T extends Record<string, unknown>>(
  obj: T,
  columns: readonly string[],
): unknown[] {
  return columns.map((c) => obj[c] ?? null);
}

// ============================================================
// 时间戳调和（防客户端时钟漂移）
// ============================================================
/** 允许的最大时钟偏差（毫秒）：1 小时 */
export const MAX_CLOCK_DRIFT_MS = 60 * 60 * 1000;

/**
 * 调和客户端时间戳与服务端时间：
 * - 客户端时间无效或偏差 > 1 小时 → 强制使用服务端时间（防恶意/异常）
 * - 偏差 ≤ 1 小时 → 信任客户端时间（保留多设备 LWW 语义）
 */
export function reconcileTimestamp(clientTs: string, serverNowIso: string): string {
  const clientMs = new Date(clientTs).getTime();
  const serverMs = new Date(serverNowIso).getTime();
  if (isNaN(clientMs) || Math.abs(clientMs - serverMs) > MAX_CLOCK_DRIFT_MS) {
    return serverNowIso;
  }
  return clientTs;
}
