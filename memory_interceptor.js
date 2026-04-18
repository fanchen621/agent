// memory_interceptor.js
// ============================================================
// 核心修复：在 OpenClaw Gateway 的每个请求前强制执行记忆搜索
// 这是解决"不主动检索"根因的关键中间件
// 部署路径: ~/.openclaw/scripts/memory_interceptor.js
// ============================================================

const fs   = require('fs');
const path = require('path');

const MEMORY_DIR    = path.join(process.env.HOME, '.openclaw/agents/liuguanyi/agent/memory');
const MEMORY_MD     = path.join(process.env.HOME, '.openclaw/agents/liuguanyi/agent/MEMORY.md');
const TDAI_URL      = 'http://localhost:8088';   // tdai memory server
const MESH_URL      = 'http://localhost:9527';   // Neural Mesh

// ── 1. 强制记忆前置拦截器 ─────────────────────────────────────
// 在 AGENTS.md 的系统提示词中注入此拦截协议
// 确保每次对话前都执行记忆搜索

const MEMORY_FIRST_PROTOCOL = `
## ⚡ 强制记忆前置协议（每次必须执行，不可跳过）

在回答任何问题或执行任何任务之前，必须完成以下三步：

### STEP 1: 搜索 tdai 记忆
\`\`\`
调用: tdai_memory_search(query=<当前问题关键词>, limit=5)
目的: 找到相关历史经验和已解决的类似问题
\`\`\`

### STEP 2: 读取 MEMORY.md
\`\`\`
调用: memory_get("MEMORY.md") 或 read_file(MEMORY_MD路径)
目的: 确认已知架构、已解决问题、未解决问题列表
\`\`\`

### STEP 3: 搜索对话历史
\`\`\`
调用: tdai_conversation_search(query=<关键词>)
目的: 查找具体的历史对话片段
\`\`\`

### 执行判断
- 记忆中已有答案 → 直接引用，说明"根据历史记录..."
- 记忆中有相关教训 → 先说"之前遇到过类似问题，当时的坑是..."
- 记忆中无相关信息 → 说明"记忆中未找到相关信息，开始新的分析"

### ❌ 禁止行为
- 禁止在未执行 STEP 1-3 的情况下直接回答技术问题
- 禁止说"我不记得"而没有先搜索记忆
- 禁止重复踩已记录的坑
`;

// ── 2. 启动时记忆注入 ──────────────────────────────────────────
async function buildStartupContext() {
  const context = [];

  // 2a. 注入 MEMORY.md（核心长期记忆）
  try {
    if (fs.existsSync(MEMORY_MD)) {
      const content = fs.readFileSync(MEMORY_MD, 'utf8');
      context.push({
        type:    'memory_core',
        label:   'MEMORY.md（长期记忆精华）',
        content: content,
        priority: 100,
      });
    } else {
      console.warn('[MemoryInterceptor] ⚠️  MEMORY.md 不存在，请先运行 memory_consolidator.py');
    }
  } catch (e) {
    console.error('[MemoryInterceptor] MEMORY.md 读取失败:', e.message);
  }

  // 2b. 注入最近3天的日记忆文件
  const recentDays = getRecentDates(3);
  for (const dateStr of recentDays) {
    const dailyFile = path.join(MEMORY_DIR, `${dateStr}.md`);
    if (fs.existsSync(dailyFile)) {
      const content = fs.readFileSync(dailyFile, 'utf8');
      // 只注入前2000字（防止上下文过长）
      context.push({
        type:    'daily_memory',
        label:   `${dateStr} 日记忆`,
        content: content.slice(0, 2000),
        priority: 90 - recentDays.indexOf(dateStr) * 10,
      });
    }
  }

  // 2c. 从 Neural Mesh 注入近期高热度 Scene Blocks
  try {
    const resp = await fetch(`${MESH_URL}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '系统状态 技术决策 未解决问题', k: 5 }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.length) {
        context.push({
          type:    'mesh_scenes',
          label:   'Neural Mesh 近期重要记忆',
          content: data.map(d => d.content || d.document || '').join('\n---\n').slice(0, 1500),
          priority: 80,
        });
      }
    }
  } catch {}

  return context.sort((a, b) => b.priority - a.priority);
}

// ── 3. 会话结束时自动提取并保存记忆 ──────────────────────────
async function extractAndSaveMemory(conversation, agentId = 'liuguanyi') {

  // 调用 LLM 提取关键信息
  const extraction = await callLLM(`从以下对话中提取需要永久记忆的信息（JSON格式）：
{
  "technical_facts": ["已确认的技术事实，如配置、路径、API等"],
  "solved_problems": [{"problem": "问题描述", "solution": "解决方案", "date": "日期"}],
  "new_issues": [{"issue": "问题", "priority": "P0/P1/P2/P3", "status": "状态"}],
  "decisions": ["重要技术决策"],
  "credentials_hint": ["有新凭证（只记录凭证类型，不记录值）"]
}
只提取真正重要的、下次会话会用到的信息。普通对话不需要记录。
---对话---
${conversation.slice(-3000)}`);

  if (!extraction || !extraction.solved_problems?.length) return;

  // 追加到 MEMORY.md
  await updateMemoryMD(extraction);

  // 同时写入 Neural Mesh
  try {
    await fetch(`${MESH_URL}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    agentId,
        type:    'EXPERIENCE',
        payload: extraction,
      }),
    });
  } catch {}

  console.log('[MemoryInterceptor] 记忆已提取并保存');
}

