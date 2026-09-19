#!/bin/bash
echo "=== Flow 环境检查 ==="
echo "CWD: $(pwd)"

if [ ! -f "wrangler.toml" ]; then
  echo "❌ wrangler.toml 不在当前目录"
  echo "   请先 cd 到 Flow 项目根目录"
  exit 1
fi
if [ ! -f "worker/index.ts" ]; then
  echo "❌ worker/index.ts 不存在"
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "⚠️  node_modules 不存在，需要 npm install"
fi
echo "✅ 环境正常"
