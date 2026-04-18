// hermes_loop_v2.js — 优化版
// 修复三个根因：
// 1. reusable_pattern 从一句话变为结构化详细步骤
// 2. generateSkill prompt 注入真实 SKILL.md 格式 + 完整上下文
// 3. afterTask 传入完整执行轨迹，不让 LLM 凭空猜

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────
// 修复一：afterTask — 提取结构化 pattern，不再是一句话
// ─────────────────────────────────────────────────
async function afterTask(task, result, agentId, callLLM) {
  const mesh = require('./neural_mesh_client');

  // 把完整执行轨迹打包传入评估（不让 LLM 凭空猜）
  const evalPrompt = `你是一个严格的质量评审员。对以下任务执行进行评估。

【任务描述】
${task.description}

【执行步骤（按顺序）】
${(result.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

【使用的工具/方法】
${(result.tools || []).join(', ') || '无记录'}

【最终结果】
${result.outcome}

【是否成功】${result.success ? '是' : '否'}

请输出严格的 JSON，不要有任何解释文字，只输出 JSON：
{
  "quality": 评分0-10（必须基于实际步骤质量，不能虚高）,
  "efficiency": 评分0-10,
  "used_experience": true或false,
  "avoided_pitfalls": true或false,
  "better_approach": "如果有更优方案，用1-2句具体描述；没有则填null",
  "reusable_pattern": {
    "applicable_scenario": "这个模式适用于什么场景（一句话，具体）",
    "prerequisite": ["前提条件1", "前提条件2"],
    "steps": [
      {"step": 1, "action": "具体做什么", "command_or_code": "如果有命令/代码就填，否则填null", "expected_output": "期望看到什么"},
      {"step": 2, "action": "...", "command_or_code": "...", "expected_output": "..."}
    ],
    "common_pitfalls": ["容易踩的坑1", "容易踩的坑2"],
    "success_criteria": "怎么判断这个模式执行成功了"
  },
  "lessons": ["这次学到的具体教训"]
}

注意：reusable_pattern 必须足够详细，让下一个不知道背景的人也能直接按步骤执行。
如果步骤不足以支撑生成完整文档，quality 应低于 7，reusable_pattern 填 null。`;

  let evaluation;
  try {
    const raw = await callLLM(evalPrompt, 1500);
    // 清理 LLM 可能输出的 markdown 代码块
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    evaluation  = JSON.parse(clean);
  } catch (e) {
    console.warn('[Hermes] 评估解析失败:', e.message);
    evaluation = { quality: 5, lessons: ['评估解析失败'] };
  }

  // quality >= 7 且 pattern 是结构化对象（不是空字符串/null）才生成 Skill
  const pattern = evaluation.reusable_pattern;
  const shouldGenerate = evaluation.quality >= 7
    && pattern
    && typeof pattern === 'object'
    && Array.isArray(pattern.steps)
    && pattern.steps.length >= 2;  // 至少2个步骤才算有价值

  if (shouldGenerate) {
    await generateSkill({
      name:        `${(task.type || 'general').replace(/\s+/g, '_')}_${Date.now()}`,
      pattern,
      source_task: task.description,
      quality:     evaluation.quality,
      agent:       agentId,
      full_result: result   // 完整执行结果一并传入
    }, callLLM);
  } else {
    console.log(`[Hermes] quality=${evaluation.quality}，pattern不足，跳过 Skill 生成`);
  }

  // 无论如何都写记忆
  try {
    await mesh.share(
      result.success ? 'EXPERIENCE' : 'FAILURE_LESSON',
      {
        agent:      agentId,
        task:       task.description,
        approach:   result.approach || result.steps?.join(' → '),
        outcome:    result.outcome,
        evaluation,
        ts:         Date.now()
      }
    );
  } catch (e) {
    console.warn('[Hermes] mesh 写入失败:', e.message);
  }

  return evaluation;
}

