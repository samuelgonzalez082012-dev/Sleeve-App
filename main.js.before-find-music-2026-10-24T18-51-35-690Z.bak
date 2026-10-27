


// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const http = require('node:http')
// main.js — add near your other requires
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const crypto = require('node:crypto')

// Where Demucs source files get resolved to and where split stems get
// written. Resolving/hashing is shared by the split, find-existing, and
// verify handlers below so they always agree on the same folder for the
// same song.
// Last-resort fallback for library entries whose stored sourcePath is
// missing the folder structure needed to resolve directly (e.g. captured
// from a picker that returned only "Album/Song.flac" instead of a full
// path). Recursively searches the Music folder for a file with the exact
// same filename. Bounded so it can't hang on a huge library.
function findFileByBasenameUnderMusic(filePath) {
  const musicRoot = app.getPath('music')
  const target = path.basename(filePath)
  const stack = [musicRoot]
  const MAX_DIRS_VISITED = 5000
  let visited = 0

  while (stack.length && visited < MAX_DIRS_VISITED) {
    const dir = stack.pop()
    visited++

    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
      } else if (entry.isFile() && entry.name === target) {
        return entryPath
      }
    }
  }

  return null
}

function resolveSourcePath(filePath) {
  let resolvedPath = filePath

  // Older Sleeve library entries may contain:
  // Music/Artist/Album/Song.mp3
  // Convert that to the user's real Windows Music folder.
  if (
    process.platform === 'win32' &&
    (filePath.startsWith('Music/') || filePath.startsWith('Music\\'))
  ) {
    const relativeMusicPath = filePath.replace(/^Music[\\/]+/, '')
    resolvedPath = path.join(app.getPath('music'), relativeMusicPath)
  } else if (!path.isAbsolute(filePath) && !fs.existsSync(filePath)) {
    // Some library entries store a path relative to whatever folder was
    // originally picked as the music library, without any leading
    // "Music/" segment at all (e.g. "Album Name/Song.flac"). If the raw
    // path doesn't exist as given, fall back to resolving it against the
    // user's Music folder before giving up.
    const candidate = path.join(app.getPath('music'), filePath)
    if (fs.existsSync(candidate)) {
      resolvedPath = candidate
    } else {
      // The stored path can also be missing folder segments entirely
      // (e.g. just "Album Name/Song.flac" with no artist folder). Search
      // the Music folder by filename as a last resort.
      const found = findFileByBasenameUnderMusic(filePath)
      if (found) resolvedPath = found
    }
  }

  return resolvedPath
}

// Stems used to be written under os.tmpdir(), which gets wiped by the OS
// (or on every reboot, on some systems) — so the split had to be redone
// every session. userData persists for the life of the install, and
// hashing the resolved source path means the same song always maps to the
// same folder, so re-opening a track finds its stems without re-running
// Demucs.
function getStemsOutDir(resolvedPath) {
  const hash = crypto
    .createHash('sha1')
    .update(resolvedPath)
    .digest('hex')
    .slice(0, 16)

  return path.join(app.getPath('userData'), 'stems', hash)
}

function getStemPaths(outDir, resolvedPath) {
  const baseName = path.basename(resolvedPath, path.extname(resolvedPath))
  const stemDir = path.join(outDir, 'htdemucs_6s', baseName)

  return {
    drums: path.join(stemDir, 'drums.wav'),
    vocals: path.join(stemDir, 'vocals.wav'),
    bass: path.join(stemDir, 'bass.wav'),
    guitar: path.join(stemDir, 'guitar.wav'),
    piano: path.join(stemDir, 'piano.wav'),
    other: path.join(stemDir, 'other.wav')
  }
}

function allStemsExist(stems) {
  return (
    !!stems &&
    typeof stems === 'object' &&
    Object.values(stems).every(
      (stemPath) => typeof stemPath === 'string' && fs.existsSync(stemPath)
    )
  )
}

function getPythonPath() {

  const isWin = process.platform === 'win32'

  const platformDir =
    process.platform === 'win32' ? 'win-x64' :
    process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'

  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'python', 'embedded', platformDir)
    : path.join(__dirname, 'python', 'venv')

  return app.isPackaged
    ? path.join(base, isWin ? 'python.exe' : 'bin/python3')
    : path.join(base, isWin ? 'Scripts/python.exe' : 'bin/python')

}

