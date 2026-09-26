// 分类路由：list / create / update / delete
import { ok, fail } from '../lib/response';
import { ulid, nowIso } from '../lib/ids';
import { NewCategorySchema } from '../../shared/schemas';
import type { Category, CategoryScope } from '../lib/types';

const VALID_SCOPES: CategoryScope[] = ['expense', 'income', 'finance'];

/**
 * GET /api/categories?scope=expense|income|finance
 */
export async function listCategories(request: Request, env: D1Database): Promise<Response> {
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope');

  if (scope && VALID_SCOPES.includes(scope as CategoryScope)) {
    const { results } = await env
      .prepare(
        `SELECT * FROM categories WHERE deleted = 0 AND scope = ?
         ORDER BY is_preset DESC, name ASC`,
      )
      .bind(scope)
      .all<Category>();
    return ok(results);
  }
  const { results } = await env
    .prepare(
      `SELECT * FROM categories WHERE deleted = 0
       ORDER BY is_preset DESC, name ASC`,
    )
    .all<Category>();
  return ok(results);
}

/**
 * POST /api/categories
 */
export async function createCategory(request: Request, env: D1Database): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  const parsed = NewCategorySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const now = nowIso();
  const category: Category = {
    id: data.id || ulid(),
    name: data.name,
    icon: data.icon ?? null,
    scope: data.scope,
    is_preset: 0,
    created_at: now,
    updated_at: now,
    last_modified: now,
    deleted: 0,
  };
  await env
    .prepare(
      `INSERT INTO categories (id, name, icon, scope, is_preset, created_at, updated_at, last_modified, deleted)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    )
    .bind(
      category.id,
      category.name,
      category.icon,
      category.scope,
      category.created_at,
      category.updated_at,
      category.last_modified,
    )
    .run();
  return ok(category);
}

/**
 * PUT /api/categories/:id
 * 预置分类（is_preset=1）禁止改名，但允许改 icon
 */
export async function updateCategory(
  request: Request,
  env: D1Database,
  id: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('INVALID_JSON', '请求体不是合法 JSON');
  }
  const parsed = NewCategorySchema.partial().safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail('INVALID_INPUT', issue ? issue.message : '输入校验失败');
  }
  const data = parsed.data;

  const existing = await env
    .prepare('SELECT * FROM categories WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<Category>();
  if (!existing) return fail('NOT_FOUND', '分类不存在', 404);

  // 预置分类保护：禁止改名
  if (existing.is_preset === 1 && data.name !== undefined && data.name !== existing.name) {
    return fail('PRESET_LOCKED', '预置分类不可改名', 403);
  }

  const now = nowIso();
  const updated: Category = {
    ...existing,
    name: data.name ?? existing.name,
    icon: data.icon !== undefined ? data.icon : existing.icon,
    scope: (data.scope as CategoryScope | undefined) ?? existing.scope,
    updated_at: now,
    last_modified: now,
  };
  await env
    .prepare(
      `UPDATE categories SET name = ?, icon = ?, scope = ?, updated_at = ?, last_modified = ? WHERE id = ?`,
    )
    .bind(updated.name, updated.icon, updated.scope, updated.updated_at, updated.last_modified, id)
    .run();
  return ok(updated);
}

/**
 * DELETE /api/categories/:id
 * 预置分类禁止删除；被交易引用的分类禁止删除
 */
export async function deleteCategory(env: D1Database, id: string): Promise<Response> {
  const existing = await env
    .prepare('SELECT is_preset FROM categories WHERE id = ? AND deleted = 0')
    .bind(id)
    .first<{ is_preset: number }>();
  if (!existing) return fail('NOT_FOUND', '分类不存在', 404);
  if (existing.is_preset === 1) {
    return fail('PRESET_LOCKED', '预置分类不可删除', 403);
  }

  const ref = await env
    .prepare('SELECT COUNT(*) as cnt FROM transactions WHERE category_id = ? AND deleted = 0')
    .bind(id)
    .first<{ cnt: number }>();
  if (ref && ref.cnt > 0) {
    return fail('IN_USE', `该分类被 ${ref.cnt} 条交易引用，无法删除`, 409);
  }
  const now = nowIso();
  await env
    .prepare('UPDATE categories SET deleted = 1, updated_at = ?, last_modified = ? WHERE id = ?')
    .bind(now, now, id)
    .run();
  return ok({ id, deleted: true });
}
