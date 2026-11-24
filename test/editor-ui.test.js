'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor-ui.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editorCss = fs.readFileSync(path.join(root, 'editor-components.css'), 'utf8');
const highlighter = fs.readFileSync(path.join(root, 'editor-highlighter.js'), 'utf8');

test('editor exposes a correctly wired save action', () => {
  assert.match(editor, /class="btn small primary editor-save" data-action="save" disabled/);
  assert.doesNotMatch(editor, /editor-save data-action="save"/);
});

test('editor includes workspace search and bounded result handling', () => {
  assert.match(editor, /workspace\.search\(term\)/);
  assert.match(editor, /response\.capped/);
  assert.match(editor, /setSelectionRange\(offset/);
});

test('editor AI actions send selected code or the active file to chat', () => {
  for (const action of ['explain', 'debug', 'refactor', 'tests', 'review']) {
    assert.match(editor, new RegExp(`data-ai-action="${action}"`));
  }
  assert.match(editor, /selectionEnd>input\.selectionStart/);
  assert.match(editor, /window\.localAI\.editor\.askAI\(prompt\)/);
});

test('AI request bridge is exposed through preload and validated in main', () => {
  assert.match(preload, /askAI\(prompt\).*editor:ai-request/s);
  assert.match(main, /ipcMain\.on\('editor:ai-request'/);
  assert.match(main, /assertTrustedRenderer\(event\)/);
  assert.match(renderer, /onAIRequest\?\.\(promptText/);
});


test('editor provides VS Code-like language-colored file icons', () => {
  for (const kind of ['html', 'javascript', 'typescript', 'css', 'json', 'python', 'java']) {
    assert.match(editorCss, new RegExp('file-icon-' + kind));
  }
  assert.match(editor, /'\.html':\['<>','html'\]/);
  assert.match(editor, /'\.js':\['JS','javascript'\]/);
  assert.match(editor, /'\.css':\['#','css'\]/);
  assert.match(editorCss, /\.editor-tree-item span:first-child:not\(\.editor-file-icon\)/);
});

test('editor supports collapsible tabs and a nested expandable Explorer', () => {
  assert.match(editor, /dataset\.action='tabs-toggle'/);
  assert.match(editor, /tabs-collapsed/);
  assert.match(editor, /querySelector\('\.editor-shell'\)\?\.classList\.toggle\('tabs-collapsed'\)/);
  assert.match(editor, /editor-tree-children/);
  assert.match(editor, /aria-expanded/);
  assert.match(editor, /auxclick/);
  assert.match(editor, /aria-label','Close '\+tab\.path/);
});

test('editor adds indentation guides and expands its docked Explorer on hover', () => {
  assert.match(highlighter, /editor-indent-guide/);
  assert.match(editorCss, /\.editor-indent-guide/);
  assert.match(editorCss, /#editorDockRoot \.editor-explorer:hover/);
  assert.match(editorCss, /#editorDockRoot \.editor-shell\.show-ai-panel \.editor-ai-panel/);
});

test('browser and editor workspace views fill the available workspace area', () => {
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.match(styles, /#browserView\.workspace-view,[\s\S]*?#editorView\.workspace-view\s*\{\s*padding:\s*0;/);
  assert.match(styles, /#browserView \.browser-host\s*\{\s*background:\s*var\(--panel-2\)/);
  assert.match(styles, /#chatView\.has-both-docks \.chat-column\{min-width:0\}/);
  assert.match(styles, /#chatView\.has-both-docks \.browser-dock,[\s\S]*?#chatView\.has-both-docks \.editor-dock\s*\{\s*width:\s*var\(--dock-panel-width,[\s\S]*?max-width:\s*none;[\s\S]*?flex-basis:\s*var\(--dock-panel-width,/);
});

test('popped-out editor opens maximized with full-width editor content', () => {
  assert.match(main, /editorWindow\.maximize\(\);editorWindow\.show\(\)/);
  assert.match(editorCss, /\.editor-window-main \.editor-shell\{width:100%;min-width:0;border-radius:0\}/);
});

test('editor navigation label has an English fallback and accessible name', () => {
  assert.match(index, /data-view="editor" aria-label="Code editor"[^>]*><span class="nav-icon">⌘<\/span><span>Code editor<\/span>/);
  assert.match(renderer, /chat:'Chats',projects:'Projects',editor:'Code editor'/);
  assert.match(renderer, /TRANSLATIONS\.en\[button\.dataset\.view\]\|\|label\.textContent/);
});
