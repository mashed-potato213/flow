// 后端类型层：所有实体类型从 shared/schemas 重新导出
// 这样后端代码可以继续 import { Account } from '../lib/types'
// 但类型实际定义在 shared/，确保前后端完全一致。

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
  SyncRequest,
  Password,
} from '../../shared/schemas';

// Cloudflare Workers 环境绑定
export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
}
