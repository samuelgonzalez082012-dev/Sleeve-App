'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateNavigationUrl, isPrivateHost, classifyClickRisk, isSensitiveField,
  normalizeBounds, formatMarksList, formatDomReport, truncate, LIB_SOURCE
} = require('../services/browser-service');

test('validateNavigationUrl accepts ordinary web addresses and adds https', () => {
  assert.equal(validateNavigationUrl('https://example.com/a?b=1').origin, 'https://example.com');
  assert.equal(validateNavigationUrl('example.com').url, 'https://example.com/');
  assert.equal(validateNavigationUrl('http://example.org:8080/x').origin, 'http://example.org:8080');
  assert.equal(validateNavigationUrl('about:blank').blank, true);
});

test('validateNavigationUrl rejects unsafe or malformed input', () => {
  for (const bad of ['', '   ', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'ftp://example.com',
    'https://user:pass@example.com', 'two words', 'https://' + 'a'.repeat(3000) + '.com', 'https://exa\u0000mple.com', 'not a url']) {
    assert.throws(() => validateNavigationUrl(bad), undefined, `should reject: ${bad.slice(0, 40)}`);
  }
});

test('isPrivateHost flags loopback, LAN and local names but not public hosts', () => {
  for (const host of ['localhost', 'app.localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd12::1', 'fe80::1', 'printer.local', 'nas.lan', '::ffff:10.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700::1111']) assert.equal(isPrivateHost(host), false, host);
});

test('validateNavigationUrl marks private addresses', () => {
  assert.equal(validateNavigationUrl('http://localhost:11434/api/tags').isPrivate, true);
  assert.equal(validateNavigationUrl('http://192.168.0.5').isPrivate, true);
  assert.equal(validateNavigationUrl('https://example.com').isPrivate, false);
});

test('classifyClickRisk requires approval for submits and sensitive button labels', () => {
  assert.equal(classifyClickRisk({ tag: 'input', type: 'submit', label: 'Go' }).risky, true);
  assert.equal(classifyClickRisk({ tag: 'button', type: 'submit', inForm: true, label: 'Next' }).risky, true);
  assert.equal(classifyClickRisk({ tag: 'button', type: '', inForm: true, label: 'Next' }).risky, true);
  assert.equal(classifyClickRisk({ tag: 'button', type: 'button', inForm: true, label: 'Show more' }).risky, false);
  assert.equal(classifyClickRisk({ tag: 'button', type: 'button', label: 'Buy now' }).risky, true);
  assert.equal(classifyClickRisk({ tag: 'div', role: 'button', label: 'Delete account' }).risky, true);
  assert.equal(classifyClickRisk({ tag: 'a', label: 'Pricing' }).risky, false);
  assert.equal(classifyClickRisk({ tag: 'button', type: 'button', label: 'Open menu' }).risky, false);
  assert.equal(classifyClickRisk(null).risky, false);
});

test('isSensitiveField protects passwords, payment and one-time codes', () => {
  assert.equal(isSensitiveField({ type: 'password' }), true);
  assert.equal(isSensitiveField({ type: 'text', autocomplete: 'cc-number' }), true);
  assert.equal(isSensitiveField({ type: 'text', autocomplete: 'one-time-code' }), true);
  assert.equal(isSensitiveField({ type: 'text', name: 'card_number' }), true);
  assert.equal(isSensitiveField({ type: 'text', label: 'CVV' }), true);
  assert.equal(isSensitiveField({ type: 'text', label: 'Social security number' }), true);
  assert.equal(isSensitiveField({ type: 'text', label: 'Your name' }), false);
  assert.equal(isSensitiveField({ type: 'email', name: 'email' }), false);
  assert.equal(isSensitiveField({ type: 'text', label: 'Passenger' }), false);
});

