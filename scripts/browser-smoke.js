'use strict';

// End-to-end smoke test for the integrated browser service, run inside real Electron:
//   xvfb-run -a npx electron --no-sandbox --disable-gpu scripts/browser-smoke.js      (Linux, headless)
//   npx electron scripts/browser-smoke.js                                             (desktop)
// It serves a small form from 127.0.0.1, drives it through the same tool layer the AI uses,
// and checks approvals, sensitive-field protection and URL policy.

const http = require('node:http');
const { app, BrowserWindow, session, WebContentsView } = require('electron');
const { createBrowserService } = require('../services/browser-service');

const results = [];
const record = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const expect = (name, condition, detail) => record(name, !!condition, condition ? '' : detail);
const expectThrows = async (name, fn, pattern) => {
  try { await fn(); record(name, false, 'did not throw'); }
  catch (error) { record(name, !pattern || pattern.test(error.message), pattern && !pattern.test(error.message) ? `wrong error: ${error.message}` : ''); }
};

const FORM_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Smoke Form</title></head><body>
<h1>Order form</h1>
<a href="/other">Other page</a>
<form id="f" action="/submit" method="get">
  <label for="n">Your name</label><input id="n" name="name" type="text">
  <label for="pw">Password</label><input id="pw" name="pw" type="password">
  <label for="c">Colour</label><select id="c" name="colour"><option value="r">Red</option><option value="g">Green</option><option value="b">Blue</option></select>
  <label><input type="checkbox" id="agree" name="agree" value="yes"> I agree</label>
  <button type="button" id="more" onclick="document.title='More clicked'">Show more</button>
  <button type="submit">Place order</button>
</form></body></html>`;

const GAME_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Game</title></head>
<body style="margin:0;background:#111"><canvas id="c" width="200" height="200" style="position:fixed;left:0;top:0"></canvas>
<script>
const ctx = document.getElementById('c').getContext('2d'); ctx.fillStyle = 'rgb(255,0,0)'; ctx.fillRect(0, 0, 200, 200);
window.events = [];
const add = (type, e) => window.events.push({ type, key: e.key, code: e.code, kc: e.keyCode, x: e.clientX, y: e.clientY, dy: e.deltaY, trusted: e.isTrusted, t: performance.now() });
for (const t of ['keydown', 'keyup']) window.addEventListener(t, e => add(t, e));
for (const t of ['mousedown', 'mouseup', 'click']) window.addEventListener(t, e => add(t, e));
window.addEventListener('wheel', e => add('wheel', e));
</script></body></html>`;
const DANGER_PAGE = `<!doctype html><title>Danger</title><body style="margin:0"><form action="/danger-submit" method="get"><button type="submit" style="position:fixed;left:0;top:0;width:300px;height:120px">Place order</button></form></body>`;

