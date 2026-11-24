'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'app-renderer.js'), 'utf8');
const { rendererFiles } = require(path.join(root, 'scripts', 'build-runtime.js'));
const sourceDir = path.join(root, 'src', 'features', 'find-music', 'ui');
const sources = [
  'find-music.js',
  'find-music-watch-ui.js',
  'find-music-download-ui.js',
  'find-music-import-core.js',
  'find-music-import-ui.js',
  'find-music-convert-ui.js'
];

assert.equal((html.match(/src=["']\.\/app-renderer\.js["']/g) || []).length, 1, 'index.html should load the renderer master bundle once');
assert.equal((html.match(/src=["']\.\/(?:duplicate-detection|renderer|playlist-import|find-music|find-music-watch-ui|find-music-download-ui|find-music-import-core|find-music-import-ui|find-music-convert-ui|spotdl-integration|mini-player-ui|audio-enhancements)\.js["']/g) || []).length, 0, 'index.html should not load renderer sources separately');
for (const file of sources) {
  assert.ok(fs.existsSync(path.join(sourceDir, file)), `source module should be kept at src/features/find-music/ui/${file}`);
  assert.equal((html.match(new RegExp(`src=["']\\./${file.replace(/\./g, '\\.')}["']`, 'g')) || []).length, 0, `index.html should no longer load ${file} separately`);
  assert.ok(bundle.includes(`BEGIN ${file}`), `bundle should include ${file} in the generated source map markers`);
}
const positions = rendererFiles.map((file) => bundle.indexOf(`BEGIN ${file}`));
assert.ok(rendererFiles.includes('find-music.js'), 'renderer bundle should include Find Music');
for (let i = 1; i < positions.length; i += 1) assert.ok(positions[i] > positions[i - 1], 'bundle should preserve original script load order');
assert.equal(require(path.join(root, 'package.json')).main, './app-main.js', 'Electron should use the bundled main entry');
assert.ok(fs.existsSync(path.join(root, 'app-preload.js')), 'preload master bundle should be generated');
console.log('Find Music bundle and source-layout tests passed.');
