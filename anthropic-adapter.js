(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocalAIAnthropicAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function toWire(messages, makeId = () => 'toolu_' + Math.random().toString(36).slice(2)) {
    const systemParts = [];
    const output = [];
    const append = (role, blocks) => {
      if (!blocks.length) return;
      const previous = output[output.length - 1];
      if (previous?.role === role && Array.isArray(previous.content)) previous.content.push(...blocks);
      else output.push({ role, content: blocks });
    };
    for (const message of Array.isArray(messages) ? messages : []) {
      if (message.role === 'system') {
        if (message.content) systemParts.push(String(message.content));
        continue;
      }
      if (message.role === 'user') {
        const blocks = [];
        if (message.content) blocks.push({ type: 'text', text: String(message.content) });
        for (const image of message.images || []) {
          const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(String(image || ''));
          if (match) blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
        }
        append('user', blocks.length ? blocks : [{ type: 'text', text: ' ' }]);
        continue;
      }
      if (message.role === 'assistant') {
        const blocks = [];
        if (message.content) blocks.push({ type: 'text', text: String(message.content) });
        for (const call of message.tool_calls || []) {
          blocks.push({
            type: 'tool_use',
            id: String(call.id || makeId()),
            name: String(call.name || ''),
            input: call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {}
          });
        }
        append('assistant', blocks.length ? blocks : [{ type: 'text', text: ' ' }]);
        continue;
      }
      if (message.role === 'tool') {
        append('user', [{
          type: 'tool_result',
          tool_use_id: String(message.tool_call_id || ''),
          content: String(message.content || '')
        }]);
      }
    }
    return { system: systemParts.join('\n\n'), messages: output };
  }

  function toolDefinition(definition) {
    if (!definition || typeof definition.name !== 'string') throw new Error('Anthropic tool definitions require a name.');
    return {
      name: definition.name,
      description: String(definition.description || ''),
      input_schema: definition.parameters && typeof definition.parameters === 'object'
        ? definition.parameters
        : { type: 'object', properties: {} }
    };
  }

  return { toWire, toolDefinition };
});