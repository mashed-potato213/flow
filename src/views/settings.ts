// 设置视图（Day 6 增强版）
// 新增：立即同步、导出 JSON 备份、导入 JSON 备份
import { api } from '../api';
import { navigate } from '../router';
import { renderTabBar, bindTabBar } from './tabbar';
import { confirmDialog } from './confirm';
import { syncAll, fullSync } from '../sync';

export async function renderSettings(root: HTMLElement) {
  root.innerHTML = `
    <div class="min-h-screen bg-gray-50 pb-tabbar">
      <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10">
        <h1 class="text-xl font-bold text-gray-900 py-4">设置</h1>
      </header>
      <div class="p-4 space-y-3">
        <a href="#/accounts" class="block bg-white rounded-xl p-4 flex items-center justify-between">
          <span>账户管理</span>
          <span class="text-gray-400">→</span>
        </a>
        <a href="#/categories" class="block bg-white rounded-xl p-4 flex items-center justify-between">
          <span>分类管理</span>
          <span class="text-gray-400">→</span>
        </a>

        <button id="sync-btn" class="w-full bg-white rounded-xl p-4 text-left flex items-center justify-between">
          <span>立即同步</span>
          <span class="text-gray-400">🔄</span>
        </button>

        <button id="export-btn" class="w-full bg-white rounded-xl p-4 text-left flex items-center justify-between">
          <span>导出 JSON 备份</span>
          <span class="text-gray-400">⬇️</span>
        </button>

        <label class="block bg-white rounded-xl p-4 flex items-center justify-between cursor-pointer">
          <span>导入 JSON 备份</span>
          <span class="text-gray-400">⬆️</span>
          <input id="import-input" type="file" accept=".json" class="hidden" />
        </label>

        <button id="logout-btn" class="w-full bg-white rounded-xl p-4 text-left text-red-600">
          退出登录
        </button>

        <p id="status" class="text-sm text-gray-500 text-center py-2 hidden"></p>
      </div>
      ${renderTabBar()}
    </div>
  `;

  const status = root.querySelector<HTMLParagraphElement>('#status')!;

  function showStatus(msg: string, isError = false) {
    status.textContent = msg;
    status.className = `text-sm text-center py-2 ${isError ? 'text-red-600' : 'text-green-600'}`;
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 3000);
  }

  root.querySelector<HTMLButtonElement>('#sync-btn')!.addEventListener('click', async () => {
    showStatus('同步中...');
    const res = await syncAll();
    showStatus(res.ok ? '✓ 同步完成' : '同步失败：' + (res.message || ''), !res.ok);
  });

  root.querySelector<HTMLButtonElement>('#export-btn')!.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/export', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('导出失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flow-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('✓ 已下载备份文件');
    } catch (e) {
      showStatus('导出失败：' + (e instanceof Error ? e.message : ''), true);
    }
  });

  root.querySelector<HTMLInputElement>('#import-input')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const ok = await confirmDialog(root, {
      title: '导入备份',
      message: '导入会合并服务端数据（按 LWW 策略）。\n继续？',
      confirmText: '继续导入',
      cancelText: '取消',
    });
    if (!ok) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await api.post('/import', json);
      if (res.ok) {
        showStatus(`✓ 导入 ${(res.data as any)?.inserted || 0} 条`);
        // 重新同步
        await fullSync();
      } else {
        showStatus('导入失败：' + (res.error?.message || ''), true);
      }
    } catch (e) {
      showStatus('导入失败：' + (e instanceof Error ? e.message : ''), true);
    }
  });

  root.querySelector<HTMLButtonElement>('#logout-btn')!.addEventListener('click', async () => {
    const ok = await confirmDialog(root, {
      title: '退出登录',
      message: '确定要退出登录吗？',
      confirmText: '退出',
      cancelText: '取消',
      danger: true,
    });
    if (!ok) return;
    await api.post('/auth/logout', {});
    navigate('#/login');
  });

  bindTabBar(root);
}