// ─────────────────────────────────────────────────
// 修复二：generateSkill — 注入格式模板 + 完整上下文
// ─────────────────────────────────────────────────
async function generateSkill(data, callLLM) {
  const { name, pattern, source_task, quality, agent, full_result } = data;

  // 把结构化 pattern 序列化为清晰的步骤描述，传给 LLM
  const stepsText = pattern.steps
    .map(s => {
      let line = `${s.step}. ${s.action}`;
      if (s.command_or_code) line += `\n   \`\`\`\n   ${s.command_or_code}\n   \`\`\``;
      if (s.expected_output)  line += `\n   期望结果：${s.expected_output}`;
      return line;
    })
    .join('\n\n');

  // 修复点：提供真实的 SKILL.md 格式范例 + 完整上下文
  const prompt = `你是 OpenClaw 技能文档专家。请根据以下信息生成一份完整可用的 SKILL.md。

【参考格式】下面是一份真实可用的 SKILL.md 样例（你必须按这个格式输出）：
---
# 技能名称
## 适用场景
当需要[具体场景]时使用此技能。

## 前提条件
- 前提1
- 前提2

## 执行步骤

### 第1步：[步骤名称]
[具体说明]
\`\`\`bash
# 具体命令（可直接复制执行）
命令内容
\`\`\`
期望结果：[描述]

### 第2步：[步骤名称]
[具体说明]
\`\`\`javascript
// 代码示例
代码内容
\`\`\`
期望结果：[描述]

## 常见问题 & 解决方案
| 问题 | 原因 | 解决方法 |
|------|------|---------|
| 问题1 | 原因 | 解决 |

## 成功判断标准
[具体描述怎么确认这个技能执行成功了]

## 注意事项
- 注意1
- 注意2
---

【现在请为以下内容生成 SKILL.md】

来源任务：${source_task}
执行者：${agent}
质量评分：${quality}/10
适用场景：${pattern.applicable_scenario}

前提条件：
${(pattern.prerequisite || []).map(p => `- ${p}`).join('\n')}

已验证的执行步骤：
${stepsText}

已知坑（必须在文档中体现）：
${(pattern.common_pitfalls || []).map(p => `- ${p}`).join('\n')}

成功判断标准：${pattern.success_criteria}

${full_result?.tools?.length ? `本次用到的工具：${full_result.tools.join(', ')}` : ''}

要求：
1. 直接输出 Markdown 文档，不要加任何解释
2. 所有 [...] 占位符必须用真实内容替换，不能有任何占位符
3. 命令和代码必须可以直接复制执行，不能是伪代码
4. 问题排查表格至少填3行真实常见问题
5. 总字数不少于 600 字`;

  let skillContent;
  try {
    skillContent = await callLLM(prompt, 2000);
    // 如果 LLM 还是输出了占位符，记录警告但仍然保存
    if (skillContent.includes('[...') || skillContent.includes('[描述]')) {
      console.warn('[Hermes] Skill 内容中仍有占位符，质量待改善');
    }
  } catch (e) {
    console.error('[Hermes] generateSkill LLM 调用失败:', e.message);
    return;
  }

  // 写入文件
  const skillDir = path.join(process.env.HOME, `.openclaw/skills/auto_${name}`);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent, 'utf8');

  // 同时写一份元数据，方便排查
  fs.writeFileSync(path.join(skillDir, 'META.json'), JSON.stringify({
    source_task, quality, agent,
    pattern_summary: pattern.applicable_scenario,
    steps_count: pattern.steps.length,
    generated_at: new Date().toISOString()
  }, null, 2), 'utf8');

  console.log(`[Hermes] Skill 已生成: auto_${name} (${skillContent.length} 字节)`);
}

// ─────────────────────────────────────────────────
// 修复三：beforeTask — 同步返回结构化 pattern 用于展示
// ─────────────────────────────────────────────────
async function beforeTask(taskDescription, agentId) {
  let mesh;
  try { mesh = require('./neural_mesh_client'); } catch { return { hasContext: false }; }

  const memories = await mesh.recall(taskDescription, 6).catch(() => []);

  // 只展示有具体步骤的高质量记忆
  const goodMemories = memories.filter(m => {
    const content = typeof m.content === 'string'
      ? JSON.parse(m.content || '{}')
      : m.content || {};
    return content.evaluation?.quality >= 7;
  });

  if (!goodMemories.length) return { hasContext: false };

  const prompt = `我在执行以下任务前，主动查到了 ${goodMemories.length} 条历史经验：

${goodMemories.map((m, i) => {
  const c = typeof m.content === 'string' ? JSON.parse(m.content || '{}') : m.content || {};
  return `经验 ${i + 1}（质量 ${c.evaluation?.quality}/10）：
- 任务类型：${c.task?.substring(0, 80)}
- 执行方法：${c.approach?.substring(0, 120)}
- 结果：${c.outcome?.substring(0, 80)}
- 教训：${(c.evaluation?.lessons || []).join('；')}`;
}).join('\n\n')}

当前任务：${taskDescription}

基于以上经验，我将采用以下策略（不重蹈覆辙，直接利用已有经验）：`;

  return { hasContext: true, memories: goodMemories, prompt };
}

module.exports = { beforeTask, afterTask, generateSkill };
