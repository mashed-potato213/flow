// 自定义确认对话框（替代浏览器原生 confirm）
// 原生 confirm 在 PWA / 不同语言下按钮文案不可控（如"确定/禁止显示"），
// 且无法匹配应用风格。这里用统一的 Tailwind 卡片样式。
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/**
 * 在指定容器内弹出确认对话框，返回 Promise<boolean>
 * @param container 通常传入当前视图的 root 元素（mount 点）
 * @param opts 选项
 *
 * 交互：
 * - 点"确定/取消"按钮 → 关闭并 resolve
 * - 点遮罩 → 取消
 * - 按 ESC → 取消
 * - 取消按钮默认聚焦（防误操作确认）
 */
export function confirmDialog(container: HTMLElement, opts: ConfirmOptions): Promise<boolean> {
  const title = opts.title ?? '请确认';
  const confirmText = opts.confirmText ?? '确定';
  const cancelText = opts.cancelText ?? '取消';

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center px-4';
    overlay.innerHTML = `
      <div class="bg-white w-full sm:max-w-sm sm:rounded-2xl rounded-t-2xl pt-6 px-6 pb-modal-safe shadow-xl">
        <h3 class="text-lg font-bold text-gray-900 mb-2">${escapeHtml(title)}</h3>
        <p class="text-sm text-gray-600 mb-6 whitespace-pre-line">${escapeHtml(opts.message)}</p>
        <div class="flex gap-2">
          <button data-act="cancel" type="button"
            class="cancel-btn flex-1 py-2 border border-gray-300 rounded-lg active:opacity-60">${escapeHtml(cancelText)}</button>
          <button data-act="ok" type="button"
            class="flex-1 py-2 rounded-lg text-white active:opacity-60 ${
              opts.danger ? 'bg-red-500' : 'bg-primary'
            }">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };

    function close(result: boolean) {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    overlay.addEventListener('click', (e) => {
      // 点遮罩 = 取消
      if (e.target === overlay) {
        close(false);
        return;
      }
      const act = (e.target as HTMLElement).dataset?.act;
      if (act === 'ok') close(true);
      else if (act === 'cancel') close(false);
    });

    document.addEventListener('keydown', onKey);
    container.appendChild(overlay);

    // 取消按钮默认聚焦（防止误确认）
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('.cancel-btn');
    cancelBtn?.focus();
  });
}

/**
 * HTML 转义（避免 message 里特殊字符破坏 DOM）
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