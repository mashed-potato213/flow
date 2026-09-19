-- Flow 记账 - 初始迁移
-- 单用户离线优先架构，基于 grill-me 第 14 轮达成的共识

-- 元数据表（存密码哈希等）
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 账户表
-- type: payment_channel（支付渠道：现金/银行卡/支付宝/微信）
--       asset_holding（资金位置：基金/股票账户）
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('payment_channel', 'asset_holding')),
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_modified   TEXT NOT NULL,            -- 用于 LWW 同步（毫秒精度 ISO 字符串）
  deleted         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_accounts_last_modified ON accounts(last_modified);
CREATE INDEX idx_accounts_type ON accounts(type);

-- 分类表
-- scope: expense（消费）/ income（收入）/ finance（理财）
CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  icon          TEXT,
  scope         TEXT NOT NULL CHECK(scope IN ('expense', 'income', 'finance')),
  is_preset     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_modified TEXT NOT NULL,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_scope ON categories(scope);
CREATE INDEX idx_categories_last_modified ON categories(last_modified);

-- 交易表
-- type: income / expense / transfer（账户间转账） / adjustment（理财账户市值调整）
-- amount 始终为正数；方向由 type 决定
-- target_account_id 仅 transfer 类型使用
-- category_id transfer 类型允许为空
CREATE TABLE transactions (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,          -- YYYY-MM-DD 本地日期
  amount            REAL NOT NULL,
  type              TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer', 'adjustment')),
  account_id        TEXT NOT NULL,
  target_account_id TEXT,
  category_id       TEXT,
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_modified     TEXT NOT NULL,
  deleted           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_transactions_date          ON transactions(date DESC);
CREATE INDEX idx_transactions_account       ON transactions(account_id);
CREATE INDEX idx_transactions_target_account ON transactions(target_account_id);
CREATE INDEX idx_transactions_category      ON transactions(category_id);
CREATE INDEX idx_transactions_type          ON transactions(type);
CREATE INDEX idx_transactions_last_modified ON transactions(last_modified);

-- 会话表（httpOnly cookie 鉴权的 token 存储）
CREATE TABLE sessions (
  token         TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_used_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 初始化元数据
INSERT INTO meta (key, value) VALUES ('schema_version', '1');
INSERT INTO meta (key, value) VALUES ('created_at', datetime('now'));
