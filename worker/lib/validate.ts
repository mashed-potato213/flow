// 数据校验：基于 shared/schemas 的 Zod 包装
// 旧 API（sanitizeAccount/sanitizeCategory/sanitizeTransaction/reconcileTimestamp）
// 保持导出以兼容现有 routes，但实现改为 Zod。

import {
  safeParseAccount,
  safeParseCategory,
  safeParseTransaction,
  ACCOUNT_COLUMNS,
  CATEGORY_COLUMNS,
  TRANSACTION_COLUMNS,
} from '../../shared/schemas';
import type { Account, Category, Transaction } from '../../shared/schemas';

// 重新导出 sanitize 函数（向后兼容，调用方无需改）
export { safeParseAccount as sanitizeAccount };
export { safeParseCategory as sanitizeCategory };
export { safeParseTransaction as sanitizeTransaction };
export { ACCOUNT_COLUMNS, CATEGORY_COLUMNS, TRANSACTION_COLUMNS };
export type { SanitizeOk, SanitizeErr, SanitizeResult } from '../../shared/schemas';

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

// 重新导出类型以保持兼容性
export type { Account, Category, Transaction };
