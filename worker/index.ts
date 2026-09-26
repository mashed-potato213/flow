// Flow Worker 入口
// 路由分发采用声明式路由表（替代原来的 if-else 链）
import * as authRoutes from './routes/auth';
import * as accountRoutes from './routes/accounts';
import * as categoryRoutes from './routes/categories';
import * as transactionRoutes from './routes/transactions';
import * as summaryRoutes from './routes/summary';
import * as syncRoutes from './routes/sync';
import * as backupRoutes from './routes/backup';
import * as exportRoutes from './routes/export';
import { requireAuth } from './auth';
import { applySecurityHeaders } from './lib/response';
import type { Env } from './lib/types';

export type { Env };

// ============================================================
// 路由表
// ============================================================

type RouteParams = Record<string, string | undefined>;
type RouteHandler = (req: Request, env: Env, params: RouteParams) => Response | Promise<Response>;

/**
 * 从路由参数中获取必填字段；缺失时抛错（被 handleApi 捕获返回 500）
 */
function requireParam(params: RouteParams, key: string): string {
  const v = params[key];
  if (v === undefined) {
    throw new Error(`Missing required route parameter: ${key}`);
  }
  return v;
}

interface Route {
  method: string;
  pattern: RegExp;
  auth: boolean;
  handler: RouteHandler;
}

// 不需鉴权
const PUBLIC_ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: /^\/health$/,
    auth: false,
    handler: () => okResponse({ status: 'healthy', timestamp: new Date().toISOString() }),
  },
  {
    method: 'GET',
    pattern: /^\/auth\/status$/,
    auth: false,
    handler: (_req, env) => authRoutes.status(env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/auth\/setup$/,
    auth: false,
    handler: (req, env) => authRoutes.setup(req, env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    auth: false,
    handler: (req, env) => authRoutes.login(req, env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/auth\/logout$/,
    auth: false,
    handler: (req, env) => authRoutes.logout(req, env.DB),
  },
];

// 需鉴权
const AUTH_ROUTES: Route[] = [
  // Accounts
  {
    method: 'GET',
    pattern: /^\/accounts$/,
    auth: true,
    handler: (_r, env) => accountRoutes.listAccounts(env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/accounts$/,
    auth: true,
    handler: (r, env) => accountRoutes.createAccount(r, env.DB),
  },
  {
    method: 'PUT',
    pattern: /^\/accounts\/reorder$/,
    auth: true,
    handler: (r, env) => accountRoutes.reorderAccounts(r, env.DB),
  },
  {
    method: 'PUT',
    pattern: /^\/accounts\/(?<id>[^/]+)$/,
    auth: true,
    handler: (r, env, p) => accountRoutes.updateAccount(r, env.DB, requireParam(p, 'id')),
  },
  {
    method: 'DELETE',
    pattern: /^\/accounts\/(?<id>[^/]+)$/,
    auth: true,
    handler: (_r, env, p) => accountRoutes.deleteAccount(env.DB, requireParam(p, 'id')),
  },

  // Categories
  {
    method: 'GET',
    pattern: /^\/categories$/,
    auth: true,
    handler: (r, env) => categoryRoutes.listCategories(r, env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/categories$/,
    auth: true,
    handler: (r, env) => categoryRoutes.createCategory(r, env.DB),
  },
  {
    method: 'PUT',
    pattern: /^\/categories\/(?<id>[^/]+)$/,
    auth: true,
    handler: (r, env, p) => categoryRoutes.updateCategory(r, env.DB, requireParam(p, 'id')),
  },
  {
    method: 'DELETE',
    pattern: /^\/categories\/(?<id>[^/]+)$/,
    auth: true,
    handler: (_r, env, p) => categoryRoutes.deleteCategory(env.DB, requireParam(p, 'id')),
  },

  // Transactions
  {
    method: 'GET',
    pattern: /^\/transactions$/,
    auth: true,
    handler: (r, env) => transactionRoutes.listTransactions(r, env.DB),
  },
  {
    method: 'GET',
    pattern: /^\/transactions\/(?<id>[^/]+)$/,
    auth: true,
    handler: (_r, env, p) => transactionRoutes.getTransaction(env.DB, requireParam(p, 'id')),
  },
  {
    method: 'POST',
    pattern: /^\/transactions$/,
    auth: true,
    handler: (r, env) => transactionRoutes.createTransaction(r, env.DB),
  },
  {
    method: 'PUT',
    pattern: /^\/transactions\/(?<id>[^/]+)$/,
    auth: true,
    handler: (r, env, p) => transactionRoutes.updateTransaction(r, env.DB, requireParam(p, 'id')),
  },
  {
    method: 'DELETE',
    pattern: /^\/transactions\/(?<id>[^/]+)$/,
    auth: true,
    handler: (_r, env, p) => transactionRoutes.deleteTransaction(env.DB, requireParam(p, 'id')),
  },

  // Summary / Sync / Export / Import
  {
    method: 'GET',
    pattern: /^\/summary$/,
    auth: true,
    handler: (r, env) => summaryRoutes.getSummary(r, env.DB),
  },
  {
    method: 'GET',
    pattern: /^\/sync$/,
    auth: true,
    handler: (r, env) => syncRoutes.syncGet(r, env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/sync$/,
    auth: true,
    handler: (r, env) => syncRoutes.syncPost(r, env.DB),
  },
  {
    method: 'GET',
    pattern: /^\/export$/,
    auth: true,
    handler: (_r, env) => exportRoutes.exportData(env.DB),
  },
  {
    method: 'POST',
    pattern: /^\/import$/,
    auth: true,
    handler: (r, env) => exportRoutes.importData(r, env.DB),
  },
];

const ALL_ROUTES = [...PUBLIC_ROUTES, ...AUTH_ROUTES];

// ============================================================
// 通用响应
// ============================================================

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFoundResponse(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'API 端点未找到' } }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
}

function internalErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
    }),
    { status: 500, headers: { 'Content-Type': 'application/json' } },
  );
}

