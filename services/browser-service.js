'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

// Integrated browser: a sandboxed Chromium view (Electron WebContentsView) that the
// user can see and drive, and that the AI agent can drive through a small, bounded tool set.
//
// Safety model
//  - The browser uses its own session partition and has no preload script, so pages can never
//    reach this app's IPC bridge, its storage or its credentials.
//  - Every permission request (camera, location, notifications...) and every download is denied.
//  - Only http(s) pages can be opened. Private-network addresses always need approval.
//  - While the agent is active, visiting a new site needs approval (default on).
//  - Submitting forms, risky buttons and JavaScript execution need native approval.
//  - Password / payment fields are never filled by the agent.
//  - All page-derived text returned to the model is wrapped as untrusted data by the renderer.

const PARTITION = 'persist:agent-browser';
const MAX_URL_LENGTH = 2048;
const MAX_TABS = 8;
const MAX_MARKS = 120;
const MAX_TEXT = 12000;
const MAX_TYPE_CHARS = 5000;
const MAX_JS_CHARS = 4000;
const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 350;
const AGENT_ACTIVE_LIMIT_MS = 30 * 60 * 1000;
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_MAX_BYTES = 2_500_000;

/* ------------------------------------------------------------------ pure helpers */

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  const kind = net.isIP(host);
  if (kind === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) {
    if (host === '::1' || host === '::') return true;
    if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
  }
  return false;
}

