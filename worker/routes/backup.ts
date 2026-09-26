// D1 → R2 自动备份
// 由 Cron Trigger 调用，或手动 POST /api/_backup
// 安全：仅备份业务数据，绝不包含 sessions（避免 R2 泄露导致 token 泄露）
import { ok, fail } from '../lib/response';

const BUSINESS_TABLES = ['accounts', 'categories', 'transactions', 'meta'] as const;
const PAGE_SIZE = 500; // 每页最多 500 行，避免单次查询过载
const LOCK_KEY = 'backup_lock';
const LOCK_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟内不允许重复备份

/**
 * 全量导出 D1 业务表到 R2
 * 备份路径：backups/YYYY-MM-DD/<ISO 时间>.json
 * 自动清理 30 天前的旧备份
 */
export async function backup(env: D1Database, bucket: R2Bucket): Promise<Response> {
  // 1. 并发锁检查：防止 Cron + 手动同时触发产生重复备份
  const lockRow = await env
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind(LOCK_KEY)
    .first<{ value: string }>();
  const now = Date.now();
  if (lockRow?.value) {
    const lastRun = parseInt(lockRow.value, 10);
    if (!isNaN(lastRun) && now - lastRun < LOCK_MIN_INTERVAL_MS) {
      return fail(
        'ALREADY_RUNNING',
        `备份进行中（${Math.ceil((LOCK_MIN_INTERVAL_MS - (now - lastRun)) / 1000)} 秒后允许重试）`,
        429,
      );
    }
  }
  // 写入锁
  await env
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .bind(LOCK_KEY, String(now))
    .run();

  try {
    const dump: Record<string, unknown[]> = {};
    let totalRows = 0;

    // 2. 分页导出每张业务表
    for (const table of BUSINESS_TABLES) {
      const rows: unknown[] = [];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { results } = await env
          .prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`)
          .bind(PAGE_SIZE, offset)
          .all();
        if (results.length === 0) break;
        rows.push(...results);
        if (results.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      dump[table] = rows;
      totalRows += rows.length;
    }

    const nowDate = new Date();
    const dateStr = nowDate.toISOString().slice(0, 10);
    const timeStr = nowDate.toISOString().replace(/[:.]/g, '-');
    const key = `backups/${dateStr}/${timeStr}.json`;

    const body = JSON.stringify(
      {
        version: 1,
        timestamp: nowDate.toISOString(),
        row_count: totalRows,
        data: dump,
      },
      null,
      2,
    );

    await bucket.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
    });

    // 3. 清理 30 天前的备份
    const cutoff = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const listed = await bucket.list({ prefix: 'backups/' });
    const toDelete = listed.objects.filter((obj) => obj.key < `backups/${cutoff}/`);
    await Promise.all(toDelete.map((obj) => bucket.delete(obj.key)));

    return ok({ key, rows: totalRows, deleted_old: toDelete.length });
  } catch (e) {
    return fail('BACKUP_FAILED', e instanceof Error ? e.message : '备份失败', 500);
  } finally {
    // 4. 释放锁（无论成功失败）
    await env.prepare('DELETE FROM meta WHERE key = ?').bind(LOCK_KEY).run();
  }
}
