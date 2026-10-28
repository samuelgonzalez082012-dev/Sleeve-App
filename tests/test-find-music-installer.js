'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = __dirname;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sleeve-find-music-import-'));
const target = path.join(tempRoot, 'Sleeve-App');
fs.mkdirSync(target, { recursive: true });
try {
  fs.writeFileSync(path.join(target, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  fs.writeFileSync(path.join(target, 'main.js'), "const { app, BrowserWindow, ipcMain, shell } = require('electron');\n");
  fs.writeFileSync(path.join(target, 'preload.js'), "const { contextBridge, ipcRenderer, webUtils } = require('electron');\ncontextBridge.exposeInMainWorld('electronAPI', {\n  getPathForFile: (file) => webUtils.getPathForFile(file),\n});\n");
  fs.writeFileSync(path.join(target, 'renderer.js'), `const playlist = [];\nfunction addFiles(files) {}\nfunction example(fileList) {\n  const file = fileList[0];\n  const track = {\n        sourcePath: window.electronAPI?.getPathForFile\n          ? window.electronAPI.getPathForFile(file)\n          : (file.webkitRelativePath || file.path || file.name || '')\n  };\n}\n  // ---------- Artist/album tag reading ----------\n`);

  const install = () => execFileSync(process.execPath, [path.join(root, 'install-find-music.js'), target], { encoding: 'utf8' });
  const firstOutput = install();
  assert.match(firstOutput, /Complete/);
  let html = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
  let preload = fs.readFileSync(path.join(target, 'preload.js'), 'utf8');
  let main = fs.readFileSync(path.join(target, 'main.js'), 'utf8');
  let renderer = fs.readFileSync(path.join(target, 'renderer.js'), 'utf8');
  assert.match(html, /find-music-import-core\.js/);
  assert.match(html, /find-music-import-ui\.js/);
  assert.match(html, /find-music-convert-ui\.js/);
  assert.doesNotMatch(html, /find-music-spotify-ui\.js|find-music-quick-ui\.js/);
  assert.match(preload, /findMusicResolvePublicLink/);
  assert.match(preload, /findMusicGetPublicAlbumTracks/);
  assert.match(preload, /findMusicConvertRun/);
  assert.match(preload, /findMusicConvertOnProgress/);
  assert.doesNotMatch(preload, /findMusicSpotify|findMusicOnSpotify|spotifyLogin/);
  assert.match(main, /find-music-public-metadata-main/);
  assert.match(main, /find-music-convert-main/);
  assert.match(main, /dialog/);
  assert.doesNotMatch(main, /find-music-spotify-main/);
  assert.match(renderer, /sleeve:find-music-get-library/);
  assert.match(renderer, /sleeve:find-music-import-files/);
  assert.ok(fs.existsSync(path.join(target, 'find-music-convert-main.js')));
  assert.ok(fs.existsSync(path.join(target, 'find-music-convert-ui.js')));
  for (const file of ['main.js', 'preload.js', 'renderer.js']) {
    execFileSync(process.execPath, ['--check', path.join(target, file)], { stdio: 'pipe' });
  }
  const filesAfterFirst = fs.readdirSync(target).filter((name) => name.includes('.before-find-music-')).length;
  const secondOutput = install();
  assert.match(secondOutput, /Complete/);
  const filesAfterSecond = fs.readdirSync(target).filter((name) => name.includes('.before-find-music-')).length;
  assert.equal(filesAfterSecond, filesAfterFirst, 'second installation should not create extra backups when nothing changed');
  assert.equal((fs.readFileSync(path.join(target, 'index.html'), 'utf8').match(/find-music-import-ui\.js/g) || []).length, 1);
  console.log('Find Music installer fresh/upgrade/idempotence tests passed.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
