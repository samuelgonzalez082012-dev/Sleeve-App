#!/usr/bin/env node
'use strict';

// Applies a reversible integration patch to the root of the Sleeve-App project.
// Usage: node install-find-music.js [path/to/Sleeve-App]

const fs = require('node:fs');
const path = require('node:path');

const bundleDir = __dirname;
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : bundleDir;
const requiredTargetFiles = ['index.html', 'main.js', 'preload.js', 'renderer.js'];
const featureFiles = [
  'find-music-core.js',
  'find-music-main.js',
  'find-music-watch-main.js',
  'find-music.js',
  'find-music-watch-ui.js',
  'find-music-download-main.js',
  'find-music-download-ui.js',
  'find-music-import-core.js',
  'find-music-public-metadata-main.js',
  'find-music-import-ui.js',
  'find-music-convert-main.js',
  'find-music-convert-ui.js',
  'find-music.css'
];

function fail(message) {
  console.error(`\n[Find Music installer] ERROR: ${message}\n`);
  process.exit(1);
}

function readFile(name) {
  return fs.readFileSync(path.join(targetDir, name), 'utf8');
}

function backupIfNeeded(name, original) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `${name}.before-find-music-${timestamp}.bak`);
  fs.writeFileSync(backupPath, original, 'utf8');
  console.log(`Backup: ${path.basename(backupPath)}`);
}

if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
  fail(`Target folder does not exist: ${targetDir}`);
}
for (const file of requiredTargetFiles) {
  if (!fs.existsSync(path.join(targetDir, file))) {
    fail(`Could not find ${file} in ${targetDir}. Pass the root of Sleeve-App as the argument.`);
  }
}
for (const file of featureFiles) {
  if (!fs.existsSync(path.join(bundleDir, file))) {
    fail(`Patch bundle is missing ${file}. Re-extract the complete ZIP and try again.`);
  }
}

let indexHtml = readFile('index.html');
let mainJs = readFile('main.js');
let preloadJs = readFile('preload.js');
let rendererJs = readFile('renderer.js');
const original = {
  'index.html': indexHtml,
  'main.js': mainJs,
  'preload.js': preloadJs,
  'renderer.js': rendererJs
};
const changed = new Set();

