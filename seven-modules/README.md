# 七大模块设计逻辑

## 模块一：自启动自愈

**文件名**: `autoself_healer.py`

**设计逻辑**：
每次崩溃写入错误历史库，下次启动前先读历史，自动决定用哪种安全模式启动，而不是无脑重启。

**核心数据结构**：
```python
error_history = {
    "crash_type": "memory|process|network|signal",
    "count": 5,
    "last_occurred": "2026-04-16T13:00:00Z",
    "safe_mode": "compressed|minimal|recovery"
}
```

**决策树**：
- 同类型崩溃 ≥3次 → 提高一级安全模式
- 间隔 <5分钟连续崩溃 → 降级到 minimal 模式
- 跨类型崩溃 → 全面检测后启动

---

## 模块二：守护看门狗

**文件名**: `guardian_watchdog.py`

**设计逻辑**：
三维检测，检测到立即强杀，同时写回错误历史库。

| 维度 | 阈值 | 动作 |
|------|------|------|
| 路由死循环 | 5秒内同路径8次 | 强杀 |
| Stream挂死 | 15秒无新chunk | 强杀 |
| 心跳丢失 | 30秒无响应 | 强杀 |

---

## 模块三：上下文压缩

**文件名**: `context_compressor.py`

**触发条件**：上下文使用率 ≥ 60%

**执行流程**：
1. 提炼结构化摘要：`goals / decisions / done / todo / tech_details`
2. 写入 Neural Mesh 永久留存
3. 完整历史替换为"精华 + 最近5条"
4. 对话无缝继续

---

## 模块四：任务调度监控

**文件名**: `task_scheduler_monitor.py`

**设计逻辑**：
用 `wrap()` 包装所有 cron 任务。

```python
def wrap(task_fn):
    # 1. 心跳协议：任务必须定期调用 heartbeat 证明自己还活着
    # 2. 完成条件验证：verify() 函数确认任务真正完成
    # 3. 自动重试：失败自动重试，带退避
    # 4. 关键任务不完成不算数
```

---

## 模块五：Bug扫描报告

**文件名**: `bug_scanner.py`

**四个扫描维度**：

| 维度 | 内容 |
|------|------|
| 代码静态分析 | AST扫描 / 危险函数检测 |
| 运行时内存/进程 | 内存泄漏 / 僵尸进程 |
| 配置合规性 | 凭证暴露 / 端口开放 |
| 版本兼容矩阵 | 依赖版本 × API兼容性 |

**输出**：P0/P1/P2 优先级修复意见，P0 立即通知。

---

## 模块六：Hermes学习环

**文件名**: `hermes_loop.py`

**设计逻辑**：

```
beforeTask:
  - 强制查历史经验
  - 强制自评估

afterTask:
  - 质量评分
  - quality ≥ 7分 → 自动生成 SKILL.md → 写入 skills 目录
  - 下次重启自动加载
```

---

## 模块七：思考标准

**文件名**: `thinking_standards.py`

**设计逻辑**：
作为系统提示词注入每个分身，从制度层面强制执行"先查经验"的行为。

```
before_task = "先查经验 → 再执行 → 后自评"
```

---

## 集成关系

```
autoself_healer ←→ error_history ←→ guardian_watchdog
                                         ↓
                              context_compressor ← Neural Mesh
                                         ↓
                          task_scheduler_monitor
                                         ↓
                              bug_scanner ← hermes_loop
                                         ↓
                           thinking_standards → 分身注入
```
