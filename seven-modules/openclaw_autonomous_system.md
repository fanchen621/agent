# OpenClaw 自治系统 · 完整实现
# 七大模块一体化设计

---

## 部署结构

```
~/.openclaw/
├── scripts/
│   ├── autostart.js        # 智能自启动
│   ├── watchdog.js          # 死循环/Stream守护
│   ├── context_compressor.js # 上下文压缩
│   ├── scheduler_monitor.js  # 任务调度监控
│   ├── bug_scanner.js       # Bug扫描报告
│   ├── hermes_loop.js       # 闭环学习
│   ├── thinking_standard.js  # 思考标准注入
│   └── master_daemon.js     # 统一守护进程入口
├── storage/
│   ├── error_history.json   # 错误历史库
│   ├── scan_reports/        # Bug扫描报告
│   └── skill_patterns.json  # 自动生成的技能模式
└── skills/
    └── auto_*/              # Hermes自动生成的Skill
```

---

## master_daemon.js — 统一入口

```javascript
// 所有子系统的统一启动入口
const { Watchdog } = require('./watchdog');
const { ContextCompressor } = require('./context_compressor');
const { SchedulerMonitor } = require('./scheduler_monitor');
const { BugScanner } = require('./bug_scanner');
const { HermesLoop } = require('./hermes_loop');
const cron = require('node-cron');
const fs = require('fs');

class MasterDaemon {
    constructor() {
        this.watchdog = new Watchdog();
        this.compressor = new ContextCompressor();
        this.scheduler = new SchedulerMonitor();
        this.bugScanner = new BugScanner();
        this.hermes = new HermesLoop();
    }

    start() {
        console.log('⬡ OpenClaw 自治系统启动...');

        // 1. 看门狗：持续运行（内部 setInterval 1000ms）
        this.watchdog.init();
        console.log('✓ 守护看门狗已激活');

        // 2. 上下文压缩：挂载到 Gateway 请求中间件
        this.mountContextMiddleware();
        console.log('✓ 上下文压缩已挂载');

        // 3. 定时任务：每天凌晨3点 Dreaming
        cron.schedule('0 3 * * *', this.scheduler.wrap('dreaming', async ({ heartbeat }) => {
            const mesh = require('./neural_mesh_client');
            heartbeat();
            const events = await this.collectTodayEvents(); heartbeat();
            const essence = await this.distill(events); heartbeat();
            await mesh.share('DREAMING', essence); heartbeat();
        }, { timeout: 3600000, retry: 2 }));

        // 4. Bug扫描：每天凌晨2点
        cron.schedule('0 2 * * *', this.scheduler.wrap('bug_scan', async ({ heartbeat }) => {
            heartbeat();
            const report = await this.bugScanner.scan();
            heartbeat();
            console.log(`[BugScan] P0:${report.p0} P1:${report.p1} P2:${report.p2}`);
        }, { timeout: 1800000 }));

        // 5. 自升级检查：每天凌晨4点
        cron.schedule('0 4 * * *', this.scheduler.wrap('upgrade_check', async ({ heartbeat }) => {
            heartbeat();
            await this.checkAndUpgrade();
        }));

        console.log('✓ 所有定时任务已注册');
        console.log('⬡ 自治系统运行中...');
    }

    mountContextMiddleware() {
        const originalHandler = global.__ocGatewayHandler;
        global.__ocGatewayHandler = async (req, session) => {
            const compressedSession = await this.compressor.checkAndCompress(session);
            return originalHandler(req, compressedSession);
        };
    }

    async collectTodayEvents() {
        const log = JSON.parse(fs.readFileSync(
            `${process.env.HOME}/.openclaw/storage/daily_events.json`, 'utf8'
        ));
        const today = Date.now() - 86400000;
        return log.filter(e => e.ts > today);
    }

    async distill(events) {
        const { callClaude } = require('./claude_api');
        return callClaude({
            model: 'claude-sonnet-4-5',
            max_tokens: 1500,
            messages: [{
                role: 'user',
                content: `你是气海老祖。提炼今日经验精华（JSON格式）：
{ top_experiences: [], top_lessons: [], capability_updates: [], context: "" }
---今日事件---
${JSON.stringify(events.slice(-50))}`
            }]
        });
    }
}

new MasterDaemon().start();
```

---

## autostart.js — 智能自启动

