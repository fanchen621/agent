/**
 * Neural Mesh Dreaming - 气海老祖每日蒸馏
 * 每日凌晨 03:00 自动运行
 * 1. 召回昨日所有事件
 * 2. 提炼精华摘要
 * 3. 广播给全体分身
 *
 * 运行方式: node dreaming.js
 * 配合 cron: 0 3 * * * /opt/node18/bin/node /opt/neural-mesh/dreaming.js
 */

const MESH_URL = 'http://127.0.0.1:9527';
const AGENT_ID = '气海老祖';

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function recall(query, k = 50) {
  return fetchJSON(`${MESH_URL}/recall`, {
    method: 'POST',
    body: { query, k, date: 3 } // 最近3天
  });
}

async function distill(events) {
  // 简单的规则提炼（不依赖外部 LLM，保持轻量）
  const byType = { EXPERIENCE: [], FAILURE_LESSON: [], TASK_HANDOFF: [], EMOTION_ALERT: [] };
  for (const ev of events) {
    if (byType[ev.type]) byType[ev.type].push(ev);
  }

  const lessons = byType.FAILURE_LESSON.slice(0, 5).map(e => ({
    what: e.payload.what,
    why: e.payload.why,
    lesson: e.payload.lesson,
    from: e.from,
    ts: new Date(ev.ts).toISOString(),
  }));

  const experiences = byType.EXPERIENCE.slice(0, 5).map(e => ({
    task: e.payload.task,
    approach: e.payload.approach,
    result: e.payload.result,
    from: e.from,
    ts: new Date(ev.ts).toISOString(),
  }));

  const emotionAlerts = byType.EMOTION_ALERT.slice(0, 3).map(e => ({
    persona: e.payload.persona,
    urgency: e.payload.urgency,
    from: e.from,
    ts: new Date(ev.ts).toISOString(),
  }));

  return {
    date: new Date().toISOString().split('T')[0],
    lessons,
    experiences,
    emotionAlerts,
    summary: `昨日（${new Date().toISOString().split('T')[0]}）共 ${events.length} 条事件，`
      + `${byType.EXPERIENCE.length} 条经验，${byType.FAILURE_LESSON.length} 条教训，`
      + `${byType.TASK_HANDOFF.length} 次任务交接。`,
  };
}

async function dreaming() {
  console.log(`[${new Date().toISOString()}] 🌙 气海老祖开始 Dreaming...`);

  try {
    // 1. 召回近3天事件
    const { results } = await recall('五分身任务经验教训', 50);
    console.log(`[Dreaming] 召回 ${results.length} 条相关事件`);

    if (results.length === 0) {
      console.log('[Dreaming] 无事件，跳过');
      return;
    }

    // 2. 提炼精华
    const essence = await distill(results);
    console.log('[Dreaming] 提炼完成:', essence.summary);

    // 3. 广播给全体
    const publishRes = await fetchJSON(`${MESH_URL}/publish`, {
      method: 'POST',
      body: {
        from: AGENT_ID,
        type: 'DREAMING',
        payload: essence
      }
    });
    console.log(`[Dreaming] 已广播 → channel=${publishRes.channel} ts=${publishRes.ts}`);

    // 4. 同时发布为 EXPERIENCE 方便后续检索
    await fetchJSON(`${MESH_URL}/publish`, {
      method: 'POST',
      body: {
        from: AGENT_ID,
        type: 'EXPERIENCE',
        payload: {
          task: '气海老祖每日蒸馏',
          approach: '召回近3天事件 → 规则提炼 → 广播精华摘要',
          result: '成功，' + essence.summary,
          lesson: essence.summary
        }
      }
    });

    console.log(`[${new Date().toISOString()}] 🌙 Dreaming 完成`);
  } catch (err) {
    console.error('[Dreaming] 失败:', err.message);
    process.exit(1);
  }
}

dreaming();