ipcMain.handle('stems:check-engine', async () => {
  return fs.existsSync(getPythonPath())
})

// Given a track's source path, returns its already-split stems (if the
// files are still on disk) or null. Lets the renderer restore the stem
// mixer for a song without re-running Demucs.
ipcMain.handle('stems:find-existing', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null

  const resolvedPath = resolveSourcePath(filePath)
  if (!fs.existsSync(resolvedPath)) return null

  const outDir = getStemsOutDir(resolvedPath)
  const stems = getStemPaths(outDir, resolvedPath)

  return allStemsExist(stems) ? stems : null
})

// Confirms a previously-saved stems object still points at real files —
// used to self-heal a library entry if the stem files were ever deleted
// or moved outside the app.
ipcMain.handle('stems:verify', async (_event, stems) => {
  return allStemsExist(stems)
})

ipcMain.handle('stems:split', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    console.log('[STEMS] filePath received:', filePath)
    console.log('[STEMS] filePath type:', typeof filePath)

    if (typeof filePath !== 'string' || !filePath.trim()) {
      reject(new Error(`Source file not found: ${filePath}`))
      return
    }

    let resolvedPath = resolveSourcePath(filePath)

    console.log('[STEMS] resolved path:', resolvedPath)
    console.log('[STEMS] exists:', fs.existsSync(resolvedPath))

    if (!fs.existsSync(resolvedPath)) {
      reject(new Error(`Source file not found: ${resolvedPath}`))
      return
    }

    const outDir = getStemsOutDir(resolvedPath)

    fs.mkdirSync(outDir, { recursive: true })

    const python = getPythonPath()

    const args = [
      '-m',
      'demucs',
      '-n',
      'htdemucs_6s',
      '--out',
      outDir,
      resolvedPath
    ]

    event.sender.send('stems:progress', {
      status: 'starting'
    })

    const proc = spawn(python, args)

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      const match = text.match(/(\d+)%/)

      if (match) {
        event.sender.send('stems:progress', {
          status: 'processing',
          percent: Number(match[1])
        })
      }
    })

    proc.on('error', (err) => {
      reject(
        new Error(`Could not start Python: ${err.message}`)
      )
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`Demucs exited with code ${code}`)
        )
        return
      }

      const stems = getStemPaths(outDir, resolvedPath)

      const allExist = allStemsExist(stems)

      if (!allExist) {
        reject(
          new Error(
            'Demucs finished but expected output files are missing'
          )
        )
        return
      }

      event.sender.send('stems:progress', {
        status: 'done'
      })

      resolve(stems)
    })
  })
})
   
