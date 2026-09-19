// 前端类型定义（与 worker/lib/types.ts 镜像）
// 用于前端组件、IndexedDB schema 等

export type AccountType = 'payment_channel' | 'asset_holding';
export type CategoryScope = 'expense' | 'income' | 'finance';
export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  is_payment_capable: number; // 0/1：是否可作为支付渠道
  opening_balance: number;
  sort_order: number;
  balance?: number; // 当前余额（仅 listAccounts 返回时存在）
  created_at: string;
  updated_at: string;
  last_modified: string;
  deleted: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  scope: CategoryScope;
  is_preset: number;
  created_at: string;
  updated_at: string;
  last_modified: string;
  deleted: number;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  type: TransactionType;
  account_id: string;
  target_account_id: string | null;
  category_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  last_modified: string;
  deleted: number;
}