---
name: minimax-response-parser
description: >
  正确解析 MiniMax LLM 输出，移除 <think> 标签并提取纯 JSON。
  Use when calling MiniMax API and response contains XML-like tags
  or when JSON.parse fails on LLM output.
---

## 使用场景
- MiniMax API 返回包含 <think>...</think> 标签时
- JSON.parse 失败且报错 "Unexpected token <"
- 需要从 LLM 原始输出中提取结构化 JSON

## 核心步骤

```javascript
function parseMiniMaxResponse(raw) {
    // 1. 转字符串
    let str = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // 2. 移除 <think>...</think> XML标签
    str = str.replace(/<[^>]+>/g, '').trim();
    // 3. 尝试直接解析
    try { return JSON.parse(str); } catch {}
    // 4. 提取 {...} JSON块
    const match = str.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch {} }
    // 5. 全部失败 → fallback
    console.warn('[Parser] MiniMax 响应解析失败');
    return null;
}
```

## 触发条件
当 JSON.parse 报错 "Unexpected token <" 时自动激活
