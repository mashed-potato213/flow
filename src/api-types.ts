// 前端类型层：从 shared/schemas 重新导出，确保前后端类型一致
import type { Account as AccountBase } from '../shared/schemas';

export type {
  Account,
  AccountType,
  Category,
  CategoryScope,
  Transaction,
  TransactionType,
  NewAccount,
  NewCategory,
  NewTransaction,
} from '../shared/schemas';

// 列表 API 返回的扩展类型（带运行时计算的 balance 等字段）
export type AccountWithBalance = AccountBase & { balance?: number };
