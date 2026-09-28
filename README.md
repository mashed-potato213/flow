# Flow 记账

个人记账应用 MVP。基于 Cloudflare 全家桶（Pages + Workers + D1 + R2）。

## ✨ 功能

- ✅ 账户管理（现金/银行卡/支付宝/微信 + 基金/股票账户 + 花呗/信用卡等借贷账户，期初余额允许负数）
- ✅ 分类管理（消费 / 收入 / 理财三类，预置 17 个常用分类）
- ✅ 4 种记账类型：支出 / 收入 / 转账 / 理财市值调整
- ✅ 月度汇总（总收入 / 总支出 / 净结余 + 分类饼图）
- ✅ 理财账户当日盈亏自动计算
- ✅ 列表 + 多维筛选 + 模糊搜索
- ✅ PWA：可安装到主屏、离线记账、联网自动同步
- ✅ 离线优先架构：IndexedDB 镜像 + LWW 同步
- ✅ 数据保护：每日自动备份到 R2 + 手动导出 JSON
- ✅ 单密码 + httpOnly cookie 鉴权

## 🛠️ 技术栈

| 层       | 选型                                               |
| -------- | -------------------------------------------------- |
| 前端     | Vite + Vanilla TS + Tailwind CSS + vite-plugin-pwa |
| 图表     | Chart.js（饼图）                                   |
| 离线存储 | IndexedDB（Dexie.js）                              |
| 后端     | Cloudflare Workers（TypeScript）                   |
| 数据库   | Cloudflare D1（SQLite）                            |
| 备份     | Cloudflare R2                                      |
| 鉴权     | PBKDF2-SHA256 (100k) + httpOnly cookie + token     |

## 💻 本地开发

### 1. 安装依赖

```powershell
npm install
```

### 2. 本地数据库迁移

```powershell
# 初始化本地 D1（dev 环境）
npx wrangler d1 migrations apply flow-db-dev --local --env dev
```

### 3. 启动开发服务器

一条命令同时启动前端（Vite, 端口 5173）和后端模拟（Wrangler, 端口 8787）：

```powershell
npm run dev:all
```

底层用 `concurrently` 把 `vite` 与 `wrangler dev` 一起跑，输出分别用蓝色 / 绿色着色。

如需分开查看两端日志，可用两个终端：

```powershell
# 终端 A
npm run dev

# 终端 B
npm run dev:worker
```

访问 http://localhost:5173 即可。Vite 已配置代理，前端 `/api/*` 请求自动转发到 8787。

### 4. 首次使用

1. 打开 http://localhost:5173
2. 设置密码（至少 10 个字符，必须含字母和数字）
3. 系统自动 seed 17 个预置分类
4. 进入"设置 → 账户管理"，添加账户
5. 开始记账

## 🚀 部署到 Cloudflare

### 前置要求

- Cloudflare 账号（免费）
- GitHub 账号
- 已安装 Node.js 18+

### 步骤 1：登录 Cloudflare

```powershell
npx wrangler login
```

浏览器会打开 Cloudflare 登录页，授权即可。

### 步骤 2：创建 D1 数据库

```powershell
npx wrangler d1 create flow-db-dev --env dev
```

输出形如：

```
✅ Successfully created DB 'flow-db-dev'
database_id = "abcd1234-5678-90ab-cdef-1234567890ab"
```

**把 `database_id` 填到 `wrangler.toml` 的 `[env.dev]` 段下的 `[[env.dev.d1_databases]]` 项。**

生产库同理（顶层配置对应，无需 `--env`）：

```powershell
npx wrangler d1 create flow-db
```

### 步骤 3：创建 R2 Bucket

按目标环境二选一：

```powershell
# dev 环境
npx wrangler r2 bucket create flow-backups-dev --env dev

# production 环境（顶层配置对应，无需 --env）
npx wrangler r2 bucket create flow-backups
```

### 步骤 4：应用数据库迁移（远程）

按目标环境二选一：

```powershell
# 推送到 dev 环境（flow-db-dev）
npx wrangler d1 migrations apply flow-db-dev --remote --env dev

# 推送到 production 环境（flow-db，顶层配置对应，无需 --env）
npx wrangler d1 migrations apply flow-db --remote
```

### 步骤 5：推送到 GitHub

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/flow.git
git push -u origin main
```

### 步骤 6：配置 GitHub Secrets

到 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret：

- `CLOUDFLARE_API_TOKEN`：到 Cloudflare Dashboard → My Profile → API Tokens → Create Token → Edit Cloudflare Workers 模板 → 复制 token
- `CLOUDFLARE_ACCOUNT_ID`：到 Cloudflare Dashboard → Workers → 右侧栏获取 Account ID

### 步骤 7：触发部署

推送后 GitHub Actions 自动运行（`.github/workflows/deploy.yml`）。

也可以手动部署：

```powershell
npm run deploy          # 部署到生产（worker name=flow）
npm run deploy:dev      # 部署到 dev 环境（worker name=flow-dev）
```

部署成功后会得到 URL：`https://flow.<your-subdomain>.workers.dev`

### 步骤 8：配置 Cron Trigger

Cron Trigger 在生产环境才有意义（dev 环境不开）。到 Cloudflare Dashboard → Workers → flow → Triggers → Cron Triggers：

- Cron: `0 3 * * *`（UTC 3:00 = 北京时间 11:00）

或通过命令行（顶层 deploy 同步配置，无需 --env）：

```powershell
npx wrangler triggers deploy
```

