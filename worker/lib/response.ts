// 统一 JSON 响应工具

export function ok(data: any): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fail(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 生成 httpOnly cookie 字符串
 * 仅在 HTTPS 环境下添加 Secure 标记（生产环境）
 */
export function setCookie(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  // 仅当当前协议为 HTTPS 时才设置 Secure（开发环境为 HTTP）
  try {
    if (typeof location !== 'undefined' && location.protocol === 'https:') {
      parts.push('Secure');
    }
  } catch {
    // 在 Worker 环境中没有 location 对象
  }
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}