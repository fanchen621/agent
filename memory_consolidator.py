#!/usr/bin/env python3
"""
memory_consolidator.py
============================================================
每日凌晨3点自动运行：
1. 扫描当天所有对话记录
2. 提炼关键技术事实、决策、问题
3. 更新 MEMORY.md（追加，永不删除）
4. 更新 scene_blocks（刷新热度）
5. 写入 Neural Mesh

首次运行：python3 memory_consolidator.py --init
  → 从现有 memory/YYYY-MM-DD.md 反推历史，生成初始 MEMORY.md

每日运行：由 crontab 触发
  0 3 * * * python3 ~/.openclaw/scripts/memory_consolidator.py >> ~/.openclaw/logs/memory.log 2>&1
"""

import os, json, time, re
from datetime import datetime, timedelta
from pathlib import Path

# ── 路径配置 ──────────────────────────────────────────────────
HOME         = Path.home()
OC_BASE      = HOME / '.openclaw'
AGENT_DIR    = OC_BASE / 'agents/liuguanyi/agent'
MEMORY_DIR   = AGENT_DIR / 'memory'
MEMORY_MD    = AGENT_DIR / 'MEMORY.md'
TDAI_DIR     = OC_BASE / 'memory-tdai'
RECORDS_DIR  = TDAI_DIR / 'records'
CONV_DIR     = TDAI_DIR / 'conversations'
SCENE_DIR    = TDAI_DIR / 'scene_blocks'
MESH_URL     = 'http://localhost:9527'
MINIMAX_URL  = os.getenv('MINIMAX_API_URL', 'https://api.minimaxi.chat/v1/chat/completions')
MINIMAX_KEY  = os.getenv('MINIMAX_API_KEY', '')

