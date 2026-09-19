// D1 → R2 自动备份
// 由 Cron Trigger 调用，或手动 POST /api/_backup
import { ok, fail } from '../lib/response';

/**
 * 全量导出 D1 所有表到 R2
 * 备份路径：backups/YYYY-MM-DD/<ISO 时间>.json
 * 自动清理 30 天前的旧备份
 */
export async function backup(env: D1Database, bucket: R2Bucket): Promise<Response> {
  try {
    const tables = ['accounts', 'categories', 'transactions', 'sessions', 'meta'];
    const dump: Record<string, any[]> = {};
    let totalRows = 0;

    for (const table of tables) {
      const { results } = await env.prepare(`SELECT * FROM ${table}`).all();
      dump[table] = results;
      totalRows += results.length;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr = now.toISOString().replace(/[:.]/g, '-');
    const key = `backups/${dateStr}/${timeStr}.json`;

    const body = JSON.stringify(
      {
        version: 1,
        timestamp: now.toISOString(),
        row_count: totalRows,
        data: dump,
      },
      null,
      2,
    );

    await bucket.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
    });

    // 清理 30 天前的备份
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const listed = await bucket.list({ prefix: 'backups/' });
    for (const obj of listed.objects) {
      if (obj.key < `backups/${cutoff}/`) {
        await bucket.delete(obj.key);
      }
    }

    return ok({ key, rows: totalRows });
  } catch (e) {
    return fail('BACKUP_FAILED', e instanceof Error ? e.message : '备份失败', 500);
  }
}