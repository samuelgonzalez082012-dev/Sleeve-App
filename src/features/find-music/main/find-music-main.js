'use strict';

const { registerFindMusicWatchHandlers } = require('../watch');
const { registerFindMusicConvertHandlers } = require('../convert');
const { registerFindMusicDownloadHandlers } = require('../download');
const { registerFindMusicSpotifyHandlers } = require('../spotify');
const core = require('../find-music-core');

function registerFindMusicHandlers({ ipcMain, shell, app, BrowserWindow, dialog }) {
  console.log('[Find Music] Registering all feature handlers...');

  // 1. Core Handlers (Item 4 in audit)
  ipcMain.handle('find-music:parse-link', async (_event, rawUrl) => {
    try {
      return core.parseReferenceLink(rawUrl);
    } catch (error) {
      throw new Error(`Link parsing failed: ${error.message}`);
    }
  });

  ipcMain.handle('find-music:open-url', async (_event, url) => {
    try {
      shell.openExternal(url);
      return { ok: true };
    } catch (error) {
      throw new Error(`Could not open URL: ${error.message}`);
    }
  });

  ipcMain.handle('find-music:search-recordings', async (_event, payload) => {
    const { title, artist } = payload || {};
    if (!title || !artist) throw new Error('Title and Artist are required for search.');

    return {
      links: core.makeProviderLinks({ title, artist }, 'all'),
      note: 'Select a provider to search for this recording.'
    };
  });

  // 2. Feature-Specific Handlers
  const results = {
    watch: registerFindMusicWatchHandlers({ ipcMain, app, BrowserWindow }),
    convert: registerFindMusicConvertHandlers({ ipcMain, app, dialog, shell }),
    download: registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow }),
    spotify: registerFindMusicSpotifyHandlers({ ipcMain }),
  };

  return { registered: true, ...results };
}

module.exports = { registerFindMusicHandlers };
