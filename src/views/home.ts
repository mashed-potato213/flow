// 快速记账视图（Day 4 完整实现）
// 4 种类型：支出 / 收入 / 转账 / 市值
// 根据类型动态展示账户、目标账户、分类下拉
import { api } from '../api';
import { renderTabBar, bindTabBar } from './tabbar';
import { formatDate } from '../utils';
import type { Account, Category, TransactionType } from '../api-types';

const TYPES: { value: TransactionType; label: string; emoji: string }[] = [
  { value: 'expense', label: '支出', emoji: '🛒' },
  { value: 'income', label: '收入', emoji: '💰' },
  { value: 'transfer', label: '转账', emoji: '🔄' },
  { value: 'adjustment', label: '市值', emoji: '📊' },
];

/**
 * HTML 转义
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] || c));
}

/**
 * 根据当前选中的交易类型，返回该类型下应展示的分类 scope
 */
function categoryScopeFor(type: TransactionType): 'expense' | 'income' | 'finance' | null {
  if (type === 'income') return 'income';
  if (type === 'expense') return 'expense';
  if (type === 'adjustment') return 'finance';
  return null; // transfer 不需要分类
}

/**
 * 账户筛选辅助函数
 * - 可支付账户：用于支出/收入/转账（payment_channel 或 asset_holding + is_payment_capable）
 * - 理财账户：用于市值调整（asset_holding）
 */
function payableAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.type === 'payment_channel' || a.is_payment_capable === 1);
}
function holdingAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.type === 'asset_holding');
}

