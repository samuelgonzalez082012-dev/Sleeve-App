#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDir = __dirname;
const projectRoot = path.resolve(testsDir, '..');
const testFiles = fs.readdirSync(testsDir)
  .filter((name) => /^(?:test-[\w.-]+|[\w.-]+\.test)\.js$/i.test(name))
  .filter((name) => name !== 'run-all.js')
  .sort((a, b) => a.localeCompare(b));

if (testFiles.length === 0) {
  console.error('[Sleeve tests] No test files found in tests/.');
  process.exit(1);
}

let failures = 0;
console.log(`[Sleeve tests] Running ${testFiles.length} test files sequentially.\n`);
for (const file of testFiles) {
  console.log(`\n========== ${file} ==========`);
  const fullPath = path.join(testsDir, file);
  const args = file.endsWith('.test.js') ? ['--test', fullPath] : [fullPath];
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) {
    failures += 1;
    console.error(`[FAIL] ${file}: ${result.error.message}`);
  } else if (result.status !== 0) {
    failures += 1;
    console.error(`[FAIL] ${file}: exited with status ${result.status}`);
  } else {
    console.log(`[PASS] ${file}`);
  }
}

console.log(`\n[Sleeve tests] ${testFiles.length - failures}/${testFiles.length} test files passed.`);
if (failures) process.exitCode = 1;
