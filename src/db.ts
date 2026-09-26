// Dexie IndexedDB Schema（镜像后端 D1 schema）
// 为 Day 6 PWA 离线同步做准备
import Dexie, { Table } from 'dexie';
import type { Account, Category, Transaction } from './api-types';

/**
 * 待同步操作队列
 * Day 6 会用：在离线时写入 IndexedDB，恢复在线后批量回放到服务器
 */
export interface PendingOp {
  id?: number;
  entity: 'accounts' | 'categories' | 'transactions';
  op: 'create' | 'update' | 'delete';
  entityId: string;
  payload: any;
  createdAt: number;
}

class FlowDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  pendingOps!: Table<PendingOp, number>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor() {
    super('flow-db');
    this.version(1).stores({
      // 主键：id；索引：列表常用字段
      accounts: 'id, type, last_modified, deleted',
      categories: 'id, scope, last_modified, deleted',
      transactions:
        'id, date, type, account_id, target_account_id, category_id, last_modified, deleted',
      pendingOps: '++id, entity, createdAt',
      meta: 'key',
    });
  }
}

export const db = new FlowDB();

/**
 * 写入 meta（key/value 形式）
 */
export async function setMeta(key: string, value: any): Promise<void> {
  await db.meta.put({ key, value });
}

/**
 * 读取 meta
 */
export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}