## 🧪 验证清单

部署完成后，按以下顺序验证：

- [ ] 访问部署 URL，设置密码
- [ ] 系统自动 seed 17 个预置分类（设置 → 分类管理查看）
- [ ] 添加账户：现金（payment_channel）、基金账户（asset_holding）
- [ ] 记几笔账：餐饮（expense）、工资（income）、支付宝 → 基金账户（transfer）、基金今日市值 10080（adjustment）
- [ ] 查看列表：按时间倒序、按账户筛选、按分类筛选、搜索"餐饮"
- [ ] 查看汇总：本月收支、饼图、理财账户当日盈亏 = 80（10080 - 10000）
- [ ] PWA 安装：浏览器提示"添加到主屏" → 安装 → 主屏出现图标
- [ ] 离线测试：关闭网络 → 记账 → 打开网络 → 数据自动同步
- [ ] 设置 → 立即同步：确认无错误
- [ ] 设置 → 导出 JSON：下载备份文件
- [ ] 设置 → 导入 JSON：选择刚才的备份，确认导入成功
- [ ] Cron 备份：等待 24 小时后到 Cloudflare Dashboard → R2 → flow-backups 查看是否有新对象

## 📂 项目结构

```
flow/
├── wrangler.toml                 # Cloudflare 配置（顶层 + [env.dev / production]）
├── package.json
├── tsconfig.json
├── vite.config.ts                # Vite + PWA
├── tailwind.config.js
├── shared/
│   └── schemas.ts                # 前后端共享 Zod schema
├── migrations/
│   ├── 0001_initial.sql          # 5 张表
│   ├── 0002_preset_categories.sql # 17 个预置分类
│   ├── 0003_account_payment_capable.sql # 账户可支付标志
│   ├── 0004_account_sort_order.sql     # 账户排序
│   └── 0005_indexes_and_meta.sql       # 索引 + 元数据
├── worker/                        # Cloudflare Worker
│   ├── index.ts                  # 入口 + 路由分发
│   ├── auth.ts                   # PBKDF2 + token 中间件
│   ├── lib/                      # 公共工具
│   │   ├── ids.ts                # ULID / ISO 时间
│   │   ├── response.ts           # 统一响应包装
│   │   ├── types.ts              # 实体类型
│   │   ├── validate.ts           # Zod 校验
│   │   └── rateLimit.ts          # 限流
│   └── routes/
│       ├── auth.ts               # /api/auth/*
│       ├── accounts.ts
│       ├── categories.ts
│       ├── transactions.ts
│       ├── summary.ts
│       ├── sync.ts               # LWW 同步
│       ├── backup.ts             # D1 → R2 (cron)
│       └── export.ts             # JSON 导入/导出
└── src/                           # 前端
    ├── index.html
    ├── main.ts                   # 入口
    ├── router.ts                 # hash 路由
    ├── api.ts                    # API 客户端
    ├── api-types.ts              # 共享类型
    ├── db.ts                     # Dexie IndexedDB
    ├── sync.ts                   # 双向同步
    ├── offlineStore.ts           # 离线写入 + 待同步队列
    ├── utils.ts                  # 工具函数
    └── views/
        ├── login.ts
        ├── home.ts               # 快速记账
        ├── list.ts               # 列表 + 搜索
        ├── summary.ts            # 汇总 + 饼图
        ├── accounts.ts
        ├── categories.ts
        ├── settings.ts           # 同步 / 导出 / 导入
        ├── confirm.ts            # 确认弹窗
        └── tabbar.ts             # 底部 Tab 导航
```

## 🔧 配置项

`wrangler.toml` 关键配置（顶层 = 生产配置，D1 / R2 / cron 直接放顶层；env 段只放其他环境）：

```toml
name = "flow"
main = "worker/index.ts"
compatibility_date = "2026-09-01"

[build]
command = "npm run build"

[assets]
directory = "./dist"
binding = "ASSETS"

# 顶层 = 生产（worker name = "flow"，不带 -production 后缀）
[[d1_databases]]
binding = "DB"
database_name = "flow-db"
database_id = "<从 wrangler d1 create 获取>"

[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "flow-backups"

[triggers]
crons = ["0 3 * * *"]

# 开发环境（worker name = "flow-dev"）
[env.dev]
[[env.dev.d1_databases]]
binding = "DB"
database_name = "flow-db-dev"
database_id = "<从 wrangler d1 create --env dev 获取>"

[[env.dev.r2_buckets]]
binding = "BACKUPS"
bucket_name = "flow-backups-dev"

[env.dev.triggers]
crons = []
```

部署命令：

```powershell
npm run deploy          # 部署到生产（顶层配置，name=flow）
npm run deploy:dev      # 部署到 dev（name=flow-dev）
```

## 🐛 已知限制

- **单用户系统**：只支持一个密码，没有账号系统
- **忘记密码 = 数据丢失**（但 R2 自动备份保留近 30 天，可联系 Cloudflare 恢复）
- **D1 免费额度**：每天 10 万次读写，10GB 存储，个人记账绰绰有余
- **首次加载需联网**：Service Worker 不缓存 HTML，必须联网完成首次登录
- **离线同步冲突**：采用 LWW（最后写入获胜），冲突极少，但极端情况下会丢一个字段的修改

## 📈 后续改进（不在 MVP 范围）

- 预算管理
- 定期账（订阅）
- 多账本切换
- 暗色模式
- 数据导入兼容 CSV/Excel
- 助记词密码恢复

## 📄 许可证

MIT
