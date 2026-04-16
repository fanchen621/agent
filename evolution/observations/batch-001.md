# Evolution Observations — Batch 1

**Date**: 2026-04-16
**Methodology**: A-Evolve (Solve → Observe → Evolve → Gate → Reload)

## Observations

### OBS-1: MiniMax 输出格式与预期不符
- Error category: API兼容性 / 数据解析
- Root cause: MiniMax 返回带 <think> 标签的原始文本
- Frequency: 2/2次 (100%)
- Severity: blocking

### OBS-2: 硬编码模型名
- Error category: 配置错误
- Root cause: prompt 写死 claude-sonnet-4-5
- Frequency: 1次（已修复）
- Severity: blocking

### OBS-3: 自评机制水分
- Error category: 方法论
- Root cause: LLM 自己出题自己打分
- Frequency: 1次
- Severity: degrading

### OBS-4: SSH exec 测试不隔离
- Error category: 工程
- Root cause: 12s SSH timeout 导致 SIGKILL
- Frequency: 多次
- Severity: degrading

### OBS-5: 记忆来源归因错误
- Error category: 记忆系统
- Root cause: grep 后未 expand 上下文
- Frequency: 1次（已修复）
- Severity: degrading

## Evolved Mutations

| ID | Type | Status |
|----|------|--------|
| EVO-1 | Skill: minimax-response-parser | ✅ Applied |
| EVO-2 | Knowledge: SSH test isolation | ✅ Applied |
| EVO-3 | Prompt Patch: No hardcoded model name | ✅ Applied |

## Prompt Patches

**Patch for EVO-3:**
Append to system prompt:
> When calling any LLM via claude_api.js, always use model name from config — never hardcode 'claude-sonnet-4-5'. Default for MiniMax: 'MiniMax-M2.7-highspeed'.
