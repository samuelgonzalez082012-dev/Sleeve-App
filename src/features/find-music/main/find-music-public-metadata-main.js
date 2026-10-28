'use strict';

const { registerFindMusicDownloadHandlers } = require('../download');

function registerFindMusicPublicMetadataHandlers({ ipcMain, app, BrowserWindow }) {
  console.log('[Find Music] Public metadata handlers registered via download module.');
  // The public metadata and open-license search logic is consolidated in download.js
  return registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow });
}

module.exports = { registerFindMusicPublicMetadataHandlers };
