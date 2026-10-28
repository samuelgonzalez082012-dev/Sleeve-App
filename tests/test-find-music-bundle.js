'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bundle = fs.readFileSync(path.join(root, 'find-music-bundle.js'), 'utf8');
const sourceDir = path.join(root, 'src', 'features', 'find-music', 'ui');
const sources = [
  'find-music.js',
  'find-music-watch-ui.js',
  'find-music-download-ui.js',
  'find-music-import-core.js',
  'find-music-import-ui.js',
  'find-music-convert-ui.js'
];

assert.equal((html.match(/src=["']\.\/find-music-bundle\.js["']/g) || []).length, 1, 'index.html should load one Find Music bundle');
for (const file of sources) {
  assert.ok(fs.existsSync(path.join(sourceDir, file)), `source module should be kept at src/features/find-music/ui/${file}`);
  assert.equal((html.match(new RegExp(`src=["']\\./${file.replace(/\./g, '\\.')}["']`, 'g')) || []).length, 0, `index.html should no longer load ${file} separately`);
  assert.ok(bundle.includes(`BEGIN ${file}`), `bundle should include ${file} in the generated source map markers`);
}
const positions = sources.map((file) => bundle.indexOf(`BEGIN ${file}`));
for (let i = 1; i < positions.length; i += 1) assert.ok(positions[i] > positions[i - 1], 'bundle should preserve original script load order');
assert.ok(fs.readFileSync(path.join(root, 'install-find-music.js'), 'utf8').includes('sourcePathForFeatureFile'), 'Find Music installer must load moved UI sources');
console.log('Find Music bundle and source-layout tests passed.');
