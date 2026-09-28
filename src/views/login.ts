// 视图集合：登录
// Day 6 已拆分：
//   - renderSettings → views/settings.ts
import { api } from '../api';
import { navigate } from '../router';

// ============================================================
// 登录 / 首次设置视图
// ============================================================
export function renderLogin(root: HTMLElement) {
  root.innerHTML = `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 pt-safe pb-safe">
      <div class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <div class="text-center mb-8">
          <div class="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span class="text-white text-3xl font-bold">F</span>
          </div>
          <h1 class="text-2xl font-bold text-gray-900">Flow 记账</h1>
          <p id="subtitle" class="text-sm text-gray-500 mt-2">加载中...</p>
        </div>

        <form id="auth-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              id="password"
              autocomplete="current-password"
              class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
              placeholder="请输入密码"
              minlength="10"
              required
            />
            <p id="hint" class="text-xs text-gray-500 mt-1"></p>
          </div>

          <button
            type="submit"
            id="submit-btn"
            class="w-full bg-primary text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            提交
          </button>
        </form>

        <p id="error" class="text-sm text-red-600 mt-4 hidden"></p>
      </div>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>('#auth-form')!;
  const passwordInput = root.querySelector<HTMLInputElement>('#password')!;
  const subtitle = root.querySelector<HTMLParagraphElement>('#subtitle')!;
  const hint = root.querySelector<HTMLParagraphElement>('#hint')!;
  const submitBtn = root.querySelector<HTMLButtonElement>('#submit-btn')!;
  const errorEl = root.querySelector<HTMLParagraphElement>('#error')!;

  let mode: 'setup' | 'login' = 'login';

  // 检测模式
  api.get<{ setup: boolean }>('/auth/status').then((res) => {
    if (res.ok && res.data) {
      mode = res.data.setup ? 'login' : 'setup';
      subtitle.textContent = mode === 'setup' ? '首次使用，请设置密码' : '请输入密码继续';
      submitBtn.textContent = mode === 'setup' ? '设置密码' : '登录';
      hint.textContent = mode === 'setup' ? '至少 10 个字符,必须含字母和数字' : '';
    } else {
      subtitle.textContent = '无法连接服务';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.classList.add('hidden');

    const password = passwordInput.value;
    if (!password) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '处理中...';

    const endpoint = mode === 'setup' ? '/auth/setup' : '/auth/login';
    const res = await api.post(endpoint, { password });

    if (res.ok) {
      // 登录/设置成功：跳回来源页面（如有），否则默认 home
      const redirect = sessionStorage.getItem('flow_redirect');
      sessionStorage.removeItem('flow_redirect');
      navigate(redirect && redirect !== '#/login' ? redirect : '#/home');
    } else {
      errorEl.textContent = res.error?.message || '操作失败';
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'setup' ? '设置密码' : '登录';
    }
  });
}

// ============================================================
// 设置视图已拆分到 src/views/settings.ts（Day 6 增强版）
// ============================================================
