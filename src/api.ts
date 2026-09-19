// API 客户端
import { navigate } from './router';

export interface ApiResult<T = any> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// 401 时不触发自动跳转的路径（鉴权相关请求本身）
const AUTH_PATHS = ['/auth/status', '/auth/login', '/auth/setup', '/auth/logout'];

async function request<T = any>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    // 401 未登录：除鉴权接口外，自动跳转到登录页
    if (res.status === 401 && !AUTH_PATHS.includes(path)) {
      // 保存来源页面（登录成功后跳回），但不要保存登录页本身
      const from = location.hash;
      if (from && from !== '#/login') {
        sessionStorage.setItem('flow_redirect', from);
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
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: e instanceof Error ? e.message : '网络错误' },
    };
  }
}

export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body: any) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T = any>(path: string, body: any) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T = any>(path: string) => request<T>(path, { method: 'DELETE' }),
};
