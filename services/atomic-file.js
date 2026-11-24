'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/** Persist a file by writing a private sibling temporary file, syncing it, then renaming it. */
async function atomicWriteFile(filePath, data, { mode = 0o600, encoding = 'utf8' } = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', mode);
    await handle.writeFile(data, encoding);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    // Directory syncing is supported on many Unix filesystems; Windows may reject it.
    try {
      const directoryHandle = await fs.open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (_) { /* Best-effort durability enhancement. */ }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

module.exports = { atomicWriteFile };
