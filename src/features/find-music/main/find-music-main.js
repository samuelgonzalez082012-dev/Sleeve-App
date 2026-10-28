'use strict';

function registerFindMusicHandlers({ ipcMain, shell }) {
  console.log('[Find Music] Main handlers registered.');
  // The actual logic is distributed across the feature modules:
  // convert.js, download.js, watch.js, spotify.js
  return { registered: true };
}

module.exports = { registerFindMusicHandlers };
