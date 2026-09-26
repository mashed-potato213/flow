// API 客户端
import { navigate } from './router';

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// 401 时不触发自动跳转的路径（鉴权相关请求本身）
const AUTH_PATHS = ['/auth/status', '/auth/login', '/auth/setup', '/auth/logout'];

// 默认请求超时 10 秒
const DEFAULT_TIMEOUT_MS = 10_000;

async function request<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  // 用 AbortController 实现超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    // 401 未登录：除鉴权接口外，自动跳转到登录页
    if (res.status === 401 && !AUTH_PATHS.includes(path)) {
      // 持久化来源页面到 localStorage（跨刷新保留）
      const from = location.hash;
      if (from && from !== '#/login') {
        try {
          localStorage.setItem('flow_redirect', from);
        } catch {
          // localStorage 可能被禁用（隐私模式），静默失败
        }
      }
      navigate('#/login');
      return {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '请先登录' },
      };
    }

    const data = (await res.json().catch(() => ({
      ok: false,
      error: { code: 'PARSE_ERROR', message: '响应解析失败' },
    }))) as ApiResult<T>;
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return {
        ok: false,
        error: { code: 'TIMEOUT', message: '请求超时' },
      };
    }
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: e instanceof Error ? e.message : '网络错误' },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path),
  post: <T = unknown>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T = unknown>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * 读取并清除登录前的来源页面（登录成功后调用）
 */
export function consumeRedirect(): string | null {
  try {
    const v = localStorage.getItem('flow_redirect');
    if (v) localStorage.removeItem('flow_redirect');
    return v;
  } catch {
    return null;
  }
}