```javascript
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const ERROR_DB = path.join(process.env.HOME, '.openclaw/storage/error_history.json');
const START_LOG = path.join(process.env.HOME, '.openclaw/storage/start_log.json');

function loadErrorHistory() {
    try { return JSON.parse(fs.readFileSync(ERROR_DB, 'utf8')); }
    catch { return []; }
}

function buildStartStrategy(history) {
    const recent = history.slice(-10);
    const oomCount = recent.filter(e => e.type === 'OOM').length;
    const loopCount = recent.filter(e => e.type === 'DEADLOOP').length;
    const crashCount = recent.filter(e => e.type === 'CRASH').length;

    if (oomCount >= 2) return {
        mode: 'safe_memory',
        description: '检测到多次OOM，启用内存安全模式',
        args: ['--max-old-space-size=512', '--single-process', '--disable-dev-shm-usage'],
        envOverrides: { NODE_OPTIONS: '--max-old-space-size=512' }
    };

    if (loopCount >= 2) return {
        mode: 'anti_loop',
        description: '检测到多次死循环，启用超时保护模式',
        args: ['--enable-watchdog', '--request-timeout=30000', '--stream-timeout=15000'],
        envOverrides: { OC_WATCHDOG: '1', OC_REQ_TIMEOUT: '30000', OC_STREAM_TIMEOUT: '15000' }
    };

    if (crashCount >= 3) return {
        mode: 'recovery',
        description: '检测到多次崩溃，启用恢复模式',
        args: ['--reset-sessions', '--clear-stream-cache', '--clear-plugin-cache'],
        envOverrides: { OC_RECOVERY: '1' }
    };

    return { mode: 'normal', description: '正常启动', args: [], envOverrides: {} };
}

async function waitForHealthy(timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const res = await fetch('http://localhost:17742/health');
            if (res.ok) return true;
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

function recordStartResult(data) {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(START_LOG, 'utf8')); } catch {}
    log.push({ ...data, ts: Date.now() });
    fs.writeFileSync(START_LOG, JSON.stringify(log.slice(-50), null, 2));
}

async function smartStart() {
    const history = loadErrorHistory();
    const strategy = buildStartStrategy(history);

    console.log(`[Autostart] 策略: ${strategy.mode} - ${strategy.description}`);

    const env = { ...process.env, ...strategy.envOverrides };
    const proc = spawn('openclaw', ['gateway', 'start', '--background', ...strategy.args], {
        env, stdio: 'inherit'
    });

    const ok = await waitForHealthy(30000);
    recordStartResult({ strategy: strategy.mode, ok, pid: proc.pid });

    if (!ok) {
        console.error('[Autostart] 健康检查失败，记录错误后重试');
        const db = loadErrorHistory();
        db.push({ type: 'START_FAILED', strategy: strategy.mode, ts: Date.now() });
        fs.writeFileSync(ERROR_DB, JSON.stringify(db.slice(-100), null, 2));
        await new Promise(r => setTimeout(r, 5000));
        return smartStart();
    }

    console.log('[Autostart] 启动成功，系统健康');
}

module.exports = { smartStart, buildStartStrategy };
```

---

## watchdog.js — 守护看门狗

