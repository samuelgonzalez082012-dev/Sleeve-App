#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const rendererFiles = [
  'duplicate-detection.js',
  'renderer.js',
  'music-taste-analysis.js',
  'playlist-import.js',
  'find-music.js',
  'find-music-discovery-ui.js',
  'find-music-watch-ui.js',
  'find-music-download-ui.js',
  'find-music-import-core.js',
  'find-music-import-ui.js',
  'find-music-convert-ui.js',
  'spotdl-integration.js',
  'mini-player-ui.js',
  'audio-enhancements.js',
  'audio-visualizer.js'
];

async function buildRuntime() {
  const outputs = [
    esbuild.build({
      absWorkingDir: root,
      entryPoints: ['main.js'],
      outfile: 'app-main.js',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      legalComments: 'none'
    }),
    esbuild.build({
      absWorkingDir: root,
      entryPoints: ['preload.js'],
      outfile: 'app-preload.js',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      legalComments: 'none'
    })
  ];

  const rendererParts = [];
  for (const file of rendererFiles) {
    const sourcePath = path.join(root, file);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing renderer source: ${sourcePath}`);
    rendererParts.push(`\n/* ===== BEGIN ${file} ===== */\n`);
    rendererParts.push(fs.readFileSync(sourcePath, 'utf8'));
    rendererParts.push(`\n/* ===== END ${file} ===== */\n`);
  }

  await Promise.all(outputs);
  fs.writeFileSync(path.join(root, 'app-renderer.js'), rendererParts.join(''), 'utf8');

  return {
    files: ['app-main.js', 'app-preload.js', 'app-renderer.js'],
    rendererSources: rendererFiles
  };
}

if (require.main === module) {
  buildRuntime()
    .then(({ files, rendererSources }) => {
      console.log(`Built ${files.join(', ')} from ${rendererSources.length} renderer sources.`);
    })
    .catch((error) => {
      console.error(`[Sleeve build] ${error.message || error}`);
      process.exitCode = 1;
    });
}

module.exports = { buildRuntime, rendererFiles };
