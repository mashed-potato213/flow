-- Flow 记账 - 第四轮迁移
-- 新增 sort_order 字段，支持账户拖拽排序
-- 历史数据：按 created_at 升序，用秒数作为初始顺序

ALTER TABLE accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 历史数据：sort_order = created_at 转秒数（天然有序）
UPDATE accounts SET sort_order = CAST(strftime('%s', created_at) AS INTEGER) * 1000
WHERE deleted = 0;

UPDATE meta SET value = '4' WHERE key = 'schema_version';