// Converts a source file into something Demucs can split directly, for
// file types we don't split as-is (e.g. FLAC). Decoding is done via
// demucs.audio.AudioFile — the exact same decoder Demucs itself uses
// before splitting — so this doesn't depend on any audio library beyond
// what Demucs already needs. Encoding prefers MP3 via lameenc (a core
// Demucs dependency, used by Demucs's own --mp3 output flag), but falls
// back to WAV if lameenc isn't present in this environment; either is a
// fine input for the split step that follows.
ipcMain.handle('stems:convert-to-mp3', async (_event, filePath) => {
  return new Promise((resolve, reject) => {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      reject(new Error(`Source file not found: ${filePath}`))
      return
    }

    const resolvedPath = resolveSourcePath(filePath)

    if (!fs.existsSync(resolvedPath)) {
      reject(new Error(`Source file not found: ${resolvedPath}`))
      return
    }

    const convertedDir = path.join(app.getPath('userData'), 'converted')
    fs.mkdirSync(convertedDir, { recursive: true })

    // Same hashing approach as the stems cache, so re-converting the same
    // source file (e.g. after cancelling once) reuses the existing file
    // instead of doing the work again.
    const hash = crypto
      .createHash('sha1')
      .update(resolvedPath)
      .digest('hex')
      .slice(0, 16)

    const mp3Out = path.join(convertedDir, `${hash}.mp3`)
    const wavOut = path.join(convertedDir, `${hash}.wav`)

    if (fs.existsSync(mp3Out)) {
      resolve(mp3Out)
      return
    }
    if (fs.existsSync(wavOut)) {
      resolve(wavOut)
      return
    }

    const python = getPythonPath()

    // Kept as an inline -c script (rather than a file on disk) so nothing
    // extra needs to be added to extraResource/packaging.
    const script = `
import os
import sys
import torch
from demucs.audio import AudioFile

src, dst_mp3 = sys.argv[1], sys.argv[2]
samplerate = 44100

wav = AudioFile(src).read(streams=0, samplerate=samplerate, channels=2)
wav = wav.clamp(-1, 1)

try:
    import lameenc

    pcm16 = (wav * 32767).to(torch.int16)
    interleaved = pcm16.t().contiguous().numpy()

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(320)
    encoder.set_in_sample_rate(samplerate)
    encoder.set_channels(interleaved.shape[1])
    encoder.set_quality(2)

    mp3_data = encoder.encode(interleaved.tobytes())
    mp3_data += encoder.flush()

    with open(dst_mp3, 'wb') as f:
        f.write(mp3_data)

    print(dst_mp3)
except ImportError:
    # lameenc isn't available in this environment -- fall back to WAV,
    # which Demucs can split just as well.
    import torchaudio

    dst_wav = os.path.splitext(dst_mp3)[0] + '.wav'
    torchaudio.save(dst_wav, wav, samplerate)
    print(dst_wav)
`

    const proc = spawn(python, ['-c', script, resolvedPath, mp3Out])

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      reject(new Error(`Could not start Python: ${err.message}`))
    })

    proc.on('close', (code) => {
      // The script prints the actual output path (.mp3 or .wav) as the
      // last line of stdout.
      const outPath = stdout.trim().split('\n').pop()

      if (code !== 0 || !outPath || !fs.existsSync(outPath)) {
        reject(
          new Error(
            `Conversion failed: ${stderr.trim() || `exit code ${code}`}`
          )
        )
        return
      }

      resolve(outPath)
    })
  })
})
ipcMain.handle('stems:find-existing-for-source', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null

  const resolvedPath = resolveSourcePath(filePath)

  if (!fs.existsSync(resolvedPath)) return null

  // For FLAC (or any source that needs conversion), find the
  // persistent converted file first.
  const convertedDir = path.join(app.getPath('userData'), 'converted')

  const hash = crypto
    .createHash('sha1')
    .update(resolvedPath)
    .digest('hex')
    .slice(0, 16)

  const mp3Path = path.join(convertedDir, `${hash}.mp3`)
  const wavPath = path.join(convertedDir, `${hash}.wav`)

  let stemSourcePath = resolvedPath

  if (fs.existsSync(mp3Path)) {
    stemSourcePath = mp3Path
  } else if (fs.existsSync(wavPath)) {
    stemSourcePath = wavPath
  }

  const outDir = getStemsOutDir(stemSourcePath)
  const stems = getStemPaths(outDir, stemSourcePath)

  return allStemsExist(stems) ? stems : null
})
ipcMain.handle('shell:show-in-folder', async (_event, filePath) => {
  shell.showItemInFolder(filePath)
})
    
   

  




function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'Icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // and load the index.html of the app.
  mainWindow.loadFile('index.html')

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
}

// ---------- Spotify OAuth (Authorization Code + PKCE) ----------
// The renderer builds the Spotify authorize URL (with a PKCE challenge)
// and asks the main process to open it in the user's real system browser,
// since Spotify's login page won't load inside the app's own window. This
// starts a tiny local server on 127.0.0.1 just long enough to catch the
// single redirect Spotify sends back after login, then shuts itself down.
const SPOTIFY_CALLBACK_PORT = 43897

ipcMain.handle('spotify:login', async (_event, authUrl) => {
  return new Promise((resolve) => {
    let settled = false
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.writeHead(404)
        res.end()
        return
      }
      const url = new URL(req.url, `http://127.0.0.1:${SPOTIFY_CALLBACK_PORT}`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0a1526;color:#eef1f6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <p>${error ? 'Something went wrong — you can close this tab and try again.' : 'Connected! You can close this tab and go back to Sleeve.'}</p>
      </body></html>`)

      if (!settled) {
        settled = true
        server.close()
        resolve(error ? { error } : { code, state })
      }
    })

    server.listen(SPOTIFY_CALLBACK_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl)
    })

    // Don't hang forever if the user closes the browser tab without finishing.
    setTimeout(() => {
      if (!settled) {
        settled = true
        server.close()
        resolve({ error: 'Login timed out' })
      }
    }, 5 * 60 * 1000)

    server.on('error', (err) => {
      if (!settled) {
        settled = true
        resolve({ error: err.message })
      }
    })
  })
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

