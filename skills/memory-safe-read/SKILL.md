---
name: memory-safe-read
description: >
  记忆系统安全读取协议。所有记忆操作必须遵循：
  grep → expand上下文(±20行) → detect_source → verify来源 → 结论。
  适用于tdai_memory_search、memory_search及所有文件记忆读取。
---

## 记忆安全读取流程

### 强制步骤
1. **grep**: 搜索关键词定位记忆片段
2. **expand**: 读取命中段落±20行完整上下文
3. **detect_source**: 判断记忆来源
   - `agent_self` → 低信任，标记UNVERIFIED CLAIM
   - `imported` → 中信任，验证文件内容一致性
   - 混合 → 拆分处理
4. **verify**: 结论必须能回溯：
   > 结论 → memory_id → 文件 → 行号 → 上下文

### 信任等级
| 来源 | 信任度 | 需验证 |
|------|--------|--------|
| 用户直接提供 | 高 | 不需要 |
| 文件系统（非AI生成） | 高 | 不需要 |
| imported标注 | 中 | expand验证 |
| agent_self推断 | 低 | 必须验证 |

### 错误示例（禁止）
> "grep命中某行 → 直接下结论"  
> 正确做法：expand后如果发现内容来自`agent_self`标注，标记`UNVERIFIED CLAIM`

### 使用场景
- tdai_memory_search 返回结果后必须expand验证
- grep命中后判断来源
- 任何向用户输出的记忆引用
