// memory_startup_injector.js
// ============================================================
// OpenClaw Gateway 启动钩子：Session 开始时自动注入记忆上下文
// 这解决了"每次会话都是空白开始"的根本问题
//
// 部署方式：
//   在 openclaw.json 中配置:
//   "startup.hooks": ["~/.openclaw/scripts/memory_startup_injector.js"]
//   或在 AGENT.md 的 onSessionStart 钩子中调用
// ============================================================

const fs   = require('fs');
const path = require('path');

const BASE       = path.join(process.env.HOME, '.openclaw');
const AGENT_DIR  = path.join(BASE, 'agents/liuguanyi/agent');
const MEMORY_MD  = path.join(AGENT_DIR, 'MEMORY.md');
const MEMORY_DIR = path.join(AGENT_DIR, 'memory');
const MESH_URL   = 'http://localhost:9527';

// ── 构建启动时注入的系统消息 ──────────────────────────────────
async function buildInjectionMessage() {
  const parts = [];

  // ① MEMORY.md（最重要，必须注入）
  if (fs.existsSync(MEMORY_MD)) {
    const content = fs.readFileSync(MEMORY_MD, 'utf8');
    // 截取关键部分（架构 + 已解决 + 未解决），避免过长
    const sections = extractKeySections(content);
    parts.push(`## 📚 长期记忆（MEMORY.md）\n${sections}`);
  }

  // ② 昨天和今天的日记忆
  const dates = [getDateStr(-1), getDateStr(0)];
  for (const d of dates) {
    const f = path.join(MEMORY_DIR, `${d}.md`);
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf8').slice(0, 1500);
      parts.push(`## 📅 ${d} 记忆\n${content}`);
    }
  }

  // ③ Neural Mesh 最近活跃场景
  try {
    const resp = await fetch(`${MESH_URL}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '当前任务 未解决问题 系统状态', k: 3 }),
    });
    if (resp.ok) {
      const items = await resp.json();
      if (items.length) {
        const snippets = items
          .map(i => (i.content || i.document || '').slice(0, 400))
          .join('\n---\n');
        parts.push(`## 🔥 Neural Mesh 近期场景\n${snippets}`);
      }
    }
  } catch {}

  if (!parts.length) return null;

  return [
    '> 📌 以下是本次会话自动注入的历史记忆，请在回答前先参考：',
    '',
    ...parts,
    '',
    '---',
    '> ⚡ 强制协议：回答前必须先调用 tdai_memory_search 搜索相关记忆',
  ].join('\n');
}

// ── 提取 MEMORY.md 的关键章节 ────────────────────────────────
function extractKeySections(content) {
  const sections = [];
  const lines    = content.split('\n');
  let   inSection = false;
  let   buffer    = [];
  const keyHeaders = ['身份与架构', '技术架构决策', '未解决问题'];

  for (const line of lines) {
    const isKeyHeader = keyHeaders.some(k => line.includes(k));
    if (isKeyHeader) {
      inSection = true;
      buffer    = [line];
    } else if (inSection && line.startsWith('## ═══') && buffer.length > 1) {
      sections.push(buffer.join('\n'));
      inSection = false;
      buffer    = [];
    } else if (inSection) {
      buffer.push(line);
      if (buffer.length > 40) {  // 每个章节最多40行
        sections.push(buffer.join('\n'));
        inSection = false;
        buffer    = [];
      }
    }
  }
  if (buffer.length > 1) sections.push(buffer.join('\n'));

  return sections.join('\n\n').slice(0, 3000);
}

// ── 注册到 OpenClaw Session 生命周期 ─────────────────────────
function registerSessionHook() {
  // 方式1：通过 global.__ocHooks（OpenClaw 官方钩子接口）
  if (global.__ocHooks) {
    global.__ocHooks.onSessionStart = async (sessionId, agentId) => {
      if (agentId && !agentId.includes('liu') &&
          !agentId.includes('fang') && !agentId.includes('wu')) {
        return;  // 只对五分身注入
      }
      const injection = await buildInjectionMessage();
      if (injection) {
        return [{
          role:    'system',
          content: injection,
          _meta:   { type: 'memory_injection', ts: Date.now() }
        }];
      }
    };
    console.log('[StartupInjector] Session钩子已注册');
    return;
  }

  // 方式2：通过修改 openclaw.json 的 contextInjections（备用）
  const ocConfig = path.join(BASE, 'openclaw.json');
  if (fs.existsSync(ocConfig)) {
    try {
      const config = JSON.parse(fs.readFileSync(ocConfig, 'utf8'));

      if (!config.agents) config.agents = {};
      if (!config.agents.liuguanyi) config.agents.liuguanyi = {};

      config.agents.liuguanyi.contextFiles = [
        MEMORY_MD,
        path.join(MEMORY_DIR, `${getDateStr(0)}.md`),
        path.join(MEMORY_DIR, `${getDateStr(-1)}.md`),
      ].filter(fs.existsSync);

      config.agents.liuguanyi.autoRecall = true;

      fs.writeFileSync(ocConfig, JSON.stringify(config, null, 2), 'utf8');
      console.log('[StartupInjector] openclaw.json 已更新记忆注入配置');
    } catch (e) {
      console.error('[StartupInjector] openclaw.json 更新失败:', e.message);
    }
  }
}

// ── 工具 ─────────────────────────────────────────────────────
function getDateStr(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().split('T')[0];
}

// ── 导出 + CLI ────────────────────────────────────────────────
module.exports = { buildInjectionMessage, registerSessionHook };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'preview') {
    buildInjectionMessage().then(msg => {
      if (msg) {
        console.log('=== 启动注入预览（前500字）===');
        console.log(msg.slice(0, 500));
        console.log(`\n总长度: ${msg.length} 字符`);
      } else {
        console.log('❌ 无法生成注入内容，检查 MEMORY.md 是否存在');
      }
    });
  } else if (cmd === 'install') {
    registerSessionHook();
    console.log('✅ 启动注入器已安装');
  } else {
    registerSessionHook();
  }
}
