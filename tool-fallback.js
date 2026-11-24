(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocalAIRunnerToolFallback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_TOOLS = 28;
  const MAX_PROMPT_CHARS = 18000;
  const MAX_CALLS = 8;
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function buildToolFallbackPrompt(definitions) {
    const available = [];
    let length = 0;
    for (const item of (Array.isArray(definitions) ? definitions : []).slice(0, 150)) {
      const definition = item && item.definition ? item.definition : item;
      if (!definition || typeof definition.name !== 'string') continue;
      const candidate = { name: definition.name, description: String(definition.description || '').slice(0, 260), parameters: definition.parameters || { type: 'object', properties: {} } };
      const serialized = JSON.stringify(candidate);
      if (available.length >= MAX_TOOLS || length + serialized.length > MAX_PROMPT_CHARS) break;
      available.push(candidate);
      length += serialized.length;
    }
    if (!available.length) return { prompt: '', names: [] };
    const prompt = [
      'LOCAL TOOL CALLING FALLBACK: This model does not have native function-calling enabled. You may request tools from the app registry below.',
      'Use a tool only when it helps complete the user request. The app validates every argument and applies the normal permission checks and native approval dialogs. Never claim a tool succeeded until its result is returned.',
      'When requesting one or more tools, output one exact block in this format and do not put it inside a Markdown code fence:',
      '<tool_calls>',
      '{"calls":[{"name":"exact_tool_name","arguments":{}}]}',
      '</tool_calls>',
      'Use no more than ' + MAX_CALLS + ' calls in a block. The name must exactly match one listed tool. Arguments must be a JSON object matching that tool parameters. Do not include commentary inside the block. If no tool is needed, answer normally and do not emit a tool_calls block.',
      'Available tools (JSON definitions):',
      JSON.stringify(available)
    ].join('\n\n');
    return { prompt, names: available.map(tool => tool.name) };
  }

  function parseToolFallbackResponse(content) {
    const source = String(content || '');
    const pattern = /<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/gi;
    const matches = [...source.matchAll(pattern)];
    if (!matches.length) return null;
    const calls = [];
    for (const match of matches) {
      let parsed;
      try { parsed = JSON.parse(match[1]); } catch (_) { return null; }
      if (!isObject(parsed) || !Array.isArray(parsed.calls)) return null;
      for (const call of parsed.calls) {
        if (!isObject(call) || typeof call.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(call.name)) return null;
        if (!isObject(call.arguments === undefined ? {} : call.arguments)) return null;
        calls.push({ id: 'fallback_' + (calls.length + 1), name: call.name, args: call.arguments || {} });
        if (calls.length > MAX_CALLS) return null;
      }
    }
    let cleaned = source;
    for (const match of matches) cleaned = cleaned.replace(match[0], '');
    return { content: cleaned.trim(), calls };
  }

  return { buildToolFallbackPrompt, parseToolFallbackResponse, MAX_CALLS, MAX_TOOLS };
});