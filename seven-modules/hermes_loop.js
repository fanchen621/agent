// hermes_loop.js — 闭环学习
const fs = require('fs');
const path = require('path');
const { callClaude } = require('./claude_api');

const STORAGE_DIR = path.join(process.env.HOME || '/root', '.openclaw/storage');
const SKILLS_DIR = path.join(process.env.HOME || '/root', '.openclaw/skills');

class HermesLoop {
    // ── 任务执行前：主动查经验 ──────────────────────
    async beforeTask(taskDescription, agentId) {
        const memories = await this.recall(taskDescription, 8);
        const failures = await this.getRelevantFailures(taskDescription, 3);

        if (!memories.length && !failures.length) {
            return { hasContext: false, prompt: '' };
        }

        const prompt = `在执行此任务前，我主动查阅了历史经验：

${memories.length ? `相关成功经验（${memories.length}条）：
${memories.map((m, i) => `${i + 1}. ${(m.content || '').substring(0, 150)}`).join('\n')}` : ''}

${failures.length ? `已知失败教训（需要避开）：
${failures.map(f => `- ${f.lesson}`).join('\n')}` : ''}

基于以上信息，我的执行策略：`;

        return { hasContext: true, memories, failures, prompt };
    }

    // ── 任务完成后：自评估 + Skill生成 + 记忆更新 ──
    async afterTask(task, result, agentId) {
        let evaluation = { quality: 5, lessons: ['评估调用失败'] };

        try {
            const evalRaw = await callClaude({
                model: 'MiniMax-M2.7-highspeed',
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
任务描述: ${task.description || task}
执行方法: ${result.approach || JSON.stringify(result).substring(0, 200)}
结果: ${result.outcome || JSON.stringify(result).substring(0, 200)}
是否成功: ${result.success !== false}`
                }]
            });
            // 兼容 MiniMax 返回带 <think> 标记的原始文本，尝试提取 JSON
            let rawStr = typeof evalRaw === 'string' ? evalRaw : JSON.stringify(evalRaw);
            rawStr = rawStr.replace(/noop">.*?<\/think>/gs, '').trim();
            try {
                evaluation = JSON.parse(rawStr);
            } catch {
                // 尝试从文本中提取 {...} 块
                const jsonMatch = rawStr.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { evaluation = JSON.parse(jsonMatch[0]); } catch {}
                }
                if (!evaluation) {
                    console.warn('[Hermes] 评估JSON解析失败，使用默认值');
                    evaluation = { quality: 5, lessons: ['LLM响应解析失败，使用默认评分'] };
                }
            }
        } catch (e) {
            console.warn('[Hermes] 评估失败:', e.message);
        }

        // quality >= 7 → 自动生成 Skill
        if (evaluation.reusable_pattern && evaluation.quality >= 7) {
            await this.generateSkill({
                name: `${(task.type || 'general')}_${Date.now()}`,
                pattern: evaluation.reusable_pattern,
                source_task: task.description || String(task),
                quality: evaluation.quality,
                agent: agentId
            });
        }

        // 写入记忆
        await this.share(
            result.success !== false ? 'EXPERIENCE' : 'FAILURE_LESSON',
            {
                agent: agentId,
                task: task.description || String(task),
                approach: result.approach || '',
                outcome: result.outcome || String(result),
                evaluation,
                ts: Date.now()
            }
        );

        return evaluation;
    }

    // ── 自动生成 Skill 文件 ──────────────────────────
    async generateSkill(data) {
        const skillDir = path.join(SKILLS_DIR, `auto_${data.name}`);
        fs.mkdirSync(skillDir, { recursive: true });

        let skillContent;
        try {
            skillContent = await callClaude({
                model: 'MiniMax-M2.7-highspeed',
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
        } catch (e) {
            skillContent = `# auto_${data.name}

## 使用场景
自动生成，来源：${data.source_task}

## 核心步骤
${data.pattern}

## 注意事项
无
`;
        }

        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);
        console.log(`[Hermes] 自动生成 Skill: auto_${data.name}`);
    }

    // ── Neural Mesh 简易实现 ─────────────────────────
    async recall(query, limit = 5) {
        const meshFile = path.join(STORAGE_DIR, 'neural_mesh.json');
        try {
            const mesh = JSON.parse(fs.readFileSync(meshFile, 'utf8'));
            const q = query.toLowerCase();
            return mesh
                .filter(m => (m.content || '').toLowerCase().includes(q) ||
                             (m.task || '').toLowerCase().includes(q))
                .slice(-limit);
        } catch { return []; }
    }

    async getRelevantFailures(query, limit = 3) {
        const failFile = path.join(STORAGE_DIR, 'failures.json');
        try {
            const fails = JSON.parse(fs.readFileSync(failFile, 'utf8'));
            const q = query.toLowerCase();
            return fails
                .filter(f => (f.lesson || '').toLowerCase().includes(q))
                .slice(-limit);
        } catch { return []; }
    }

    async share(type, data) {
        const storageFile = path.join(STORAGE_DIR, type === 'EXPERIENCE' ? 'neural_mesh.json' : 'failures.json');
        let arr = [];
        try { arr = JSON.parse(fs.readFileSync(storageFile, 'utf8')); } catch {}
        arr.push(data);
        fs.writeFileSync(storageFile, JSON.stringify(arr.slice(-500), null, 2));
    }
}

module.exports = { HermesLoop };