test('normalizeBounds rounds, clamps and survives bad input', () => {
  assert.deepEqual(normalizeBounds({ x: 10.4, y: 20.6, width: 300.2, height: 200.7 }, { width: 1000, height: 800 }), { x: 10, y: 21, width: 300, height: 201 });
  assert.deepEqual(normalizeBounds({ x: -50, y: -5, width: 5000, height: 5000 }, { width: 1000, height: 800 }), { x: 0, y: 0, width: 1000, height: 800 });
  assert.deepEqual(normalizeBounds({ x: 900, y: 700, width: 500, height: 500 }, { width: 1000, height: 800 }), { x: 900, y: 700, width: 100, height: 100 });
  assert.deepEqual(normalizeBounds(null, { width: 100, height: 100 }), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(normalizeBounds({ x: 'a', y: NaN, width: Infinity, height: undefined }, { width: 100, height: 100 }), { x: 0, y: 0, width: 0, height: 0 });
});

test('formatMarksList renders compact numbered lines', () => {
  const text = formatMarksList([
    { i: 1, tag: 'a', role: '', label: 'Home', href: '/' },
    { i: 2, tag: 'input', type: 'text', label: 'Your name', value: 'Ada' },
    { i: 3, tag: 'button', label: 'Submit', disabled: true },
    { i: 4, tag: 'input', type: 'checkbox', label: 'Agree', checked: true }
  ]);
  assert.match(text, /^\[1\] a "Home" → \//m);
  assert.match(text, /\[2\] input:text "Your name" value="Ada"/);
  assert.match(text, /\[3\] button "Submit" \(disabled\)/);
  assert.match(text, /\[4\] input:checkbox "Agree" \(checked\)/);
});

test('formatDomReport includes url, elements, headings and text', () => {
  const report = formatDomReport({ url: 'https://x.test/', title: 'X', viewport: { w: 800, h: 600, scrollY: 0, docH: 2000 }, marks: [{ i: 1, tag: 'a', label: 'Go', href: '/go' }], headings: ['h1: Welcome'], text: 'Hello world' });
  assert.match(report, /URL: https:\/\/x\.test\//);
  assert.match(report, /scrolled 0 of 1400 px/);
  assert.match(report, /\[1\] a "Go" → \/go/);
  assert.match(report, /- h1: Welcome/);
  assert.match(report, /Hello world/);
  assert.match(formatDomReport({ url: 'u', title: 't', marks: [] }), /No interactive elements/);
});

test('truncate bounds long text and reports the remainder', () => {
  assert.equal(truncate('abc', 10), 'abc');
  assert.match(truncate('x'.repeat(50), 10), /^x{10}… \[truncated 40 characters\]$/);
  assert.equal(truncate(null, 5), '');
});

test('the in-page library is valid, self-contained JavaScript', () => {
  assert.doesNotThrow(() => new Function(LIB_SOURCE));
  assert.ok(LIB_SOURCE.includes('__larAgent'));
  assert.ok(!/\brequire\s*\(/.test(LIB_SOURCE), 'page code must not use Node APIs');
});

test('parseKeySteps accepts names and objects and totals the time', () => {
  const { parseKeySteps } = require('../services/browser-service');
  const out = parseKeySteps(['ArrowLeft', { key: 'Space', hold_ms: 100, wait_ms: 20 }, { wait_ms: 50 }, { key: 'a', action: 'down' }]);
  assert.equal(out.steps.length, 4);
  assert.equal(out.steps[0].code, 'Left');
  assert.equal(out.steps[1].hold, 100);
  assert.equal(out.steps[2].action, 'wait');
  assert.equal(out.steps[3].action, 'down');
  assert.equal(out.totalMs, 30 + 100 + 20 + 50);
});

test('parseKeySteps rejects bad input and over-long sequences', () => {
  const { parseKeySteps } = require('../services/browser-service');
  assert.throws(() => parseKeySteps([]), /non-empty/);
  assert.throws(() => parseKeySteps(['Banana']), /Unsupported key/);
  assert.throws(() => parseKeySteps([{}]), /key or a wait_ms/);
  assert.throws(() => parseKeySteps(Array(201).fill('a')), /At most/);
  assert.throws(() => parseKeySteps(Array(5).fill({ key: 'a', hold_ms: 5000 })), /seconds/);
});

test('resolveKeyCode maps game keys', () => {
  const { resolveKeyCode } = require('../services/browser-service');
  assert.equal(resolveKeyCode('ArrowUp'), 'Up');
  assert.equal(resolveKeyCode('W'), 'w');
  assert.equal(resolveKeyCode('f5'), 'F5');
  assert.equal(resolveKeyCode(' '), 'Space');
});