function validateNavigationUrl(input) {
  let text = String(input == null ? '' : input).trim();
  if (!text) throw new Error('A web address is required.');
  if (text.length > MAX_URL_LENGTH) throw new Error('That web address is too long.');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('The web address contains invalid characters.');
  if (text === 'about:blank') return { url: 'about:blank', origin: 'about:blank', hostname: '', isPrivate: false, blank: true };
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
    if (/\s/.test(text) || !/^[^\s/]+\.[^\s/]+|^localhost(?::\d+)?(?:[/?#]|$)|^\[?[0-9a-f:.]+\]?(?::\d+)?(?:[/?#]|$)/i.test(text)) {
      throw new Error('Enter a full web address such as https://example.com.');
    }
    text = `https://${text}`;
  }
  let url;
  try { url = new URL(text); } catch (_) { throw new Error('That is not a valid web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https pages can be opened in the browser.');
  if (url.username || url.password) throw new Error('Web addresses containing a username or password are not allowed.');
  if (!url.hostname) throw new Error('The web address has no host name.');
  return { url: url.href, origin: url.origin, hostname: url.hostname, isPrivate: isPrivateHost(url.hostname), blank: false };
}

const RISKY_LABEL = /\b(buy|purchase|pay|place\s+order|checkout|check\s+out|order\s+now|donate|subscribe|confirm|delete|remove|erase|send|post|publish|submit|sign\s?in|log\s?in|sign\s?up|register|apply|transfer|withdraw|unsubscribe|deactivate|close\s+account|cancel\s+(my\s+)?(subscription|account|order))\b/i;

function classifyClickRisk(desc) {
  const d = desc || {};
  const tag = String(d.tag || '').toLowerCase();
  const type = String(d.type || '').toLowerCase();
  const label = String(d.label || '');
  if (tag === 'input' && ['submit', 'image'].includes(type)) return { risky: true, reason: 'submits a form' };
  if (tag === 'button' && d.inForm && !['button', 'reset'].includes(type)) return { risky: true, reason: 'submits a form' };
  if ((tag === 'button' || d.role === 'button' || tag === 'input') && RISKY_LABEL.test(label)) return { risky: true, reason: `looks like a “${(label.match(RISKY_LABEL) || [''])[0].toLowerCase()}” action` };
  return { risky: false, reason: '' };
}

const SENSITIVE_FIELD = /(pass(word|wd|code)?\b|card.?(number|no)|cc.?(num|number)|cvv|cvc|security.?code|\bssn\b|social.?security|routing.?number|\biban\b|\bpin\b|one.?time.?code|otp)/i;

function isSensitiveField(desc) {
  const d = desc || {};
  if (String(d.type || '').toLowerCase() === 'password') return true;
  if (/^(cc-|current-password|new-password|one-time-code)/i.test(String(d.autocomplete || ''))) return true;
  return SENSITIVE_FIELD.test([d.name, d.id, d.label].filter(Boolean).join(' '));
}

const GAME_KEY_NAMES = { enter: 'Return', return: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: 'Space', ' ': 'Space', shift: 'Shift', control: 'Control', ctrl: 'Control', alt: 'Alt' };
const MAX_KEY_STEPS = 200;
const MAX_KEY_TOTAL_MS = 20_000;

function resolveKeyCode(key) {
  const raw = String(key == null ? '' : key);
  const lower = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(GAME_KEY_NAMES, lower)) return GAME_KEY_NAMES[lower];
  if (/^f([1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase();
  if (raw.length === 1) return raw.toLowerCase();
  throw new Error(`Unsupported key “${raw}”. Use a single letter, digit or symbol, or one of: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, Shift, Control, Alt, F1–F12.`);
}

// Turns the model's compact key list into validated steps with timing.
// A step is "ArrowLeft", or { key, action: tap|down|up, hold_ms, wait_ms }, or { wait_ms }.
function parseKeySteps(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('steps must be a non-empty list, for example ["ArrowLeft", {"key":"Space","hold_ms":120}, {"wait_ms":50}].');
  if (input.length > MAX_KEY_STEPS) throw new Error(`At most ${MAX_KEY_STEPS} steps per call.`);
  const steps = [];
  let total = 0;
  for (const item of input) {
    const step = typeof item === 'string' ? { key: item } : (item && typeof item === 'object' ? item : null);
    if (!step) throw new Error('Each step must be a key name or an object.');
    const wait = Math.min(Math.max(Math.round(Number(step.wait_ms) || 0), 0), 5000);
    if (step.key === undefined || step.key === null || step.key === '') {
      if (!wait) throw new Error('A step needs a key or a wait_ms.');
      steps.push({ code: null, action: 'wait', hold: 0, wait }); total += wait; continue;
    }
    const action = ['tap', 'down', 'up'].includes(step.action) ? step.action : 'tap';
    const hold = action === 'tap' ? Math.min(Math.max(Math.round(step.hold_ms === undefined ? 30 : Number(step.hold_ms) || 0), 0), 5000) : 0;
    steps.push({ code: resolveKeyCode(step.key), key: String(step.key), action, hold, wait });
    total += hold + wait;
  }
  if (total > MAX_KEY_TOTAL_MS) throw new Error(`The sequence would take ${Math.round(total / 1000)} seconds; keep it under ${MAX_KEY_TOTAL_MS / 1000}. Send shorter sequences and look again between them.`);
  return { steps, totalMs: total };
}

function truncate(text, max) {
  const value = String(text == null ? '' : text);
  return value.length > max ? `${value.slice(0, max)}… [truncated ${value.length - max} characters]` : value;
}

function normalizeBounds(rect, limit) {
  const r = rect && typeof rect === 'object' ? rect : {};
  const num = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
  let x = num(r.x); let y = num(r.y); let width = num(r.width); let height = num(r.height);
  const maxW = limit && Number.isFinite(limit.width) ? limit.width : 16384;
  const maxH = limit && Number.isFinite(limit.height) ? limit.height : 16384;
  x = Math.min(Math.max(x, 0), maxW); y = Math.min(Math.max(y, 0), maxH);
  width = Math.min(Math.max(width, 0), Math.max(0, maxW - x));
  height = Math.min(Math.max(height, 0), Math.max(0, maxH - y));
  return { x, y, width, height };
}

function formatMarksList(marks) {
  return (marks || []).map(m => {
    const bits = [`[${m.i}] ${m.role || m.tag}${m.type && m.tag === 'input' ? `:${m.type}` : ''}`];
    if (m.label) bits.push(`"${m.label}"`);
    if (m.href) bits.push(`→ ${m.href}`);
    if (m.value && m.tag !== 'a' && m.tag !== 'button' && !['checkbox', 'radio', 'submit', 'button', 'reset'].includes(m.type)) bits.push(`value="${m.value}"`);
    if (m.checked === true) bits.push('(checked)');
    if (m.disabled) bits.push('(disabled)');
    return bits.join(' ');
  }).join('\n');
}

function formatDomReport(report) {
  const r = report || {};
  const lines = [];
  lines.push(`URL: ${r.url || ''}`);
  lines.push(`Title: ${r.title || ''}`);
  if (r.viewport) lines.push(`Viewport: ${r.viewport.w}x${r.viewport.h}, scrolled ${Math.round(r.viewport.scrollY)} of ${Math.round(Math.max(0, r.viewport.docH - r.viewport.h))} px`);
  lines.push('');
  lines.push(r.marks && r.marks.length ? 'Interactive elements currently visible (the same numbers are drawn on the page):' : 'No interactive elements are visible in the current viewport.');
  if (r.marks && r.marks.length) lines.push(formatMarksList(r.marks));
  if (r.headings && r.headings.length) { lines.push('', 'Headings:'); r.headings.forEach(h => lines.push(`- ${h}`)); }
  if (r.text) { lines.push('', 'Visible text (excerpt):', r.text); }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ in-page library
   Serialized with Function.prototype.toString and evaluated in the page. It must be
   self-contained: it cannot reference anything outside its own body. */

function pageLibrary() {
  if (window.__larAgent) return;
  const OVERLAY_ID = '__lar_agent_overlay__';
  const COLORS = ['#ff4d6d', '#2ec4b6', '#ff9f1c', '#7b6cff', '#3a86ff', '#e63946'];
  const state = { marks: [], boxes: [], active: false, rafPending: false };
  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    '.mark{position:fixed;box-sizing:border-box;border:2px solid;border-radius:4px;pointer-events:none}' +
    '.tag{position:absolute;left:-2px;top:-17px;min-width:17px;padding:0 4px;height:17px;line-height:17px;font:700 11px/17px system-ui,sans-serif;color:#fff;border-radius:4px 4px 4px 0;text-align:center}' +
    '.glow{position:fixed;inset:0;box-shadow:inset 0 0 0 3px rgba(104,123,233,.85),inset 0 0 28px rgba(104,123,233,.35);pointer-events:none;opacity:0;transition:opacity .25s}' +
    '.glow.on{opacity:1}' +
    '.pill{position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:rgba(18,24,38,.92);color:#e8ecff;font:600 11px/1.4 system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 2px 12px rgba(0,0,0,.4);opacity:0;transition:opacity .25s}' +
    '.pill.on{opacity:1}' +
    '.cursor{position:fixed;left:0;top:0;width:22px;height:22px;transform:translate(60vw,60vh);transition:transform .5s cubic-bezier(.22,.8,.3,1);opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}' +
    '.cursor.on{opacity:1}' +
    '.ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #8a9dff;animation:rip .55s ease-out forwards;pointer-events:none}' +
    '@keyframes rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.2);opacity:0}}' +
    '</style><div class="glow"></div><div class="pill">AI is working in this tab</div><div class="layer"></div>' +
    '<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.6L9.5 19z" fill="#fff" stroke="#1b2133" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const layer = root.querySelector('.layer');
  const glow = root.querySelector('.glow');
  const pill = root.querySelector('.pill');
  const cursor = root.querySelector('.cursor');
  (document.documentElement || document.body).appendChild(host);

  function clean(text, max) { return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, max); }

  function describe(el, i) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let label = el.getAttribute('aria-label') || '';
    if (!label && el.labels && el.labels[0]) label = el.labels[0].innerText;
    if (!label) label = el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || '';
    if (!label) label = (tag === 'input' && ['submit', 'button', 'reset'].includes(type) ? el.value : el.innerText) || '';
    let value = '';
    if (type !== 'password') {
      if (tag === 'select') value = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : '';
      else if (tag === 'input' || tag === 'textarea') value = el.value || '';
    }
    const editable = (tag === 'textarea') || el.isContentEditable ||
      (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'range', 'color', 'hidden'].includes(type));
    return {
      i, tag, type, role: el.getAttribute('role') || '',
      label: clean(label, 80), name: el.getAttribute('name') || '', id: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      href: tag === 'a' ? clean(el.getAttribute('href') || '', 120) : '',
      value: clean(value, 60), editable: !!editable,
      checked: (type === 'checkbox' || type === 'radio') ? !!el.checked : undefined,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      inForm: !!el.closest('form')
    };
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0 || cs.pointerEvents === 'none') return false;
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    return !top || el.contains(top) || top.contains(el);
  }

  const SELECTOR = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
  const NATIVE = 'a[href],button,input:not([type=hidden]),select,textarea';

  function gather(root0, out, depth) {
    if (depth > 4) return;
    root0.querySelectorAll(SELECTOR).forEach(el => out.push(el));
    root0.querySelectorAll('*').forEach(el => { if (el.shadowRoot) gather(el.shadowRoot, out, depth + 1); });
  }

  function clearBoxes() { layer.textContent = ''; state.boxes = []; }

  function place() {
    state.rafPending = false;
    state.boxes.forEach((b, n) => {
      const el = state.marks[n];
      if (!el || !el.isConnected) { b.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      const off = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
      b.style.display = off ? 'none' : 'block';
      b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
      b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
    });
  }
  function schedule() { if (!state.rafPending) { state.rafPending = true; requestAnimationFrame(place); } }
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);

  const api = {
    collect(max) {
      clearBoxes();
      const raw = [];
      gather(document, raw, 0);
      const seen = new Set();
      const picked = [];
      for (const el of raw) {
        if (seen.has(el) || el === host) continue;
        seen.add(el);
        const generic = !el.matches(NATIVE);
        if (generic && el.querySelector(NATIVE)) continue;
        if (!visible(el)) continue;
        picked.push(el);
        if (picked.length >= max) break;
      }
      state.marks = picked;
      const descriptors = picked.map((el, n) => {
        const box = document.createElement('div');
        box.className = 'mark';
        box.style.borderColor = COLORS[n % COLORS.length];
        box.style.background = COLORS[n % COLORS.length] + '1f';
        const tagEl = document.createElement('span');
        tagEl.className = 'tag'; tagEl.textContent = String(n + 1);
        tagEl.style.background = COLORS[n % COLORS.length];
        box.appendChild(tagEl); layer.appendChild(box); state.boxes.push(box);
        return describe(el, n + 1);
      });
      place();
      const doc = document.documentElement;
      return { marks: descriptors, viewport: { w: innerWidth, h: innerHeight, scrollX: scrollX, scrollY: scrollY, docH: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) } };
    },
    outline() {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(h => h.offsetParent !== null).slice(0, 12).map(h => h.tagName.toLowerCase() + ': ' + clean(h.innerText, 100));
      const text = clean(document.body ? document.body.innerText : '', 3000);
      return { url: location.href, title: document.title, headings, text };
    },
    pick(index) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'stale' };
      return { el };
    },
    prepare(index) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'That element number is no longer valid. Call browser_get_dom to refresh the numbered elements.' };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      schedule();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, desc: describe(el, index) };
    },
    describeActive() {
      const el = document.activeElement;
      if (!el || el === document.body) return { none: true };
      return { desc: describe(el, 0), inForm: !!(el.form || el.closest('form')) };
    },
    selectOption(index, wanted) {
      const el = state.marks[index - 1];
      if (!el || !el.isConnected) return { error: 'That element number is no longer valid. Call browser_get_dom to refresh the numbered elements.' };
      if (el.tagName.toLowerCase() !== 'select') return { error: 'That element is not a drop-down list.' };
      const w = String(wanted).trim().toLowerCase();
      let found = -1;
      for (let n = 0; n < el.options.length; n++) {
        const o = el.options[n];
        if (o.value.toLowerCase() === w || o.text.trim().toLowerCase() === w) { found = n; break; }
      }
      if (found < 0) for (let n = 0; n < el.options.length; n++) if (el.options[n].text.toLowerCase().includes(w)) { found = n; break; }
      if (found < 0) return { error: 'No option matched. Options: ' + Array.from(el.options).slice(0, 25).map(o => clean(o.text, 40)).join(' | ') };
      el.selectedIndex = found;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { chosen: clean(el.options[found].text, 60) };
    },
    readText(selector, index) {
      let el = null;
      if (index) { const p = state.marks[index - 1]; el = p && p.isConnected ? p : null; }
      else if (selector) { try { el = document.querySelector(selector); } catch (e) { return { error: 'Invalid CSS selector.' }; } }
      else el = document.body;
      if (!el) return { error: 'No element matched.' };
      return { text: (el.innerText || el.textContent || '').trim() };
    },
    scroll(direction, amount) {
      const doc = document.documentElement;
      const max = Math.max(0, Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0) - innerHeight);
      if (direction === 'top') scrollTo({ top: 0 });
      else if (direction === 'bottom') scrollTo({ top: max });
      else scrollBy({ top: (direction === 'up' ? -1 : 1) * amount });
      schedule();
      return { y: Math.round(scrollY), max: Math.round(max) };
    },
    cursorTo(x, y) { cursor.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; cursor.classList.add('on'); },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      root.appendChild(r); setTimeout(() => r.remove(), 700);
    },
    setActive(on, label) {
      state.active = !!on;
      glow.classList.toggle('on', !!on); pill.classList.toggle('on', !!on);
      if (label) pill.textContent = label;
      if (!on) cursor.classList.remove('on');
    },
    chrome(show) { glow.style.visibility = show ? 'visible' : 'hidden'; pill.style.visibility = show ? 'visible' : 'hidden'; },
    clearMarks() { clearBoxes(); state.marks = []; },
    redraw() { place(); },
    hasMarks() { return state.marks.length > 0; }
  };
  Object.defineProperty(window, '__larAgent', { value: api, configurable: true });
}

