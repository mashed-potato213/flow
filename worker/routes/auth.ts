// 鉴权路由：status / setup / login / logout
import { ok, fail, setCookie, clearCookie } from '../lib/response';
import {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  isPasswordSetup,
  getPasswordHash,
  setPasswordHash,
  readTokenFromRequest,
} from '../auth';

const COOKIE_NAME = 'flow_token';
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 年（秒）

function cookieHeaders(value: string | null): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (value) {
    headers.append('Set-Cookie', setCookie(COOKIE_NAME, value, COOKIE_MAX_AGE));
  } else {
    headers.append('Set-Cookie', clearCookie(COOKIE_NAME));
  }
  return headers;
}

/**
 * GET /api/auth/status
 * 返回 { setup: boolean }，告知前端是首次设置密码还是登录模式
 */
export async function status(env: D1Database): Promise<Response> {
  const setup = await isPasswordSetup(env);
  return new Response(
    JSON.stringify({ ok: true, data: { setup } }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * POST /api/auth/setup
 * 首次设置密码（仅在未设置时可用）
 */
export async function setup(request: Request, env: D1Database): Promise<Response> {
  if (await isPasswordSetup(env)) {
    return fail('ALREADY_SETUP', '密码已设置', 409);
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!body.password || body.password.length < 6) {
    return fail('INVALID_PASSWORD', '密码至少 6 个字符');
  }
  const hash = await hashPassword(body.password);
  await setPasswordHash(env, hash);
  const token = await createSession(env);
  return new Response(
    JSON.stringify({ ok: true, data: { token } }),
    { headers: cookieHeaders(token) },
  );
}

/**
 * POST /api/auth/login
 * 登录
 */
export async function login(request: Request, env: D1Database): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!body.password) return fail('INVALID_PASSWORD', '请输入密码');
  const hash = await getPasswordHash(env);
  if (!hash) return fail('NOT_SETUP', '尚未设置密码', 400);
  const valid = await verifyPassword(body.password, hash);
  if (!valid) return fail('WRONG_PASSWORD', '密码错误', 401);
  const token = await createSession(env);
  return new Response(
    JSON.stringify({ ok: true, data: { token } }),
    { headers: cookieHeaders(token) },
  );
}

/**
 * POST /api/auth/logout
 * 登出（删除当前会话）
 */
export async function logout(request: Request, env: D1Database): Promise<Response> {
  const token = readTokenFromRequest(request);
  if (token) await deleteSession(env, token);
  return new Response(
    JSON.stringify({ ok: true, data: null }),
    { headers: cookieHeaders(null) },
  );
}