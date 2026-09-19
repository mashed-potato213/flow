-- Flow 记账 - 第三轮迁移
-- 新增 is_payment_capable 字段：asset_holding 可选启用支付能力
-- 用于余额宝这类"既可支付又有收益"的混合账户

-- 1. 新增字段（默认 0：不可支付）
ALTER TABLE accounts ADD COLUMN is_payment_capable INTEGER NOT NULL DEFAULT 0;

-- 2. 历史数据迁移：所有 payment_channel 账户隐含可支付
UPDATE accounts SET is_payment_capable = 1 WHERE type = 'payment_channel';

-- 3. 更新 schema 版本
UPDATE meta SET value = '3' WHERE key = 'schema_version';
