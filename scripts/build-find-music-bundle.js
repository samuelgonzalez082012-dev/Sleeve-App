#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const UI_SOURCE_DIR = path.join('src', 'features', 'find-music', 'ui');
const ACTIVE_FILES = [
  'find-music.js',
  'find-music-watch-ui.js',
  'find-music-download-ui.js',
  'find-music-import-core.js',
  'find-music-import-ui.js',
  'find-music-convert-ui.js'
];

function buildBundle(projectRoot = process.cwd(), options = {}) {
  const root = path.resolve(projectRoot);
  const parts = [
    '/* GENERATED FILE — do not hand-edit. Source lives under src/features/find-music/ui/. */',
    '/* Rebuild with: node scripts/build-find-music-bundle.js */',
    `/* Source order: ${ACTIVE_FILES.join(' -> ')} */`,
    ''
  ];
  for (const file of ACTIVE_FILES) {
    const sourcePath = path.join(root, UI_SOURCE_DIR, file);
    if (!fs.existsSync(sourcePath)) throw new Error(`Missing Find Music UI source: ${sourcePath}`);
    parts.push(`\n/* ===== BEGIN ${file} ===== */\n`);
    parts.push(fs.readFileSync(sourcePath, 'utf8'));
    parts.push(`\n/* ===== END ${file} ===== */\n`);
  }
  const contents = parts.join('');
  if (options.write !== false) fs.writeFileSync(path.join(root, 'find-music-bundle.js'), contents, 'utf8');
  return { path: path.join(root, 'find-music-bundle.js'), contents, sourceFiles: [...ACTIVE_FILES] };
}

if (require.main === module) {
  try {
    const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
    const result = buildBundle(root, { write: true });
    console.log(`Built ${result.path} from ${result.sourceFiles.length} source files.`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { buildBundle, ACTIVE_FILES, UI_SOURCE_DIR };