const LIB_SOURCE = `(${pageLibrary.toString()})();`;

/* ------------------------------------------------------------------ service */

const MAX_REFLEX_CHARS = 6000;
const REFLEX_KEY = "Symbol.for('lar.reflex')";
const REFLEX_STATUS = `(() => { const r = window[${REFLEX_KEY}]; if (!r) return { running: false, note: 'No reflex has been started on this page.' }; return r.snapshot(); })()`;
const REFLEX_STOP = `(() => { const r = window[${REFLEX_KEY}]; if (!r) return { running: false, note: 'No reflex was running.' }; r.stop('stopped'); return r.snapshot(); })()`;

function buildReflexSource(code, intervalMs, durationMs) {
  return `(() => {
  const SLOT = ${REFLEX_KEY};
  try { const previous = window[SLOT]; if (previous && previous.running()) previous.stop('replaced'); } catch (_) {}
  const KEYS = { arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowup: ['ArrowUp', 'ArrowUp', 38], arrowright: ['ArrowRight', 'ArrowRight', 39], arrowdown: ['ArrowDown', 'ArrowDown', 40], left: ['ArrowLeft', 'ArrowLeft', 37], up: ['ArrowUp', 'ArrowUp', 38], right: ['ArrowRight', 'ArrowRight', 39], down: ['ArrowDown', 'ArrowDown', 40], space: [' ', 'Space', 32], enter: ['Enter', 'Enter', 13], escape: ['Escape', 'Escape', 27], shift: ['Shift', 'ShiftLeft', 16], control: ['Control', 'ControlLeft', 17], ctrl: ['Control', 'ControlLeft', 17], alt: ['Alt', 'AltLeft', 18], tab: ['Tab', 'Tab', 9] };
  const info = name => {
    const raw = String(name); const hit = KEYS[raw.toLowerCase()];
    if (hit) return { key: hit[0], code: hit[1], kc: hit[2] };
    if (/^[a-z]$/i.test(raw)) return { key: raw, code: 'Key' + raw.toUpperCase(), kc: raw.toUpperCase().charCodeAt(0) };
    if (/^[0-9]$/.test(raw)) return { key: raw, code: 'Digit' + raw, kc: raw.charCodeAt(0) };
    return { key: raw, code: raw, kc: raw.length === 1 ? raw.toUpperCase().charCodeAt(0) : 0 };
  };
  const held = new Set();
  const fire = (type, name) => {
    const i = info(name);
    const ev = new KeyboardEvent(type, { key: i.key, code: i.code, bubbles: true, cancelable: true, composed: true });
    try { Object.defineProperty(ev, 'keyCode', { get: () => i.kc }); Object.defineProperty(ev, 'which', { get: () => i.kc }); } catch (_) {}
    (document.activeElement || document.body || document).dispatchEvent(ev);
  };
  const pointer = (type, x, y) => {
    const target = document.elementFromPoint(x, y) || document.body;
    target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1 }));
  };
  let sample = null;
  const readPixels = (x, y, w, h) => {
    try {
      const source = document.querySelector('canvas');
      if (!source) return null;
      const r = source.getBoundingClientRect();
      const sx = source.width / (r.width || 1); const sy = source.height / (r.height || 1);
      if (!sample) sample = document.createElement('canvas');
      sample.width = w; sample.height = h;
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, (x - r.left) * sx, (y - r.top) * sy, w * sx, h * sy, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    } catch (_) { return null; }
  };
  const logs = [];
  const mem = {};
  const run = { ticks: 0, started: performance.now(), state: 'running', reason: '', error: '', result: undefined, handle: 0, last: 0 };
  const api = {
    mem,
    key(name, mode) { if (mode === 'down') { held.add(String(name)); fire('keydown', name); } else if (mode === 'up') { held.delete(String(name)); fire('keyup', name); } else { fire('keydown', name); fire('keyup', name); } },
    down(name) { if (!held.has(String(name))) { held.add(String(name)); fire('keydown', name); } },
    up(name) { if (held.delete(String(name))) fire('keyup', name); },
    release() { for (const name of [...held]) { held.delete(name); fire('keyup', name); } },
    click(x, y) { pointer('mousemove', x, y); pointer('mousedown', x, y); pointer('mouseup', x, y); pointer('click', x, y); },
    move(x, y) { pointer('mousemove', x, y); },
    pixel(x, y) { const d = readPixels(Math.round(x), Math.round(y), 1, 1); return d ? [d[0], d[1], d[2], d[3]] : null; },
    pixels(x, y, w, h) { w = Math.min(Math.max(Math.round(w), 1), 256); h = Math.min(Math.max(Math.round(h), 1), 256); return readPixels(Math.round(x), Math.round(y), w, h); },
    canvas() { return document.querySelector('canvas'); },
    log(...parts) { if (logs.length >= 100) logs.shift(); logs.push(parts.map(p => { try { return typeof p === 'string' ? p : JSON.stringify(p); } catch (_) { return String(p); } }).join(' ').slice(0, 200)); },
    stop(result) { finish('stopped by script', '', result); }
  };
  function finish(reason, error, result) {
    if (run.state !== 'running') return;
    run.state = 'finished'; run.reason = reason; if (error) run.error = error; if (result !== undefined) run.result = result;
    if (run.mode === 'raf') cancelAnimationFrame(run.handle); else clearInterval(run.handle);
    try { api.release(); } catch (_) {}
  }
  const fn = function (api, t, dt) {
${code}
  };
  const tick = now => {
    if (run.state !== 'running') return;
    const t = now - run.started;
    if (t > ${Number(durationMs)}) { finish('duration reached'); return; }
    run.ticks++;
    try { fn(api, t, now - (run.last || now)); } catch (error) { finish('error', String(error && error.message || error)); return; }
    run.last = now;
    if (run.mode === 'raf' && run.state === 'running') run.handle = requestAnimationFrame(tick);
  };
  window[SLOT] = {
    running: () => run.state === 'running',
    stop: reason => finish(reason || 'stopped'),
    snapshot: () => {
      const elapsed = Math.round(performance.now() - run.started);
      let value = run.result; try { value = value === undefined ? undefined : JSON.parse(JSON.stringify(value)); } catch (_) { value = String(value); }
      return { running: run.state === 'running', ticks: run.ticks, elapsed_ms: elapsed, ticks_per_second: elapsed ? Math.round(run.ticks * 1000 / elapsed) : 0, ended: run.reason || undefined, error: run.error || undefined, result: value, held_keys: [...held], log: logs.slice(-30) };
    }
  };
  if (${Number(intervalMs)} > 0) { run.mode = 'interval'; run.handle = setInterval(() => tick(performance.now()), ${Number(intervalMs)}); }
  else { run.mode = 'raf'; run.handle = requestAnimationFrame(tick); }
  return { started: true, mode: run.mode === 'raf' ? 'every animation frame' : 'every ${Number(intervalMs)} ms', max_seconds: ${Math.round(Number(durationMs) / 1000)} };
})()`;
}

