// claude_api.js — LLM API 调用封装（stub实现）
// 在真实环境中替换为实际的 API 调用

async function callClaude({ model = 'claude-sonnet-4-5', max_tokens = 1000, messages = [] }) {
    // 读取 API key
    const fs = require('fs');
    const path = require('path');
    let apiKey = process.env.ANTHROPIC_API_KEY || '';
    let baseURL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';

    try {
        const cfgPath = path.join(process.env.HOME || '/root', '.openclaw/openclaw.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        // 支持从配置中读取凭证
        if (cfg.llm?.apiKey) apiKey = cfg.llm.apiKey;
        if (cfg.llm?.baseURL) baseURL = cfg.llm.baseURL;
    } catch {}

    if (!apiKey) {
        console.warn('[claude_api] 未配置 ANTHROPIC_API_KEY，返回占位响应');
        return JSON.stringify({
            goals: ['API未配置'],
            decisions: [],
            done: [],
            todo: [],
            tech_details: {},
            context_note: 'claude_api stub模式运行'
        });
    }

    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage?.content || '';

    try {
        const response = await require('node-fetch')(`${baseURL}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model,
                max_tokens,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[claude_api] API错误 ${response.status}: ${errText.substring(0, 200)}`);
            return null;
        }

        const data = await response.json();
        const content = data.content?.[0]?.text || '';
        
        // 尝试解析 JSON
        try {
            return JSON.parse(content);
        } catch {
            return content;
        }
    } catch (e) {
        console.error('[claude_api] 调用失败:', e.message);
        return null;
    }
}

module.exports = { callClaude };