```javascript
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ERROR_DB = path.join(process.env.HOME, '.openclaw/storage/error_history.json');

class Watchdog {
    constructor() {
        this.routeLog = new Map();
        this.streamLog = new Map();
        this.heartbeats = [];
        this.enabled = false;
    }

    init() {
        this.enabled = true;
        this._tickInterval = setInterval(() => this.tick(), 1000);

        if (global.__ocHooks) {
            global.__ocHooks.onRequest = (path) => this.onRequest(path);
            global.__ocHooks.onStreamOpen = (id) => this.onStreamOpen(id);
            global.__ocHooks.onStreamChunk = (id) => this.onStreamChunk(id);
            global.__ocHooks.onStreamClose = (id) => this.onStreamClose(id);
        }

        console.log('[Watchdog] 已激活 - 路由死循环/Stream挂死/心跳检测');
    }

    onRequest(reqPath) {
        const now = Date.now();
        const log = this.routeLog.get(reqPath) || [];
        const recent = log.filter(t => now - t < 5000);
        recent.push(now);
        this.routeLog.set(reqPath, recent);

        if (recent.length >= 8) {
            this.killRouteLoop(reqPath);
        }
    }

    killRouteLoop(reqPath) {
        console.error(`[Watchdog] 路由死循环检测: ${reqPath}，执行清理`);
        this.recordError('DEADLOOP', { path: reqPath });
        this.routeLog.delete(reqPath);
        exec('openclaw gateway flush-route-cache', (err) => {
            if (err) console.error('[Watchdog] flush-route-cache 失败:', err.message);
        });
    }

    onStreamOpen(id) {
        this.streamLog.set(id, { lastChunk: Date.now(), openTs: Date.now() });
    }

    onStreamChunk(id) {
        const entry = this.streamLog.get(id);
        if (entry) entry.lastChunk = Date.now();
    }

    onStreamClose(id) {
        this.streamLog.delete(id);
    }

    killHungStream(id, age) {
        console.error(`[Watchdog] Stream挂死: ${id}，已${age}s无输出`);
        this.recordError('STREAM_HANG', { id, age });
        this.streamLog.delete(id);
        const registry = global.__ocStreamRegistry;
        if (registry?.[id]) {
            try { registry[id].destroy(); } catch {}
        }
    }

    registerHeartbeat() {
        this.heartbeats.push(Date.now());
        if (this.heartbeats.length > 100) this.heartbeats = this.heartbeats.slice(-50);
    }

    tick() {
        if (!this.enabled) return;
        const now = Date.now();

        for (const [id, entry] of this.streamLog) {
            const age = Math.round((now - entry.lastChunk) / 1000);
            if (age > 15) this.killHungStream(id, age);
        }

        const lastHB = this.heartbeats[this.heartbeats.length - 1];
        if (lastHB && now - lastHB > 30000) {
            console.error('[Watchdog] 心跳超时30s，Gateway可能假死，重启中...');
            this.recordError('HEARTBEAT_LOST', { lastHB });
            exec('pm2 restart openclaw-gateway');
        }
    }

    recordError(type, ctx) {
        let db = [];
        try { db = JSON.parse(fs.readFileSync(ERROR_DB, 'utf8')); } catch {}
        db.push({ type, ctx, ts: Date.now() });
        fs.writeFileSync(ERROR_DB, JSON.stringify(db.slice(-100), null, 2));
    }

    destroy() {
        this.enabled = false;
        clearInterval(this._tickInterval);
    }
}

module.exports = { Watchdog };
```

---

## context_compressor.js — 上下文压缩

```javascript
const { callClaude } = require('./claude_api');

const COMPRESS_THRESHOLD = 0.60;
const MAX_CONTEXT_TOKENS = 200000;
const KEEP_RECENT_MSGS = 5;

class ContextCompressor {
    async checkAndCompress(session) {
        if (!session || !session.usedTokens) return session;

        const ratio = session.usedTokens / MAX_CONTEXT_TOKENS;
        if (ratio < COMPRESS_THRESHOLD) return session;

        console.log(`[Compress] ${(ratio * 100).toFixed(1)}% 触发压缩 (session: ${session.id})`);
        return this.compress(session);
    }

    async compress(session) {
        const summaryRaw = await callClaude({
            model: 'claude-sonnet-4-5',
            max_tokens: 2000,
            messages: [{
                role: 'user',
                content: `对以下对话历史提炼精华，JSON格式：
{
    "goals": ["用户的核心目标"],
    "decisions": ["已做的决策和选型理由"],
    "done": ["已完成的关键步骤和结果"],
    "todo": ["未解决的问题和下一步"],
    "tech_details": {"key": "重要技术细节，如配置/路径/端口"},
    "context_note": "一句话总结当前对话状态"
}
---对话历史（共${session.messages.length}条）---
${JSON.stringify(session.messages)}`
            }]
        });

        try {
            const mesh = require('./neural_mesh_client');
            await mesh.share('EXPERIENCE', {
                type: 'context_compress',
                session_id: session.id,
                agent: session.agentId,
                summary: summaryRaw,
                original_tokens: session.usedTokens,
                message_count: session.messages.length,
                ts: Date.now()
            });
        } catch (e) {
            console.warn('[Compress] Mesh写入失败，但压缩继续:', e.message);
        }

        const compressed = [
            { role: 'system', content: session.systemPrompt },
            {
                role: 'assistant',
                content: `[上下文已压缩 · ${new Date().toLocaleString()} · 保留精华]\n\n` +
                    `目标：${summaryRaw.goals?.join('；')}\n` +
                    `已完成：${summaryRaw.done?.join('；')}\n` +
                    `待办：${summaryRaw.todo?.join('；')}\n` +
                    `技术细节：${JSON.stringify(summaryRaw.tech_details)}\n` +
                    `状态：${summaryRaw.context_note}`
            },
            ...session.messages.slice(-KEEP_RECENT_MSGS)
        ];

        return {
            ...session,
            messages: compressed,
            compressed: true,
            compressedAt: Date.now(),
            preCompressSize: session.messages.length
        };
    }
}

module.exports = { ContextCompressor };
```