// Upgrade older Find Music patches to the premium-free import workflow. The legacy
// Spotify Web API UI made catalog requests that could require Spotify Development
// Mode access; do not load it in this version. Keep unrelated app-level Spotify code
// intact, but remove this feature's token/collection bridge and handler registration.
const indexBeforePremiumFreeCleanup = indexHtml;
indexHtml = indexHtml.replace(/\s*<script\b[^>]*src=["']\.\/find-music-(?:spotify-ui|quick-ui)\.js["'][^>]*><\/script>/gi, '');
if (indexHtml !== indexBeforePremiumFreeCleanup) changed.add('index.html');

const preloadBeforePremiumFreeCleanup = preloadJs;
preloadJs = preloadJs.replace(/^\s*spotifyLogin: \(authUrl\) => ipcRenderer\.invoke\('spotify:login', authUrl\),\r?\n/gm, '');
preloadJs = preloadJs.replace(/^\s*findMusicSpotify(?:ExchangeCode|GetPlaylist|GetAlbum|GetTrack|Cancel):[^\r\n]*\r?\n/gm, '');
preloadJs = preloadJs.replace(/^\s*findMusicOnSpotifyProgress: \(callback\) => \{\r?\n(?:[^\n]*\r?\n)*?  \},\r?\n/gm, '');
preloadJs = preloadJs.replace(/^\s*\/\/ Spotify OAuth reuses Sleeve's existing PKCE loopback callback\. Tokens stay in memory\.\r?\n/gm, '');
if (preloadJs !== preloadBeforePremiumFreeCleanup) changed.add('preload.js');

const mainBeforePremiumFreeCleanup = mainJs;
mainJs = mainJs.replace(/^\s*require\(['"]\.\/find-music-spotify-main['"]\)\.registerFindMusicSpotifyHandlers\(\{ ipcMain \}\);\r?\n/gm, '');
if (mainJs !== mainBeforePremiumFreeCleanup) changed.add('main.js');

// Remove the obsolete embedded-store-browser bridge from earlier patch versions.
const preloadBeforeBrowserCleanup = preloadJs;
preloadJs = preloadJs.replace(/^\s*findMusicOpenStoreBrowser: \(url\) => ipcRenderer\.invoke\('find-music:open-store-browser', url\),\r?\n/gm, '');
preloadJs = preloadJs.replace(/^\s*findMusicOnDownloadCompleted: \(callback\) => \{\r?\n\s*const listener = \(_event, payload\) => callback\(payload\);\r?\n\s*ipcRenderer\.on\('find-music:download-completed', listener\);\r?\n\s*return \(\) => ipcRenderer\.removeListener\('find-music:download-completed', listener\);\r?\n\s*\},\r?\n/gm, '');
if (preloadJs !== preloadBeforeBrowserCleanup) changed.add('preload.js');

// index.html: add the original Find Music UI and then the folder-watcher enhancement.
if (!indexHtml.includes('find-music.css')) {
  if (!indexHtml.includes('</head>')) fail('Could not locate </head> in index.html. No files were changed.');
  indexHtml = indexHtml.replace('</head>', '  <link rel="stylesheet" href="./find-music.css">\n</head>');
  changed.add('index.html');
}
if (!indexHtml.includes('find-music.js')) {
  if (!indexHtml.includes('</body>')) fail('Could not locate </body> in index.html. No files were changed.');
  indexHtml = indexHtml.replace('</body>', '  <script src="./find-music.js"></script>\n</body>');
  changed.add('index.html');
}
if (!indexHtml.includes('find-music-watch-ui.js')) {
  const findMusicScript = /(<script\s+src=["']\.\/find-music\.js["']\s*><\/script>)/;
  if (!findMusicScript.test(indexHtml)) {
    fail('Could not locate the Find Music script in index.html. No files were changed.');
  }
  indexHtml = indexHtml.replace(findMusicScript, '$1\n  <script src="./find-music-watch-ui.js"></script>');
  changed.add('index.html');
}

if (!indexHtml.includes('find-music-download-ui.js')) {
  const watcherScript = /(<script\s+src=["']\.\/find-music-watch-ui\.js["']\s*><\/script>)/;
  if (!watcherScript.test(indexHtml)) {
    fail('Could not locate the Find Music watcher script in index.html. No files were changed.');
  }
  indexHtml = indexHtml.replace(watcherScript, '$1\n  <script src="./find-music-download-ui.js"></script>');
  changed.add('index.html');
}

// Load CSV normalization before the focused import UI. The old Spotify-auth UI
// scripts are intentionally not included in this premium-free version.
const downloadUiScript = /(<script\s+src=["']\.\/find-music-download-ui\.js["']\s*><\/script>)/;
if (!indexHtml.includes('find-music-download-ui.js')) fail('Could not locate the Find Music download UI script in index.html. No files were changed.');
if (!indexHtml.includes('find-music-import-core.js')) {
  if (!downloadUiScript.test(indexHtml)) fail('Could not locate the Find Music download UI script in index.html. No files were changed.');
  indexHtml = indexHtml.replace(downloadUiScript, '$1\n  <script src="./find-music-import-core.js"></script>');
  changed.add('index.html');
}
if (!indexHtml.includes('find-music-import-ui.js')) {
  const importCoreScript = /(<script\s+src=["']\.\/find-music-import-core\.js["']\s*><\/script>)/;
  if (!importCoreScript.test(indexHtml)) fail('Could not locate the CSV core script in index.html. No files were changed.');
  indexHtml = indexHtml.replace(importCoreScript, '$1\n  <script src="./find-music-import-ui.js"></script>');
  changed.add('index.html');
}
if (!indexHtml.includes('find-music-convert-ui.js')) {
  const importUiScript = /(<script\s+src=["']\.\/find-music-import-ui\.js["']\s*><\/script>)/;
  if (!importUiScript.test(indexHtml)) fail('Could not locate the Find Music import UI script in index.html. No files were changed.');
  indexHtml = indexHtml.replace(importUiScript, '$1\n  <script src="./find-music-convert-ui.js"></script>');
  changed.add('index.html');
}

// preload.js: keep the narrow APIs exposed by the existing preload bridge.
const preloadMarker = '  getPathForFile: (file) => webUtils.getPathForFile(file),';
if (!preloadJs.includes(preloadMarker)) {
  fail('Could not locate the expected getPathForFile line in preload.js. No files were changed.');
}
if (!preloadJs.includes('findMusicSearchRecordings')) {
  const baseApiBlock = `
  // Find Music APIs: metadata search and supported official-source browsing.
  findMusicParseLink: (url) => ipcRenderer.invoke('find-music:parse-link', url),
  findMusicSearchRecordings: (payload) => ipcRenderer.invoke('find-music:search-recordings', payload),
  findMusicOpenUrl: (url) => ipcRenderer.invoke('find-music:open-url', url),`;
  preloadJs = preloadJs.replace(preloadMarker, `${preloadMarker}${baseApiBlock}`);
  changed.add('preload.js');
}
if (!preloadJs.includes('findMusicWatchSelectFolder')) {
  const apiAnchor = "  findMusicOpenUrl: (url) => ipcRenderer.invoke('find-music:open-url', url),";
  const watchApiBlock = `
  // Folder watching is opt-in. Only paths reported from the selected folder can be read for import.
  findMusicWatchSelectFolder: () => ipcRenderer.invoke('find-music:watch-select-folder'),
  findMusicWatchStop: () => ipcRenderer.invoke('find-music:watch-stop'),
  findMusicReadImportFile: (filePath) => ipcRenderer.invoke('find-music:read-import-file', filePath),
  findMusicOnNewFiles: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('find-music:watch:new-files', listener);
    return () => ipcRenderer.removeListener('find-music:watch:new-files', listener);
  },`;
  if (!preloadJs.includes(apiAnchor)) {
    fail('Could not locate findMusicOpenUrl in preload.js. No files were changed.');
  }
  preloadJs = preloadJs.replace(apiAnchor, `${apiAnchor}${watchApiBlock}`);
  changed.add('preload.js');
}

if (!preloadJs.includes('findMusicSearchOpenAudio')) {
  const readImportMarker = "  findMusicReadImportFile: (filePath) => ipcRenderer.invoke('find-music:read-import-file', filePath),";
  if (!preloadJs.includes(readImportMarker)) {
    fail('Could not locate findMusicReadImportFile in preload.js. No files were changed.');
  }
  const downloadApiBlock = `
  // Direct open-license downloads run in Sleeve; store discovery links open externally.
  findMusicSearchOpenAudio: (payload) => ipcRenderer.invoke('find-music:search-open-audio', payload),
  findMusicDownloadOpenAudio: (payload) => ipcRenderer.invoke('find-music:download-open-audio', payload),
  findMusicReadDownloadedFile: (filePath) => ipcRenderer.invoke('find-music:read-downloaded-file', filePath),
  findMusicResolveDownloadOpenAudio: (payload) => ipcRenderer.invoke('find-music:resolve-download-open-audio', payload),
  findMusicDownloadOpenAudioCollection: (payload) => ipcRenderer.invoke('find-music:download-open-audio-collection', payload),
  findMusicCancelOpenAudioCollection: (requestId) => ipcRenderer.invoke('find-music:cancel-open-audio-collection', requestId),
  findMusicOnOpenAudioCollectionProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('find-music:open-audio-collection-progress', listener);
    return () => ipcRenderer.removeListener('find-music:open-audio-collection-progress', listener);
  },
`;
  preloadJs = preloadJs.replace(readImportMarker, `${readImportMarker}${downloadApiBlock}`);
  changed.add('preload.js');
}

// Ensure collection-download bridge methods are present when updating an older patch install.
if (!preloadJs.includes('findMusicResolveDownloadOpenAudio')) {
  const downloadReadAnchor = "  findMusicReadDownloadedFile: (filePath) => ipcRenderer.invoke('find-music:read-downloaded-file', filePath),";
  if (!preloadJs.includes(downloadReadAnchor)) fail('Could not locate the download read API in preload.js. No files were changed.');
  const collectionBridge = `
  findMusicResolveDownloadOpenAudio: (payload) => ipcRenderer.invoke('find-music:resolve-download-open-audio', payload),
  findMusicDownloadOpenAudioCollection: (payload) => ipcRenderer.invoke('find-music:download-open-audio-collection', payload),
  findMusicCancelOpenAudioCollection: (requestId) => ipcRenderer.invoke('find-music:cancel-open-audio-collection', requestId),
  findMusicOnOpenAudioCollectionProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('find-music:open-audio-collection-progress', listener);
    return () => ipcRenderer.removeListener('find-music:open-audio-collection-progress', listener);
  },`;
  preloadJs = preloadJs.replace(downloadReadAnchor, `${downloadReadAnchor}${collectionBridge}`);
  changed.add('preload.js');
}

// Premium-free public catalog metadata bridge: Spotify oEmbed only reads public
// link preview metadata; Apple’s public catalog supplies track/album details.
if (!preloadJs.includes('findMusicResolvePublicLink')) {
  const readDownloadedAnchor = "  findMusicReadDownloadedFile: (filePath) => ipcRenderer.invoke('find-music:read-downloaded-file', filePath),";
  if (!preloadJs.includes(readDownloadedAnchor)) fail('Could not locate the Find Music download bridge. No files were changed.');
  const publicMetadataBridge = `
  findMusicResolvePublicLink: (payload) => ipcRenderer.invoke('find-music:resolve-public-link', payload),
  findMusicGetPublicAlbumTracks: (collectionId) => ipcRenderer.invoke('find-music:get-public-album-tracks', collectionId),`;
  preloadJs = preloadJs.replace(readDownloadedAnchor, `${readDownloadedAnchor}${publicMetadataBridge}`);
  changed.add('preload.js');
}

// Add the local FFmpeg converter bridge on fresh installs and upgrades alike.
if (!preloadJs.includes('findMusicConvertStatus')) {
  const metadataAnchor = "  findMusicGetPublicAlbumTracks: (collectionId) => ipcRenderer.invoke('find-music:get-public-album-tracks', collectionId),";
  if (!preloadJs.includes(metadataAnchor)) fail('Could not locate the Find Music public metadata bridge. No files were changed.');
  const convertBridge = `
  // Local FFmpeg conversion operates only on user-selected local media files; it does not fetch YouTube streams.
  findMusicConvertStatus: () => ipcRenderer.invoke('find-music:convert-status'),
  findMusicConvertPickSource: () => ipcRenderer.invoke('find-music:convert-pick-source'),
  findMusicConvertPickFfmpeg: () => ipcRenderer.invoke('find-music:convert-pick-ffmpeg'),
  findMusicConvertRun: (payload) => ipcRenderer.invoke('find-music:convert-run', payload),
  findMusicConvertCancel: (jobId) => ipcRenderer.invoke('find-music:convert-cancel', jobId),
  findMusicConvertReadOutput: (outputToken) => ipcRenderer.invoke('find-music:convert-read-output', outputToken),
  findMusicConvertRevealOutput: (outputToken) => ipcRenderer.invoke('find-music:convert-reveal-output', outputToken),
  findMusicConvertOnProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('find-music:convert-progress', listener);
    return () => ipcRenderer.removeListener('find-music:convert-progress', listener);
  },`;
  preloadJs = preloadJs.replace(metadataAnchor, `${metadataAnchor}${convertBridge}`);
  changed.add('preload.js');
}

// FFmpeg conversion uses Electron's native file picker. Add the already-supported dialog API.
if (!/const\s*\{[^}]*\bdialog\b[^}]*\}\s*=\s*require\(['"]electron['"]\)/s.test(mainJs)) {
  const electronImport = /const\s*\{\s*app,\s*BrowserWindow,\s*ipcMain,\s*shell\s*\}\s*=\s*require\(['"]electron['"]\)/;
  if (!electronImport.test(mainJs)) fail('Could not locate the expected Electron import in main.js to add dialog support. No files were changed.');
  mainJs = mainJs.replace(electronImport, "const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')");
  changed.add('main.js');
}

// Remove any earlier Spotify Web API handler registration from Find Music.
const beforeSpotifyRegistrationCleanup = mainJs;
mainJs = mainJs.replace(/^\s*require\(['"]\.\/find-music-spotify-main['"]\)\.registerFindMusicSpotifyHandlers\(\{ ipcMain \}\);\r?\n/gm, '');
if (mainJs !== beforeSpotifyRegistrationCleanup) changed.add('main.js');

// main.js: register public metadata search plus the opt-in local download watcher.
const mainRegistration = "require('./find-music-main').registerFindMusicHandlers({ ipcMain, shell });";
if (!mainJs.includes(mainRegistration)) {
  mainJs = `${mainJs.trimEnd()}\n\n// Find Music public recording metadata and external source links.\n${mainRegistration}\n`;
  changed.add('main.js');
}
const watcherRegistration = "require('./find-music-watch-main').registerFindMusicWatchHandlers({ ipcMain, app, BrowserWindow });";
if (!mainJs.includes(watcherRegistration)) {
  mainJs = `${mainJs.trimEnd()}\n\n// Find Music opt-in download-folder detection and user-approved local-file import.\n${watcherRegistration}\n`;
  changed.add('main.js');
}

const downloadRegistration = "require('./find-music-download-main').registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow });";
if (!mainJs.includes(downloadRegistration)) {
  mainJs = `${mainJs.trimEnd()}\n\n// Find Music in-app open-license downloads and collection ZIP packaging; no embedded browser.\n${downloadRegistration}\n`;
  changed.add('main.js');
}

const publicMetadataRegistration = "require('./find-music-public-metadata-main').registerFindMusicPublicMetadataHandlers({ ipcMain });";
if (!mainJs.includes(publicMetadataRegistration)) {
  mainJs = `${mainJs.trimEnd()}\n\n// Find Music public link metadata and public album-track lookup; no Spotify Web API login.\n${publicMetadataRegistration}\n`;
  changed.add('main.js');
}

const converterRegistration = "require('./find-music-convert-main').registerFindMusicConvertHandlers({ ipcMain, app, dialog, shell });";
if (!mainJs.includes(converterRegistration)) {
  mainJs = `${mainJs.trimEnd()}\n\n// Find Music conversion of user-selected local media using a user-installed FFmpeg binary.\n${converterRegistration}\n`;
  changed.add('main.js');
}

// renderer.js: allow imported File objects to retain their original full path,
// and connect the Find Music UI event to Sleeve's existing addFiles() pipeline.
const sourcePathPattern = /        sourcePath: window\.electronAPI\?\.getPathForFile\r?\n          \? window\.electronAPI\.getPathForFile\(file\)\r?\n          : \(file\.webkitRelativePath \|\| file\.path \|\| file\.name \|\| ''\)/;
const patchedSourcePath = `        sourcePath: file.__sleeveSourcePath || (window.electronAPI?.getPathForFile
          ? window.electronAPI.getPathForFile(file)
          : (file.webkitRelativePath || file.path || file.name || ''))`;
if (!rendererJs.includes('file.__sleeveSourcePath') && sourcePathPattern.test(rendererJs)) {
  rendererJs = rendererJs.replace(sourcePathPattern, patchedSourcePath);
  changed.add('renderer.js');
} else if (!rendererJs.includes('file.__sleeveSourcePath')) {
  fail('Could not locate the expected addFiles() sourcePath expression in renderer.js. No files were changed.');
}
const rendererBridgeMarker = '  // ---------- Artist/album tag reading ----------';
if (!rendererJs.includes('sleeve:find-music-import-files')) {
  if (!rendererJs.includes(rendererBridgeMarker)) {
    fail('Could not locate the addFiles() integration point in renderer.js. No files were changed.');
  }
  const eventBridge = `  // Receive user-approved audio files from Find Music's watched-download panel.
  window.addEventListener('sleeve:find-music-import-files', (event) => {
    const detailFiles = event && event.detail && Array.isArray(event.detail.files) ? event.detail.files : [];
    const files = detailFiles.filter((file) => typeof File !== 'undefined' && file instanceof File);
    if (files.length) addFiles(files);
  });

`;
  rendererJs = rendererJs.replace(rendererBridgeMarker, `${eventBridge}${rendererBridgeMarker}`);
  changed.add('renderer.js');
}

if (!rendererJs.includes('sleeve:find-music-get-library')) {
  if (!rendererJs.includes(rendererBridgeMarker)) {
    fail('Could not locate the library integration point in renderer.js. No files were changed.');
  }
  const libraryBridge = `  // Expose a minimal read-only library snapshot to Find Music for duplicate checks.
  // This stays inside the renderer; no library records are sent over Electron IPC.
  window.addEventListener('sleeve:find-music-get-library', (event) => {
    const callback = event && event.detail && event.detail.callback;
    if (typeof callback !== 'function') return;
    try {
      callback(playlist.map((track) => ({
        title: String(track.title || ''), artist: String(track.artist || ''), album: String(track.album || ''),
        duration: Number(track.duration) || null, isrc: String(track.isrc || (track.manualMetadata && track.manualMetadata.isrc) || '')
      })));
    } catch (error) { console.warn('Sleeve: could not provide library metadata to Find Music', error); callback([]); }
  });

`;
  rendererJs = rendererJs.replace(rendererBridgeMarker, `${libraryBridge}${rendererBridgeMarker}`);
  changed.add('renderer.js');
}

// All required anchors are checked before any project files are written.
// Back up modified integration files, then copy the self-contained feature modules.
for (const name of changed) backupIfNeeded(name, original[name]);
for (const file of featureFiles) {
  const sourcePath = path.join(bundleDir, file);
  const destinationPath = path.join(targetDir, file);
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) continue;
  if (fs.existsSync(destinationPath)) {
    const current = fs.readFileSync(destinationPath, 'utf8');
    const incoming = fs.readFileSync(sourcePath, 'utf8');
    if (current !== incoming) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${destinationPath}.before-find-music-${timestamp}.bak`;
      fs.copyFileSync(destinationPath, backupPath);
      console.log(`Backup: ${path.basename(backupPath)}`);
    }
  }
  fs.copyFileSync(sourcePath, destinationPath);
}

if (changed.has('index.html')) fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtml, 'utf8');
if (changed.has('preload.js')) fs.writeFileSync(path.join(targetDir, 'preload.js'), preloadJs, 'utf8');
if (changed.has('main.js')) fs.writeFileSync(path.join(targetDir, 'main.js'), mainJs, 'utf8');
if (changed.has('renderer.js')) fs.writeFileSync(path.join(targetDir, 'renderer.js'), rendererJs, 'utf8');

console.log('\n[Find Music installer] Complete.');
console.log(`Target: ${targetDir}`);
console.log('Added: premium-free Spotify link previews, public track/album metadata lookup, Exportify CSV import, local-library deduplication, authorized in-app direct downloads/ZIP packaging, and optional download-folder watching.');
console.log('Sleeve downloads only files the selected source makes available. It does not rip Spotify or other streaming audio, and leaves downloaded originals in Sleeve Downloads.');
console.log('\nNext: paste a Spotify track/album link or import an Exportify CSV. No Spotify Client ID, login, or Premium subscription is used by this Find Music workflow. Playlists need CSV metadata; downloads only include high-confidence matches from supported sources with eligible public-domain/open-license declarations.');