export async function renderHome(root: HTMLElement) {
  let selectedType: TransactionType = 'expense';
  let accounts: Account[] = [];
  let categories: Category[] = [];

  async function load() {
    try {
      const [accRes, catRes] = await Promise.all([
        api.get<Account[]>('/accounts'),
        api.get<Category[]>('/categories'),
      ]);
      if (accRes.ok && accRes.data) accounts = accRes.data;
      if (catRes.ok && catRes.data) categories = catRes.data;
      const errs = [accRes, catRes].filter((r) => !r.ok).map((r) => r.error?.message || '加载失败');
      if (errs.length) console.warn('部分下拉数据加载失败:', errs);
      render();
    } catch (e) {
      console.error('home.load failed:', e);
      root.innerHTML = `
        <div class="min-h-screen flex items-center justify-center p-8">
          <div class="bg-white rounded-xl p-6 max-w-sm text-center">
            <p class="text-4xl mb-4">⚠️</p>
            <h2 class="text-lg font-bold mb-2">加载失败</h2>
            <p class="text-sm text-gray-600 mb-4">${e instanceof Error ? e.message : '未知错误'}</p>
            <button onclick="location.reload()" class="bg-primary text-white px-4 py-2 rounded-lg">重试</button>
          </div>
        </div>
      `;
    }
  }

  function render() {
    const scope = categoryScopeFor(selectedType);
    const filteredCats = scope ? categories.filter((c) => c.scope === scope) : [];

    root.innerHTML = `
      <div class="min-h-screen bg-gray-50 pb-tabbar">
        <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10">
          <h1 class="text-xl font-bold text-gray-900 py-4">记一笔</h1>
        </header>
        <div class="p-4 space-y-4">
          <!-- 类型选择 -->
          <div class="grid grid-cols-4 gap-2">
            ${TYPES.map(
              (t) => `
              <button data-type="${t.value}"
                class="type-btn py-3 rounded-xl text-center transition ${
                  selectedType === t.value ? 'bg-primary text-white' : 'bg-white text-gray-700'
                }">
                <div class="text-xl">${t.emoji}</div>
                <div class="text-xs mt-1">${t.label}</div>
              </button>
            `,
            ).join('')}
          </div>

          <!-- 金额输入 -->
          <div class="bg-white rounded-xl p-6">
            <label class="block text-sm text-gray-600 mb-2">金额</label>
            <div class="flex items-baseline">
              <span class="text-2xl text-gray-400 mr-2">¥</span>
              <input id="amount" type="number" step="0.01" min="0.01" inputmode="decimal"
                placeholder="0.00" required
                class="flex-1 text-3xl font-bold outline-none" />
            </div>
          </div>

          <!-- 账户选择 -->
          <div class="bg-white rounded-xl p-4">
            <label class="block text-sm text-gray-600 mb-2">${
              selectedType === 'transfer' ? '从账户' : '账户'
            }</label>
            <select id="account" class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary">
              <option value="">请选择</option>
              ${(selectedType === 'adjustment' ? holdingAccounts(accounts) : payableAccounts(accounts))
                .map(
                  (a) =>
                    `<option value="${a.id}">${escapeHtml(a.name)} (${
                      a.type === 'payment_channel' ? '支付' : '理财'
                    })</option>`,
                )
                .join('')}
            </select>
          </div>

          ${
            selectedType === 'transfer'
              ? `
            <div class="bg-white rounded-xl p-4">
              <label class="block text-sm text-gray-600 mb-2">到账户</label>
              <select id="target-account" class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary">
                <option value="">请选择</option>
              ${payableAccounts(accounts)
                .map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)
                .join('')}
              </select>
            </div>
          `
              : ''
          }

          ${
            selectedType !== 'transfer'
              ? `
            <div class="bg-white rounded-xl p-4">
              <label class="block text-sm text-gray-600 mb-2">分类</label>
              <select id="category" class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary">
                <option value="">请选择</option>
                ${filteredCats
                  .map(
                    (c) =>
                      `<option value="${c.id}">${c.icon || ''} ${escapeHtml(c.name)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
          `
              : ''
          }

          <!-- 日期选择 -->
          <div class="bg-white rounded-xl p-4">
            <label class="block text-sm text-gray-600 mb-2">日期</label>
            <div class="relative">
              <!-- 显示层：text input 完全可控对齐，iOS 上靠左显示 -->
              <input id="date-display" type="text" readonly value="${formatDate()}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary bg-white" />
              <!-- 触发层：透明的 date input 覆盖在上层，捕获点击触发 native picker -->
              <input id="date" type="date" value="${formatDate()}"
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            </div>
          </div>

          <!-- 备注 -->
          <div class="bg-white rounded-xl p-4">
            <label class="block text-sm text-gray-600 mb-2">备注</label>
            <input id="note" type="text" placeholder="（可选）" maxlength="100"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" />
          </div>

          <!-- 保存按钮 -->
          <button id="save-btn" class="w-full bg-primary text-white py-4 rounded-xl font-medium text-lg disabled:opacity-50">
            保存
          </button>

          <p id="error" class="text-sm text-red-600 hidden"></p>
        </div>
        ${renderTabBar()}
      </div>
    `;

    bindEvents();
    bindTabBar(root);
  }

  function bindEvents() {
    root.querySelectorAll<HTMLButtonElement>('.type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedType = btn.dataset.type as TransactionType;
        render();
      });
    });

    // 同步隐藏的 date input 与显示层 text input（iOS 解决 native 居中）
    const dateInput = root.querySelector('#date') as HTMLInputElement | null;
    const dateDisplay = root.querySelector('#date-display') as HTMLInputElement | null;
    if (dateInput && dateDisplay) {
      const syncDate = () => {
        dateDisplay.value = dateInput.value;
      };
      dateInput.addEventListener('change', syncDate);
      dateInput.addEventListener('input', syncDate);
    }

    const saveBtn = root.querySelector('#save-btn') as HTMLButtonElement;
    const errorEl = root.querySelector('#error') as HTMLParagraphElement;

    function showError(msg: string) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    saveBtn.addEventListener('click', async () => {
      // 防重复点击：保存进行中禁用按钮
      if (saveBtn.disabled) return;

      const amountStr = (root.querySelector('#amount') as unknown as HTMLInputElement).value.trim();
      const amount = parseFloat(amountStr);
      const account = (root.querySelector('#account') as unknown as HTMLSelectElement).value;
      const targetAccountEl = root.querySelector(
        '#target-account',
      ) as unknown as HTMLSelectElement | null;
      const targetAccount = targetAccountEl?.value;
      const categoryEl = root.querySelector('#category') as unknown as HTMLSelectElement | null;
      const category = categoryEl?.value;
      const date = (root.querySelector('#date') as unknown as HTMLInputElement).value;
      const note = (root.querySelector('#note') as unknown as HTMLInputElement).value;

      errorEl.classList.add('hidden');

      // 严格的金额校验
      if (!amountStr || isNaN(amount)) {
        showError('请输入金额');
        return;
      }
      if (amount <= 0) {
        showError('金额必须大于 0');
        return;
      }
      if (amount > 1e10) {
        showError('金额超出合理范围');
        return;
      }
      if (!account) {
        showError('请选择账户');
        return;
      }
      if (selectedType === 'transfer' && !targetAccount) {
        showError('请选择目标账户');
        return;
      }
      if (selectedType !== 'transfer' && !category) {
        showError('请选择分类');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      const payload: any = {
        date,
        amount,
        type: selectedType,
        account_id: account,
        note: note.trim() || undefined,
      };
      if (selectedType === 'transfer') {
        payload.target_account_id = targetAccount;
      } else {
        payload.category_id = category;
      }

      try {
        const res = await api.post('/transactions', payload);
        if (res.ok) {
          // 清空表单
          (root.querySelector('#amount') as HTMLInputElement).value = '';
          (root.querySelector('#note') as HTMLInputElement).value = '';
          saveBtn.textContent = '✓ 已保存';
          setTimeout(() => {
            if (saveBtn.textContent === '✓ 已保存') saveBtn.textContent = '保存';
            saveBtn.disabled = false;
          }, 1000);
        } else {
          showError(res.error?.message || '保存失败');
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
      } catch (e) {
        showError('网络错误：' + (e instanceof Error ? e.message : ''));
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    });
  }

  await load();
}