// ============================================================
// 路由匹配（带全局异常捕获）
// ============================================================

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(4); // 去掉 "/api"
  const method = request.method;

  for (const route of ALL_ROUTES) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (!m) continue;
    // 从正则 groups 中过滤掉 undefined（noUncheckedIndexedAccess 兼容）
    const groups = m.groups || {};
    const params: RouteParams = {};
    for (const key of Object.keys(groups)) {
      const val = groups[key];
      if (typeof val === 'string') params[key] = val;
    }

    try {
      if (route.auth) {
        const authErr = await requireAuth(env.DB, request);
        if (authErr) return authErr;
      }
      return await route.handler(request, env, params);
    } catch (e) {
      console.error('[handler error]', route.pattern.source, e);
      // 不暴露内部错误细节（防信息泄露），仅记录到日志
      return internalErrorResponse();
    }
  }

  return notFoundResponse();
}

// ============================================================
// 入口
// ============================================================

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isDev = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    // 备份端点绕过鉴权（Cron Triggers 不携带 Cookie，路径本身以下划线开头难以猜测）
    if (url.pathname === '/api/_backup' && request.method === 'POST') {
      try {
        return applySecurityHeaders(await backupRoutes.backup(env.DB, env.BACKUPS), isDev);
      } catch (e) {
        console.error('[backup endpoint error]', e);
        return applySecurityHeaders(internalErrorResponse(), isDev);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return applySecurityHeaders(await handleApi(request, env), isDev);
    }

    // 静态资源（由 wrangler 的 assets 配置提供）
    return applySecurityHeaders(await env.ASSETS.fetch(request), isDev);
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('[cron] backup started at', new Date().toISOString());
    try {
      const res = await backupRoutes.backup(env.DB, env.BACKUPS);
      const body = (await res.json()) as { ok: boolean; data?: unknown; error?: unknown };
      console.log('[cron] backup result:', body);
    } catch (e) {
      console.error('[cron] failed:', e);
    }
  },
};
