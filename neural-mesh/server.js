/**
 * Neural Mesh Server - 五分身共享意识层
 * 端口: 9527
 * 依赖: redis@4, express@4
 */
const express = require('express');
const { createClient } = require('redis');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Redis 连接 ───────────────────────────────────────────────────────────────
const pub = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
const sub = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
const store = createClient({ socket: { host: '127.0.0.1', port: 6379 } });
const subscriber = createClient({ socket: { host: '127.0.0.1', port: 6379 } });

pub.on('error', err => console.error('[redis:pub]', err));
sub.on('error', err => console.error('[redis:sub]', err));
store.on('error', err => console.error('[redis:store]', err));
subscriber.on('error', err => console.error('[redis:subscriber]', err));

// ─── 五分身频道定义 ─────────────────────────────────────────────────────────
const CHANNELS = {
  ALL:          'mesh:all',          // 全体广播
  EMOTION:      'mesh:emotion',      // 情感预警
  TASK:         'mesh:task',        // 任务交接
  MEMORY:       'mesh:memory',      // 记忆更新
  SKILL:        'mesh:capability',   // 能力广播
  EXPERIENCE:   'mesh:experience',   // 经验
  FAILURE:      'mesh:failure',      // 失败教训
  DREAMING:     'mesh:dreaming',     // 蒸馏
};

// ─── 内存订阅者列表（WebSocket风格）───────────────────────────────────────────
const subscribers = new Map(); // agentId → { socket, channels: Set }

function broadcastToChannel(channel, event) {
  const msg = JSON.stringify(event);
  // 发送给所有订阅了该频道的内存订阅者
  for (const [agentId, sub] of subscribers) {
    if (sub.channels.has(channel) || sub.channels.has('mesh:all')) {
      try {
        sub.socket.send(msg);
      } catch (e) {
        console.error(`[broadcast] failed to ${agentId}:`, e.message);
      }
    }
  }
}

// 启动时连接 Redis 并订阅所有频道
(async () => {
  await pub.connect();
  await sub.connect();
  await store.connect();
  await subscriber.connect();

  // 订阅所有频道，收到消息广播给内存订阅者
  for (const ch of Object.values(CHANNELS)) {
    await subscriber.subscribe(ch, (msg) => {
      try {
        const event = JSON.parse(msg);
        broadcastToChannel(ch, event);
      } catch (e) {
        console.error('[subscribe] parse error:', e.message);
      }
    });
  }

  console.log('⬡ Neural Mesh Redis connected, all channels subscribed');
})();

// ─── 事件类型白名单 & 频道映射 ─────────────────────────────────────────────
const TYPE_TO_CHANNEL = {
  'ALL':                CHANNELS.ALL,
  'EMOTION':           CHANNELS.EMOTION,
  'EMOTION_ALERT':     CHANNELS.EMOTION,
  'TASK':              CHANNELS.TASK,
  'TASK_HANDOFF':      CHANNELS.TASK,
  'MEMORY':            CHANNELS.MEMORY,
  'SKILL':             CHANNELS.SKILL,
  'CAPABILITY_UPDATE':  CHANNELS.SKILL,
  'EXPERIENCE':        CHANNELS.EXPERIENCE,
  'FAILURE':           CHANNELS.FAILURE,
  'FAILURE_LESSON':    CHANNELS.FAILURE,
  'DREAMING':          CHANNELS.DREAMING,
};

const VALID_TYPES = new Set(Object.keys(TYPE_TO_CHANNEL));
const MEMORY_TYPES = new Set(['EXPERIENCE', 'FAILURE_LESSON', 'DREAMING', 'MEMORY']);

// ─── 发布事件 ───────────────────────────────────────────────────────────────
/**
 * POST /publish
 * { from, type, payload }
 */
