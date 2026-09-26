// 离线写入队列
// 在离线或网络错误时，把变更暂存到 IndexedDB，联网后由 sync 自动回放
import { db } from './db';
import type { Table } from 'dexie';
import type { Account, Category, Transaction } from './api-types';

type EntityName = 'accounts' | 'categories' | 'transactions';
type EntityRow = Account | Category | Transaction;

interface MutationResult<T = unknown> {
  ok: boolean;
  queued?: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * 写入本地 IndexedDB（软删除用 deleted=1）
 */
async function applyLocal(
  entity: EntityName,
  op: 'create' | 'update' | 'delete',
  data: EntityRow & { id: string },
): Promise<void> {
  // 类型擦除：三个表的 update/put 签名不同，统一用 Table<any, string> 操作
  const table = db[entity] as unknown as Table<EntityRow, string>;
  if (op === 'delete') {
    await table.update(data.id, {
      deleted: 1,
      last_modified: new Date().toISOString(),
    });
  } else {
    await table.put(data);
  }
}

/**
 * 统一的离线优先 mutation helper
 * 用法（替代 api.post/put/del）：
 *   const res = await mutateAndQueue('accounts', 'create', newAccount);
 *   if (res.queued) showStatus('已离线保存，联网后自动同步');
 *
 * 行为：
 * 1. 立即写 IndexedDB（保证本地一致）
 * 2. 尝试推送到服务端
 * 3. 离线/网络错误时入队（联网后由 sync 自动 replay）
 * 4. 业务错误（401/422 等）不入队，直接返回
 */
export async function mutateAndQueue<T extends EntityRow & { id: string }>(
  entity: EntityName,
  op: 'create' | 'update' | 'delete',
  data: T,
): Promise<MutationResult> {
  // 1. 立即写本地（保证 UI 即时响应）
  await applyLocal(entity, op, data);

  // 2. 推送到服务端
  const endpoint = `/api/${entity}`;
  let res;
  try {
    if (op === 'create')
      res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    else if (op === 'update')
      res = await fetch(`${endpoint}/${data.id}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    else
      res = await fetch(`${endpoint}/${data.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
  } catch {
    // fetch 直接抛异常 = 网络层错误
    res = null;
  }

  // 3. 网络层错误或 5xx → 入队
  const isNetworkError = !res;
  const isServerError = res && res.status >= 500;
  if (isNetworkError || isServerError) {
    await db.pendingOps.add({
      entity,
      op,
      entityId: data.id,
      payload: op === 'delete' ? null : (data as any),
      createdAt: Date.now(),
    });
    return {
      ok: true,
      queued: true,
      error: { code: 'OFFLINE', message: '离线中，已加入待同步队列' },
    };
  }

  // 4. 业务错误（4xx）不入队，直接返回
  const body = (await res!.json().catch(() => ({
    ok: false,
    error: { code: 'PARSE_ERROR', message: '响应解析失败' },
  }))) as MutationResult;
  return body;
}

/**
 * 回放队列中的所有操作到服务端（按创建顺序）
 * 每个操作独立处理：成功则出队；失败保留在队列等待下次
 */
export async function replayPendingOps(): Promise<{
  ok: boolean;
  replayed: number;
  failed: number;
}> {
  const ops = await db.pendingOps.orderBy('createdAt').toArray();
  if (ops.length === 0) return { ok: true, replayed: 0, failed: 0 };

  let replayed = 0;
  let failed = 0;

  for (const op of ops) {
    if (!op.id) continue;
    try {
      const endpoint = `/api/${op.entity}`;
      let res;
      if (op.op === 'create') {
        res = await fetch(endpoint, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
      } else if (op.op === 'update') {
        res = await fetch(`${endpoint}/${op.entityId}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(op.payload),
        });
      } else {
        res = await fetch(`${endpoint}/${op.entityId}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
      }

      // 业务错误（4xx）也删除（说明服务端持久拒绝了，重试也没用）
      // 网络错误/5xx → 保留
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await db.pendingOps.delete(op.id);
        replayed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { ok: failed === 0, replayed, failed };
}

/**
 * 获取待同步队列长度（用于 UI 角标）
 */
export async function getPendingCount(): Promise<number> {
  return await db.pendingOps.count();
}
