#!/bin/bash
# ============================================================
# install_memory_fix.sh
# 一键部署记忆系统完整修复
# 解决：MEMORY.md缺失 + 不主动检索 + 启动未注入 + 未自动更新
# ============================================================

set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AGENT_DIR="$HOME/.openclaw/agents/liuguanyi/agent"
OC_SCRIPTS="$HOME/.openclaw/scripts"

echo "╔══════════════════════════════════════╗"
echo "║   OpenClaw 记忆系统完整修复部署      ║"
echo "╚══════════════════════════════════════╝"

# ── Step 1: 确认目录结构 ─────────────────────────────────────
echo ""
echo ">>> [1/6] 确认目录结构..."
mkdir -p "$AGENT_DIR/memory"
mkdir -p "$OC_SCRIPTS"
mkdir -p "$HOME/.openclaw/logs"
echo "✅ 目录结构就绪"

# ── Step 2: 部署 MEMORY.md ────────────────────────────────────
echo ""
echo ">>> [2/6] 部署 MEMORY.md..."
if [ ! -f "$AGENT_DIR/MEMORY.md" ]; then
    cp "$SCRIPT_DIR/MEMORY.md" "$AGENT_DIR/MEMORY.md"
    echo "✅ MEMORY.md 已创建: $AGENT_DIR/MEMORY.md"
else
    echo "⚠️  MEMORY.md 已存在，跳过覆盖（如需重置请手动删除后重跑）"
fi

# ── Step 3: 部署 memory_consolidator.py ──────────────────────
echo ""
echo ">>> [3/6] 部署 memory_consolidator.py..."
cp "$SCRIPT_DIR/memory_consolidator.py" "$OC_SCRIPTS/"
chmod +x "$OC_SCRIPTS/memory_consolidator.py"

# 首次初始化（从历史记录反推）
python3 "$OC_SCRIPTS/memory_consolidator.py" --init
echo "✅ memory_consolidator.py 部署完成"

# ── Step 4: 部署 memory_interceptor.js ───────────────────────
echo ""
echo ">>> [4/6] 部署 memory_interceptor.js..."
cp "$SCRIPT_DIR/memory_interceptor.js" "$OC_SCRIPTS/"

# 注册到 OpenClaw（官方 CLI）
if command -v openclaw &> /dev/null; then
    openclaw config set memory.interceptor.enabled true 2>/dev/null || \
        echo "⚠️  openclaw config 命令失败，请手动开启记忆拦截器"
fi
echo "✅ memory_interceptor.js 部署完成"

# ── Step 5: 更新 AGENTS.md（注入强制记忆协议）────────────────
echo ""
echo ">>> [5/6] 更新 AGENTS.md，注入强制记忆协议..."

AGENTS_MD="$AGENT_DIR/AGENTS.md"
MEMORY_PROTOCOL='
## ⚡ 强制记忆前置协议（每次必须执行）

> 此协议由 memory_interceptor.js 注入，不可删除或跳过

**在回答任何问题或执行任何任务之前，必须完成以下检索：**

1. `tdai_memory_search(query=<关键词>)` — 搜索语义记忆
2. `memory_get("MEMORY.md")` — 读取长期记忆精华
3. `tdai_conversation_search(query=<关键词>)` — 搜索历史对话

**判断规则：**
- 记忆中有答案 → 直接引用，说"根据历史记录..."
- 记忆中有教训 → 先说"之前踩过这个坑..."
- 记忆中无信息 → 说"记忆中未找到相关信息，开始新的分析"

**禁止：** 未检索记忆就直接回答技术问题 / 重复踩已记录的坑
'

if [ -f "$AGENTS_MD" ]; then
    # 检查是否已注入
    if ! grep -q "强制记忆前置协议" "$AGENTS_MD"; then
        # 在文件开头注入（在第一个 ## 之前）
        TMP=$(mktemp)
        echo "$MEMORY_PROTOCOL" > "$TMP"
        echo "" >> "$TMP"
        cat "$AGENTS_MD" >> "$TMP"
        mv "$TMP" "$AGENTS_MD"
        echo "✅ AGENTS.md 已注入强制记忆协议"
    else
        echo "⚠️  AGENTS.md 已包含记忆协议，跳过"
    fi
else
    echo "$MEMORY_PROTOCOL" > "$AGENTS_MD"
    echo "✅ AGENTS.md 已创建（含记忆协议）"
fi

# ── Step 6: 设置定时任务 ──────────────────────────────────────
echo ""
echo ">>> [6/6] 设置定时任务..."

# 每天凌晨3点运行 consolidator
(crontab -l 2>/dev/null | grep -v "memory_consolidator"; \
 echo "0 3 * * * python3 $OC_SCRIPTS/memory_consolidator.py >> $HOME/.openclaw/logs/memory.log 2>&1") | crontab -

# 每天凌晨3:30 健康检查
(crontab -l 2>/dev/null | grep -v "memory_health"; \
 echo "30 3 * * * node $OC_SCRIPTS/memory_interceptor.js health >> $HOME/.openclaw/logs/memory.log 2>&1") | crontab -

echo "✅ 定时任务已设置"
echo "   03:00 每日 consolidator（提炼记忆 + 更新MEMORY.md）"
echo "   03:30 每日健康检查"

# ── 完成验证 ─────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo " 部署完成，运行验证..."
echo "═══════════════════════════════════════════"

python3 "$OC_SCRIPTS/memory_consolidator.py" --health
node "$OC_SCRIPTS/memory_interceptor.js" health

echo ""
echo "✅ 记忆系统修复完成！"
echo ""
echo "下一步验证："
echo "  1. 重启 OpenClaw Gateway"
echo "  2. 发送任意消息，检查分身是否先说'正在搜索记忆...'"
echo "  3. 检查 $AGENT_DIR/MEMORY.md 内容是否正确"