app.post('/publish', async (req, res) => {
  try {
    const { from, type, payload } = req.body;
    if (!from || !type) {
      return res.status(400).json({ error: 'from and type required' });
    }
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: `invalid event type: ${type}` });
    }

    const channel = TYPE_TO_CHANNEL[type] || CHANNELS.ALL;
    const event = { from, type, payload, ts: Date.now() };

    // 1. 实时广播
    await pub.publish(channel, JSON.stringify(event));

    // 2. 持久化到 Redis LIST（按日期分桶）
    if (MEMORY_TYPES.has(type)) {
      const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      await store.lPush(`mesh:log:${dateKey}`, JSON.stringify(event));
      await store.lTrim(`mesh:log:${dateKey}`, 0, 999); // 只保留最近1000条
    }

    res.json({ ok: true, channel, ts: event.ts });
  } catch (err) {
    console.error('[publish]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── 查询记忆 ───────────────────────────────────────────────────────────────
/**
 * POST /recall
 * { query, type, from, date, k }
 * 按日期范围查询记忆，内存中有就内存过滤，否则读 Redis
 */
app.post('/recall', async (req, res) => {
  try {
    const { query, type, from, date, k = 8 } = req.body;
    const results = [];

    // 查最近 N 天的日志
    const days = parseInt(date) || 7;
    const cutoff = Date.now() - days * 24 * 3600 * 1000;

    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const items = await store.lRange(`mesh:log:${d}`, 0, 99);
      for (const item of items) {
        try {
          const ev = JSON.parse(item);
          if (ev.ts < cutoff) continue;
          if (type && ev.type !== type) continue;
          if (from && ev.from !== from) continue;
          // 简单关键词匹配
          const text = JSON.stringify(ev.payload).toLowerCase();
          const q = (query || '').toLowerCase();
          if (!q || text.includes(q)) {
            results.push(ev);
          }
        } catch (e) {}
        if (results.length >= k) break;
      }
      if (results.length >= k) break;
    }

    // 简单排序：最新优先
    results.sort((a, b) => b.ts - a.ts);
    res.json({ results: results.slice(0, k), total: results.length });
  } catch (err) {
    console.error('[recall]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── 能力注册 / 查询 ────────────────────────────────────────────────────────
/**
 * POST /capability/register
 * { agent, skills: [{name, desc, level}] }
 */
app.post('/capability/register', async (req, res) => {
  try {
    const { agent, skills } = req.body;
    if (!agent || !skills) {
      return res.status(400).json({ error: 'agent and skills required' });
    }
    await store.hSet('mesh:capabilities', agent, JSON.stringify({
      skills,
      updatedAt: Date.now()
    }));
    // 广播能力更新
    await pub.publish(CHANNELS.SKILL, JSON.stringify({
      from: agent, type: 'CAPABILITY_UPDATE', payload: { agent, skills }, ts: Date.now()
    }));
    res.json({ ok: true });
  } catch (err) {
    console.error('[capability:register]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /capability/all
 */
app.get('/capability/all', async (req, res) => {
  try {
    const all = await store.hGetAll('mesh:capabilities');
    const result = {};
    for (const [agent, data] of Object.entries(all)) {
      try { result[agent] = JSON.parse(data); } catch { result[agent] = data; }
    }
    res.json(result);
  } catch (err) {
    console.error('[capability:all]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /capability/:agent
 */
app.get('/capability/:agent', async (req, res) => {
  try {
    const { agent } = req.params;
    const data = await store.hGet('mesh:capabilities', agent);
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 情感预警 ────────────────────────────────────────────────────────────────
/**
 * POST /emotion/alert
 * { from, persona, vector, count }
 */
app.post('/emotion/alert', async (req, res) => {
  try {
    const { from, persona, vector, count } = req.body;
    const urgency = count >= 3 ? 'high' : 'warn';
    const event = {
      from, type: 'EMOTION_ALERT',
      payload: { persona, vector, count, urgency },
      ts: Date.now()
    };
    await pub.publish(CHANNELS.EMOTION, JSON.stringify(event));
    res.json({ ok: true, urgency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 任务交接 ────────────────────────────────────────────────────────────────
/**
 * POST /task/handoff
 * { from, to, task, context }
 */
app.post('/task/handoff', async (req, res) => {
  try {
    const { from, to, task, context } = req.body;
    const event = {
      from, type: 'TASK_HANDOFF',
      payload: { to, task, context, status: 'pending' },
      ts: Date.now()
    };
    // 持久化交接任务
    await store.lPush('mesh:tasks:pending', JSON.stringify(event));
    await pub.publish(CHANNELS.TASK, JSON.stringify(event));
    res.json({ ok: true, ts: event.ts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /task/pending?agent=xxx
 */
app.get('/task/pending', async (req, res) => {
  try {
    const { agent } = req.query;
    const all = await store.lRange('mesh:tasks:pending', 0, 99);
    const tasks = [];
    for (const t of all) {
      try {
        const ev = JSON.parse(t);
        if (!agent || ev.payload.to === agent || ev.payload.from === agent) {
          tasks.push(ev);
        }
      } catch (e) {}
    }
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /task/resolve
 * { ts, agent }
 */
app.post('/task/resolve', async (req, res) => {
  try {
    const { ts } = req.body;
    const all = await store.lRange('mesh:tasks:pending', 0, -1);
    for (let i = 0; i < all.length; i++) {
      try {
        const ev = JSON.parse(all[i]);
        if (ev.ts === ts) {
          ev.payload.status = 'resolved';
          await store.lRem('mesh:tasks:pending', 1, all[i]);
          await store.lPush('mesh:tasks:resolved', JSON.stringify(ev));
          return res.json({ ok: true });
        }
      } catch (e) {}
    }
    res.status(404).json({ error: 'task not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket 长连接（SSE - Server-Sent Events）─────────────────────────────
/**
 * GET /stream/:agent?channels=mesh:all,mesh:task
 * 使用 SSE，浏览器和脚本均可使用
 */
app.get('/stream/:agent', async (req, res) => {
  const { agent } = req.params;
  const channels = (req.query.channels || 'mesh:all').split(',');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 发送心跳
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30000);

  // 注册订阅者
  const sub = { socket: res, channels: new Set(channels) };
  subscribers.set(agent, sub);

  // 发送欢迎事件
  res.write(`event: connected\ndata: ${JSON.stringify({ agent, channels })}\n\n`);

  // 取消订阅时清理
  req.on('close', () => {
    clearInterval(heartbeat);
    subscribers.delete(agent);
    console.log(`[stream] ${agent} disconnected (${subscribers.size} active)`);
  });

  console.log(`[stream] ${agent} connected, channels=${channels.join(',')} (${subscribers.size} active)`);
});

// ─── 状态 ─────────────────────────────────────────────────────────────────
/**
 * GET /status
 */
app.get('/status', async (req, res) => {
  try {
    const tasks = await store.lLen('mesh:tasks:pending');
    const caps = await store.hLen('mesh:capabilities');
    res.json({
      ok: true,
      uptime: process.uptime(),
      subscribers: subscribers.size,
      channels: Object.keys(CHANNELS),
      pendingTasks: tasks,
      registeredAgents: caps,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 9527;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`⬡ Neural Mesh online → http://127.0.0.1:${PORT}`);
  console.log(`  Channels: ${Object.keys(CHANNELS).join(', ')}`);
});
