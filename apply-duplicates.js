#!/usr/bin/env node
'use strict';
// Run from the Sleeve project root: node apply-duplicates.js
// Local-only patch: this script never connects to or updates GitHub.
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const htmlPath = path.join(root, 'index.html');
const rendererPath = path.join(root, 'renderer.js');
const cssLower = path.join(root, 'main.css');
const cssUpper = path.join(root, 'Main.css');
function fail(message) { console.error(`Sleeve duplicate patch: ${message}`); process.exit(1); }
for (const p of [htmlPath, rendererPath]) if (!fs.existsSync(p)) fail(`Required file missing: ${path.basename(p)}. Run this from the Sleeve project root.`);
let html = fs.readFileSync(htmlPath, 'utf8');
let renderer = fs.readFileSync(rendererPath, 'utf8');
const cssPath = fs.existsSync(cssLower) ? cssLower : (fs.existsSync(cssUpper) ? cssUpper : null);
if (!cssPath) fail('Could not find main.css or Main.css. No files changed.');
let css = fs.readFileSync(cssPath, 'utf8');
if (html.includes('id="dupeBanner"') || renderer.includes('SLEEVE_DUPLICATE_DETECTION_INTEGRATED')) fail('Duplicate feature appears to be installed already. No files changed.');
if (!html.includes('<link href="main.css"')) fail('Expected lowercase main.css link was not found. No files changed.');
if (!html.includes('<div class="main-content">') || !html.includes('<script src="./renderer.js">')) fail('Expected HTML insertion points were not found. No files changed.');
if (!renderer.includes('function scheduleRender(query, opts){') || !renderer.includes('function addFiles(fileList){')) fail('Expected renderer insertion points were not found. No files changed.');
const helperSource = fs.readFileSync(path.join(__dirname, 'duplicate-detection.js'), 'utf8');
const rendererInsert = fs.readFileSync(path.join(__dirname, 'renderer-insert.txt'), 'utf8');
let newHtml = html.replace('<script src="./renderer.js">', '<script src="./duplicate-detection.js"></script>\n<script src="./renderer.js">');
newHtml = newHtml.replace('<div class="main-content">', `<div class="main-content">\n        <div class="dupe-banner" id="dupeBanner" role="status" aria-live="polite" hidden>\n          <span class="dupe-banner-icon" aria-hidden="true">⚠</span><span class="dupe-banner-text" id="dupeBannerText"></span>\n          <button class="dupe-banner-btn" id="dupeReviewBtn" type="button">Review</button>\n          <button class="dupe-banner-dismiss" id="dupeBannerDismiss" type="button" aria-label="Dismiss duplicate notice">×</button>\n        </div>`);
newHtml = newHtml.replace('</body>', `<div class="dupe-modal-overlay" id="dupeModalOverlay" role="dialog" aria-modal="true" aria-labelledby="dupeModalTitle" aria-hidden="true" hidden>\n  <div class="dupe-modal-box">\n    <div class="dupe-modal-header"><h3 id="dupeModalTitle">Review possible duplicates</h3><button class="dupe-modal-close" id="dupeModalClose" type="button" aria-label="Close">×</button></div>\n    <p class="dupe-modal-sub">Sleeve compares track metadata and file size. Review each group before removing anything.</p>\n    <div class="dupe-group-list" id="dupeGroupList"></div>\n  </div>\n</div>\n</body>`);
if (newHtml === html || !newHtml.includes('id="dupeBanner"') || !newHtml.includes('duplicate-detection.js')) fail('Could not safely patch index.html. No files changed.');
renderer = renderer.replace('function scheduleRender(query, opts){', rendererInsert + '\n  function scheduleRender(query, opts){');
renderer = renderer.replace('function scheduleRender(query, opts){', 'function scheduleRender(query, opts){\n    scheduleDuplicateScan();');
renderer = renderer.replace("if (changed){\n          dbPut(track);", "if (changed){\n          dbPut(track);\n          scheduleDuplicateScan();");
css += `\n\n/* Sleeve duplicate review feature */\n.dupe-banner[hidden], .dupe-modal-overlay[hidden] { display:none !important; }\n.dupe-modal-overlay { position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.68); }\n.dupe-modal-box { width:min(640px,100%); max-height:82vh; display:flex; flex-direction:column; padding:22px; border:1px solid var(--line-bright); border-radius:14px; background:var(--bg-elevated,#16233a); box-shadow:0 24px 70px rgba(0,0,0,.55); }\n.dupe-group-list { overflow:auto; min-height:0; display:flex; flex-direction:column; gap:12px; }\n.dupe-group { border:1px solid var(--line-bright); border-radius:10px; padding:12px; }\n.dupe-group h4 { margin:0 0 8px; font-size:14px; }\n.dupe-track-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--line); }\n.dupe-track-details { min-width:0; display:flex; flex-direction:column; gap:3px; }\n.dupe-track-details strong,.dupe-track-details small { overflow-wrap:anywhere; }\n.dupe-track-details small { color:var(--text-dim,#93a0b8); font-size:11px; }\n.dupe-track-actions { flex-shrink:0; }\n.dupe-keep-label { color:var(--text-dim,#93a0b8); font-size:12px; }\n.dupe-remove-btn,.dupe-ignore-btn { border:1px solid var(--line-bright); border-radius:7px; padding:6px 9px; background:rgba(255,255,255,.05); color:var(--text,#eef1f6); cursor:pointer; font-size:12px; }\n.dupe-remove-btn:hover,.dupe-ignore-btn:hover { background:rgba(255,255,255,.1); }\n.dupe-ignore-btn { margin-top:8px; }\n`;
if (!renderer.includes('scheduleDuplicateScan();') || !renderer.includes('SLEEVE_DUPLICATE_DETECTION_INTEGRATED')) fail('Renderer integration validation failed. No files changed.');
// Validate JS syntax of the injected renderer fragment before writing.
new Function(rendererInsert.replace('  // SLEEVE_DUPLICATE_DETECTION_INTEGRATED', '').replace(/document\.getElementById\('dupeReviewBtn'\)[\s\S]*$/, ''));
// Write only after all checks pass.
fs.writeFileSync(htmlPath, newHtml, 'utf8');
fs.writeFileSync(rendererPath, renderer, 'utf8');
fs.writeFileSync(path.join(root, 'duplicate-detection.js'), helperSource, 'utf8');
fs.writeFileSync(cssLower, css, 'utf8');
if (cssPath === cssUpper) fs.unlinkSync(cssUpper);
console.log('Duplicate detection installed locally. GitHub was not modified.');
console.log('Files updated: index.html, renderer.js, main.css; added duplicate-detection.js');
