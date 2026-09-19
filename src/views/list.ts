// 账目列表视图（Day 4 完整实现）
// 搜索 + 多维度筛选 + 分页 + 行内删除
import { api } from '../api';
import { renderTabBar, bindTabBar } from './tabbar';
import { confirmDialog } from './confirm';
import { formatMoney, signColor, signPrefix, debounce } from '../utils';
import type { Transaction, Account, Category } from '../api-types';

interface Filters {
  account: string;
  category: string;
  type: string;
  start: string;
  end: string;
  q: string;
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

export async function renderList(root: HTMLElement) {
  const filters: Filters = {
    account: '',
    category: '',
    type: '',
    start: '',
    end: '',
    q: '',
  };

  let accounts: Account[] = [];
  let categories: Category[] = [];
  let transactions: Transaction[] = [];

  /**
   * 同步 date input 内部提示文字的可见性
   * iOS Safari 不渲染 <input type="date"> 的 placeholder，
   * 这里用 sibling span 模拟，value 非空时通过 opacity 隐藏。
   */
  function setupDateHint(inputId: string) {
    const input = root.querySelector<HTMLInputElement>(`#${inputId}`);
    const hint = root.querySelector<HTMLElement>(`[data-hint-for="${inputId}"]`);
    if (!input || !hint) return;
    const update = () => {
      hint.style.opacity = input.value ? '0' : '1';
    };
    input.addEventListener('input', update);
    input.addEventListener('change', update);
    update();
  }

  async function loadData() {
    try {
      const [accRes, catRes] = await Promise.all([
        api.get<Account[]>('/accounts'),
        api.get<Category[]>('/categories'),
      ]);
      if (accRes.ok && accRes.data) accounts = accRes.data;
      if (catRes.ok && catRes.data) categories = catRes.data;
      const errs = [accRes, catRes].filter((r) => !r.ok).map((r) => r.error?.message || '加载失败');
      if (errs.length) console.warn('部分列表加载失败:', errs);
      await loadTransactions();
    } catch (e) {
      console.error('loadData failed:', e);
      const content = root.querySelector<HTMLDivElement>('#tx-list');
      if (content) {
        content.innerHTML = `<div class="bg-white rounded-xl p-4 text-red-500 text-sm">${
          escapeHtml(e instanceof Error ? e.message : '加载异常')
        }</div>`;
      }
    }
  }

  async function loadTransactions() {
    const params = new URLSearchParams();
    if (filters.account) params.set('account', filters.account);
    if (filters.category) params.set('category', filters.category);
    if (filters.type) params.set('type', filters.type);
    if (filters.start) params.set('start', filters.start);
    if (filters.end) params.set('end', filters.end);
    if (filters.q) params.set('q', filters.q);
    params.set('limit', '200');

    const res = await api.get<Transaction[]>(`/transactions?${params.toString()}`);
    const content = root.querySelector<HTMLDivElement>('#tx-list');
    if (!content) return;
    if (!res.ok || !res.data) {
      content.innerHTML = `<div class="text-center text-red-500 py-8">${
        escapeHtml(res.error?.message || '加载失败')
      }</div>`;
      return;
    }
    transactions = res.data;
    renderList_();
  }

  function renderShell() {
    root.innerHTML = `
      <div class="min-h-screen bg-gray-50 pb-tabbar">
        <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10">
          <h1 class="text-xl font-bold text-gray-900 py-4">账目列表</h1>
        </header>
        <div class="p-4 space-y-3">
          <!-- 搜索框 -->
          <input id="search" type="text" placeholder="🔍 搜索备注..."
            value="${escapeHtml(filters.q)}"
            class="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />

          <!-- 筛选条 -->
          <div class="bg-white rounded-xl p-3 space-y-2">
            <div class="grid grid-cols-3 gap-2">
              <select id="filter-type" class="text-sm px-2 py-1.5 border border-gray-200 rounded outline-none">
                <option value="">全部类型</option>
                <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>支出</option>
                <option value="income" ${filters.type === 'income' ? 'selected' : ''}>收入</option>
                <option value="transfer" ${filters.type === 'transfer' ? 'selected' : ''}>转账</option>
                <option value="adjustment" ${filters.type === 'adjustment' ? 'selected' : ''}>市值</option>
              </select>
              <select id="filter-account" class="text-sm px-2 py-1.5 border border-gray-200 rounded outline-none">
                <option value="">全部账户</option>
                ${accounts
                  .map(
                    (a) =>
                      `<option value="${a.id}" ${filters.account === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`,
                  )
                  .join('')}
              </select>
              <select id="filter-category" class="text-sm px-2 py-1.5 border border-gray-200 rounded outline-none">
                <option value="">全部分类</option>
                ${categories
                  .map(
                    (c) =>
                      `<option value="${c.id}" ${filters.category === c.id ? 'selected' : ''}>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <input id="filter-start" type="date" value="${escapeHtml(filters.start)}"
                  class="w-full h-8 text-sm pl-[3.5rem] pr-2 border border-gray-200 rounded outline-none" />
                <span data-hint-for="filter-start"
                  class="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-black pointer-events-none transition-opacity">开始时间</span>
              </div>
              <div class="relative flex-1">
                <input id="filter-end" type="date" value="${escapeHtml(filters.end)}"
                  class="w-full h-8 text-sm pl-[3.5rem] pr-2 border border-gray-200 rounded outline-none" />
                <span data-hint-for="filter-end"
                  class="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-black pointer-events-none transition-opacity">结束时间</span>
              </div>
            </div>
            <button id="reset-btn" class="text-xs text-primary">清除筛选</button>
          </div>

          <!-- 列表 -->
          <div id="tx-list" class="text-center py-12 text-gray-400">加载中...</div>
        </div>
        ${renderTabBar()}
      </div>
    `;

    // 绑定筛选事件
    (root.querySelector('#search') as HTMLInputElement).addEventListener(
      'input',
      debounce(() => {
        filters.q = (root.querySelector('#search') as HTMLInputElement).value.trim();
        loadTransactions();
      }, 300),
    );

    (root.querySelector('#filter-type') as unknown as HTMLSelectElement).addEventListener('change', (e) => {
      filters.type = (e.target as HTMLSelectElement).value;
      loadTransactions();
    });
    (root.querySelector('#filter-account') as unknown as HTMLSelectElement).addEventListener('change', (e) => {
      filters.account = (e.target as HTMLSelectElement).value;
      loadTransactions();
    });
    (root.querySelector('#filter-category') as unknown as HTMLSelectElement).addEventListener(
      'change',
      (e) => {
        filters.category = (e.target as HTMLSelectElement).value;
        loadTransactions();
      },
    );
    (root.querySelector('#filter-start') as HTMLInputElement).addEventListener('change', (e) => {
      filters.start = (e.target as HTMLInputElement).value;
      loadTransactions();
    });
    (root.querySelector('#filter-end') as HTMLInputElement).addEventListener('change', (e) => {
      filters.end = (e.target as HTMLInputElement).value;
      loadTransactions();
    });

    // iOS 上 date input 的 placeholder 不可见，
    // 用 sibling span + JS 同步 value 状态手动控制可见性
    setupDateHint('filter-start');
    setupDateHint('filter-end');
    (root.querySelector('#reset-btn') as HTMLButtonElement).addEventListener('click', () => {
      filters.account = '';
      filters.category = '';
      filters.type = '';
      filters.start = '';
      filters.end = '';
      filters.q = '';
      renderShell();
      loadTransactions();
    });

    bindTabBar(root);
  }

  function renderList_() {
    const content = root.querySelector<HTMLDivElement>('#tx-list');
    if (!content) return;
    if (transactions.length === 0) {
      content.innerHTML = `<div class="bg-white rounded-xl py-12 text-gray-400">暂无记录</div>`;
      return;
    }
    const accountName = (id: string) =>
      accounts.find((a) => a.id === id)?.name || '?';
    const categoryName = (id: string | null) =>
      id ? categories.find((c) => c.id === id)?.name || '?' : '';

    // 计算每条市值调整的"上一笔市值"，进而得出本次盈亏
    // 算法：按 account_id 分组所有 adjustment 交易，按时间正序排序（早的在前）。
    //       组内首条 adjustment 之前的市值 = 该账户的 opening_balance。
    //       之后每条的"上一笔市值" = 前一条的 amount。
    // 注意：仅基于当前已加载的交易计算（limit=200）。若账户最早的 adjustment
    //       不在加载窗口内，会回退到 opening_balance —— MVP 范围内可接受。
    const prevAmount = new Map<string, number>();
    {
      const grouped = new Map<string, Transaction[]>();
      for (const t of transactions) {
        if (t.type === 'adjustment') {
          const arr = grouped.get(t.account_id) ?? [];
          arr.push(t);
          grouped.set(t.account_id, arr);
        }
      }
      for (const [accId, txs] of grouped) {
        txs.sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return a.last_modified < b.last_modified ? -1 : 1;
        });
        const acc = accounts.find((a) => a.id === accId);
        const opening = acc?.opening_balance ?? 0;
        let prev = opening;
        for (const t of txs) {
          prevAmount.set(t.id, prev);
          prev = t.amount;
        }
      }
    }

    // 单条 adjustment 行的金额列渲染：主数字 = 本次盈亏，下方小字保留市值供查看
    function renderAmount(t: Transaction): string {
      if (t.type === 'adjustment' && prevAmount.has(t.id)) {
        const pnl = t.amount - prevAmount.get(t.id)!;
        const color = pnl >= 0 ? 'text-green-600' : 'text-red-600';
        const prefix = pnl >= 0 ? '+' : '';
        return `
          <div class="${color} font-medium">${prefix}${formatMoney(pnl)}</div>
          <div class="text-xs text-gray-400 mt-0.5">市值 ${formatMoney(t.amount)}</div>
        `;
      }
      return `<div class="${signColor(t.type)} font-medium">${signPrefix(t.type)}${formatMoney(t.amount)}</div>`;
    }

    content.innerHTML = transactions
      .map(
        (t) => `
      <div class="bg-white rounded-xl p-3 mb-2 flex items-start" data-id="${t.id}">
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline text-sm">
            <span class="font-medium text-gray-900">${
              categoryName(t.category_id) ||
              (t.type === 'transfer'
                ? '转账'
                : t.type === 'adjustment'
                  ? '市值'
                  : '')
            }</span>
            <span class="ml-2 text-xs text-gray-400">${escapeHtml(t.date)}</span>
          </div>
          <div class="text-xs text-gray-500 mt-1 truncate text-left">
            ${escapeHtml(accountName(t.account_id))}${
              t.target_account_id
                ? ' → ' + escapeHtml(accountName(t.target_account_id))
                : ''
            }
            ${t.note ? ' · ' + escapeHtml(t.note) : ''}
          </div>
        </div>
        <div class="text-right ml-2 flex-shrink-0">
          ${renderAmount(t)}
          <button class="delete-tx text-xs text-red-400 mt-1" data-id="${t.id}">删除</button>
        </div>
      </div>
    `,
      )
      .join('');

    content.querySelectorAll<HTMLButtonElement>('.delete-tx').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id!;
        const tx = transactions.find((t) => t.id === id);
        if (!tx) return;
        const ok = await confirmDialog(root, {
          title: '删除记录',
          message: `确定要删除这条交易吗？\n¥${tx.amount.toFixed(2)} · ${tx.date}${tx.note ? '\n备注：' + tx.note : ''}`,
          confirmText: '删除',
          cancelText: '取消',
          danger: true,
        });
        if (!ok) return;
        const res = await api.del(`/transactions/${id}`);
        if (res.ok) loadTransactions();
        else alert(res.error?.message || '删除失败');
      });
    });
  }

  renderShell();
  await loadData();
}