---

## hermes_loop.js — 闭环学习

```javascript
const { callClaude } = require('./claude_api');
const collab = require('./collab_protocol');

class HermesLoop {
    async beforeTask(taskDescription, agentId) {
        const mesh = require('./neural_mesh_client');
        const memories = await mesh.recall(taskDescription, 8);
        const failures = collab.getRelevantFailures(taskDescription, 3);

        if (!memories.length && !failures.length) {
            return { hasContext: false, prompt: '' };
        }

        const prompt = `在执行此任务前，我主动查阅了历史经验：

${memories.length ? `相关成功经验（${memories.length}条）：
${memories.map((m, i) => `${i + 1}. ${m.content?.substring(0, 150)}`).join('\n')}` : ''}

${failures.length ? `已知失败教训（需要避开）：
${failures.map(f => `- ${f.lesson}`).join('\n')}` : ''}

基于以上信息，我的执行策略：`;

        return { hasContext: true, memories, failures, prompt };
    }

    async afterTask(task, result, agentId) {
        const mesh = require('./neural_mesh_client');

        let evaluation;
        try {
            evaluation = await callClaude({
                model: 'claude-sonnet-4-5',
                max_tokens: 800,
                messages: [{
                    role: 'user',
                    content: `对以下任务执行进行自评估，JSON格式：
{
    "quality": 0-10,
    "efficiency": 0-10,
    "used_experience": true/false,
    "avoided_pitfalls": true/false,
    "better_approach": "如果有更优方案，描述；否则null",
    "reusable_pattern": "如果有可复用模式，描述；否则null",
    "lessons": ["这次学到了什么"]
}
任务描述: ${task.description}
执行方法: ${result.approach}
结果: ${result.outcome}
是否成功: ${result.success}`
                }]
            });
        } catch (e) {
            evaluation = { quality: 5, lessons: ['评估API调用失败'] };
        }

        if (evaluation.reusable_pattern && evaluation.quality >= 7) {
            await this.generateSkill({
                name: `${task.type || 'general'}_${Date.now()}`,
                pattern: evaluation.reusable_pattern,
                source_task: task.description,
                quality: evaluation.quality,
                agent: agentId
            });
        }

        await mesh.share(
            result.success ? 'EXPERIENCE' : 'FAILURE_LESSON',
            {
                agent: agentId,
                task: task.description,
                approach: result.approach,
                outcome: result.outcome,
                evaluation,
                ts: Date.now()
            }
        );

        return evaluation;
    }

    async generateSkill(data) {
        const fs = require('fs');
        const path = require('path');

        const skillContent = await callClaude({
            model: 'claude-sonnet-4-5',
            max_tokens: 1000,
            messages: [{
                role: 'user',
                content: `为以下可复用模式生成一个 OpenClaw SKILL.md 文件：
---
name: auto_${data.name}
description: 自动生成的技能，来源任务：${data.source_task}
---

## 使用场景
[描述什么时候应该使用这个技能]

## 核心步骤
[列出具体可执行的步骤]

## 注意事项
[需要避免的坑]

---可复用模式---
${data.pattern}`
            }]
        });

        const skillDir = path.join(process.env.HOME, `.openclaw/skills/auto_${data.name}`);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);
        console.log(`[Hermes] 自动生成 Skill: auto_${data.name}`);
    }
}

module.exports = { HermesLoop };
```

---

## 一键安装

```bash
#!/bin/bash
# install_autonomous.sh

set -e
SCRIPTS_DIR="$HOME/.openclaw/scripts"
mkdir -p "$SCRIPTS_DIR"
mkdir -p "$HOME/.openclaw/storage/scan_reports"

# 1. 安装依赖
cd "$SCRIPTS_DIR"
npm init -y 2>/dev/null
npm install node-cron node-fetch

# 2. 写入所有脚本（见上方各模块代码）

# 3. PM2 守护 Master Daemon
pm2 start master_daemon.js --name oc-daemon --restart-delay=5000
pm2 save

# 4. 设置 crontab（调度器的备用保障）
(crontab -l 2>/dev/null | grep -v "oc-daemon"; \
    echo "*/5 * * * * pm2 describe oc-daemon > /dev/null || pm2 start $SCRIPTS_DIR/master_daemon.js --name oc-daemon") | crontab -

echo "✅ OpenClaw 自治系统部署完成"
pm2 list
```