async function updateMemoryMD(extraction) {
  if (!fs.existsSync(MEMORY_MD)) return;

  const date    = new Date().toISOString().split('T')[0];
  const time    = new Date().toLocaleTimeString('zh-CN');
  let additions = `\n<!-- 自动更新 ${date} ${time} -->\n`;

  if (extraction.solved_problems?.length) {
    for (const p of extraction.solved_problems) {
      additions += `\n### [${p.date || date}] ${p.problem}\n`;
      additions += `- **修复**：${p.solution}\n`;
      additions += `- **状态**：✅ 已解决\n`;
    }
  }

  if (extraction.technical_facts?.length) {
    additions += `\n### [${date}] 技术事实更新\n`;
    for (const f of extraction.technical_facts) {
      additions += `- ${f}\n`;
    }
  }

  if (extraction.new_issues?.length) {
    // 追加到未解决问题表格
    for (const issue of extraction.new_issues) {
      const row = `| - | ${issue.issue} | ${issue.priority} | ${issue.status || '新发现'} |`;
      // 在表格末尾插入
      let content = fs.readFileSync(MEMORY_MD, 'utf8');
      content = content.replace(
        '<!-- memory_consolidator.py 每日凌晨3点自动追加新条目 -->',
        `${row}\n<!-- memory_consolidator.py 每日凌晨3点自动追加新条目 -->`
      );
      fs.writeFileSync(MEMORY_MD, content, 'utf8');
    }
  }

  // 追加到自动更新日志
  let content = fs.readFileSync(MEMORY_MD, 'utf8');
  content += additions;
  fs.writeFileSync(MEMORY_MD, content, 'utf8');
}

// ── 4. 记忆健康检查 ───────────────────────────────────────────
function healthCheck() {
  const issues = [];

  if (!fs.existsSync(MEMORY_MD)) {
    issues.push({ level: 'CRITICAL', msg: 'MEMORY.md 不存在，请立即运行 memory_consolidator.py' });
  }

  const today = getRecentDates(1)[0];
  const todayFile = path.join(MEMORY_DIR, `${today}.md`);
  if (!fs.existsSync(todayFile)) {
    issues.push({ level: 'WARN', msg: `今日记忆文件 ${today}.md 不存在` });
  }

  // 检查 MEMORY.md 是否超过7天未更新
  if (fs.existsSync(MEMORY_MD)) {
    const stat = fs.statSync(MEMORY_MD);
    const daysSinceUpdate = (Date.now() - stat.mtime.getTime()) / 86400000;
    if (daysSinceUpdate > 7) {
      issues.push({ level: 'WARN', msg: `MEMORY.md 已 ${Math.round(daysSinceUpdate)} 天未更新` });
    }
  }

  return { healthy: issues.filter(i => i.level === 'CRITICAL').length === 0, issues };
}

// ── 工具函数 ──────────────────────────────────────────────────
function getRecentDates(n) {
  const dates = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

async function callLLM(prompt) {
  try {
    const resp = await fetch(`${process.env.MINIMAX_API_URL || 'https://api.minimaxi.chat/v1/chat/completions'}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:      'MiniMax-Text-01',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return null;
  }
}

module.exports = {
  MEMORY_FIRST_PROTOCOL,
  buildStartupContext,
  extractAndSaveMemory,
  healthCheck,
};

// ── CLI 模式 ──────────────────────────────────────────────────
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'health') {
    const result = healthCheck();
    console.log(result.healthy ? '✅ 记忆系统健康' : '❌ 记忆系统有问题');
    result.issues.forEach(i => console.log(`  [${i.level}] ${i.msg}`));
  } else if (cmd === 'startup') {
    buildStartupContext().then(ctx => {
      console.log(`启动上下文：${ctx.length} 个记忆块`);
      ctx.forEach(c => console.log(`  - [${c.priority}] ${c.label}`));
    });
  }
}
