/**
 * Neural Mesh Client - 五分身共用客户端
 * 使用方式:
 *   const mesh = new MeshClient('liuguanyi');
 *   await mesh.share('EXPERIENCE', { task: '...', result: '...' });
 *   await mesh.recall('DragonFlow 优化经验');
 *   await mesh.handoff('wushuai', { task: '...', context: {} });
 */

const MESH_URL = 'http://127.0.0.1:9527';

class MeshClient {
  constructor(agentId) {
    this.id = agentId;
    this._stream = null;
    this._handlers = new Map();
    this._reconnectDelay = 3000;
    this._connected = false;
  }

  // ─── HTTP 基础 ──────────────────────────────────────────────────────────

  async _fetch(path, opts = {}) {
    const url = `${MESH_URL}${path}`;
    const fetch = require('node-fetch');
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Mesh ${path} → ${res.status}: ${err}`);
    }
    return res.json();
  }

  // ─── 广播事件 ────────────────────────────────────────────────────────────

  /**
   * 共享任意类型事件
   * @param {string} type - EXPERIENCE | FAILURE_LESSON | CAPABILITY_UPDATE | EMOTION_ALERT | TASK_HANDOFF | MEMORY | ALL
   * @param {object} payload
   */
  async share(type, payload) {
    return this._fetch('/publish', {
      method: 'POST',
      body: { from: this.id, type, payload },
    });
  }

  /** 快捷：共享经验 */
  async shareExperience(task, approach, result, lesson) {
    return this.share('EXPERIENCE', { task, approach, result, lesson });
  }

  /** 快捷：共享失败教训 */
  async shareFailureLesson(what, why, lesson) {
    return this.share('FAILURE_LESSON', { what, why, lesson });
  }

  // ─── 查询记忆 ────────────────────────────────────────────────────────────

  /**
   * 按关键词召回相关记忆
   * @param {string} query - 搜索关键词
   * @param {object} opts - { type, from, date, k }
   */
  async recall(query, opts = {}) {
    return this._fetch('/recall', {
      method: 'POST',
      body: { query, ...opts },
    });
  }

  // ─── 能力注册 ────────────────────────────────────────────────────────────

  /**
   * 注册分身能力
   * @param {Array} skills - [{name, desc, level}]
   */
  async registerSkills(skills) {
    return this._fetch('/capability/register', {
      method: 'POST',
      body: { agent: this.id, skills },
    });
  }

  /** 查询所有分身能力 */
  async getAllCapabilities() {
    return this._fetch('/capability/all');
  }

  /** 查询指定分身能力 */
  async getCapabilities(agent) {
    return this._fetch(`/capability/${agent}`);
  }

  // ─── 情感预警 ────────────────────────────────────────────────────────────

  /**
   * 发送情感预警（气海老祖用）
   * @param {string} persona - 人格向量描述
   * @param {object} vector - 情感向量
   * @param {number} count - 连续异常次数
   */
  async alertEmotion(persona, vector, count) {
    return this._fetch('/emotion/alert', {
      method: 'POST',
      body: { from: this.id, persona, vector, count },
    });
  }

  // ─── 任务交接 ────────────────────────────────────────────────────────────

  /**
   * 交接任务给其他分身
   * @param {string} to - 目标分身名
   * @param {string} task - 任务描述
   * @param {object} context - 任务上下文
   */
  async handoff(to, task, context = {}) {
    return this._fetch('/task/handoff', {
      method: 'POST',
      body: { from: this.id, to, task, context },
    });
  }

  /** 查询待处理任务 */
  async getPendingTasks(agent) {
    return this._fetch(`/task/pending?agent=${agent || this.id}`);
  }

  /** 标记任务已解决 */
  async resolveTask(ts) {
    return this._fetch('/task/resolve', { method: 'POST', body: { ts, agent: this.id } });
  }

  // ─── SSE 长连接 ──────────────────────────────────────────────────────────

  /**
   * 实时监听事件流
   * @param {string[]} channels - 要订阅的频道，默认全部
   * @param {function} handler - (event) => {}
   */
  async stream(channels = ['mesh:all'], handler) {
    this._handlers.set('default', handler);
    const url = `${MESH_URL}/stream/${this.id}?channels=${channels.join(',')}`;
    this._stream = new EventSource(url);

    this._stream.addEventListener('connected', (e) => {
      this._connected = true;
      console.log(`[Mesh:${this.id}] connected to neural mesh`);
    });

    this._stream.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data);
        const h = this._handlers.get('default');
        if (h) h(event);
      } catch (err) {
        console.error('[Mesh:stream] parse error', err);
      }
    });

    this._stream.onerror = () => {
      this._connected = false;
      this._stream.close();
      console.warn(`[Mesh:${this.id}] stream lost, retry in ${this._reconnectDelay}ms`);
      setTimeout(() => {
        if (this._handlers.has('default')) {
          this.stream(channels, this._handlers.get('default'));
        }
      }, this._reconnectDelay);
    };
  }

  /** 停止监听 */
  stopStream() {
    if (this._stream) {
      this._stream.close();
      this._stream = null;
      this._connected = false;
    }
    this._handlers.clear();
  }

  // ─── 状态 ────────────────────────────────────────────────────────────────

  async status() {
    return this._fetch('/status');
  }

  get connected() {
    return this._connected;
  }
}

// ─── 快捷工厂函数 ───────────────────────────────────────────────────────────

function createMeshClient(agentId) {
  return new MeshClient(agentId);
}

// Node.js / CommonJS 环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MeshClient, createMeshClient };
}
