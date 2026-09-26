// LWW（Last-Write-Wins）同步核心
// POST /api/sync    推送本地变更，返回服务端最新状态
// GET  /api/sync?since=<ISO>  拉取 last_modified > since 的所有变更
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

interface SyncRequest {
  accounts?: unknown[];
  categories?: unknown[];
  transactions?: unknown[];
}

interface SyncResponse {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  server_time: string;
  skipped: number; // 跳过条数（校验失败）
}

/**
 * 处理 POST /api/sync：客户端推送本地变更
 * LWW：服务端记录较新则跳过；客户端较新则覆盖
 *
 * 安全：所有导入数据通过 sanitize 函数校验，丢弃未知字段，防止 SQL 注入
 */
export async function syncPost(request: Request, env: D1Database): Promise<Response> {
  let body: SyncRequest;
  try {
    body = (await request.json()) as SyncRequest;
  } catch {
    return fail('INVALID_JSON', '请求体无效');
  }

  const result: SyncResponse = {
    accounts: [],
    categories: [],
    transactions: [],
    server_time: new Date().toISOString(),
    skipped: 0,
  };

  // 处理账户
  await processEntity(
    env,
    'accounts',
    body.accounts,
    sanitizeAccount,
    (rows) => {
      result.accounts = rows;
    },
    (n) => {
      result.skipped += n;
    },
  );

  // 处理分类
  await processEntity(
    env,
    'categories',
    body.categories,
    sanitizeCategory,
    (rows) => {
      result.categories = rows;
    },
    (n) => {
      result.skipped += n;
    },
  );

  // 处理交易
  await processEntity(
    env,
    'transactions',
    body.transactions,
    sanitizeTransaction,
    (rows) => {
      result.transactions = rows;
    },
    (n) => {
      result.skipped += n;
    },
  );

  return ok(result);
}

// ============================================================
// 时间戳调和（实现已移至 lib/validate.ts）
// ============================================================

/**
 * 单个实体的 LWW 处理流程：sanitize → 对比 last_modified → 批量 upsert → 回读
 */
async function processEntity<T extends { id: string; last_modified: string }>(
  env: D1Database,
  entity: EntityName,
  rawItems: unknown[] | undefined,
  sanitize: (input: unknown) => { ok: true; data: T } | { ok: false; error: string },
  setResult: (rows: T[]) => void,
  trackSkipped: (n: number) => void,
): Promise<void> {
  if (!rawItems || rawItems.length === 0) {
    setResult([]);
    return;
  }

  // 1. sanitize：丢弃非法数据和未知字段
  const validItems: T[] = [];
  let skipped = 0;
  for (const raw of rawItems) {
    const r = sanitize(raw);
    if (r.ok) {
      validItems.push(r.data);
    } else {
      skipped++;
    }
  }
  trackSkipped(skipped);
  if (validItems.length === 0) {
    setResult([]);
    return;
  }

  // 2. 拉取服务端这些 ID 的当前 last_modified（单次查询）
  const ids = validItems.map((i) => i.id);
  const { results: serverRows } = await env
    .prepare(
      `SELECT id, last_modified FROM ${entity} WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<{ id: string; last_modified: string }>();
  const serverMap = new Map(serverRows.map((r) => [r.id, r.last_modified]));

  // 3. LWW + 时钟漂移防御：调和客户端时间戳后再比较
  const serverNowIso = new Date().toISOString();
  const upserts: T[] = [];
  for (const item of validItems) {
    const serverTs = serverMap.get(item.id);
    // 调和：偏差 > 1 小时则强制使用服务端时间
    const effectiveTs = reconcileTimestamp(item.last_modified, serverNowIso);

    if (!serverTs || serverTs < effectiveTs) {
      // 写入数据库时使用调和后的时间戳
      upserts.push({ ...item, last_modified: effectiveTs });
    }
  }

  // 4. 用 D1 Batch 批量 upsert（用预编译 SQL + 固定列名，无注入风险）
  if (upserts.length > 0) {
    const columns =
      entity === 'accounts'
        ? ACCOUNT_COLUMNS
        : entity === 'categories'
          ? CATEGORY_COLUMNS
          : TRANSACTION_COLUMNS;
    const stmt = env.prepare(UPSERT_SQL[entity]);
    const batch = upserts.map((item) => stmt.bind(...pickColumns(item as any, columns)));
    await env.batch(batch);
  }

  // 5. 返回这些 ID 的最新状态
  const { results: finalRows } = await env
    .prepare(`SELECT * FROM ${entity} WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<T>();
  setResult(finalRows);
}

/**
 * 处理 GET /api/sync?since=<ISO>：拉取增量变更
 */
export async function syncGet(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  let sinceTs = '1970-01-01T00:00:00.000Z';
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) sinceTs = d.toISOString();
  }

  const accounts = await env
    .prepare(`SELECT * FROM accounts WHERE last_modified > ? ORDER BY last_modified ASC`)
    .bind(sinceTs)
    .all<Account>();
  const categories = await env
    .prepare(`SELECT * FROM categories WHERE last_modified > ? ORDER BY last_modified ASC`)
    .bind(sinceTs)
    .all<Category>();
  const transactions = await env
    .prepare(`SELECT * FROM transactions WHERE last_modified > ? ORDER BY last_modified ASC`)
    .bind(sinceTs)
    .all<Transaction>();

  return ok({
    accounts: accounts.results,
    categories: categories.results,
    transactions: transactions.results,
    server_time: new Date().toISOString(),
  });
}
