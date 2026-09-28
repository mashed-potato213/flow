// 前后端共享的 Zod schemas + TypeScript 类型推导
// 任何修改都会同时影响前端 (src/) 和后端 (worker/)，
// 避免手写同步类型导致漂移。

import { z } from 'zod';

// ============================================================
// 枚举
// ============================================================

export const AccountTypeSchema = z.enum(['payment_channel', 'asset_holding']);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const CategoryScopeSchema = z.enum(['expense', 'income', 'finance']);
export type CategoryScope = z.infer<typeof CategoryScopeSchema>;

export const TransactionTypeSchema = z.enum(['income', 'expense', 'transfer', 'adjustment']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

// ============================================================
// 实体 schema
// ============================================================

export const AccountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  type: AccountTypeSchema,
  is_payment_capable: z.union([z.literal(0), z.literal(1)]),
  opening_balance: z.number().finite(), // 允许负数：支持花呗/信用卡等借贷账户
  sort_order: z.number().nonnegative().finite(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  last_modified: z.string().min(1),
  deleted: z.union([z.literal(0), z.literal(1)]),
});
export type Account = z.infer<typeof AccountSchema>;

export const CategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  icon: z.string().nullable(),
  scope: CategoryScopeSchema,
  is_preset: z.union([z.literal(0), z.literal(1)]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  last_modified: z.string().min(1),
  deleted: z.union([z.literal(0), z.literal(1)]),
});
export type Category = z.infer<typeof CategorySchema>;

export const TransactionSchema = z
  .object({
    id: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    amount: z.number().positive().max(1e12),
    type: TransactionTypeSchema,
    account_id: z.string().min(1),
    target_account_id: z.string().nullable(),
    category_id: z.string().nullable(),
    note: z.string().max(500).nullable(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    last_modified: z.string().min(1),
    deleted: z.union([z.literal(0), z.literal(1)]),
  })
  // 业务规则：transfer 必须有 target_account_id 且不能相同
  .refine(
    (tx) =>
      tx.type !== 'transfer' ||
      (tx.target_account_id !== null && tx.target_account_id !== tx.account_id),
    {
      message: 'transfer requires target_account_id different from account_id',
      path: ['target_account_id'],
    },
  );
export type Transaction = z.infer<typeof TransactionSchema>;

// ============================================================
// 创建/更新的输入 schema（不要求所有字段，ID/时间戳由服务端填充）
// ============================================================

// 基础对象 schema（不含 refine），供 .partial() 使用
export const NewTransactionBaseSchema = z.object({
  id: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(1e12),
  type: TransactionTypeSchema,
  account_id: z.string().min(1),
  target_account_id: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

// 完整 schema：用于创建（POST），含 transfer 业务规则校验
export const NewTransactionSchema = NewTransactionBaseSchema.refine(
  (tx) => tx.type !== 'transfer' || tx.target_account_id != null,
  {
    message: 'transfer requires target_account_id',
    path: ['target_account_id'],
  },
).refine((tx) => tx.type !== 'transfer' || tx.target_account_id !== tx.account_id, {
  message: 'source and target accounts cannot be same',
  path: ['target_account_id'],
});
export type NewTransaction = z.infer<typeof NewTransactionBaseSchema>;

export const NewAccountSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(50),
  type: AccountTypeSchema,
  is_payment_capable: z.union([z.literal(0), z.literal(1)]).optional(),
  opening_balance: z.number().finite().optional(), // 允许负数：支持花呗/信用卡等借贷账户
});
export type NewAccount = z.infer<typeof NewAccountSchema>;

export const NewCategorySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(50),
  icon: z.string().max(8).nullable().optional(),
  scope: CategoryScopeSchema,
});
export type NewCategory = z.infer<typeof NewCategorySchema>;

// ============================================================
// 同步请求 schema（数组形式，包含未 sanitize 的原始数据）
// ============================================================

export const SyncRequestSchema = z.object({
  accounts: z.array(z.unknown()).optional(),
  categories: z.array(z.unknown()).optional(),
  transactions: z.array(z.unknown()).optional(),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

// ============================================================
// 数据库列白名单（前后端共用，前端用于 sort/filter 校验）
// ============================================================

export const ACCOUNT_COLUMNS = [
  'id',
  'name',
  'type',
  'is_payment_capable',
  'opening_balance',
  'sort_order',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

export const CATEGORY_COLUMNS = [
  'id',
  'name',
  'icon',
  'scope',
  'is_preset',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

export const TRANSACTION_COLUMNS = [
  'id',
  'date',
  'amount',
  'type',
  'account_id',
  'target_account_id',
  'category_id',
  'note',
  'created_at',
  'updated_at',
  'last_modified',
  'deleted',
] as const;

// ============================================================
// 密码规则
// ============================================================

export const PasswordSchema = z
  .string()
  .min(10, '密码至少 10 个字符')
  .max(128, '密码不超过 128 个字符')
  .refine((p) => /[A-Za-z]/.test(p), '密码必须包含字母')
  .refine((p) => /\d/.test(p), '密码必须包含数字');
export type Password = z.infer<typeof PasswordSchema>;

// ============================================================
// 工具：safeParse 包装（统一错误格式）
// ============================================================

export interface SanitizeOk<T> {
  ok: true;
  data: T;
}
export interface SanitizeErr {
  ok: false;
  error: string;
}
export type SanitizeResult<T> = SanitizeOk<T> | SanitizeErr;

export function safeParse<T>(schema: z.ZodType<T>, input: unknown): SanitizeResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  return {
    ok: false,
    error: first ? `${first.path.join('.')}: ${first.message}` : 'invalid input',
  };
}

export function safeParseAccount(input: unknown): SanitizeResult<Account> {
  return safeParse(AccountSchema, input);
}
export function safeParseCategory(input: unknown): SanitizeResult<Category> {
  return safeParse(CategorySchema, input);
}
export function safeParseTransaction(input: unknown): SanitizeResult<Transaction> {
  return safeParse(TransactionSchema, input);
}
