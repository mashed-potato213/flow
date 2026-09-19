# Flow 记账

个人记账应用 MVP。基于 Cloudflare 全家桶（Pages + Workers + D1 + R2）。

## ✨ 功能

- ✅ 账户管理（现金/银行卡/支付宝/微信 + 基金/股票账户）
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

| 层 | 选型 |
|---|---|
| 前端 | Vite + Vanilla TS + Tailwind CSS + vite-plugin-pwa |
| 图表 | Chart.js（饼图） |
| 离线存储 | IndexedDB（Dexie.js） |
| 后端 | Cloudflare Workers（TypeScript） |
| 数据库 | Cloudflare D1（SQLite） |
| 备份 | Cloudflare R2 |
| 鉴权 | PBKDF2-SHA256 (100k) + httpOnly cookie + token |

## 💻 本地开发

### 1. 安装依赖
```powershell
npm install
```

### 2. 本地数据库迁移
```powershell
# 初始化本地 D1
npx wrangler d1 migrations apply flow-db --local
```

### 3. 启动开发服务器

需要两个终端：

终端 A（Vite 前端开发，端口 5173）：
```powershell
npm run dev
```

终端 B（Wrangler 后端模拟，端口 8787）：
```powershell
npx wrangler dev
```

访问 http://localhost:5173 即可。Vite 已配置代理，前端 `/api/*` 请求自动转发到 8787。

### 4. 首次使用

1. 打开 http://localhost:5173
2. 设置密码（至少 6 个字符）
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
npx wrangler d1 create flow-db
```
输出形如：
```
✅ Successfully created DB 'flow-db'
database_id = "abcd1234-5678-90ab-cdef-1234567890ab"
```
**把 `database_id` 填到 `wrangler.toml` 的 `[[d1_databases]]` 段。**

### 步骤 3：创建 R2 Bucket
```powershell
npx wrangler r2 bucket create flow-backups
```

### 步骤 4：应用数据库迁移（远程）
```powershell
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
npm run deploy
```

部署成功后会得到 URL：`https://flow.<your-subdomain>.workers.dev`

### 步骤 8：配置 Cron Trigger

到 Cloudflare Dashboard → Workers → flow → Triggers → Cron Triggers：
- Cron: `0 3 * * *`（UTC 3:00 = 北京时间 11:00）

或通过命令行：
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
├── wrangler.toml                 # Cloudflare 配置
├── package.json
├── tsconfig.json
├── vite.config.ts                # Vite + PWA
├── tailwind.config.js
├── migrations/
│   ├── 0001_initial.sql          # 5 张表
│   └── 0002_preset_categories.sql # 17 个预置分类
├── worker/                        # Cloudflare Worker
│   ├── index.ts                  # 入口 + 路由分发
│   ├── auth.ts                   # PBKDF2 + token 中间件
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
    ├── utils.ts                  # 工具函数
    └── views/
        ├── login.ts
        ├── home.ts               # 快速记账
        ├── list.ts               # 列表 + 搜索
        ├── summary.ts            # 汇总 + 饼图
        ├── accounts.ts
        ├── categories.ts
        ├── settings.ts           # 同步 / 导出 / 导入
        └── tabbar.ts             # 底部 Tab 导航
```

## 🔧 配置项

`wrangler.toml` 关键配置：

```toml
name = "flow"
main = "worker/index.ts"
compatibility_date = "2026-09-01"

[build]
command = "npm run build"

[assets]
directory = "./dist"
binding = "ASSETS"

[[d1_databases]]
binding = "DB"
database_name = "flow-db"
database_id = "<从 wrangler d1 create 获取>"

[[r2_buckets]]
binding = "BACKUPS"
bucket_name = "flow-backups"

[triggers]
crons = ["0 3 * * *"]
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