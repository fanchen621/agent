"""
Neural Mesh Client - Python 版（五分身通用）
兼容 Python 3.6+，不依赖任何外部库（仅用 urllib）

使用方式:
    from mesh_client import MeshClient
    mesh = MeshClient('柳贯一')
    await mesh.share('EXPERIENCE', {'task': '...', 'result': '...'})
    results = await mesh.recall('关键词')
    await mesh.handoff('战部渡', '调研任务', {'context': {...}})
"""

import json
import urllib.request
import urllib.parse
import time
from typing import List, Dict, Any, Optional

MESH_URL = "http://127.0.0.1:9527"
TIMEOUT = 5


class MeshClient:
    def __init__(self, agent_id: str, url: str = MESH_URL):
        self.id = agent_id
        self.url = url.rstrip("/")
        self._handlers = []

    # ─── 内部 HTTP 工具 ───────────────────────────────────────────────────

    def _post(self, path: str, body: Dict) -> Dict:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.url}{path}",
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str) -> Dict:
        req = urllib.request.Request(f"{self.url}{path}", method="GET")
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # ─── 发布事件 ────────────────────────────────────────────────────────

    def share(self, event_type: str, payload: Any) -> Dict:
        """
        通用发布接口
        event_type: EXPERIENCE | FAILURE_LESSON | TASK_HANDOFF |
                    CAPABILITY_UPDATE | EMOTION_ALERT | MEMORY | ALL
        """
        return self._post("/publish", {"from": self.id, "type": event_type, "payload": payload})

    def share_experience(self, task: str, approach: str, result: str, lesson: str = "") -> Dict:
        """快捷：共享经验"""
        return self.share("EXPERIENCE", {
            "task": task, "approach": approach, "result": result, "lesson": lesson
        })

    def share_failure(self, what: str, why: str, lesson: str) -> Dict:
        """快捷：共享失败教训"""
        return self.share("FAILURE_LESSON", {"what": what, "why": why, "lesson": lesson})

    def publish_all(self, msg: str) -> Dict:
        """广播给所有分身"""
        return self.share("ALL", {"msg": msg})

    # ─── 召回记忆 ────────────────────────────────────────────────────────

    def recall(self, query: str = "", k: int = 8, event_type: str = "", days: int = 7) -> Dict:
        """
        召回相关记忆
        query: 关键词（空则返回最近的 k 条）
        event_type: 按类型过滤（如 "FAILURE_LESSON"）
        days: 追溯天数
        """
        body = {"query": query, "k": k, "date": days}
        if event_type:
            body["type"] = event_type
        return self._post("/recall", body)

    # ─── 能力注册 ────────────────────────────────────────────────────────

    def register_skills(self, skills: List[Dict]) -> Dict:
        """
        注册分身能力
        skills: [{"name": "...", "desc": "...", "level": 1-5}]
        """
        return self._post("/capability/register", {"agent": self.id, "skills": skills})

    def get_all_capabilities(self) -> Dict:
        """查询所有分身能力"""
        return self._get("/capability/all")

    def get_capabilities(self, agent: str) -> Dict:
        """查询指定分身能力"""
        return self._get(f"/capability/{urllib.parse.quote(agent, safe='')}")

    # ─── 情感预警 ────────────────────────────────────────────────────────

    def alert_emotion(self, persona: str, vector: Dict, count: int) -> Dict:
        """
        发送情感预警（气海老祖用）
        persona: 人格描述
        vector: 情感向量 {"calm": 0.1, "desperate": 0.9}
        count: 连续异常次数
        """
        return self._post("/emotion/alert", {
            "from": self.id, "persona": persona, "vector": vector, "count": count
        })

    # ─── 任务交接 ────────────────────────────────────────────────────────

    def handoff(self, to_agent: str, task: str, context: Dict = None) -> Dict:
        """
        交接任务给其他分身
        to_agent: 目标分身名
        task: 任务描述
        context: 任务上下文
        """
        return self._post("/task/handoff", {
            "from": self.id, "to": to_agent, "task": task,
            "context": context or {}
        })

    def get_pending_tasks(self, agent: str = "") -> Dict:
        """查询待处理任务（空则查自己的）"""
        ag = agent or self.id
        return self._get(f"/task/pending?agent={urllib.parse.quote(ag, safe='')}")

    def resolve_task(self, ts: int) -> Dict:
        """标记任务已解决"""
        return self._post("/task/resolve", {"ts": ts, "agent": self.id})

    # ─── 系统状态 ────────────────────────────────────────────────────────

    def status(self) -> Dict:
        """查询 Neural Mesh 状态"""
        return self._get("/status")

    # ─── SSE 长连接 ──────────────────────────────────────────────────────
    # Python 不内置 SSE，用线程模拟轮询（5秒间隔）

    def stream(self, channels: List[str] = None, handler=None, interval: float = 5.0):
        """
        模拟 SSE 实时监听（后台线程轮询）
        channels: 订阅频道，默认全部
        handler: 回调函数，接收 event dict
        返回 stop 函数
        """
        import threading

        if channels is None:
            channels = ["mesh:all"]
        channels_str = ",".join(channels)

        last_ts = int(time.time() * 1000)

        def poll():
            while getattr(self, "_stream_running", False):
                try:
                    # 用 recall 拉取最新事件（轮询替代 SSE）
                    r = self.recall(k=3, days=0)
                    for ev in r.get("results", []):
                        if ev["ts"] > last_ts:
                            last_ts = ev["ts"]
                            if handler:
                                handler(ev)
                except Exception:
                    pass
                time.sleep(interval)

        self._stream_running = True
        t = threading.Thread(target=poll, daemon=True)
        t.start()

        def stop():
            self._stream_running = False

        return stop


