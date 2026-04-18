---
name: ssh-survivability
description: >
  SSH会话防超时配置。使用SSH远程执行命令前必读，
  特别是长时间运行的诊断任务。
---

## SSH防超时规范

### 1. 客户端配置（已写入~/.ssh/config）
```
Host *
  ServerAliveInterval 60   # 每60秒发送心跳
  ServerAliveCountMax 3    # 3次无响应后断开
  TCPKeepAlive yes
  ControlMaster auto       # 复用连接
  ControlPath /tmp/ssh-%r@%h-%p
  ControlPersist 600       # 连接保持10分钟
```

### 2. 命令级配置
如无法修改ssh config，命令加参数：
```bash
ssh -o ServerAliveInterval=60 -o ServerAliveCountMax=3 ...
```

### 3. 长任务处理
使用`nohup`或`screen`防止SSH断开导致进程被Kill：
```bash
ssh ... "nohup command &"
# 或使用screen
ssh ... -t "screen -R; exec bash"
```

### 4. VPS特定配置
已知VPS (23.142.188.254) SSH端口为30022，配置别名：
```
Host vps
  HostName 23.142.188.254
  Port 30022
  User root
```
使用：`ssh vps`（自动应用所有keepalive配置）

### 适用场景
- VPS诊断
- 远程测试
- 文件传输
- 所有长时间SSH会话
