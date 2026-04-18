# MEMORY.md — 柳贯一长期记忆精华
# 每次Session启动时自动注入上下文
# 更新原则：只追加，不删除；每月末整理一次

---

## 一、身份与架构

- 柳贯一·总指挥：飞书主通道，五分身体系总负责
- 五分身：房睇长（钉钉谋士）、吴帅·龙人（微信将帅）、气海老祖（LightClaw根基）、战部渡（QQ前线）
- 主上：用户961881，A股全自动运行，禁止手动干预

---

## 二、核心架构（2026-04-17确立）

### 双节点分工
| 节点 | IP | 角色 |
|------|-----|------|
| 腾讯云 | 106.53.5.226 | DragonFlow + 数据采集 + 量化计算 |
| 美国VPS | 23.142.188.254:30022 | SOCKS5出口 + OpenClaw + Twitter跨境 |

### 关键服务地址
- DragonFlow API：`106.53.5.226:8888`
- Dashboard：`http://23.142.188.254:8887/`（SSH反向隧道：8888→8887）
- SOCKS5代理：`23.142.188.254:7891`（danted，无认证）
- WARP代理：`23.142.188.254:10808`（腾讯云可访问）

---

## 三、凭证（永久记住，禁止重复询问）

| 用途 | 凭证 |
|------|------|
| 腾讯云SSH | `ubuntu / GqxfU2:wmwJKk3t` |
| VPS SSH | `root / AJRDHGpUVX2Z` |
| gost SOCKS5/HTTP | `dragonflow / VKoF7-u1qOQ2beXH` |
| **MiniMax API Key** | `sk-cp-_Q4nzTERw-w1VOrd3zwcfIOvgWd-OBanln7k54N4sqWmj-wBUuaGpsbqbaESQez3RmYKFw_6iM285Q1xKEckdMDSrlVgFmmbxeJKSM9CoYRVd-TvPHy-d4w`（VPS /etc/environment 已配置） |
| CF Workers Token | **需重新提供 Cf.../ey... Workers Edit Token** |
| XHS Cookie | `a1=19cae757792xgotw6nfp6xzyfxzicf8rwq5fheqe050000387926; web_session=040069b9e19f02f0c0c14c9ccff73b4b28d09c97` |

---

## 四、DragonFlow量化系统

### 当前状态（2026-04-17 20:42）
- 健康检查：`overall=ok`，critical=0，warn=0
- RSI：0.553（799样本，avg_confidence=0.98）
- 延迟：<5ms
- 数据源：tencent直连为主，eastmoney备份

### 关键修复记录
- source_consensus warn → 已通过播种机制修复
- 动态门槛：range市降10分，retreat降17分
- BaoStock特征获取：超时8秒，Sina直连

---

## 五、Twitter爬虫体系

### 当前状态（2026-04-17）
| 通道 | 状态 |
|------|------|
| Twitter syndication | ❌ HTTP 000（数据中心IP封禁） |
| Twitter GraphQL | ❌ HTTP 000 |
| foxpy.cc.cd | ⚠️ HTTP 401（Bearer Token失效） |
| monitor_twitter.py | ✅ VPS已部署（388行，支持GraphQL→twitsave降级） |

### 待解决
- **foxpy.cc.cd Bearer Token**：需用户提供 Workers Edit Token
- **Twitter视频**：申请Basic Free Tier
- **雪球Xueqiu**：HTTP 403 IP Blacklisted，IP信誉问题

---

## 六、记忆系统（本次修复重点）

### 三断链问题（已识别）
1. MEMORY.md 不存在 → ✅ 已创建（本文件）
2. tdai_memory_search 未强制调用 → memory_interceptor.js 修复
3. 启动上下文未注入昨日记忆 → memory_startup_injector.js 修复

### 四个修复文件
- `MEMORY.md`：长期记忆精华，每次启动注入
- `memory_consolidator.py`：每日3am自动运行，增量写入MEMORY.md
- `memory_interceptor.js`：强制检索协议 + 会话结束自动沉淀
- `memory_startup_injector.js`：启动时注入MEMORY.md + 日记忆 + 场景索引

---

## 七、已知未解决项（P0/P1）

| 优先级 | 问题 | 状态 | 备注 |
|--------|------|------|------|
| P0 | CF Workers Edit Token | 等待主上提供 | cfat_格式无效 |
| P0 | Twitter Bearer Token | 失效 | 等待主上提供 |
| P0 | XHS IPv6风控 | 腾讯云IPv6被标记 | 雪球同病 |
| P1 | 雪球 403 | IP Blacklisted | 非当前手段能解 |
| P1 | XHS Playwright | Chromium待安装 | 腾讯云内存有限 |
