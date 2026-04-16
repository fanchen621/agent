// collab_protocol.js — 协作者协议（stub实现）
const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(process.env.HOME || '/root', '.openclaw/storage');
const FAILURES_FILE = path.join(STORAGE_DIR, 'failures.json');

/**
 * 获取与任务相关的失败教训
 * @param {string} query - 查询任务描述
 * @param {number} limit - 返回数量限制
 * @returns {Array} 失败教训列表
 */
function getRelevantFailures(query, limit = 3) {
    try {
        const fails = JSON.parse(fs.readFileSync(FAILURES_FILE, 'utf8'));
        const q = (query || '').toLowerCase();
        return fails
            .filter(f => (f.lesson || '').toLowerCase().includes(q) ||
                         (f.task || '').toLowerCase().includes(q))
            .slice(-limit)
            .map(f => ({ lesson: f.lesson || f.task || '', error_type: f.type || 'unknown' }));
    } catch {
        return [];
    }
}

module.exports = { getRelevantFailures };
