'use strict';

const { registerFindMusicWatchHandlers } = require('../watch');
const { registerFindMusicConvertHandlers } = require('../convert');
const { registerFindMusicDownloadHandlers } = require('../download');
const { registerFindMusicSpotifyHandlers } = require('../spotify');

function registerFindMusicHandlers({ ipcMain, shell, app, BrowserWindow, dialog }) {
  console.log('[Find Music] Registering all feature handlers...');

  const results = {
    watch: registerFindMusicWatchHandlers({ ipcMain, app, BrowserWindow }),
    convert: registerFindMusicConvertHandlers({ ipcMain, app, dialog, shell }),
    download: registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow }),
    spotify: registerFindMusicSpotifyHandlers({ ipcMain }),
  };

  return { registered: true, ...results };
}

module.exports = { registerFindMusicHandlers };
