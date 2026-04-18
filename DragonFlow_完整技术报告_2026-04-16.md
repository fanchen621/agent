# DragonFlow 完整技术报告
**日期：2026-04-16 17:59**
**Dashboard：http://23.142.188.254:8888**

---

## 一、深刻反思

### 今日最大失误：Python 环境分裂

```
问题链条：
VPS 原生 Python 3.6.8
        ↓ 编译 Python 3.9.18 → /opt/python39/
        ↓ 用 /opt/python39/bin/python3 运行 main.py
        ↓ 所有 pip install 默认装到 Python 3.6（系统环境）
        ↓ Python 3.9 运行时缺少：uvicorn / websockets / apscheduler / aiohttp / rich
        ↓ 逐一补装后，websockets 仍装错环境
        ↓ WebSocket 始终 404，导致浏览器"连接中"
```

**根本原因：没有在 Python 3.9 环境下做 venv，直接混用两个 Python 版本和两套 pip。**

---

## 二、完整运行日志（09:41 - 10:00）

```
09:41:43 DragonFlow 数据库初始化完成
09:41:43 [router] eastmoney_clist ❌ eastmoney_ulist ❌ sina_vip ❌ tencent_quote ❌ sina_hq ❌
09:41:44 [router] 启动探活完成
09:41:44 AutoPilot started
09:41:45 APScheduler 已启动
09:41:45 DragonFlow Dashboard 启动完成
09:41:47 [弹性] 指数源切换: tencent -> sina
09:41:56 [舆情] 市场RSI=0.73 [偏乐观] 修正0.8 样本72

⚠️ 期间出现大量：
   "No supported WebSocket library detected"
   （uvicorn 启动了，但 websockets 装在 Python 3.6 里，Python 3.9 读不到）

09:44:55 [realtime_watch] 0 live / 0 evolution candidates from 174 symbols in 179202ms
09:44:55 [evolution_mode] created cycle 2 2026-04-16->2026-04-17
09:44:55 ⚠️ 自愈 critical (严重1 警告1)
09:44:55 [自愈] 所有数据源健康状态已重置

09:45:22 ⚠️ 自愈 critical (严重1 警告1)
09:45:28 [舆情] 市场RSI=0.68 [中性] 样本72

09:46:18 重启（修复 Python 环境后）
09:46:19 AutoPilot started
09:46:20 Dashboard 启动完成
09:46:22 [弹性] 指数源切换: tencent -> sina
09:46:33 [舆情] 市场RSI=0.68 [中性] 样本72

09:47:41 [ws] connected clients=1  ← 测试连接
09:47:46 [ws] disconnected clients=0

09:48:46 ⚠️ 自愈 warn (严重0 警告2)
09:48:47 [ws] connected clients=1  ← 浏览器连接
09:49:04 ⚠️ [弹性] 所有指数源失败，使用缓存
09:49:12 ⚠️ [弹性] 所有指数源失败，使用缓存
09:49:17 ⚠️ 自愈 critical (严重1 警告1)
09:49:18 [ws] disconnected clients=0

09:50:07 [quick_scan] zone=neutral 扫描完成: 0 只候选
09:50:33 [realtime_watch] 0 live / 0 evolution from 174 symbols in 200596ms
09:50:33 ⚠️ 自愈 critical (严重1 警告1)

09:52:10 [realtime_watch] 0 live / 0 evolution from 301 symbols in 89464ms
09:53:47 [realtime_watch] 0 live / 0 evolution from 301 symbols in 89047ms
09:53:48 ⚠️ 自愈 critical (严重1 警告2)

09:55:09 ⚠️ [quick_scan] 新浪涨幅榜 curl 超时（curl subprocess 无代理）
09:55:45 [realtime_watch] 0 live / 0 evolution from 301 symbols in 111359ms
09:57:44 [realtime_watch] 0 live / 0 evolution from 301 symbols in 112643ms
09:57:51 [舆情] 市场RSI=0.71 [偏乐观] 样本72

10:00:00 ⚠️ 自愈 critical (严重2 警告1)
10:00:00 [自愈] 本小时修复次数已达上限，跳过
10:00:03 [quick_scan] zone=neutral 扫描完成: 0 只候选
```

---

## 三、完整技术难点清单

### 🔴🔴 致命（已定位，待修复）

