-- 索引优化
-- accounts 按 sort_order 排序的列表查询
CREATE INDEX IF NOT EXISTS idx_accounts_sort_order
  ON accounts(sort_order)
  WHERE deleted = 0;

-- transactions 按日期范围的列表查询（汇总、列表页）
CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON transactions(date DESC, last_modified DESC)
  WHERE deleted = 0;

-- transactions 按账户查询（账户详情）
CREATE INDEX IF NOT EXISTS idx_transactions_account
  ON transactions(account_id, date DESC)
  WHERE deleted = 0;

-- transactions 按类型 + 日期（理财账户 adjustment 查询）
CREATE INDEX IF NOT EXISTS idx_transactions_type_date
  ON transactions(account_id, date DESC, last_modified DESC)
  WHERE deleted = 0 AND type = 'adjustment';

-- transactions 按 last_modified 增量同步
CREATE INDEX IF NOT EXISTS idx_transactions_last_modified
  ON transactions(last_modified ASC)
  WHERE deleted = 0;

-- accounts/categories 增量同步
CREATE INDEX IF NOT EXISTS idx_accounts_last_modified
  ON accounts(last_modified ASC)
  WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_categories_last_modified
  ON categories(last_modified ASC)
  WHERE deleted = 0;
