'use strict';
const { atomicWriteFile } = require('./atomic-file');
const BASE = 'https://openrouter.ai/api/v1';
function createOpenRouterService({ safeStorage, fs, path, userData }) {
  const keyPath = path.join(userData, 'openrouter-key.bin');
  function secureStorageAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  }
  async function getKey() {
    try {
      const stat = await fs.lstat(keyPath);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16384) return '';
      const encrypted = await fs.readFile(keyPath);
      return secureStorageAvailable() ? safeStorage.decryptString(encrypted) : '';
    } catch { return ''; }
  }
  async function setKey(value) {
    const key = String(value || '').trim();
    if (key && !key.startsWith('sk-or-')) throw new Error('That does not look like an OpenRouter API key.');
    if (!key) { await fs.rm(keyPath, { force: true }); return { connected: false }; }
    if (!secureStorageAvailable()) throw new Error('OS-backed secure credential storage is unavailable on this device. The OpenRouter key was not saved.');
    await fs.mkdir(userData, { recursive: true });
    await atomicWriteFile(keyPath, safeStorage.encryptString(key), { mode: 0o600 });
    return { connected: !!key };
  }
  async function request(endpoint, options = {}) {
    const key = await getKey();
    if (!key) throw new Error('An OpenRouter API key is required. Add it in Connections.');
    const timeout = AbortSignal.timeout(120000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(BASE + endpoint, {
        ...options, signal,
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://local-ai-runner.app',
          'X-Title': 'Local AI Runner',
          ...(options.headers || {})
        }
      });
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TimeoutError') throw new Error(options.signal?.aborted ? 'Team run stopped.' : 'OpenRouter request timed out.');
      throw e;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || 'OpenRouter request failed (' + response.status + ').');
    return body;
  }
  return {
    setKey,
    status: async () => ({ connected: !!(await getKey()) }),
    models: async () => (await request('/models')).data || [],
    chat: async payload => {
      if (!payload || !Array.isArray(payload.messages) || payload.messages.length > 100) throw new Error('Invalid chat request.');
      const model = String(payload.model || '').slice(0, 200);
      if (!model) throw new Error('Choose an OpenRouter model.');
      const messages = payload.messages.map(message => {
        if (!message || !['system', 'user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') throw new Error('Invalid chat message.');
        if (message.content.length > 120000) throw new Error('Chat message exceeds the supported size.');
        const normalized = { role: message.role, content: message.content };
        if (message.role === 'tool') {
          if (typeof message.tool_call_id !== 'string' || message.tool_call_id.length > 200) throw new Error('Invalid tool response.');
          normalized.tool_call_id = message.tool_call_id;
        }
        if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
          normalized.tool_calls = message.tool_calls.slice(0, 64).map(call => {
            if (!call || typeof call.id !== 'string' || typeof call.name !== 'string') throw new Error('Invalid assistant tool call.');
            return { id: call.id.slice(0, 200), type: 'function', function: { name: call.name.slice(0, 128), arguments: JSON.stringify(call.args || {}) } };
          });
        }
        return normalized;
      });
      const tools = Array.isArray(payload.tools) ? payload.tools.slice(0, 64).map(tool => {
        if (!tool || tool.type !== 'function' || !tool.function || typeof tool.function.name !== 'string' || !tool.function.parameters || typeof tool.function.parameters !== 'object') throw new Error('Invalid tool definition.');
        return { type: 'function', function: { name: tool.function.name.slice(0, 128), description: String(tool.function.description || '').slice(0, 2000), parameters: tool.function.parameters } };
      }) : [];
      return request('/chat/completions', {
        method: 'POST',
        signal: payload.signal,
        body: JSON.stringify({
          model, messages,
          ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
          temperature: Math.max(0, Math.min(2, Number(payload.temperature ?? 0.2))),
          max_tokens: Math.max(1, Math.min(16000, Number(payload.max_tokens ?? 4000)))
        })
      });
    }
  };
}
module.exports = { createOpenRouterService };
