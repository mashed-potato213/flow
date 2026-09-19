// 底部 Tab Bar 通用组件
import { navigate } from '../router';

/**
 * 渲染底部 4-Tab 导航栏
 * 高亮当前 hash 对应的 tab
 */
export function renderTabBar(): string {
  const current = location.hash || '#/home';
  const tabs = [
    { hash: '#/home', icon: '✏️', label: '记一笔' },
    { hash: '#/list', icon: '📋', label: '列表' },
    { hash: '#/summary', icon: '📊', label: '汇总' },
    { hash: '#/settings', icon: '⚙️', label: '设置' },
  ];
  return `
    <nav class="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-20 pb-safe">
      <div class="max-w-screen-sm mx-auto flex justify-around">
        ${tabs
          .map(
            (t) => `
          <button type="button" data-hash="${t.hash}"
             class="tab-btn flex-1 flex flex-col items-center py-2 ${current === t.hash ? 'text-primary' : 'text-gray-500'}">
            <span class="text-xl">${t.icon}</span>
            <span class="text-xs mt-1">${t.label}</span>
          </button>
        `,
          )
          .join('')}
      </div>
    </nav>
  `;
}

/**
 * 给当前 root 中的 tab 按钮绑定点击事件
 * 使用 JS 跳转，避免依赖 hashchange 事件（更稳定）
 */
export function bindTabBar(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const hash = btn.dataset.hash;
      if (hash) navigate(hash);
    });
  });
}
