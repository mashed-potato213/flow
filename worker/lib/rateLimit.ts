// 登录速率限制：基于 D1 meta 表的滑动窗口
// 设计：单用户系统，用 meta 表的单个 key 存 JSON 数组 [timestamp, timestamp, ...]
// - 每次失败追加时间戳
// - 每次检查清理超 windowSec 的时间戳
// - 数组长度 ≥ limit 则锁定到最早时间戳 + windowSec

import { fail } from './response';

const RATE_LIMIT_KEY = 'login_attempts';

interface AttemptRecord {
  count: number;
  firstFailAt: number; // ms 时间戳
  lockedUntil: number; // ms 时间戳；0 表示未锁定
}

/**
 * 读取当前失败计数
 */
async function readAttempts(env: D1Database): Promise<AttemptRecord> {
  const row = await env
    .prepare('SELECT value FROM meta WHERE key = ?')
    .bind(RATE_LIMIT_KEY)
    .first<{ value: string }>();
  if (!row?.value) return { count: 0, firstFailAt: 0, lockedUntil: 0 };
  try {
    const parsed = JSON.parse(row.value) as AttemptRecord;
    return {
      count: parsed.count || 0,
      firstFailAt: parsed.firstFailAt || 0,
      lockedUntil: parsed.lockedUntil || 0,
    };
  } catch {
    return { count: 0, firstFailAt: 0, lockedUntil: 0 };
  }
}

async function writeAttempts(env: D1Database, rec: AttemptRecord): Promise<void> {
  await env
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .bind(RATE_LIMIT_KEY, JSON.stringify(rec))
    .run();
}

const LIMIT = 10; // 窗口内最多失败次数
const WINDOW_SEC = 5 * 60; // 5 分钟窗口
const LOCKOUT_SEC = 15 * 60; // 锁定 15 分钟

/**
 * 检查当前请求是否被锁定；锁定返回 429 Response，否则返回 null
 */
export async function checkRateLimit(env: D1Database): Promise<Response | null> {
  const rec = await readAttempts(env);
  const now = Date.now();

  if (rec.lockedUntil > now) {
    const retryAfter = Math.ceil((rec.lockedUntil - now) / 1000);
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: `登录失败次数过多，请 ${Math.ceil(retryAfter / 60)} 分钟后再试`,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
        },
      },
    );
  }
  return null;
}

/**
 * 记录一次登录失败。返回新的失败次数。
 */
export async function recordFailure(env: D1Database): Promise<number> {
  const rec = await readAttempts(env);
  const now = Date.now();

  // 超出窗口则重置
  if (rec.firstFailAt > 0 && now - rec.firstFailAt > WINDOW_SEC * 1000) {
    rec.count = 0;
    rec.firstFailAt = now;
    rec.lockedUntil = 0;
  } else if (rec.firstFailAt === 0) {
    rec.firstFailAt = now;
  }
  rec.count += 1;

  // 达到上限则锁定
  if (rec.count >= LIMIT) {
    rec.lockedUntil = now + LOCKOUT_SEC * 1000;
  }

  await writeAttempts(env, rec);
  return rec.count;
}

/**
 * 登录成功后清除失败计数
 */
export async function clearFailures(env: D1Database): Promise<void> {
  await env.prepare('DELETE FROM meta WHERE key = ?').bind(RATE_LIMIT_KEY).run();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = fail; // 防止 import 被误删
