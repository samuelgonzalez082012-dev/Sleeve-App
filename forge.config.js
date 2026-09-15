module.exports = {
  packagerConfig: {
    asar: true,
    icon: './Icon.ico',
    prune: true,
    extraResource: ['./python/embedded']
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'MyMusicPlayer'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32']
    }
  ]
}