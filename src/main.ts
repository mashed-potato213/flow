import './style.css';
import { register, startRouter, navigate } from './router';
import { api } from './api';
import { renderLogin } from './views/login';
import { renderSettings } from './views/settings';
import { renderAccounts } from './views/accounts';
import { renderCategories } from './views/categories';
import { renderHome } from './views/home';
import { renderList } from './views/list';
import { renderSummary } from './views/summary';
import { startAutoSync, syncAll } from './sync';

async function bootstrap() {
  try {
    // 先注册所有路由
    register('#/login', renderLogin);
    register('#/home', renderHome);
    register('#/list', renderList);
    register('#/summary', renderSummary);
    register('#/settings', renderSettings);
    register('#/accounts', renderAccounts);
    register('#/categories', renderCategories);

    // 检测登录状态，决定初始路由
    const status = await api.get<{ setup: boolean }>('/auth/status');
    if (!status.ok || !status.data) {
      navigate('#/login');
    } else {
      // 已能连接服务，默认进入 home
      // 各页面在加载时会自动处理鉴权失败的情况（Day 3+ 完善）
      if (!location.hash) navigate('#/home');
    }

    startRouter();

    // 启动自动同步（仅登录后）
    if (status.ok && status.data) {
      startAutoSync();
    }

    // 注册 PWA service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // PWA 注册失败不影响功能
      });
    }
  } catch (e) {
    console.error('Bootstrap failed:', e);
    // 渲染错误界面
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = `
        <div class="min-h-screen flex items-center justify-center p-8">
          <div class="bg-white rounded-xl p-6 max-w-sm text-center">
            <p class="text-4xl mb-4">⚠️</p>
            <h2 class="text-lg font-bold mb-2">启动失败</h2>
            <p class="text-sm text-gray-600 mb-4">${e instanceof Error ? e.message : '未知错误'}</p>
            <button onclick="location.reload()" class="bg-primary text-white px-4 py-2 rounded-lg">重试</button>
          </div>
        </div>
      `;
    }
  }
}

bootstrap();

// 暴露 syncAll 用于调试
(window as any).syncAll = syncAll;
