// 鉴权模块：PBKDF2 密码哈希 + token 验证
import { nowIso } from './lib/ids';
import { fail } from './lib/response';

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const TOKEN_BYTES = 32;
const SESSION_DAYS = 365;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * 使用 PBKDF2-SHA256 计算密码哈希
 * 返回格式：pbkdf2$<iterations>$<saltHex>$<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  );
  return `pbkdf2$${ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

/**
 * 验证密码是否匹配存储的哈希值
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterStr, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const iterations = parseInt(iterStr, 10);
  if (!iterations || iterations < 1) return false;
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  );
  return toHex(bits) === hashHex;
}

/**
 * 生成随机会话 token（64 字符 hex）
 */
export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)).buffer);
}

/**
 * 创建新会话（写入 sessions 表）
 */
export async function createSession(env: D1Database): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await env.prepare(
    'INSERT INTO sessions (token, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, now.toISOString(), expires.toISOString(), now.toISOString())
    .run();
  return token;
}

/**
 * 删除会话（登出）
 */
export async function deleteSession(env: D1Database, token: string): Promise<void> {
  await env.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

/**
 * 验证 token 是否有效（存在 + 未过期），并刷新 last_used_at
 */
export async function verifyToken(env: D1Database, token: string): Promise<boolean> {
  const row = await env.prepare(
    'SELECT expires_at FROM sessions WHERE token = ?',
  )
    .bind(token)
    .first<{ expires_at: string }>();
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) return false;
  await env.prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?')
    .bind(nowIso(), token)
    .run();
  return true;
}

/**
 * 是否已设置密码
 */
export async function isPasswordSetup(env: D1Database): Promise<boolean> {
  const row = await env.prepare(
    "SELECT value FROM meta WHERE key = 'password_hash'",
  ).first<{ value: string }>();
  return !!row?.value;
}

/**
 * 获取密码哈希
 */
export async function getPasswordHash(env: D1Database): Promise<string | null> {
  const row = await env.prepare(
    "SELECT value FROM meta WHERE key = 'password_hash'",
  ).first<{ value: string }>();
  return row?.value || null;
}

/**
 * 设置密码哈希（upsert）
 */
export async function setPasswordHash(env: D1Database, hash: string): Promise<void> {
  await env.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('password_hash', ?)",
  ).bind(hash).run();
}

/**
 * 从请求头中读取 token
 */
export function readTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/flow_token=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * 鉴权守卫：返回 null 表示通过；返回 Response 表示 401
 */
export async function requireAuth(env: D1Database, request: Request): Promise<Response | null> {
  const token = readTokenFromRequest(request);
  if (!token) return fail('UNAUTHORIZED', '未登录', 401);
  const ok = await verifyToken(env, token);
  if (!ok) return fail('UNAUTHORIZED', '会话已过期', 401);
  return null;
}