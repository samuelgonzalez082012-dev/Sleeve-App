'use strict';

const {
  searchOpenLicensedAudio,
  resolveOpenLicensedTrack,
  getArchiveItem
} = require('../download');

/**
 * Public metadata handlers for Find Music.
 * These provide the "no-login" search and resolution capabilities.
 */
function registerFindMusicPublicMetadataHandlers({ ipcMain }) {
  console.log('[Find Music] Registering public metadata handlers...');

  // Resolve a public link to a recording (used for YouTube/Internet Archive references)
  ipcMain.handle('find-music:resolve-public-link', async (_event, payload) => {
    try {
      const { url } = payload || {};
      if (!url) throw new Error('No URL provided.');

      // Search for an open-licensed match based on the link's implied metadata
      // Note: In a real implementation, this would first extract metadata from the URL
      // then call resolveOpenLicensedTrack.
      const match = await resolveOpenLicensedTrack({
        title: 'Unknown', // Placeholder: would be extracted from URL
        artist: 'Unknown',
        url: url
      });

      return match ? { success: true, match } : { success: false, message: 'No public match found.' };
    } catch (error) {
      throw new Error(`Public link resolution failed: ${error.message}`);
    }
  });

  // Get public album tracks for a specific identifier
  ipcMain.handle('find-music:get-public-album-tracks', async (_event, payload) => {
    try {
      const { identifier } = payload || {};
      if (!identifier) throw new Error('No identifier provided.');

      const item = await getArchiveItem(identifier);
      return {
        success: true,
        metadata: item.metadata,
        files: item.json.files
      };
    } catch (error) {
      throw new Error(`Public metadata retrieval failed: ${error.message}`);
    }
  });

  return { registered: true };
}

module.exports = { registerFindMusicPublicMetadataHandlers };
