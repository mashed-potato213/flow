// 极简 hash 路由（支持 query 参数）

type View = (root: HTMLElement, params: Record<string, string>) => void | Promise<void>;

const routes = new Map<string, View>();

export function register(hash: string, view: View) {
  routes.set(hash, view);
}

export function navigate(hash: string) {
  if (location.hash !== hash) {
    // 修改 hash 会触发 hashchange → handleRoute
    location.hash = hash;
  } else {
    // hash 已经匹配：浏览器不会再触发 hashchange，必须手动渲染
    handleRoute();
  }
}

export function currentRoute(): string {
  return location.hash || '#/home';
}

/**
 * 解析 hash 路径，拆分 path 与 query string
 * 例：#/summary?month=2026-09 → { path: '#/summary', params: { month: '2026-09' } }
 */
export function parseHash(hash: string): { path: string; params: Record<string, string> } {
  const raw = hash.slice(1); // 去掉前缀 #
  const [path, queryStr] = raw.split('?');
  const params: Record<string, string> = {};
  if (queryStr) {
    for (const kv of queryStr.split('&')) {
      if (!kv) continue;
      const [k, v = ''] = kv.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  // 必须保留 # 前缀，否则 routes.get(path) 永远查不到
  return { path: path ? '#' + path : '#/home', params };
}

async function handleRoute() {
  const { path, params } = parseHash(currentRoute());
  const view = routes.get(path) || routes.get('#/home')!;

  // 渲染新视图（innerHTML = '' 自动清理 DOM 节点和事件监听器）
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  await view(root, params);
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  if (!location.hash) {
    location.hash = '#/home';
  } else {
    handleRoute();
  }
}
