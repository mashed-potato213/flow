// 通用工具函数

/**
 * 格式化日期为 YYYY-MM-DD（本地时区）
 */
export function formatDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 格式化金额（人民币符号 + 千分位 + 两位小数）
 * 例：1234567.89 → "¥1,234,567.89"
 */
export function formatMoney(amount: number): string {
  const formatted = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `¥${formatted}`;
}

/**
 * 根据交易类型返回 Tailwind 文字颜色类
 */
export function signColor(type: string): string {
  if (type === 'income') return 'text-green-600';
  if (type === 'expense') return 'text-red-600';
  if (type === 'adjustment') return 'text-blue-600';
  return 'text-gray-600';
}

/**
 * 根据交易类型返回前缀符号
 */
export function signPrefix(type: string): string {
  if (type === 'income') return '+';
  if (type === 'expense') return '-';
  if (type === 'adjustment') return '~';
  return '';
}

/**
 * 防抖
 */
export function debounce<F extends (...args: any[]) => void>(fn: F, ms: number): F {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as F;
}