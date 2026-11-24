'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { highlightCode } = require('../editor-highlighter');

test('JavaScript highlights keywords, functions, types, properties and operators distinctly', () => {
  const html = highlightCode('const user = new User();\nuser.load("data");\nuser.name;', 'js');
  for (const token of ['keyword', 'variable', 'operator', 'type', 'function', 'property', 'string', 'punctuation']) {
    assert.match(html, new RegExp('class="syn-' + token + '"'));
  }
});

test('HTML highlights tags, attributes, values, comments and entities', () => {
  const html = highlightCode('<!-- note -->\n<div class="card">&amp;</div>', 'html');
  for (const token of ['comment', 'tag', 'attribute', 'string', 'constant', 'punctuation']) {
    assert.match(html, new RegExp('class="syn-' + token + '"'));
  }
});

test('CSS highlights selectors, properties, values, functions and colors', () => {
  const html = highlightCode('.card:hover { color: #fff; width: calc(100% - 2px); }', 'css');
  for (const token of ['selector', 'property', 'number', 'function', 'value', 'punctuation']) {
    assert.match(html, new RegExp('class="syn-' + token + '"'));
  }
});

test('JSON keys are styled separately and source is safely escaped', () => {
  const html = highlightCode('{"name": "<script>", "enabled": true}', 'json');
  assert.match(html, /<span class="syn-property">&quot;name&quot;<\/span>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