# ── LLM 调用 ──────────────────────────────────────────────────
def call_llm(prompt: str, max_tokens: int = 1200) -> str:
    import urllib.request
    body = json.dumps({
        'model':       'MiniMax-Text-01',
        'messages':    [{'role': 'user', 'content': prompt}],
        'max_tokens':  max_tokens,
        'temperature': 0.1,
    }).encode()
    req = urllib.request.Request(
        MINIMAX_URL,
        data=body,
        headers={'Authorization': f'Bearer {MINIMAX_KEY}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            return data['choices'][0]['message']['content']
    except Exception as e:
        print(f'[LLM] 调用失败: {e}')
        return ''

# ── 读取当天对话记录 ──────────────────────────────────────────
def load_today_records(date_str: str = None) -> str:
    if not date_str:
        date_str = datetime.now().strftime('%Y-%m-%d')
    
    texts = []
    
    # 1. 从 records/YYYY-MM-DD.jsonl 读取
    record_file = RECORDS_DIR / f'{date_str}.jsonl'
    if record_file.exists():
        for line in record_file.read_text(encoding='utf-8').splitlines():
            try:
                r = json.loads(line)
                content = r.get('content') or r.get('text') or r.get('message', '')
                if content and len(content) > 20:
                    texts.append(content[:500])
            except: pass

    # 2. 从 memory/YYYY-MM-DD.md 读取
    daily_md = MEMORY_DIR / f'{date_str}.md'
    if daily_md.exists():
        texts.append(daily_md.read_text(encoding='utf-8')[:3000])

    return '\n\n---\n\n'.join(texts[:30])  # 最多30条

# ── 核心提炼：从今日记录提取关键信息 ─────────────────────────
def distill_today(date_str: str) -> dict:
    raw = load_today_records(date_str)
    if not raw.strip():
        print(f'[Consolidator] {date_str} 无记录，跳过')
        return {}

    prompt = f"""你是 OpenClaw 记忆系统的整理员。请从以下 {date_str} 的对话记录中提炼关键信息。

严格按 JSON 输出，不要有任何解释文字：
{{
  "solved_problems": [
    {{"title": "简短标题", "root_cause": "根本原因", "fix": "修复方案", "verified": true/false}}
  ],
  "technical_facts": [
    "已确认的技术事实（路径/配置/API等）"
  ],
  "new_issues": [
    {{"issue": "问题描述", "priority": "P0/P1/P2/P3", "status": "待解决/已部分解决"}}
  ],
  "important_decisions": [
    "重要架构或技术决策"
  ],
  "key_credentials_types": [
    "新增了什么类型的凭证（只记类型，不记值）"
  ],
  "summary": "今天整体进展的一句话总结"
}}

注意：
- 只提取真正重要的、影响后续工作的信息
- solved_problems 只写今天确认解决的问题
- 如果没有则对应字段填空数组 []

---今日记录---
{raw[:4000]}"""

    raw_response = call_llm(prompt, 1000)
    clean = raw_response.replace('```json', '').replace('```', '').strip()
    try:
        return json.loads(clean)
    except:
        print(f'[Consolidator] JSON解析失败，原始输出: {raw_response[:200]}')
        return {}

# ── 更新 MEMORY.md ────────────────────────────────────────────
def update_memory_md(date_str: str, distilled: dict):
    if not distilled:
        return

    if not MEMORY_MD.exists():
        print(f'[Consolidator] MEMORY.md 不存在，请先运行 --init')
        return

    content    = MEMORY_MD.read_text(encoding='utf-8')
    new_blocks = []

    # 追加已解决问题
    for p in distilled.get('solved_problems', []):
        block = (
            f"\n### [{date_str}] {p['title']}\n"
            f"- **根因**：{p.get('root_cause', '未记录')}\n"
            f"- **修复**：{p.get('fix', '未记录')}\n"
            f"- **状态**：{'✅ 已验证' if p.get('verified') else '⚠️ 未验证'}\n"
        )
        new_blocks.append(block)

    # 追加技术事实
    facts = distilled.get('technical_facts', [])
    if facts:
        block  = f"\n### [{date_str}] 技术事实\n"
        block += '\n'.join(f'- {f}' for f in facts) + '\n'
        new_blocks.append(block)

    # 更新未解决问题表格（追加新问题行）
    for issue in distilled.get('new_issues', []):
        row = f'| - | {issue["issue"]} | {issue["priority"]} | {issue.get("status", "新发现")} |'
        # 在表格区域末尾插入
        content = content.replace(
            '---\n\n## ═══ 自动更新日志 ═══',
            f'{row}\n\n---\n\n## ═══ 自动更新日志 ═══'
        )

    # 追加到自动更新日志
    log_entry  = f'\n<!-- [{date_str}] {distilled.get("summary", "")} -->\n'
    log_entry += '\n'.join(new_blocks)

    content += log_entry
    MEMORY_MD.write_text(content, encoding='utf-8')
    print(f'[Consolidator] MEMORY.md 已更新，追加了 {len(new_blocks)} 个新块')

# ── 更新 scene_blocks ─────────────────────────────────────────
def refresh_scene_blocks(date_str: str, distilled: dict):
    """更新场景块热度，添加新场景"""
    if not SCENE_DIR.exists():
        return

    today_summary = distilled.get('summary', '')
    if not today_summary:
        return

    # 更新现有场景块的热度
    for scene_file in SCENE_DIR.glob('*.json'):
        try:
            data  = json.loads(scene_file.read_text(encoding='utf-8'))
            title = data.get('title', '')
            # 如果今天的记录与场景相关，增加热度
            if any(kw in today_summary for kw in title.split()[:3]):
                data['heat']        = data.get('heat', 0) + 5
                data['last_active'] = date_str
                scene_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        except: pass

    print(f'[Consolidator] scene_blocks 已刷新')

# ── 写入 Neural Mesh ──────────────────────────────────────────
def push_to_mesh(date_str: str, distilled: dict):
    try:
        import urllib.request
        body = json.dumps({
            'from':    'qihaizuzu',  # 气海老祖负责记忆管理
            'type':    'DREAMING',
            'payload': {
                'date':      date_str,
                'distilled': distilled,
            }
        }).encode()
        req = urllib.request.Request(
            f'{MESH_URL}/publish',
            data=body,
            headers={'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f'[Consolidator] Neural Mesh 写入成功')
    except Exception as e:
        print(f'[Consolidator] Neural Mesh 写入失败（不影响主流程）: {e}')

# ── 初始化模式：从历史记录反推生成初始 MEMORY.md ─────────────
def init_from_history():
    """首次运行时，扫描所有历史记录生成 MEMORY.md"""
    print('[Init] 扫描历史记录...')

    all_distilled = {}
    # 扫描最近30天
    for i in range(30, -1, -1):
        date_str = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
        d = distill_today(date_str)
        if d:
            all_distilled[date_str] = d
            print(f'  [{date_str}] 提炼完成: {d.get("summary", "")}')

    if not all_distilled:
        print('[Init] 未找到历史记录，将使用默认 MEMORY.md 模板')
        # 从 soul/memory 目录复制模板
        template_path = Path(__file__).parent / 'MEMORY.md'
        if template_path.exists():
            MEMORY_MD.parent.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.copy(template_path, MEMORY_MD)
            print(f'[Init] MEMORY.md 已从模板创建: {MEMORY_MD}')
        return

    # 生成综合 MEMORY.md
    all_facts    = []
    all_solved   = []
    all_issues   = []
    all_decisions= []

    for date_str, d in all_distilled.items():
        all_solved.extend([(date_str, p) for p in d.get('solved_problems', [])])
        all_facts.extend(d.get('technical_facts', []))
        all_issues.extend(d.get('new_issues', []))
        all_decisions.extend(d.get('important_decisions', []))

    # 去重事实
    all_facts = list(dict.fromkeys(all_facts))

    # 读取模板（来自 /home/claude/memory_fix/MEMORY.md）
    template_path = Path(__file__).parent / 'MEMORY.md'
    if template_path.exists():
        base_content = template_path.read_text(encoding='utf-8')
    else:
        base_content = '# MEMORY.md — 自动生成\n'

    # 追加历史提炼内容
    history_block = '\n## ═══ 历史记录提炼（自动生成）═══\n\n'
    for date_str, p in all_solved[-20:]:  # 最近20条已解决
        history_block += f'### [{date_str}] {p["title"]}\n'
        history_block += f'- **修复**：{p.get("fix", "")}\n'
        history_block += f'- **状态**：✅\n\n'

    MEMORY_MD.parent.mkdir(parents=True, exist_ok=True)
    MEMORY_MD.write_text(base_content + history_block, encoding='utf-8')
    print(f'[Init] MEMORY.md 初始化完成: {MEMORY_MD}')
    print(f'  已解决问题: {len(all_solved)} 条')
    print(f'  技术事实: {len(all_facts)} 条')

# ── 主流程 ────────────────────────────────────────────────────
def main():
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else '--daily'

    if mode == '--init':
        init_from_history()
        return

    if mode == '--health':
        issues = []
        if not MEMORY_MD.exists():
            issues.append('❌ MEMORY.md 不存在，运行: python3 memory_consolidator.py --init')
        else:
            age = (datetime.now().timestamp() - MEMORY_MD.stat().st_mtime) / 86400
            if age > 2:
                issues.append(f'⚠️  MEMORY.md {age:.0f}天未更新')
            else:
                issues.append(f'✅ MEMORY.md 最近更新: {age:.1f}天前')

        today = datetime.now().strftime('%Y-%m-%d')
        df    = MEMORY_DIR / f'{today}.md'
        issues.append(f'{"✅" if df.exists() else "❌"} 今日日记忆文件: {today}.md')
        for i in issues:
            print(i)
        return

    # 默认：每日运行
    date_str = datetime.now().strftime('%Y-%m-%d')
    print(f'[Consolidator] 开始处理 {date_str}...')
    distilled = distill_today(date_str)
    if distilled:
        update_memory_md(date_str, distilled)
        refresh_scene_blocks(date_str, distilled)
        push_to_mesh(date_str, distilled)
        print(f'[Consolidator] ✅ {date_str} 处理完成: {distilled.get("summary", "")}')
    else:
        print(f'[Consolidator] {date_str} 无有效记录')

if __name__ == '__main__':
    main()