function createBrowserService({ app, dialog, session, WebContentsView, getMainWindow, options = {} }) {
  const tabs = new Map();
  let order = [];
  let activeId = null;
  let attachedId = null;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let visible = false;
  let agentActive = false;
  let agentTimer = null;
  let tabCounter = 0;
  let sessionConfigured = false;
  let stateTimer = null;
  let queue = Promise.resolve();
  const approvedOrigins = new Set();
  const settings = { askNewSites: options.askNewSites !== false, autoApprove: options.autoApprove === true };
  let interruptToken = 0;

  /* ---------- plumbing ---------- */
  const window_ = () => { const w = getMainWindow(); return w && !w.isDestroyed() ? w : null; };
  const send = (channel, payload) => { const w = window_(); if (w && !w.webContents.isDestroyed()) w.webContents.send(channel, payload); };
  const activity = text => send('browser:activity', { at: Date.now(), text: String(text).slice(0, 240) });
  const enqueue = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function ensureSession() {
    const ses = session.fromPartition(PARTITION);
    if (!sessionConfigured) {
      sessionConfigured = true;
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
      ses.on('will-download', (event, item) => { event.preventDefault(); try { item.cancel(); } catch (_) { /* already cancelled */ } activity('A download was blocked.'); });
      try {
        ses.setUserAgent(ses.getUserAgent().replace(/\sElectron\/[\d.]+/i, '').replace(/\s(?:Local-?AI-?Runner|local-ai-runner)\/[\d.]+/i, ''));
      } catch (_) { /* keep default user agent */ }
    }
    return ses;
  }

  function snapshot() {
    const t = activeId && tabs.get(activeId);
    const wc = t && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    const history = wc && wc.navigationHistory;
    return {
      tabs: order.map(id => {
        const tab = tabs.get(id); const w = tab.view.webContents;
        return { id, title: w.isDestroyed() ? '' : (w.getTitle() || 'New tab'), url: w.isDestroyed() ? '' : w.getURL(), loading: !w.isDestroyed() && w.isLoading(), active: id === activeId };
      }),
      activeId,
      canGoBack: !!(history && history.canGoBack()),
      canGoForward: !!(history && history.canGoForward()),
      agentActive, visible, askNewSites: settings.askNewSites, autoApprove: settings.autoApprove
    };
  }
  function emitState() {
    if (stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; send('browser:state', snapshot()); }, 40);
  }

  function applyAttachment() {
    const w = window_();
    if (!w) return;
    const tab = activeId && tabs.get(activeId);
    const shouldShow = !!tab && visible && bounds.width > 8 && bounds.height > 8;
    if (attachedId && (attachedId !== activeId || !shouldShow)) {
      const old = tabs.get(attachedId);
      if (old) { try { w.contentView.removeChildView(old.view); } catch (_) { /* not attached */ } }
      attachedId = null;
    }
    if (shouldShow) {
      if (attachedId !== activeId) { w.contentView.addChildView(tab.view); attachedId = activeId; }
      tab.view.setBounds(bounds);
    }
  }

  /* ---------- tabs ---------- */
  function needsApproval(v) {
    if (v.blank || approvedOrigins.has(v.origin)) return false;
    if (v.isPrivate) return true;
    return agentActive && settings.askNewSites;
  }

  async function approveOrigin(v) {
    const w = window_();
    if (!w) return false;
    if (settings.autoApprove && !v.isPrivate) { approvedOrigins.add(v.origin); activity(`Auto-approved visiting ${v.origin}`); return true; }
    const answer = await dialog.showMessageBox(w, {
      type: v.isPrivate ? 'warning' : 'question', buttons: ['Allow for this session', 'Block'], cancelId: 1, defaultId: 1, noLink: true,
      title: 'Allow the AI to open this site?',
      message: `Allow the AI to open ${v.origin}?`,
      detail: v.isPrivate
        ? 'This address is on your own computer or local network. Pages there may expose private services. Only allow it if you expect it.'
        : 'The assistant wants to visit a site it has not visited in this session. Page content is treated as untrusted data.'
    });
    if (answer.response !== 0) return false;
    approvedOrigins.add(v.origin);
    return true;
  }

  async function approveAction({ title, message, detail }) {
    const w = window_();
    if (!w) return false;
    if (settings.autoApprove) { activity(`Auto-approved: ${title.replace(/\?$/, '')}`); return true; }
    const answer = await dialog.showMessageBox(w, {
      type: 'question', buttons: ['Allow', 'Decline'], cancelId: 1, defaultId: 1, noLink: true,
      title, message, detail
    });
    return answer.response === 0;
  }

  function guardNavigation(tabId, event, url) {
    let v;
    try { v = validateNavigationUrl(url); } catch (_) { event.preventDefault(); activity('A navigation to an unsupported address was blocked.'); return; }
    if (!needsApproval(v)) return;
    event.preventDefault();
    approveOrigin(v).then(ok => {
      const tab = tabs.get(tabId);
      if (ok && tab && !tab.view.webContents.isDestroyed()) tab.view.webContents.loadURL(v.url).catch(() => {});
      else if (!ok) activity(`Blocked navigation to ${v.origin}.`);
    }).catch(() => {});
  }

  function createTab() {
    if (tabs.size >= MAX_TABS) throw new Error(`The browser tab limit (${MAX_TABS}) was reached. Close a tab first.`);
    const view = new WebContentsView({ webPreferences: { session: ensureSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
    try { view.setBackgroundColor('#ffffff'); } catch (_) { /* optional */ }
    const id = `t${++tabCounter}`;
    const wc = view.webContents;
    tabs.set(id, { id, view });
    order.push(id);
    wc.setWindowOpenHandler(({ url }) => {
      try {
        const v = validateNavigationUrl(url);
        if (!v.blank && !needsApproval(v)) { enqueueOpen(v); }
        else if (!v.blank) approveOrigin(v).then(ok => { if (ok) enqueueOpen(v); }).catch(() => {});
      } catch (_) { /* unsupported */ }
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => guardNavigation(id, event, url));
    wc.on('will-redirect', (event, url) => guardNavigation(id, event, url));
    for (const name of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page']) wc.on(name, emitState);
    wc.on('dom-ready', () => { if (agentActive && id === activeId) injectActive(wc, true); });
    wc.on('render-process-gone', () => { activity('A browser tab stopped unexpectedly.'); emitState(); });
    return id;
  }

  function enqueueOpen(v) {
    try { const id = createTab(); activate(id); tabs.get(id).view.webContents.loadURL(v.url).catch(() => {}); } catch (error) { activity(error.message); }
  }

  function activate(id) {
    if (!tabs.has(id)) throw new Error('That tab does not exist.');
    activeId = id;
    applyAttachment();
    emitState();
  }

  function destroyTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    const w = window_();
    if (w && attachedId === id) { try { w.contentView.removeChildView(tab.view); } catch (_) { /* detached */ } attachedId = null; }
    tabs.delete(id);
    order = order.filter(x => x !== id);
    try { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } catch (_) { /* gone */ }
    if (activeId === id) activeId = order.length ? order[order.length - 1] : null;
    applyAttachment();
    emitState();
  }

  function activeWc() {
    if (!activeId || !tabs.has(activeId)) { const id = createTab(); activate(id); }
    const wc = tabs.get(activeId).view.webContents;
    if (wc.isDestroyed()) throw new Error('The active tab is no longer available.');
    return wc;
  }

  /* ---------- page helpers ---------- */
  async function page(wc, expression) {
    return wc.executeJavaScript(`${LIB_SOURCE}\nwindow.__larAgent.${expression}`, true);
  }
  async function injectActive(wc, on) {
    try { await page(wc, `setActive(${on ? 'true' : 'false'}, ${JSON.stringify('AI is working in this tab')})`); } catch (_) { /* page may be navigating */ }
  }

  async function ensureVisible() {
    if (visible && bounds.width > 8 && bounds.height > 8) return;
    send('browser:reveal', { at: Date.now() });
    for (let waited = 0; waited < 3000; waited += 100) {
      await sleep(100);
      if (visible && bounds.width > 8 && bounds.height > 8) return;
    }
    throw new Error('The browser panel is hidden. Open the Browser view or the chat browser dock so the AI can work where you can see it.');
  }

  function waitForLoad(wc, timeout = NAV_TIMEOUT_MS) {
    return new Promise(resolve => {
      if (wc.isDestroyed()) return resolve();
      if (!wc.isLoading()) return setTimeout(resolve, SETTLE_MS);
      let done = false;
      const finish = () => {
        if (done) return; done = true; clearTimeout(timer);
        if (!wc.isDestroyed()) wc.removeListener('did-stop-loading', finish);
        setTimeout(resolve, SETTLE_MS);
      };
      const timer = setTimeout(() => { if (!wc.isDestroyed() && wc.isLoading()) { try { wc.stop(); } catch (_) { /* ignore */ } } finish(); }, timeout);
      wc.on('did-stop-loading', finish);
    });
  }

  async function afterAction(wc) {
    await sleep(250);
    // A click may have opened a popup tab; follow it so the agent sees what the user sees.
    const target = activeId && tabs.get(activeId) ? tabs.get(activeId).view.webContents : wc;
    await waitForLoad(target);
    return target;
  }

  function pageInfo(wc) { return { url: wc.getURL(), title: wc.getTitle() }; }

  async function moveCursor(wc, x, y) {
    try { await page(wc, `cursorTo(${x},${y})`); } catch (_) { /* cosmetic */ }
    await sleep(520);
  }

  function sendClick(wc, x, y) {
    const ix = Math.round(x); const iy = Math.round(y);
    wc.focus();
    wc.sendInputEvent({ type: 'mouseMove', x: ix, y: iy });
    wc.sendInputEvent({ type: 'mouseDown', x: ix, y: iy, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: ix, y: iy, button: 'left', clickCount: 1 });
    page(wc, `ripple(${ix},${iy})`).catch(() => {});
  }

  const KEY_MAP = { enter: 'Return', return: 'Return', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', space: 'Space' };
  function sendKey(wc, key) {
    const code = KEY_MAP[String(key).toLowerCase()];
    if (!code) throw new Error(`Unsupported key “${key}”. Use one of: Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space.`);
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: code });
    if (code === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    if (code === 'Space') wc.sendInputEvent({ type: 'char', keyCode: ' ' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: code });
    return code;
  }

  const intArg = (value, name) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MARKS) throw new Error(`${name} must be an element number from browser_get_dom (1–${MAX_MARKS}).`);
    return n;
  };

  async function prepareElement(wc, index) {
    const info = await page(wc, `prepare(${index})`);
    if (info.error) throw new Error(info.error);
    return info;
  }

  /* ---------- agent tools ---------- */
  const tools = {
    async navigate(args) {
      const v = validateNavigationUrl(args.url);
      if (needsApproval(v) && !(await approveOrigin(v))) throw new Error(`The user did not allow access to ${v.origin}. Choose another source or ask the user.`);
      await ensureVisible();
      const wc = activeWc();
      activity(`Opening ${v.url}`);
      try {
        await Promise.race([wc.loadURL(v.url), sleep(NAV_TIMEOUT_MS).then(() => { try { wc.stop(); } catch (_) { /* ignore */ } })]);
      } catch (error) {
        if (!(error && (error.code === 'ERR_ABORTED' || error.errno === -3))) throw new Error(`Could not load the page: ${error.message}`);
      }
      await waitForLoad(wc);
      return { ...pageInfo(wc), loaded: !wc.isLoading() };
    },

    async click(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const info = await prepareElement(wc, index);
      await moveCursor(wc, info.x, info.y);
      const risk = classifyClickRisk(info.desc);
      if (risk.risky) {
        const ok = await approveAction({
          title: 'Approve this click?', message: `Click “${info.desc.label || info.desc.tag}”?`,
          detail: `This ${risk.reason}.\nPage: ${wc.getURL()}\n\nThe assistant should not act on your behalf for sensitive steps unless you approve each one.`
        });
        if (!ok) throw new Error('The user declined this click. Do not retry it; explain what you need or ask the user.');
      }
      activity(`Click [${index}] ${info.desc.label || info.desc.tag}`);
      sendClick(wc, info.x, info.y);
      const target = await afterAction(wc);
      return { clicked: info.desc.label || info.desc.tag, ...pageInfo(target), tabs: order.length };
    },

    async type(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const text = String(args.text == null ? '' : args.text);
      if (text.length > MAX_TYPE_CHARS) throw new Error(`Text is limited to ${MAX_TYPE_CHARS} characters per call.`);
      const info = await prepareElement(wc, index);
      if (isSensitiveField(info.desc)) throw new Error('This looks like a password, payment or one-time-code field. The assistant must not fill it. Tell the user to enter it themselves in the browser, then continue.');
      if (!info.desc.editable) throw new Error('That element is not a text field. Use browser_click for buttons, links and checkboxes, or browser_select for drop-down lists.');
      await moveCursor(wc, info.x, info.y);
      sendClick(wc, info.x, info.y);
      await sleep(120);
      if (args.clear !== false) {
        // Select through the page first: the native selectAll can run before focus has settled after the click.
        const selected = await wc.executeJavaScript("(()=>{const e=document.activeElement;if(e&&(e.tagName==='INPUT'||e.tagName==='TEXTAREA')&&typeof e.select==='function'){e.focus();e.select();return true;}return false;})()", true).catch(() => false);
        if (!selected) wc.selectAll();
        if (!text) { sendKey(wc, 'Backspace'); }
      }
      if (text) wc.insertText(text);
      await sleep(120);
      activity(`Typed into [${index}] ${info.desc.label || info.desc.tag}`);
      if (args.submit === true) {
        if (info.desc.inForm) {
          const ok = await approveAction({ title: 'Approve form submission?', message: 'Press Enter to submit this form?', detail: `Page: ${wc.getURL()}\nField: ${info.desc.label || info.desc.name || info.desc.tag}` });
          if (!ok) throw new Error('The user declined to submit the form. The text was typed but not submitted.');
        }
        sendKey(wc, 'Enter');
        const target = await afterAction(wc);
        return { typed: text.length, submitted: true, ...pageInfo(target) };
      }
      const after = await page(wc, `describeActive()`);
      return { typed: text.length, fieldValue: after && after.desc ? truncate(after.desc.value, 60) : '', ...pageInfo(wc) };
    },

    async select(args) {
      await ensureVisible();
      const wc = activeWc();
      const index = intArg(args.index, 'index');
      const info = await prepareElement(wc, index);
      await moveCursor(wc, info.x, info.y);
      const result = await page(wc, `selectOption(${index}, ${JSON.stringify(String(args.value == null ? '' : args.value).slice(0, 200))})`);
      if (result.error) throw new Error(result.error);
      activity(`Selected “${result.chosen}” in [${index}]`);
      return { selected: result.chosen };
    },

    async press_key(args) {
      await ensureVisible();
      const wc = activeWc();
      const key = String(args.key || '');
      if (/^enter|return$/i.test(key)) {
        const active = await page(wc, 'describeActive()');
        if (active && active.desc && active.inForm) {
          const ok = await approveAction({ title: 'Approve pressing Enter?', message: 'Press Enter inside a form?', detail: `This may submit the form.\nPage: ${wc.getURL()}` });
          if (!ok) throw new Error('The user declined. Do not retry; ask the user how to continue.');
        }
      }
      sendKey(wc, key);
      activity(`Pressed ${key}`);
      const target = await afterAction(wc);
      return { pressed: key, ...pageInfo(target) };
    },

    async scroll(args) {
      await ensureVisible();
      const wc = activeWc();
      const direction = ['up', 'down', 'top', 'bottom'].includes(args.direction) ? args.direction : 'down';
      const amount = Math.min(Math.max(Number(args.amount) || 600, 50), 5000);
      const result = await page(wc, `scroll(${JSON.stringify(direction)}, ${amount})`);
      await sleep(250);
      return { scrolledTo: result.y, maxScroll: result.max, note: 'Call browser_get_dom to number the elements now in view.' };
    },

    async get_dom() {
      await ensureVisible();
      const wc = activeWc();
      const data = await page(wc, `collect(${MAX_MARKS})`);
      const outline = await page(wc, 'outline()');
      const report = { url: outline.url, title: outline.title, viewport: data.viewport, marks: data.marks, headings: outline.headings, text: outline.text };
      const sparse = data.marks.length === 0 && outline.text.length < 40;
      return { text: truncate(formatDomReport(report), MAX_TEXT), markCount: data.marks.length, suggestVision: sparse, ...pageInfo(wc) };
    },

    async get_text(args) {
      await ensureVisible();
      const wc = activeWc();
      const selector = args.selector ? String(args.selector).slice(0, 300) : '';
      const index = args.index ? intArg(args.index, 'index') : 0;
      const result = await page(wc, `readText(${JSON.stringify(selector)}, ${index})`);
      if (result.error) throw new Error(result.error);
      return { text: truncate(result.text, MAX_TEXT), ...pageInfo(wc) };
    },

    async screenshot(args) {
      await ensureVisible();
      const wc = activeWc();
      let markList = '';
      if (args.marks !== false) {
        const data = await page(wc, `collect(${MAX_MARKS})`);
        markList = formatMarksList(data.marks);
      } else { await page(wc, 'redraw()'); }
      await page(wc, 'chrome(false)');
      await sleep(80);
      let image;
      try { image = await wc.capturePage(); } finally { await page(wc, 'chrome(true)').catch(() => {}); }
      if (!image || image.isEmpty()) throw new Error('The browser did not produce an image. Make sure the browser panel is visible.');
      let size = image.getSize();
      let scaled = size.width > SCREENSHOT_MAX_WIDTH ? image.resize({ width: SCREENSHOT_MAX_WIDTH }) : image;
      let jpeg = scaled.toJPEG(72);
      if (jpeg.length > SCREENSHOT_MAX_BYTES) { scaled = image.resize({ width: 900 }); jpeg = scaled.toJPEG(60); }
      size = scaled.getSize();
      return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, width: size.width, height: size.height, marks: truncate(markList, 6000), ...pageInfo(wc) };
    },

    async execute_js(args) {
      await ensureVisible();
      const wc = activeWc();
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('JavaScript code is required.');
      if (code.length > MAX_JS_CHARS) throw new Error(`Code is limited to ${MAX_JS_CHARS} characters.`);
      const ok = await approveAction({ title: 'Approve JavaScript?', message: 'Run this JavaScript in the current page?', detail: `Page: ${wc.getURL()}\n\n${truncate(code, 1500)}` });
      if (!ok) throw new Error('The user declined to run this JavaScript.');
      activity('Ran JavaScript in the page');
      const result = await Promise.race([
        wc.executeJavaScript(code, true),
        sleep(10_000).then(() => { throw new Error('The script took longer than 10 seconds.'); })
      ]);
      let text;
      try { text = typeof result === 'string' ? result : JSON.stringify(result === undefined ? null : result); } catch (_) { text = String(result); }
      return { result: truncate(text, 8000) };
    },

    // ---- fast game-play tools: no cursor animation, no settle waits ----
    async keys(args) {
      await ensureVisible();
      const wc = activeWc();
      const { steps, totalMs } = parseKeySteps(args.steps);
      if (steps.some(step => step.code === 'Return')) {
        const active = await page(wc, 'describeActive()');
        if (active && active.desc && active.inForm) {
          const ok = await approveAction({ title: 'Approve pressing Enter?', message: 'Press Enter inside a form?', detail: `This may submit the form.\nPage: ${wc.getURL()}` });
          if (!ok) throw new Error('The user declined. Do not retry; ask the user how to continue.');
        }
      }
      const token = interruptToken;
      const held = new Set();
      const started = Date.now();
      let done = 0;
      activity(`Keys: ${steps.filter(step => step.key).slice(0, 6).map(step => step.key).join(' ')}${steps.length > 6 ? '…' : ''}`);
      wc.focus();
      try {
        for (const step of steps) {
          if (token !== interruptToken) break;
          if (step.action === 'wait') { await sleep(step.wait); done++; continue; }
          const down = () => { wc.sendInputEvent({ type: 'keyDown', keyCode: step.code }); if (step.code.length === 1 || step.code === 'Space' || step.code === 'Return') wc.sendInputEvent({ type: 'char', keyCode: step.code === 'Space' ? ' ' : (step.code === 'Return' ? '\r' : step.code) }); };
          const up = () => wc.sendInputEvent({ type: 'keyUp', keyCode: step.code });
          if (step.action === 'down') { down(); held.add(step.code); }
          else if (step.action === 'up') { up(); held.delete(step.code); }
          else { down(); if (step.hold) await sleep(step.hold); up(); }
          if (step.wait) await sleep(step.wait);
          done++;
        }
      } finally {
        for (const code of held) { try { wc.sendInputEvent({ type: 'keyUp', keyCode: code }); } catch (_) { /* ignore */ } }
      }
      return { steps: done, of: steps.length, planned_ms: totalMs, elapsed_ms: Date.now() - started, interrupted: token !== interruptToken, held_released: held.size };
    },

    async mouse(args) {
      await ensureVisible();
      const wc = activeWc();
      const action = String(args.action || 'click');
      if (!['move', 'click', 'double', 'down', 'up', 'drag', 'wheel'].includes(action)) throw new Error('action must be move, click, double, down, up, drag or wheel.');
      const coord = (value, name, max) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${name} must be a number from 0 to ${Math.max(0, Math.floor(max))} (page pixels from the top-left of the browser view).`);
        return Math.round(n);
      };
      const x = coord(args.x, 'x', bounds.width);
      const y = coord(args.y, 'y', bounds.height);
      const button = ['left', 'right', 'middle'].includes(args.button) ? args.button : 'left';
      wc.focus();
      if (['click', 'double', 'down', 'drag'].includes(action) && !settings.autoApprove) {
        const desc = await wc.executeJavaScript(`(()=>{const e=document.elementFromPoint(${x},${y});if(!e)return null;if(e.tagName==='CANVAS')return {tag:'canvas'};const c=e.closest('a,button,input,[role=button],summary')||e;const label=(c.getAttribute('aria-label')||c.innerText||c.value||c.title||'').trim().slice(0,80);return {tag:c.tagName.toLowerCase(),type:c.type||'',role:c.getAttribute('role')||'',label,inForm:!!c.closest('form')};})()`, true).catch(() => null);
        const risk = classifyClickRisk(desc);
        if (risk.risky) {
          const ok = await approveAction({ title: 'Approve this click?', message: `Click “${(desc && desc.label) || (desc && desc.tag)}”?`, detail: `This ${risk.reason}.\nPage: ${wc.getURL()}` });
          if (!ok) throw new Error('The user declined this click. Do not retry it; explain what you need or ask the user.');
        }
      }
      const clicks = action === 'double' ? 2 : 1;
      const started = Date.now();
      if (action === 'move') wc.sendInputEvent({ type: 'mouseMove', x, y });
      else if (action === 'wheel') {
        wc.sendInputEvent({ type: 'mouseMove', x, y });
        wc.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: -Math.max(-2000, Math.min(2000, Math.round(Number(args.delta_x) || 0))), deltaY: -Math.max(-2000, Math.min(2000, Math.round(Number(args.delta_y) || 0))) });
        await sleep(30); // Electron's wheel deltas point the opposite way to the DOM's; negated so positive means scroll down
      } else if (action === 'down') { wc.sendInputEvent({ type: 'mouseMove', x, y }); wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 }); }
      else if (action === 'up') { wc.sendInputEvent({ type: 'mouseMove', x, y }); wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 }); }
      else if (action === 'drag') {
        const tx = coord(args.to_x, 'to_x', bounds.width);
        const ty = coord(args.to_y, 'to_y', bounds.height);
        const count = Math.min(Math.max(Math.round(Number(args.steps) || 12), 2), 60);
        const duration = Math.min(Math.max(Math.round(Number(args.duration_ms) || 200), 0), 3000);
        wc.sendInputEvent({ type: 'mouseMove', x, y });
        wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
        for (let i = 1; i <= count; i++) {
          wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x + (tx - x) * i / count), y: Math.round(y + (ty - y) * i / count) });
          if (duration) await sleep(duration / count);
        }
        wc.sendInputEvent({ type: 'mouseUp', x: tx, y: ty, button, clickCount: 1 });
      } else {
        wc.sendInputEvent({ type: 'mouseMove', x, y });
        for (let i = 1; i <= clicks; i++) { wc.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: i }); wc.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: i }); }
      }
      activity(`Mouse ${action} at ${x},${y}`);
      return { action, x, y, elapsed_ms: Date.now() - started, viewport: { width: Math.round(bounds.width), height: Math.round(bounds.height) } };
    },

    async look(args) {
      await ensureVisible();
      const wc = activeWc();
      const width = Math.min(Math.max(Math.round(Number(args.width) || 640), 160), 1280);
      const quality = Math.min(Math.max(Math.round(Number(args.quality) || 55), 30), 85);
      const frames = Math.min(Math.max(Math.round(Number(args.frames) || 1), 1), 4);
      const gap = Math.min(Math.max(Math.round(args.interval_ms === undefined ? 100 : Number(args.interval_ms) || 0), 0), 1000);
      let rect;
      if (args.region && typeof args.region === 'object') {
        rect = { x: Math.max(0, Math.round(Number(args.region.x) || 0)), y: Math.max(0, Math.round(Number(args.region.y) || 0)), width: Math.max(8, Math.round(Number(args.region.width) || 0)), height: Math.max(8, Math.round(Number(args.region.height) || 0)) };
        if (!(rect.width >= 8 && rect.height >= 8)) rect = undefined;
      }
      const started = Date.now();
      await wc.executeJavaScript('window.__larAgent&&window.__larAgent.chrome(false)', true).catch(() => {});
      const out = [];
      let size = { width: 0, height: 0 };
      try {
        for (let i = 0; i < frames; i++) {
          const at = Date.now();
          let image = rect ? await wc.capturePage(rect) : await wc.capturePage();
          if (!image || image.isEmpty()) throw new Error('The browser did not produce an image. Make sure the browser panel is visible.');
          if (image.getSize().width > width) image = image.resize({ width, quality: 'good' });
          size = image.getSize();
          out.push(`data:image/jpeg;base64,${image.toJPEG(quality).toString('base64')}`);
          if (i < frames - 1 && gap) await sleep(Math.max(0, gap - (Date.now() - at)));
        }
      } finally { await wc.executeJavaScript('window.__larAgent&&window.__larAgent.chrome(true)', true).catch(() => {}); }
      return { frames: out, width: size.width, height: size.height, elapsed_ms: Date.now() - started, viewport: { width: Math.round(bounds.width), height: Math.round(bounds.height) }, ...pageInfo(wc) };
    },

    // A small program that runs inside the page at frame rate, so reactions do not wait for the model.
    async reflex(args) {
      await ensureVisible();
      const wc = activeWc();
      const action = String(args.action || 'start');
      if (action === 'status') return { ...(await wc.executeJavaScript(REFLEX_STATUS, true)), ...pageInfo(wc) };
      if (action === 'stop') return { ...(await wc.executeJavaScript(REFLEX_STOP, true)), ...pageInfo(wc) };
      if (action !== 'start') throw new Error('action must be start, status or stop.');
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('code is required to start a reflex.');
      if (code.length > MAX_REFLEX_CHARS) throw new Error(`Reflex code is limited to ${MAX_REFLEX_CHARS} characters.`);
      const interval = Number(args.interval_ms) > 0 ? Math.min(Math.max(Math.round(Number(args.interval_ms)), 4), 1000) : 0;
      const duration = Math.min(Math.max(Math.round(Number(args.duration_ms) || 30_000), 500), 120_000);
      const ok = await approveAction({ title: 'Approve a game-speed script?', message: 'Run this script repeatedly inside the current page?', detail: `It can press keys and click in the page for up to ${Math.round(duration / 1000)} seconds.\nPage: ${wc.getURL()}\n\n${truncate(code, 1500)}` });
      if (!ok) throw new Error('The user declined to run this script.');
      activity(`Reflex loop started (${interval ? `every ${interval} ms` : 'every frame'}, up to ${Math.round(duration / 1000)} s)`);
      let result;
      try { result = await wc.executeJavaScript(buildReflexSource(code, interval, duration), true); }
      catch (error) { throw new Error(`The script could not start: ${String(error && error.message || error).slice(0, 300)}`); }
      return { ...result, ...pageInfo(wc) };
    },

    async new_tab(args) {
      await ensureVisible();
      const id = createTab();
      activate(id);
      if (args && args.url) return { tabIndex: order.indexOf(id) + 1, ...(await tools.navigate({ url: args.url })) };
      return { tabIndex: order.indexOf(id) + 1 };
    },

    async close_tab(args) {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 1 || index > order.length) throw new Error(`Tab number must be between 1 and ${order.length}.`);
      destroyTab(order[index - 1]);
      return { remaining: order.length };
    },

    async switch_tab(args) {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 1 || index > order.length) throw new Error(`Tab number must be between 1 and ${order.length}.`);
      activate(order[index - 1]);
      return pageInfo(activeWc());
    },

    async list_tabs() {
      return { tabs: snapshot().tabs.map((t, n) => ({ index: n + 1, title: t.title, url: t.url, active: t.active })) };
    },

    async wait(args) {
      const ms = Math.min(Math.max(Number(args.ms) || 1000, 100), 5000);
      await sleep(ms);
      const wc = activeWc();
      await waitForLoad(wc, 5000);
      return pageInfo(wc);
    }
  };

  /* ---------- public API ---------- */
  return {
    setBounds(rect) {
      const w = window_();
      const content = w ? w.getContentBounds() : { width: 16384, height: 16384 };
      bounds = normalizeBounds(rect, content);
      applyAttachment();
      return true;
    },
    setVisible(value) { visible = !!value; applyAttachment(); emitState(); return true; },
    setAskNewSites(value) { settings.askNewSites = !!value; emitState(); return true; },
    setAutoApprove(value) { settings.autoApprove = !!value; emitState(); return true; },
    interrupt() {
      interruptToken++;
      for (const t of tabs.values()) {
        const wc = t.view && t.view.webContents;
        if (wc && !wc.isDestroyed()) wc.executeJavaScript(REFLEX_STOP, true).catch(() => {});
      }
      return true;
    },
    setAgentActive(value) {
      agentActive = !!value;
      clearTimeout(agentTimer);
      if (agentActive) agentTimer = setTimeout(() => { agentActive = false; emitState(); }, AGENT_ACTIVE_LIMIT_MS);
      const t = activeId && tabs.get(activeId);
      if (t && !t.view.webContents.isDestroyed()) injectActive(t.view.webContents, agentActive);
      emitState();
      return true;
    },
    getState() { return snapshot(); },

    async userNavigate(input) {
      const v = validateNavigationUrl(input);
      approvedOrigins.add(v.origin);
      const wc = activeWc();
      try { await wc.loadURL(v.url); } catch (error) { if (!(error && (error.code === 'ERR_ABORTED' || error.errno === -3))) throw new Error(`Could not load the page: ${error.message}`); }
      emitState();
      return pageInfo(wc);
    },
    userAction(name) {
      const wc = activeWc();
      const history = wc.navigationHistory;
      if (name === 'back' && history.canGoBack()) history.goBack();
      else if (name === 'forward' && history.canGoForward()) history.goForward();
      else if (name === 'reload') wc.reload();
      else if (name === 'stop') wc.stop();
      emitState();
      return true;
    },
    userTab(op, payload) {
      if (op === 'new') { const id = createTab(); activate(id); return { id }; }
      if (op === 'close') { if (!tabs.has(String(payload))) throw new Error('That tab does not exist.'); destroyTab(String(payload)); return true; }
      if (op === 'switch') { activate(String(payload)); return true; }
      throw new Error('Unknown tab operation.');
    },
    async clearData() {
      const ses = ensureSession();
      await ses.clearStorageData();
      await ses.clearCache();
      approvedOrigins.clear();
      return true;
    },

    runTool(name, args) {
      if (!Object.prototype.hasOwnProperty.call(tools, name)) return Promise.reject(new Error(`Unknown browser tool “${name}”.`));
      const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
      return enqueue(() => tools[name](safeArgs));
    },

    shutdown() {
      clearTimeout(agentTimer); clearTimeout(stateTimer);
      for (const id of [...order]) destroyTab(id);
      attachedId = null; activeId = null; visible = false;
    }
  };
}

module.exports = {
  createBrowserService,
  validateNavigationUrl, isPrivateHost, classifyClickRisk, isSensitiveField,
  normalizeBounds, formatMarksList, formatDomReport, truncate, parseKeySteps, resolveKeyCode,
  PARTITION, LIB_SOURCE
};
