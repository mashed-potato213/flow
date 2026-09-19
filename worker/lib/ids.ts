// ID 生成与时间工具
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/**
 * 生成 ULID（26 字符、时间序）
 * 前 10 字符为时间戳（base32），后 16 字符为随机数
 */
export function ulid(): string {
  const now = Date.now();
  let time = '';
  let t = now;
  for (let i = 0; i < TIME_LEN; i++) {
    time = ENCODING[t % ENCODING_LEN] + time;
    t = Math.floor(t / ENCODING_LEN);
  }
  const randomBytes = crypto.getRandomValues(new Uint8Array(RANDOM_LEN));
  let random = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    random += ENCODING[randomBytes[i] % ENCODING_LEN];
  }
  return time + random;
}

/**
 * 当前时间的 ISO 字符串（秒级精度）
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 当前时间的 ISO 字符串（毫秒精度，用于 last_modified）
 */
export function nowMs(): string {
  return new Date().toISOString();
}