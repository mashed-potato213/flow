// JSON 导出 + 导入
// GET  /api/export  下载 JSON 备份（不含已删除）
// POST /api/import  从 JSON 备份合并到服务端（LWW）
import { ok, fail } from '../lib/response';
import {
  UPSERT_SQL,
  ACCOUNT_COLUMNS,
  CATEGORY_COLUMNS,
  TRANSACTION_COLUMNS,
  sanitizeAccount,
  sanitizeCategory,
  sanitizeTransaction,
  pickColumns,
  reconcileTimestamp,
} from '../lib/validate';
import type { Account, Category, Transaction } from '../lib/types';

type EntityName = 'accounts' | 'categories' | 'transactions';

/**
 * 导出未删除的数据为 JSON 文件
 */
export async function exportData(env: D1Database): Promise<Response> {
  const tables: EntityName[] = ['accounts', 'categories', 'transactions'];
  const dump: Record<string, any[]> = {};

  for (const table of tables) {
    const { results } = await env.prepare(`SELECT * FROM ${table} WHERE deleted = 0`).all();
    dump[table] = results;
  }

  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    data: dump,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="flow-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}

/**
 * 导入 JSON 备份，按 LWW 合并
 *
 * 安全：所有数据通过 sanitize 校验，使用预编译 SQL + 固定列名
 * 失败的单条会被跳过并记录原因，不会让整个导入失败
 */
export async function importData(request: Request, env: D1Database): Promise<Response> {
  let body: any;
  try {
    body = (await request.json()) as any;
  } catch {
    return fail('INVALID_JSON', '请求体无效');
  }
  if (!body.data || typeof body.data !== 'object') {
    return fail('INVALID_FORMAT', '数据格式错误');
  }

  let inserted = 0;
  let skipped = 0;
  const skipReasons: string[] = [];

  // 处理账户
  const accountResult = await importEntity(env, 'accounts', body.data.accounts, (item) =>
    sanitizeAccount(item),
  );
  inserted += accountResult.inserted;
  skipped += accountResult.skipped;
  skipReasons.push(...accountResult.reasons);

  // 处理分类
  const categoryResult = await importEntity(env, 'categories', body.data.categories, (item) =>
    sanitizeCategory(item),
  );
  inserted += categoryResult.inserted;
  skipped += categoryResult.skipped;
  skipReasons.push(...categoryResult.reasons);

  // 处理交易
  const txResult = await importEntity(
    env,
    'transactions',
    body.data.transactions,
    (item) => sanitizeTransaction(item),
  );
  inserted += txResult.inserted;
  skipped += txResult.skipped;
  skipReasons.push(...txResult.reasons);

  return ok({ inserted, skipped, reasons: skipReasons.slice(0, 10) });
}

/**
 * 单个实体的导入流程：sanitize → LWW 对比 → 批量 upsert
 */
async function importEntity<T extends { id: string; last_modified: string }>(
  env: D1Database,
  entity: EntityName,
  rawItems: unknown,
  sanitize: (input: unknown) => { ok: true; data: T } | { ok: false; error: string },
): Promise<{ inserted: number; skipped: number; reasons: string[] }> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { inserted: 0, skipped: 0, reasons: [] };
  }

  // 1. sanitize
  const validItems: T[] = [];
  const reasons: string[] = [];
  let skipped = 0;
  for (const raw of rawItems) {
    const r = sanitize(raw);
    if (r.ok) {
      validItems.push(r.data);
    } else {
      skipped++;
      if (reasons.length < 10) {
        const id = (raw as any)?.id || '<no id>';
        reasons.push(`${entity}[${id}]: ${r.error}`);
      }
    }
  }
  if (validItems.length === 0) {
    return { inserted: 0, skipped, reasons };
  }

  // 2. LWW：只 upsert 客户端较新的项（带时钟漂移防御）
  const ids = validItems.map((i) => i.id);
  const { results: serverRows } = await env.prepare(
    `SELECT id, last_modified FROM ${entity} WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<{ id: string; last_modified: string }>();
  const serverMap = new Map(serverRows.map((r) => [r.id, r.last_modified]));

  const serverNowIso = new Date().toISOString();
  const upserts: T[] = [];
  for (const item of validItems) {
    const serverTs = serverMap.get(item.id);
    // 调和时间戳（防客户端时钟漂移）
    const effectiveTs = reconcileTimestamp(item.last_modified, serverNowIso);

    if (!serverTs || serverTs < effectiveTs) {
      upserts.push({ ...item, last_modified: effectiveTs });
    }
  }
  if (upserts.length === 0) {
    return { inserted: 0, skipped, reasons };
  }

  // 3. 批量 upsert（用预编译 SQL + 固定列名，无注入风险）
  const columns =
    entity === 'accounts'
      ? ACCOUNT_COLUMNS
      : entity === 'categories'
        ? CATEGORY_COLUMNS
        : TRANSACTION_COLUMNS;
  const stmt = env.prepare(UPSERT_SQL[entity]);
  const batch = upserts.map((item) => stmt.bind(...pickColumns(item as any, columns)));
  await env.batch(batch);

  return { inserted: upserts.length, skipped, reasons };
}
