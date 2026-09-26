// 分类管理视图（Day 3 完整实现）
import { api } from '../api';
import { confirmDialog } from './confirm';
import { mutateAndQueue } from '../offlineStore';
import { ulid } from 'ulid';
import type { Category } from '../api-types';

const SCOPE_LABELS: Record<string, { label: string; emoji: string }> = {
  expense: { label: '支出', emoji: '🛒' },
  income: { label: '收入', emoji: '💰' },
  finance: { label: '理财', emoji: '📊' },
};

/**
 * HTML 转义，防止 XSS
 */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] || c,
  );
}

export async function renderCategories(root: HTMLElement) {
  root.innerHTML = `
    <div class="min-h-screen bg-gray-50 pb-12">
      <header class="bg-white border-b border-gray-200 px-4 pt-safe sticky top-0 z-10 flex items-center">
        <a href="#/settings" class="text-primary text-xl mr-3">←</a>
        <h1 class="text-xl font-bold text-gray-900 flex-1 py-4">分类管理</h1>
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
    const res = await api.get<Category[]>('/categories');
    if (!res.ok || !res.data) {
      content.innerHTML = `<div class="bg-red-50 text-red-600 p-4 rounded-lg">${escapeHtml(res.error?.message || '加载失败')}</div>`;
      return;
    }

    // 按 scope 分组
    const groups: Record<string, Category[]> = { expense: [], income: [], finance: [] };
    res.data.forEach((c) => {
      const list = groups[c.scope];
      if (list) list.push(c);
    });

    content.innerHTML = Object.entries(SCOPE_LABELS)
      .map(([scope, { label, emoji }]) => {
        const list = groups[scope] ?? [];
        return `
      <div class="mb-6">
        <h2 class="text-sm font-bold text-gray-700 mb-2 flex items-center">
          <span class="mr-2">${emoji}</span>${label}
          <span class="ml-auto text-xs text-gray-400 font-normal">${list.length}</span>
        </h2>
        <div class="bg-white rounded-xl overflow-hidden">
          ${
            list.length === 0
              ? `<div class="p-4 text-center text-gray-400 text-sm">暂无</div>`
              : list
                  .map(
                    (c) => `
              <div class="flex items-center px-4 py-3 border-b border-gray-100 last:border-b-0">
                <span class="text-xl mr-3">${escapeHtml(c.icon || '•')}</span>
                <span class="flex-1 text-gray-900">${escapeHtml(c.name)}</span>
                ${c.is_preset ? '<span class="text-xs text-gray-400 mr-3">预置</span>' : ''}
                <button class="edit-btn text-primary text-sm mr-3" data-id="${c.id}">编辑</button>
                ${c.is_preset ? '' : `<button class="delete-btn text-red-500 text-sm" data-id="${c.id}">删除</button>`}
              </div>
            `,
                  )
                  .join('')
          }
        </div>
      </div>
    `;
      })
      .join('');

    content.querySelectorAll<HTMLButtonElement>('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const category = res.data!.find((c) => c.id === id);
        if (category) showModal(category);
      });
    });
    content.querySelectorAll<HTMLButtonElement>('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        const target = res.data!.find((c) => c.id === id);
        if (!target) return;
        const ok = await confirmDialog(root, {
          title: '删除分类',
          message: `确定要删除分类"${target.name}"吗？\n该操作不可恢复。`,
          confirmText: '删除',
          cancelText: '取消',
          danger: true,
        });
        if (!ok) return;
        const del = await mutateAndQueue('categories', 'delete', target);
        if (del.ok || del.queued) {
          load();
        } else {
          alert(del.error?.message || '删除失败');
        }
      });
    });
  }

  function showModal(category?: Category) {
    const isEdit = !!category;
    modalContainer.innerHTML = `
      <div class="fixed inset-0 bg-black bg-opacity-50 z-30 flex items-end sm:items-center justify-center">
        <div class="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pt-6 px-6 pb-modal-safe">
          <h3 class="text-lg font-bold mb-4">${isEdit ? '编辑分类' : '新增分类'}</h3>
          <form id="category-form" class="space-y-3">
            <div>
              <label class="block text-sm text-gray-700 mb-1">名称</label>
              <input id="name" type="text" required maxlength="10"
                value="${category ? escapeHtml(category.name) : ''}"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" />
            </div>
            <div>
              <label class="block text-sm text-gray-700 mb-1">图标（emoji 或字符，可选）</label>
              <input id="icon" type="text" maxlength="2"
                value="${category?.icon ? escapeHtml(category.icon) : ''}"
                placeholder="如 🍜"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" />
            </div>
            <div>
              <label class="block text-sm text-gray-700 mb-1">类型</label>
              <select id="scope" class="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary" ${isEdit ? 'disabled' : ''}>
                <option value="expense" ${category?.scope === 'expense' ? 'selected' : ''}>支出</option>
                <option value="income" ${category?.scope === 'income' ? 'selected' : ''}>收入</option>
                <option value="finance" ${category?.scope === 'finance' ? 'selected' : ''}>理财</option>
              </select>
            </div>
            <div class="flex gap-2 pt-2">
              <button type="button" id="cancel-btn" class="flex-1 py-2 border border-gray-300 rounded-lg">取消</button>
              <button type="submit" class="flex-1 py-2 bg-primary text-white rounded-lg">保存</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = modalContainer.querySelector<HTMLFormElement>('#category-form')!;
    const cancelBtn = modalContainer.querySelector<HTMLButtonElement>('#cancel-btn')!;

    cancelBtn.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = modalContainer.querySelector('#name') as unknown as HTMLInputElement;
      const iconInput = modalContainer.querySelector('#icon') as unknown as HTMLInputElement;
      const scopeSelect = modalContainer.querySelector('#scope') as unknown as HTMLSelectElement;

      const payload = {
        name: nameInput.value.trim(),
        icon: iconInput.value.trim() || null,
        scope: scopeSelect.value as Category['scope'],
      };

      const submitBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      submitBtn.disabled = true;
      submitBtn.textContent = '保存中...';

      const now = new Date().toISOString();
      const row: Category = isEdit
        ? { ...category!, ...payload, updated_at: now, last_modified: now }
        : {
            id: ulid(),
            name: payload.name,
            icon: payload.icon,
            scope: payload.scope,
            is_preset: 0,
            created_at: now,
            updated_at: now,
            last_modified: now,
            deleted: 0,
          };

      const res = await mutateAndQueue('categories', isEdit ? 'update' : 'create', row);

      if (res.ok || res.queued) {
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
