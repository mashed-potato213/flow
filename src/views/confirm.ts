// 自定义确认对话框（替代浏览器原生 confirm）
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface PendingDialog {
  overlay: HTMLElement;
  resolve: (value: boolean) => void;
  onKey: (e: KeyboardEvent) => void;
}

/**
 * 当前所有未决对话框的注册表
 * 当视图被销毁时调用 dismissAllDialogs() 清理所有未决 Promise
 */
const pendingDialogs = new Set<PendingDialog>();

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
      // 从注册表移除（避免重复清理）
      pendingDialogs.delete(entry);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    const entry: PendingDialog = { overlay, resolve, onKey };
    pendingDialogs.add(entry);

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
 * 强制关闭所有未决对话框并以 false resolve
 * 在视图销毁时（如路由切换）调用，防止 Promise 永远卡住
 */
export function dismissAllDialogs(): void {
  for (const dialog of Array.from(pendingDialogs)) {
    pendingDialogs.delete(dialog);
    dialog.overlay.remove();
    document.removeEventListener('keydown', dialog.onKey);
    dialog.resolve(false);
  }
}

/**
 * HTML 转义（避免 message 里特殊字符破坏 DOM）
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
