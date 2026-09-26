// 统一 JSON 响应工具

/**
 * 成功响应
 */
export function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 失败响应
 */
export function fail(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 生成 httpOnly cookie 字符串
 * 通过 Request URL 的协议判断是否添加 Secure 标记
 */
export function setCookie(name: string, value: string, maxAge: number, request: Request): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/**
 * 清除 cookie
 */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * 在 Response 上添加安全响应头
 * - CSP: 限制脚本和资源来源（应用自身 + 内联样式用于 Tailwind）
 * - X-Frame-Options: 防止点击劫持
 * - X-Content-Type-Options: 防止 MIME 嗅探
 * - Referrer-Policy: 限制 referer 泄露
 * - Permissions-Policy: 禁用不需要的浏览器能力
 */
export function applySecurityHeaders(response: Response, isDev = false): Response {
  const headers = response.headers;
  // CSP: 开发环境允许 inline script（HMR），生产严格
  const csp = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: https:; font-src 'self' data:;"
    : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:; font-src 'self' data:;";
  headers.set('Content-Security-Policy', csp);
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  return response;
}
