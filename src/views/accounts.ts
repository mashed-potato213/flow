// 账户管理视图（Day 3 完整实现）
import { api } from '../api';
import { formatMoney } from '../utils';
import { mutateAndQueue } from '../offlineStore';
import { confirmDialog } from './confirm';
import { ulid } from 'ulid';
import Sortable from 'sortablejs';

interface Account {
  id: string;
  name: string;
  type: 'payment_channel' | 'asset_holding';
  is_payment_capable: number;
  opening_balance: number;
  sort_order: number;
  balance?: number;
  created_at: string;
}

/**
 * 账户标签（简短展示）
 */
function accountLabel(a: { type: string; is_payment_capable?: number }): string {
  if (a.type === 'payment_channel') return '💳 支付';
  if (a.is_payment_capable) return '💰 理财·可付';
  return '📊 理财';
}

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

export async function renderAccounts(root: HTMLElement) {
  let sortableInstance: Sortable | null = null;

  root.innerHTML = `
    <div class="min-h-screen bg-gray-50 pb-12">
      <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10 flex items-center">
        <a href="#/settings" class="text-primary text-xl mr-3">←</a>
        <h1 class="text-xl font-bold text-gray-900 flex-1 py-4">账户管理</h1>
        <span class="hidden sm:inline text-xs text-gray-400 mr-3">长按拖动排序</span>
        <button id="add-btn" class="text-primary font-medium">+ 新增</button>
      </header>
      <div id="content" class="p-4">
        <div class="text-center py-12 text-gray-400">加载中...</div>
      </div>
    </div>
    <div id="modal-container"></div>
  `;

  const content = root.querySelector<HTMLDivElement>('#content')!;
  const addBtn = root.querySelector<HTMLButtonElement>('#add-btn')!;
  const modalContainer = root.querySelector<HTMLDivElement>('#modal-container')!;

  async function load() {
    content.innerHTML = `<div class="text-center py-12 text-gray-400">加载中...</div>`;
    const res = await api.get<Account[]>('/accounts');
    if (!res.ok || !res.data) {
      content.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-lg">${escapeHtml(res.error?.message || '加载失败')}</div>`;
      return;
    }
    if (res.data.length === 0) {
      content.innerHTML = `
        <div class="bg-white rounded-xl p-8 text-center text-gray-400">
          <p class="text-4xl mb-3">💳</p>
          <p>暂无账户</p>
          <p class="text-xs mt-1">点击右上角"+ 新增"添加你的第一个账户</p>
        </div>
      `;
      return;
    }

    const totalBalance = res.data.reduce((sum, a) => sum + (a.balance ?? a.opening_balance), 0);

    content.innerHTML = `
      <!-- 总资产卡片 -->
      <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-5 mb-4 text-white shadow-sm">
        <div class="text-xs opacity-80">总资产</div>
        <div class="text-3xl font-bold mt-1">${formatMoney(totalBalance)}</div>
        <div class="text-xs opacity-80 mt-1">${res.data.length} 个账户</div>
      </div>
      <!-- 可拖拽列表 -->
      <div id="account-list">
        ${res.data
          .map(
            (a) => `
          <div class="account-item bg-white rounded-xl p-3 mb-3 flex items-center shadow-sm" data-id="${a.id}">
            <span class="drag-handle text-gray-300 mr-2 select-none" title="拖动排序">⋮⋮</span>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-gray-900">${escapeHtml(a.name)}</div>
              <div class="text-xs text-gray-500 mt-1">
                <span class="inline-block px-2 py-0.5 bg-gray-100 rounded">${accountLabel(a)}</span>
                <span class="ml-2">余额 <span class="text-gray-900 font-medium">${formatMoney(a.balance ?? a.opening_balance)}</span></span>
                ${a.balance !== undefined && a.balance !== a.opening_balance
                  ? `<span class="ml-1 text-gray-400">（期初 ${formatMoney(a.opening_balance)}）</span>`
                  : ''}
              </div>
            </div>
            <button class="edit-btn text-primary text-sm mr-3" data-id="${a.id}">编辑</button>
            <button class="delete-btn text-red-500 text-sm" data-id="${a.id}">删除</button>
          </div>
        `,
          )
          .join('')}
      </div>
    `;

    // 销毁旧的 Sortable 实例（避免重复绑定）
    sortableInstance?.destroy();

    // 初始化拖拽排序
    const listEl = content.querySelector<HTMLDivElement>('#account-list');
    if (listEl) {
      sortableInstance = Sortable.create(listEl, {
        animation: 150,
        handle: '.drag-handle', // 仅手柄可拖
        delay: 150,            // 移动端长按 150ms 触发，避免误触
        delayOnTouchOnly: true,
        onEnd: async () => {
          const ids = Array.from(listEl.children).map((el) => (el as HTMLElement).dataset.id!);
          const res = await api.put('/accounts/reorder', { ids });
          if (!res.ok) {
            alert('排序保存失败：' + (res.error?.message || '未知错误'));
            load(); // 回滚：重新拉取服务端顺序
          }
        },
      });
    }

    content.querySelectorAll<HTMLButtonElement>('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const account = res.data!.find((a) => a.id === id);
        if (account) showModal(account);
      });
    });
    content.querySelectorAll<HTMLButtonElement>('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        // mutateAndQueue 需要完整对象（用于写 IndexedDB）
        const target = res.data!.find((a) => a.id === id);
        if (!target) return;
        const ok = await confirmDialog(root, {
          title: '删除账户',
          message: `确定要删除账户"${target.name}"吗？\n该操作不可恢复。`,
          confirmText: '删除',
          cancelText: '取消',
          danger: true,
        });
        if (!ok) return;
        const del = await mutateAndQueue('accounts', 'delete', target as Account);
        if (del.ok || del.queued) {
          load();
        } else {
          alert(del.error?.message || '删除失败');
        }
      });
    });
  }

  function showModal(account?: Account) {
    const isEdit = !!account;
    const showPaymentToggle = !isEdit || account!.type === 'asset_holding';

    modalContainer.innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-50 z-30 flex items-end sm:items-center justify-center">
        <div class="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pt-6 px-6 pb-modal-safe">
          <h3 class="text-lg font-bold mb-4">${isEdit ? '编辑账户' : '新增账户'}</h3>
          <form id="account-form" class="space-y-3">
            <div>
              <label class="block text-sm text-gray-700 mb-1">名称</label>
              <input id="name" type="text" required maxlength="20"
                value="${account ? escapeHtml(account.name) : ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" />
            </div>
            <div>
              <label class="block text-sm text-gray-700 mb-1">类型</label>
              <select id="type" class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary">
                <option value="payment_channel" ${account?.type === 'payment_channel' ? 'selected' : ''}>💳 支付（现金/银行卡/支付宝）</option>
                <option value="asset_holding" ${account?.type === 'asset_holding' ? 'selected' : ''}>📊 理财（基金/股票/余额宝）</option>
              </select>
            </div>
            <div id="payment-toggle-wrap" class="${showPaymentToggle ? '' : 'hidden'}">
              <label class="flex items-center text-sm text-gray-700">
                <input id="is_payment_capable" type="checkbox"
                  ${account?.is_payment_capable ? 'checked' : ''}
                  class="mr-2 w-4 h-4 accent-primary" />
                <span>可支付（余额宝类：理财账户同时用于付款/收款）</span>
              </label>
            </div>
            <div>
              <label class="block text-sm text-gray-700 mb-1">期初余额</label>
              <input id="opening_balance" type="number" step="0.01"
                value="${account?.opening_balance ?? 0}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" />
            </div>
            <div class="flex gap-2 pt-2">
              <button type="button" id="cancel-btn" class="flex-1 py-2 border border-gray-300 rounded-lg">取消</button>
              <button type="submit" class="flex-1 py-2 bg-primary text-white rounded-lg">保存</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = modalContainer.querySelector<HTMLFormElement>('#account-form')!;
    const cancelBtn = modalContainer.querySelector<HTMLButtonElement>('#cancel-btn')!;
    const typeSelect = modalContainer.querySelector<HTMLSelectElement>('#type')!;
    const paymentWrap = modalContainer.querySelector<HTMLDivElement>('#payment-toggle-wrap')!;

    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'asset_holding') {
        paymentWrap.classList.remove('hidden');
      } else {
        paymentWrap.classList.add('hidden');
        (modalContainer.querySelector('#is_payment_capable') as HTMLInputElement).checked = false;
      }
    });

    cancelBtn.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = modalContainer.querySelector<HTMLInputElement>('#name')!;
      const balanceInput = modalContainer.querySelector<HTMLInputElement>('#opening_balance')!;
      const paymentCheckbox = modalContainer.querySelector<HTMLInputElement>('#is_payment_capable')!;

      const payload = {
        name: nameInput.value.trim(),
        type: typeSelect.value,
        is_payment_capable: typeSelect.value === 'asset_holding' ? (paymentCheckbox.checked ? 1 : 0) : 1,
        opening_balance: parseFloat(balanceInput.value || '0'),
      };

      const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      submitBtn.disabled = true;
      submitBtn.textContent = '保存中...';

      const now = new Date().toISOString();
      const row: Account = {
        id: account?.id || ulid(),
        name: payload.name,
        type: payload.type as Account['type'],
        is_payment_capable: payload.is_payment_capable,
        opening_balance: payload.opening_balance,
        sort_order: account?.sort_order ?? Date.now(),
        created_at: account?.created_at || now,
      } as Account;

      const res = await mutateAndQueue('accounts', isEdit ? 'update' : 'create', row);

      if (res.ok) {
        modalContainer.innerHTML = '';
        load();
      } else {
        alert(res.error?.message || '保存失败');
        submitBtn.disabled = false;
        submitBtn.textContent = '保存';
      }
    });
  }

  addBtn.addEventListener('click', () => showModal());

  await load();
}
