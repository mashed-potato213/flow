// 前端同步逻辑：push 本地变更 + pull 服务端增量
// 基于 last_modified 时间戳实现 LWW（Last-Write-Wins）冲突解决
import { db } from './db';
import { api } from './api';
import { replayPendingOps } from './offlineStore';
import type { Account, Category, Transaction } from './api-types';

interface SyncResult {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  server_time: string;
}

/** 同步进行中标记（防止并发） */
let syncing = false;

/** 上次同步成功的服务端时间（meta 表 key） */
const SYNC_TIME_KEY = 'lastSyncTime';

/** 读取上次同步时间 */
export async function getLastSyncTime(): Promise<string | null> {
  const row = await db.meta.get(SYNC_TIME_KEY);
  return row?.value || null;
}

/** 写入上次同步时间 */
export async function setLastSyncTime(time: string): Promise<void> {
  await db.meta.put({ key: SYNC_TIME_KEY, value: time });
}

/**
 * 拉取服务端增量（last_modified > since 的所有变更）
 * 并写入 IndexedDB
 */
export async function fullSync(): Promise<{ ok: boolean; message?: string }> {
  if (syncing) return { ok: false, message: '同步进行中' };
  syncing = true;
  try {
    const since = await getLastSyncTime();
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const res = await api.get<SyncResult>(`/sync${query}`);

    if (!res.ok || !res.data) {
      return { ok: false, message: res.error?.message || '同步失败' };
    }

    const { accounts, categories, transactions, server_time } = res.data;

    await db.transaction('rw', db.accounts, db.categories, db.transactions, async () => {
      if (accounts.length) await db.accounts.bulkPut(accounts);
      if (categories.length) await db.categories.bulkPut(categories);
      if (transactions.length) await db.transactions.bulkPut(transactions);
    });

    await setLastSyncTime(server_time);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '网络错误' };
  } finally {
    syncing = false;
  }
}

/**
 * 收集本地所有 last_modified 大于 lastSyncTime 的项
 * 推送到服务端，服务端按 LWW 合并并返回最新状态
 */
export async function pushLocalChanges(): Promise<{
  ok: boolean;
  pushed?: number;
  message?: string;
}> {
  const since = (await getLastSyncTime()) || '1970-01-01T00:00:00.000Z';

  const accounts = await db.accounts.where('last_modified').above(since).toArray();
  const categories = await db.categories.where('last_modified').above(since).toArray();
  const transactions = await db.transactions.where('last_modified').above(since).toArray();

  if (accounts.length === 0 && categories.length === 0 && transactions.length === 0) {
    return { ok: true, pushed: 0 };
  }

  const res = await api.post<SyncResult>('/sync', {
    accounts,
    categories,
    transactions,
  });

  if (!res.ok || !res.data) {
    return { ok: false, pushed: 0, message: res.error?.message };
  }

  // 用服务端返回的最新数据覆盖
  await db.transaction('rw', db.accounts, db.categories, db.transactions, async () => {
    if (res.data!.accounts.length) await db.accounts.bulkPut(res.data!.accounts);
    if (res.data!.categories.length) await db.categories.bulkPut(res.data!.categories);
    if (res.data!.transactions.length) await db.transactions.bulkPut(res.data!.transactions);
  });

  return {
    ok: true,
    pushed: accounts.length + categories.length + transactions.length,
  };
}

/**
 * 全量同步：先重放离线队列 → push 本地变更 → pull 服务端
 */
export async function syncAll(): Promise<{ ok: boolean; message?: string }> {
  // 1. 先重放离线队列（用户在断网期间的修改）
  try {
    await replayPendingOps();
  } catch (e) {
    // 重放失败不阻塞后续同步
    console.warn('replayPendingOps failed:', e);
  }

  // 2. push 本地变更
  const push = await pushLocalChanges();
  if (!push.ok) return { ok: false, message: push.message };

  // 3. pull 服务端增量
  return await fullSync();
}

/** 启动自动同步：立即一次 + 60 秒周期 + 网络恢复触发 */
export function startAutoSync(): void {
  // 离线时跳过
  if (!navigator.onLine) {
    window.addEventListener(
      'online',
      () => {
        startAutoSync();
      },
      { once: true },
    );
    return;
  }

  // 立即同步一次
  syncAll().catch(() => {
    // 静默失败
  });

  // 每 60 秒同步一次
  setInterval(() => {
    if (navigator.onLine) {
      syncAll().catch(() => {
        // 静默失败
      });
    }
  }, 60_000);

  // 网络恢复时立即同步
  window.addEventListener('online', () => {
    syncAll().catch(() => {
      // 静默失败
    });
  });
}