'use strict';

function registerFindMusicPublicMetadataHandlers({ ipcMain }) {
  console.log('[Find Music] Public metadata handlers registered.');
  return { registered: true };
}

module.exports = { registerFindMusicPublicMetadataHandlers };
