// 分类路由：list / create / update / delete
// 鉴权由 index.ts 的统一中间件处理，这里只负责业务逻辑
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import type { Category, CategoryScope } from '../lib/types';

/**
 * GET /api/categories?scope=expense|income|finance
 * 列出分类（可选 scope 过滤）；按 is_preset DESC, name ASC 排序
 */
export async function listCategories(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');
  let results: Category[];
  if (scope && ['expense', 'income', 'finance'].includes(scope)) {
    const res = await env.prepare(
      `SELECT * FROM categories WHERE deleted = 0 AND scope = ?
       ORDER BY is_preset DESC, name ASC`,
    )
      .bind(scope)
      .all<Category>();
    results = res.results;
  } else {
    const res = await env.prepare(
      `SELECT * FROM categories WHERE deleted = 0
       ORDER BY is_preset DESC, name ASC`,
    ).all<Category>();
    results = res.results;
  }
  return ok(results);
}

/**
 * POST /api/categories
 * 创建自定义分类
 */
export async function createCategory(request: Request, env: D1Database): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Partial<Category>;
  if (!body.name || !body.scope) {
    return fail('INVALID_INPUT', '缺少必填字段');
  }
  if (!['expense', 'income', 'finance'].includes(body.scope)) {
    return fail('INVALID_SCOPE', '分类 scope 无效');
  }
  const now = nowIso();
  const category: Category = {
    id: ulid(),
    name: body.name,
    icon: body.icon || null,
    scope: body.scope as CategoryScope,
    is_preset: 0,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env.prepare(
    `INSERT INTO categories (id, name, icon, scope, is_preset, created_at, updated_at, last_modified, deleted)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`,
  ).bind(
    category.id,
    category.name,
    category.icon,
    category.scope,
    category.created_at,
    category.updated_at,
    category.last_modified,
  ).run();
  return ok(category);
}

/**
 * PUT /api/categories/:id
 * 更新分类（部分字段）。预置分类（is_preset=1）禁止改名但允许改 icon
 */
export async function updateCategory(
  request: Request,
  env: D1Database,
  id: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Partial<Category>;
  const existing = await env.prepare(
    'SELECT * FROM categories WHERE id = ? AND deleted = 0',
  )
    .bind(id)
    .first<Category>();
  if (!existing) return fail('NOT_FOUND', '分类不存在', 404);

  if (body.scope !== undefined && !['expense', 'income', 'finance'].includes(body.scope)) {
    return fail('INVALID_SCOPE', '分类 scope 无效');
  }

  const now = nowIso();
  const updated: Category = {
    ...existing,
    name: body.name ?? existing.name,
    icon: body.icon !== undefined ? body.icon : existing.icon,
    scope: (body.scope as CategoryScope | undefined) ?? existing.scope,
    updated_at: now,
    last_modified: now,
  };
  await env.prepare(
    `UPDATE categories SET name = ?, icon = ?, scope = ?, updated_at = ?, last_modified = ? WHERE id = ?`,
  )
    .bind(
      updated.name,
      updated.icon,
      updated.scope,
      updated.updated_at,
      updated.last_modified,
      id,
    )
    .run();
  return ok(updated);
}

/**
 * DELETE /api/categories/:id
 * 软删除分类（若被交易引用则拒绝）。预置分类禁止删除。
 */
export async function deleteCategory(env: D1Database, id: string): Promise<Response> {
  const existing = await env.prepare(
    'SELECT is_preset FROM categories WHERE id = ? AND deleted = 0',
  )
    .bind(id)
    .first<{ is_preset: number }>();
  if (!existing) return fail('NOT_FOUND', '分类不存在', 404);
  if (existing.is_preset === 1) {
    return fail('PRESET_LOCKED', '预置分类不可删除', 403);
  }

  const ref = await env.prepare(
    `SELECT COUNT(*) as cnt FROM transactions WHERE category_id = ? AND deleted = 0`,
  )
    .bind(id)
    .first<{ cnt: number }>();
  if (ref && ref.cnt > 0) {
    return fail('IN_USE', `该分类被 ${ref.cnt} 条交易引用，无法删除`, 409);
  }
  const now = nowIso();
  await env.prepare(
    'UPDATE categories SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?',
  )
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}