**1. `get_stock_history()` 三源变两源，BaoStock 从未作为备选**
- 当前逻辑：腾讯 → 网易 → None
- 网易 K线返回 502 → 函数直接 None
- **BaoStock 从未被当作历史数据源**，只用来补充换手率字段
- 影响：`compute_stock_features` 的 `ma5/ma10/ma20` 指标为空
- 修复：在腾讯/网易失败后加 BaoStock 作为第三备选

**2. 探活端点误报（一直 critical）**
- `probe_validate_endpoints()` 用 `urllib.urlopen` 直连，无代理
- VPS 直连 EastMoney/Sina 被拒 → 全部 ❌
- 但实际数据请求走 `proxied_get`（有代理）→ 正常
- 探活结果不影响数据流，但健康检查一直报 critical
- 修复：探活应走和数据请求相同的代理路径

**3. `quick_scan` curl subprocess 无代理（已修复但不稳定）**
- 之前新浪涨幅榜用 curl subprocess，无代理，VPS 直连超时
- 刚改为 `urllib.request.urlopen`，但不稳定（09:55 仍超时）
- 修复：统一走 `proxied_get`

---

### 🔴 功能性（影响系统表现）

**4. 候选扫描结果为 0（持续问题）**
- 当日涨停股几乎全是 300/688（主板禁止买）
- 符合用户硬约束，但系统缺乏有效候选来源
- 当前：301 symbol，0 通过评分，89-200秒/次
- 修复：需引入更多主板候选股源（如涨幅>3%的主板股）

**5. 进化胜率 32%，亏损 -4599 元**
- cycle 2 phase: buy_day，0 开仓
- exploration_rate: 0.62 过高
- 已完成：profile 读取闭环修复

**6. 舆情爬取 54秒阻塞**
- 雪球/同花顺/东财市场 三源超时后才到股吧
- 并发优化已完成（max_workers=4），但仍偶发超时

---

### 🟡 架构问题（不影响核心功能）

**7. proxy_engine 探活设计缺陷**
- 探活直连，数据请求走代理——策略不一致
- 应该区分"探活失败"和"数据获取失败"含义

**8. 腾讯批量接口刚修复，未经实战**
- `_fetch_stocks_tencent_async` 依赖 aiohttp，今天才装
- 尚未在真实交易环境中验证并发性能

**9. `data_router.fetch_consensus()` 从未被调用**
- 代码实现存在，但系统从未 import 使用

**10. 知识库评分是半成品**
- `_knowledge_factor()` 已实现，但知识库存量未知
- 知识库为空时全为 0，向后兼容

---

## 四、今日已修复清单（确认）

| 修复项 | 状态 | 说明 |
|--------|------|------|
| Python 3.9 环境安装 | ✅ | 编译 3.9.18 到 /opt/python39 |
| websockets 包 | ✅ | 装到 Python 3.9 |
| aiohttp 包 | ✅ | 装到 Python 3.9 |
| uvicorn/apscheduler/rich | ✅ | 装到 Python 3.9 |
| 双"系统健康"标签 | ✅ | dashboard.html 第三卡标题改为"健康监控" |
| WebSocket 心跳 10s | ✅ | _tick_idle 60s→10s，启动立即广播 |
| 探活 URL 走 proxied_get | ✅ | proxy_engine.py 修复 |
| BaoStock 换手率 merge | ✅ | _supplement_turnover_from_baostock |
| 进化 profile 读取闭环 | ✅ | rank_candidates 传入 evolution_profile |
| 舆情多源并行 | ✅ | max_workers=4 |
| 涨跌分布 12 桶柱状图 | ✅ | dashboard.html |
| 涨停股拦截 | ✅ | trade_rules.py |
| systemd 部署 | ✅ | dragonflow.service |

---

## 五、当前系统状态

```
scheduler_running: true
autopilot_running: true
web_running: true
current_zone: risk
current_emotion: 冰点（偏乐观修正后）
db_size_mb: 14.38
live_candidate_count: 0
evolution_cycle: 2
持仓: 0（空仓）
候选: 0
```

**核心数据流：**
- 指数：腾讯 API ✅（0.06秒）
- 个股：Sina（通过代理）✅
- BaoStock：正常 ✅
- 舆情：RSI=0.71 偏乐观，72样本 ✅
- 进化：profile 加载 ✅

**关键待修复：**
1. `get_stock_history` 加 BaoStock 第三备选
2. 探活逻辑统一走 proxied_get
3. `quick_scan` 改用 `proxied_get` 彻底替换 curl subprocess