(async () => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/submit')) return res.end('<!doctype html><title>Submitted</title><p>Thanks</p>');
    if (req.url.startsWith('/game')) return res.end(GAME_PAGE);
    if (req.url.startsWith('/danger')) return res.end(DANGER_PAGE);
    if (req.url.startsWith('/other')) return res.end('<!doctype html><title>Other</title><p>Other page</p>');
    res.end(FORM_PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  await app.whenReady();
  const win = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html,<body style="margin:0;background:#222"><div id=host></div></body>');

  const prompts = [];
  let answer = 0;
  const dialog = { showMessageBox: async (_w, opts) => { prompts.push(opts.title); return { response: answer }; } };
  const svc = createBrowserService({ app, dialog, session, WebContentsView, getMainWindow: () => win });

  svc.setBounds({ x: 0, y: 60, width: 1000, height: 700 });
  svc.setVisible(true);
  svc.setAgentActive(true);

  // 1. private address needs approval, then loads
  const nav = await svc.runTool('navigate', { url: base + '/' });
  expect('navigate loads the page', nav.title === 'Smoke Form', JSON.stringify(nav));
  expect('private address prompted for approval', prompts.includes('Allow the AI to open this site?'), JSON.stringify(prompts));

  // 2. numbered elements
  const dom = await svc.runTool('get_dom', {});
  const find = (label, extra = '') => { const m = dom.text.split('\n').find(line => line.includes(label) && line.includes(extra)); const g = m && m.match(/^\[(\d+)\]/); return g ? Number(g[1]) : 0; };
  const nameIdx = find('Your name'); const pwIdx = find('Password'); const colourIdx = find('Colour'); const agreeIdx = find('I agree');
  const moreIdx = find('Show more'); const submitIdx = find('Place order'); const linkIdx = find('Other page');
  expect('get_dom numbers the interactive elements', dom.markCount >= 7 && nameIdx && pwIdx && colourIdx && agreeIdx && moreIdx && submitIdx && linkIdx, dom.text);

  // 3. typing
  const typed = await svc.runTool('type', { index: nameIdx, text: 'Ada Lovelace' });
  expect('type fills a text field', typed.fieldValue === 'Ada Lovelace', JSON.stringify(typed));
  const retyped = await svc.runTool('type', { index: nameIdx, text: 'Grace' });
  expect('type replaces existing text by default', retyped.fieldValue === 'Grace', JSON.stringify(retyped));
  await expectThrows('type refuses a password field', () => svc.runTool('type', { index: pwIdx, text: 'hunter2' }), /password|must not fill/i);

  // 4. select + checkbox + harmless click (no approval expected for the harmless button)
  const before = prompts.length;
  const sel = await svc.runTool('select', { index: colourIdx, value: 'Green' });
  expect('select chooses an option by text', sel.selected === 'Green', JSON.stringify(sel));
  await svc.runTool('click', { index: agreeIdx });
  const check = await svc.runTool('get_dom', {});
  expect('click toggles a checkbox', /input:checkbox "I agree" \(checked\)/.test(check.text), check.text);
  await svc.runTool('click', { index: moreIdx });
  const afterMore = await svc.runTool('get_text', { selector: 'h1' });
  expect('harmless button click ran without an approval prompt', prompts.length === before && /Show more|Order form/.test(afterMore.text + afterMore.title) && afterMore.title === 'More clicked', `${prompts.length - before} prompts, title=${afterMore.title}`);

  // 5. screenshot (set-of-marks)
  const shot = await svc.runTool('screenshot', {});
  expect('screenshot returns a JPEG data URL with marks', /^data:image\/jpeg;base64,/.test(shot.dataUrl) && shot.dataUrl.length > 4000 && /Place order/.test(shot.marks), `len=${shot.dataUrl.length}`);

  // 6. declined submit keeps the form unsubmitted
  const fresh = await svc.runTool('get_dom', {});
  const submit2 = (fresh.text.split('\n').find(l => l.includes('Place order')).match(/^\[(\d+)\]/) || [])[1];
  answer = 1; // Decline
  await expectThrows('declining a submit click is respected', () => svc.runTool('click', { index: Number(submit2) }), /declined/i);
  expect('declined submit did not reach the server', !hits.some(u => u.startsWith('/submit')), JSON.stringify(hits));

  // 7. approved submit goes through with the typed values
  answer = 0;
  const submitted = await svc.runTool('click', { index: Number(submit2) });
  expect('approved submit navigates', submitted.title === 'Submitted', JSON.stringify(submitted));
  expect('submitted form contained typed values', hits.some(u => u.startsWith('/submit') && u.includes('name=Grace') && u.includes('colour=g') && u.includes('agree=yes')), JSON.stringify(hits));
  expect('submit click asked for approval', prompts.includes('Approve this click?'), JSON.stringify(prompts));

  // 8. Enter key submits (and asks approval)
  await svc.runTool('navigate', { url: base + '/' });
  const dom2 = await svc.runTool('get_dom', {});
  const n2 = Number((dom2.text.split('\n').find(l => l.includes('Your name')).match(/^\[(\d+)\]/) || [])[1]);
  const hitsBefore = hits.length;
  await svc.runTool('type', { index: n2, text: 'Enter test', submit: true });
  expect('type with submit presses Enter and submits', hits.slice(hitsBefore).some(u => u.startsWith('/submit') && u.includes('name=Enter+test')), JSON.stringify(hits.slice(hitsBefore)));

  // 9. execute_js asks approval, runs in page, declines respected
  await svc.runTool('navigate', { url: base + '/' });
  const js = await svc.runTool('execute_js', { code: 'document.title + "!"' });
  expect('execute_js returns a result after approval', js.result === 'Smoke Form!', JSON.stringify(js));
  answer = 1;
  await expectThrows('execute_js declined is respected', () => svc.runTool('execute_js', { code: '1+1' }), /declined/i);
  answer = 0;

  // 10. tabs
  await svc.runTool('new_tab', { url: base + '/other' });
  let tabsList = await svc.runTool('list_tabs', {});
  expect('new_tab opens a second tab', tabsList.tabs.length === 2 && tabsList.tabs[1].active && tabsList.tabs[1].title === 'Other', JSON.stringify(tabsList));
  await svc.runTool('switch_tab', { index: 1 });
  tabsList = await svc.runTool('list_tabs', {});
  expect('switch_tab changes the active tab', tabsList.tabs[0].active, JSON.stringify(tabsList));
  await svc.runTool('close_tab', { index: 2 });
  tabsList = await svc.runTool('list_tabs', {});
  expect('close_tab removes a tab', tabsList.tabs.length === 1, JSON.stringify(tabsList));

  // 11. scroll + wait + stale marks
  const scrolled = await svc.runTool('scroll', { direction: 'bottom' });
  expect('scroll reports position', typeof scrolled.scrolledTo === 'number', JSON.stringify(scrolled));
  await svc.runTool('navigate', { url: base + '/other' });
  await expectThrows('stale element numbers are rejected after navigation', () => svc.runTool('click', { index: 3 }), /no longer valid/i);

  // 12. URL policy
  await expectThrows('file:// is blocked', () => svc.runTool('navigate', { url: 'file:///etc/passwd' }), /http/i);
  await expectThrows('javascript: is blocked', () => svc.runTool('navigate', { url: 'javascript:alert(1)' }), /http/i);
  await expectThrows('unknown tool is rejected', () => svc.runTool('rm_rf', {}), /Unknown/);

  // 13. new sites need approval while the agent is active, and a refusal blocks navigation
  answer = 1;
  await expectThrows('visiting a new public site can be refused', () => svc.runTool('navigate', { url: 'https://example.com' }), /did not allow/i);
  answer = 0;

  // 14. game tools: fast keys, mouse, look, reflex
  await svc.runTool('navigate', { url: base + '/game' });
  const events = () => win.webContents.session && svc._debugEvents ? null : null;
  const pageEvents = async () => (await svc.runTool('execute_js', { code: 'JSON.stringify(window.events)' })).result;
  const promptsBeforeGame = prompts.length;
  let keyRun = await svc.runTool('keys', { steps: ['ArrowLeft', { key: 'Space', action: 'down' }, { wait_ms: 150 }, { key: 'Space', action: 'up' }, { key: 'a', hold_ms: 20 }] });
  const promptsAfterKeys = prompts.length;
  expect('keys runs every step quickly', keyRun.steps === 5 && keyRun.elapsed_ms < 1200, JSON.stringify(keyRun));
  const ev1 = JSON.parse(await pageEvents());
  const types = ev1.filter(e => e.type.startsWith('key')).map(e => `${e.type}:${e.key}`);
  expect('keys deliver real key events in order', types.join(',') === 'keydown:ArrowLeft,keyup:ArrowLeft,keydown: ,keyup: ,keydown:a,keyup:a', types.join(','));
  expect('keys are trusted browser input', ev1.filter(e => e.type.startsWith('key')).every(e => e.trusted === true), JSON.stringify(ev1.slice(0, 2)));
  const down = ev1.find(e => e.type === 'keydown' && e.key === ' '); const upEv = ev1.find(e => e.type === 'keyup' && e.key === ' ');
  expect('a held key stays down for the requested time', upEv.t - down.t >= 120, `${upEv.t - down.t} ms`);
  expect('arrow keys carry legacy keyCode 37', ev1.find(e => e.key === 'ArrowLeft').kc === 37, JSON.stringify(ev1.find(e => e.key === 'ArrowLeft')));
  expect('keys needs no approval outside forms', promptsAfterKeys === promptsBeforeGame, JSON.stringify(prompts.slice(promptsBeforeGame, promptsAfterKeys)));
  await expectThrows('keys rejects an unknown key name', () => svc.runTool('keys', { steps: ['Banana'] }), /Unsupported key/);
  await expectThrows('keys rejects sequences that run too long', () => svc.runTool('keys', { steps: [{ key: 'a', hold_ms: 5000 }, { key: 'a', hold_ms: 5000 }, { key: 'a', hold_ms: 5000 }, { key: 'a', hold_ms: 5000 }, { key: 'a', hold_ms: 5000 }] }), /seconds/);

  await svc.runTool('execute_js', { code: 'window.events.length = 0; 1' });
  await svc.runTool('mouse', { action: 'click', x: 120, y: 80 });
  await svc.runTool('mouse', { action: 'wheel', x: 100, y: 100, delta_y: 240 });
  await new Promise(r => setTimeout(r, 150));
  const ev2 = JSON.parse(await pageEvents());
  const click = ev2.find(e => e.type === 'click');
  expect('mouse click lands on the requested page coordinates', click && click.x === 120 && click.y === 80 && click.trusted, JSON.stringify(ev2));
  expect('mouse wheel reaches the page', ev2.some(e => e.type === 'wheel' && e.dy > 0), JSON.stringify(ev2));
  await expectThrows('mouse rejects out-of-range coordinates', () => svc.runTool('mouse', { action: 'click', x: 99999, y: 5 }), /must be a number/);

  const t0 = Date.now();
  const look = await svc.runTool('look', { width: 320, frames: 3, interval_ms: 50 });
  expect('look returns small JPEG frames fast', look.frames.length === 3 && look.frames.every(f => /^data:image\/jpeg;base64,/.test(f)) && look.width <= 320 && Date.now() - t0 < 3000, `${look.frames.length} frames, ${look.width}px, ${Date.now() - t0} ms`);
  const zoom = await svc.runTool('look', { region: { x: 0, y: 0, width: 100, height: 100 }, width: 200 });
  expect('look can zoom into a region', zoom.frames.length === 1 && zoom.width <= 200, JSON.stringify({ w: zoom.width, h: zoom.height }));

  // reflex: runs in the page, reads canvas pixels, presses keys, stops itself
  await svc.runTool('execute_js', { code: 'window.events.length = 0; 1' });
  const started = await svc.runTool('reflex', { action: 'start', code: 'api.mem.n = (api.mem.n || 0) + 1; if (api.mem.n === 5) { api.key("ArrowRight"); api.log("pressed", api.pixel(50, 50)); } if (api.mem.n >= 30) api.stop({ ticks: api.mem.n, pixel: api.pixel(50, 50) });', duration_ms: 5000 });
  expect('reflex starts in the background', started.started === true, JSON.stringify(started));
  expect('reflex start asked for approval', prompts.includes('Approve a game-speed script?'), JSON.stringify(prompts));
  await new Promise(r => setTimeout(r, 900));
  const status = await svc.runTool('reflex', { action: 'status' });
  expect('reflex finished by itself and reported a result', status.running === false && status.ended === 'stopped by script' && status.result && status.result.ticks === 30, JSON.stringify(status));
  expect('reflex read canvas pixels', status.result && JSON.stringify(status.result.pixel) === '[255,0,0,255]', JSON.stringify(status.result));
  expect('reflex logged what it did', status.log.some(l => l.includes('pressed')), JSON.stringify(status.log));
  const ev3 = JSON.parse(await pageEvents());
  expect('reflex key presses reach page listeners with legacy keyCode', ev3.some(e => e.type === 'keydown' && e.key === 'ArrowRight' && e.kc === 39), JSON.stringify(ev3));
  expect('reflex ran at frame rate', status.ticks_per_second >= 20 || status.elapsed_ms < 1500, JSON.stringify({ tps: status.ticks_per_second, ms: status.elapsed_ms }));

  await expectThrows('a reflex with a syntax error reports it', () => svc.runTool('reflex', { action: 'start', code: 'if (' }), /could not start/i);
  answer = 1;
  await expectThrows('declining a reflex is respected', () => svc.runTool('reflex', { action: 'start', code: 'api.stop()' }), /declined/i);
  answer = 0;

  // interrupt stops a long-running reflex and releases held keys
  await svc.runTool('reflex', { action: 'start', code: 'api.down("ArrowUp");', duration_ms: 60000 });
  const running = await svc.runTool('reflex', { action: 'status' });
  svc.interrupt();
  await new Promise(r => setTimeout(r, 300));
  const stopped = await svc.runTool('reflex', { action: 'status' });
  expect('interrupt stops a running reflex and releases held keys', running.running === true && stopped.running === false && stopped.held_keys.length === 0, JSON.stringify({ running: running.running, stopped }));

  // 15. coordinate clicks on a risky button still need approval, until auto-approve is on
  await svc.runTool('navigate', { url: base + '/danger' });
  answer = 1;
  await expectThrows('a risky coordinate click can be declined', () => svc.runTool('mouse', { action: 'click', x: 50, y: 40 }), /declined/i);
  expect('declined coordinate click did not submit', !hits.some(u => u.startsWith('/danger-submit')), JSON.stringify(hits));
  svc.setAutoApprove(true);
  const promptsBeforeAuto = prompts.length;
  await svc.runTool('mouse', { action: 'click', x: 50, y: 40 });
  await new Promise(r => setTimeout(r, 600));
  expect('auto-approve lets the click through without a prompt', hits.some(u => u.startsWith('/danger-submit')) && prompts.length === promptsBeforeAuto, JSON.stringify({ hits, prompts: prompts.slice(promptsBeforeAuto) }));
  const autoJs = await svc.runTool('execute_js', { code: '2 + 2' });
  expect('auto-approve covers page scripts too', autoJs.result === '4' && prompts.length === promptsBeforeAuto, JSON.stringify(autoJs));
  expect('auto-approve is reflected in browser state', svc.getState().autoApprove === true, JSON.stringify(svc.getState()));
  const privateNav = await svc.runTool('navigate', { url: base + '/' }).then(() => 'loaded').catch(e => e.message);
  expect('an already-approved local address still loads', privateNav === 'loaded', privateNav);
  await expectThrows('auto-approve still never fills password fields', async () => { const d = await svc.runTool('get_dom', {}); const idx = Number((d.text.split('\n').find(l => l.includes('Password')).match(/^\[(\d+)\]/) || [])[1]); return svc.runTool('type', { index: idx, text: 'x' }); }, /password|must not fill/i);
  svc.setAutoApprove(false);

  svc.shutdown();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  app.exit(failed.length ? 1 : 0);
})().catch(error => { console.error('SMOKE TEST CRASHED:', error); app.exit(2); });

setTimeout(() => { console.error('SMOKE TEST TIMED OUT'); app.exit(3); }, 120_000);