# ─── 快捷工厂函数 ────────────────────────────────────────────────────────────

def create_mesh_client(agent_id: str) -> MeshClient:
    return MeshClient(agent_id)


# ─── 五分身快速接入 ─────────────────────────────────────────────────────────

AGENTS = ["柳贯一", "房睇长", "吴帅", "气海老祖", "战部渡"]


def register_all_agents():
    """一口气注册五分身能力（演示用）"""
    skills_map = {
        "柳贯一": [{"name": "战略调度", "desc": "统筹五分身协作", "level": 5}],
        "房睇长": [{"name": "情报分析", "desc": "信息收集与研判", "level": 5}],
        "吴帅": [{"name": "突破执行", "desc": "高难度任务执行", "level": 5}],
        "气海老祖": [{"name": "运营维护", "desc": "系统稳定与演进", "level": 5}],
        "战部渡": [{"name": "前线侦察", "desc": "前线任务执行", "level": 5}],
    }
    results = {}
    for name, skills in skills_map.items():
        mesh = MeshClient(name)
        r = mesh.register_skills(skills)
        results[name] = r
        print(f"  [{name}] {'✅' if r.get('ok') else '❌'}: {r}")
    return results


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python mesh_client.py <agent_id> [command] [args...]")
        print("Commands:")
        print("  status                    - 查看系统状态")
        print("  register                 - 注册能力")
        print("  share <task> <approach> <result> [lesson]")
        print("  recall <query>           - 召回记忆")
        print("  handoff <to> <task>      - 交接任务")
        print("  pending [agent]          - 查询待处理任务")
        print("  alert <persona> <count>  - 情感预警")
        sys.exit(1)

    agent_id = sys.argv[1]
    cmd = sys.argv[2] if len(sys.argv) > 2 else "status"
    mesh = MeshClient(agent_id)

    if cmd == "status":
        print(json.dumps(mesh.status(), indent=2, ensure_ascii=False))

    elif cmd == "register":
        skills = [{"name": "测试技能", "desc": "测试用", "level": 1}]
        print(json.dumps(mesh.register_skills(skills), indent=2, ensure_ascii=False))

    elif cmd == "share":
        task = sys.argv[3] if len(sys.argv) > 3 else "测试任务"
        approach = sys.argv[4] if len(sys.argv) > 4 else "直接测试"
        result = sys.argv[5] if len(sys.argv) > 5 else "成功"
        lesson = sys.argv[6] if len(sys.argv) > 6 else ""
        print(json.dumps(mesh.share_experience(task, approach, result, lesson), indent=2, ensure_ascii=False))

    elif cmd == "recall":
        query = sys.argv[3] if len(sys.argv) > 3 else ""
        print(json.dumps(mesh.recall(query), indent=2, ensure_ascii=False))

    elif cmd == "handoff":
        to = sys.argv[3] if len(sys.argv) > 3 else ""
        task = sys.argv[4] if len(sys.argv) > 4 else ""
        print(json.dumps(mesh.handoff(to, task), indent=2, ensure_ascii=False))

    elif cmd == "pending":
        ag = sys.argv[3] if len(sys.argv) > 3 else ""
        print(json.dumps(mesh.get_pending_tasks(ag), indent=2, ensure_ascii=False))

    elif cmd == "alert":
        persona = sys.argv[3] if len(sys.argv) > 3 else agent_id
        count = int(sys.argv[4]) if len(sys.argv) > 4 else 1
        print(json.dumps(mesh.alert_emotion(persona, {"calm": 0.5, "desperate": 0.5}, count), indent=2, ensure_ascii=False))

    elif cmd == "all_register":
        register_all_agents()
