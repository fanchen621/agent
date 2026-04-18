# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## SSH

### ~/.ssh/config 已配置
```
Host *
  ServerAliveInterval 60
  ServerAliveCountMax 3
  TCPKeepAlive yes
  ControlMaster auto
  ControlPath /tmp/ssh-%r@%h-%p
  ControlPersist 600
```

### VPS 别名
```
Host vps
  HostName 23.142.188.254
  Port 30022
  User root
```
使用：`ssh vps`

### 腾讯云（主服务器）
- Host: 106.53.5.226
- SSH端口: 22
- 用户: ubuntu
- 密码: GqxfU2:wmwJKk3t
- DragonFlow路径: /root/DragonFlow
- 注意: root密码与ubuntu相同，需sudo提权

## VPS (Argosbx 犹他州)

- IP: 23.142.188.254
- 端口: 30022
- 用户: root
- 密码: AJRDHGpUVX2Z（已记录，不再询问）
- 用途: Skill Factory / Meta反思Agent / 科学上网节点

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.
