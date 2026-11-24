

// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('node:path')
const http = require('node:http')
// main.js — add near your other requires
const { spawn } = require('node:child_process')
const https = require('node:https')
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
      preload: path.join(__dirname, 'app-preload.js')
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
    // On macOS it's common to re-create an app window when its
    // dock icon is clicked and there are no other open windows.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay in the app when there's
// no windows open. This behavior is not required on non-macOS platforms.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// Find Music catalog discovery handlers (authorized store links + public metadata).
require('./find-music-main').registerFindMusicHandlers({ ipcMain, shell });

// Find Music opt-in download-folder detection and user-approved local-file import.
require('./find-music-watch-main').registerFindMusicWatchHandlers({ ipcMain, app, BrowserWindow });

// Find Music in-app open-license downloads and secure official-store browser.
require('./find-music-download-main').registerFindMusicDownloadHandlers({ ipcMain, app, BrowserWindow });

// Find Music Spotify playlist/album metadata only (no Spotify audio downloading).

// Find Music public link metadata and public album-track lookup; no Spotify Web API login.
require('./find-music-public-metadata-main').registerFindMusicPublicMetadataHandlers({ ipcMain });

// Find Music conversion of user-selected local media using a user-installed FFmpeg binary.
require('./find-music-convert-main').registerFindMusicConvertHandlers({ ipcMain, app, dialog, shell });

// Optional AI music restoration: official SonicMaster integration.
// The app downloads the upstream code and a SHA-256-verified 3.45 GB checkpoint
// only after the user explicitly starts setup in Settings.
const AI_RESTORATION_DIR = path.join(app.getPath('userData'), 'ai-restoration', 'sonicmaster');
const AI_RESTORATION_CONFIG_PATH = path.join(app.getPath('userData'), 'ai-restoration-config.json');
const SONICMASTER_REVISION = 'ab32b2d456e461b6bbc188d666caf2eabefa2f31';
const SONICMASTER_CHECKPOINT_URL = 'https://huggingface.co/amaai-lab/SonicMaster/resolve/main/model.safetensors';
const SONICMASTER_CHECKPOINT_SHA256 = 'd6af20753f79824321b62a797780ff04ff277590804793f56bd83a2f3b7a5ed4';
const SONICMASTER_FILES = [
  ['infer_single.py', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/infer_single.py`],
  ['model.py', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/model.py`],
  ['utils.py', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/utils.py`],
  ['configs/tangoflux_config.yaml', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/configs/tangoflux_config.yaml`],
  ['requirements_sonic.txt', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/requirements_sonic.txt`],
  ['LICENSE', `https://raw.githubusercontent.com/AMAAI-Lab/SonicMaster/${SONICMASTER_REVISION}/LICENSE`]
];
let aiSetupActive = false;
let aiSetupRequest = null;

function readAiRestorationConfig() {
  try { return JSON.parse(fs.readFileSync(AI_RESTORATION_CONFIG_PATH, 'utf8')); }
  catch (_) { return {}; }
}

function saveAiRestorationConfig(config) {
  fs.mkdirSync(path.dirname(AI_RESTORATION_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(AI_RESTORATION_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function aiProgress(sender, payload) {
  try { if (sender && !sender.isDestroyed()) sender.send('ai-restoration:progress', payload); }
  catch (_) {}
}

function isTrustedAiDownloadHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'raw.githubusercontent.com' || host === 'huggingface.co' ||
    host === 'hf.co' || host.endsWith('.huggingface.co') || host.endsWith('.hf.co');
}

function downloadTrustedAiAsset(sourceUrl, destination, sender, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let received = 0;
    let total = 0;
    let request = null;
    let output = null;
    const temporary = `${destination}.download`;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { if (request) request.destroy(); } catch (_) {}
      try { if (output) output.destroy(); } catch (_) {}
      try { fs.unlinkSync(temporary); } catch (_) {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const fetch = (urlString, redirects = 0) => {
      if (settled) return;
      if (redirects > 8) return fail(new Error(`${label}: too many redirects.`));
      let parsed;
      try { parsed = new URL(urlString); } catch (_) { return fail(new Error(`${label}: invalid download URL.`)); }
      if (parsed.protocol !== 'https:' || !isTrustedAiDownloadHost(parsed.hostname)) {
        return fail(new Error(`${label}: blocked untrusted download host.`));
      }
      request = https.get(parsed, { headers: { 'User-Agent': 'Sleeve-Audio-Restoration/1.0' } }, (response) => {
        const status = response.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const next = response.headers.location;
          response.resume();
          if (!next) return fail(new Error(`${label}: server returned an empty redirect.`));
          fetch(new URL(next, parsed).toString(), redirects + 1);
          return;
        }
        if (status !== 200) {
          response.resume();
          return fail(new Error(`${label}: server returned HTTP ${status}.`));
        }
        total = Number(response.headers['content-length']) || 0;
        received = 0;
        try { fs.mkdirSync(path.dirname(destination), { recursive: true }); }
        catch (error) { response.resume(); return fail(error); }
        output = fs.createWriteStream(temporary);
        response.on('data', (chunk) => {
          received += chunk.length;
          const percent = total > 0 ? Math.min(100, Math.round(received / total * 100)) : null;
          aiProgress(sender, {
            phase: label,
            message: total > 0
              ? `${label}: ${(received / 1073741824).toFixed(2)} / ${(total / 1073741824).toFixed(2)} GB (${percent}%)`
              : `${label}: ${(received / 1048576).toFixed(0)} MB downloaded`,
            percent,
            receivedBytes: received,
            totalBytes: total
          });
        });
        response.once('error', fail);
        output.once('error', fail);
        output.once('finish', () => {
          if (settled) return;
          output.close(() => {
            try { fs.renameSync(temporary, destination); }
            catch (error) { return fail(error); }
            settled = true;
            resolve({ bytes: received, totalBytes: total });
          });
        });
        response.pipe(output);
      });
      request.setTimeout(45000, () => request.destroy(new Error(`${label}: download timed out.`)));
      request.once('error', fail);
    };
    fetch(sourceUrl);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.once('error', reject);
    input.once('end', () => resolve(hash.digest('hex')));
  });
}

function checkSonicMasterFiles(config) {
  const bootstrapPython = config.pythonSetupPath || config.pythonPath;
  const required = [bootstrapPython, config.scriptPath, config.checkpointPath, config.configPath, config.requirementsPath];
  const filesReady = required.every(target => {
    try { return typeof target === 'string' && Boolean(target) && fs.statSync(target).isFile(); }
    catch (_) { return false; }
  });
  return { filesReady, configured: Boolean(bootstrapPython || config.scriptPath || config.checkpointPath) };
}

function runPythonCheck(pythonPath, code) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };
    try {
      child = spawn(pythonPath, ['-c', code], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => stdout = (stdout + chunk.toString()).slice(-5000));
      child.stderr.on('data', chunk => stderr = (stderr + chunk.toString()).slice(-5000));
      child.once('error', error => finish({ ok: false, error: error.message }));
      child.once('close', code => finish({ ok: code === 0, stdout: stdout.trim(), error: stderr.trim() }));
    } catch (error) { finish({ ok: false, error: error.message }); }
  });
}

async function checkAiRestorationConfig() {
  const config = readAiRestorationConfig();
  const paths = checkSonicMasterFiles(config);
  if (!paths.filesReady) {
    return {
      available: false,
      filesReady: false,
      runtimeReady: false,
      message: 'SonicMaster is not set up yet. Use “Set up SonicMaster” in Settings. The model checkpoint is about 3.45 GB and is downloaded only after you start setup.'
    };
  }
  try { if (!config.pythonPath || !fs.statSync(config.pythonPath).isFile()) {
    return {
      available: false,
      filesReady: true,
      runtimeReady: false,
      venvReady: false,
      message: 'SonicMaster source and model files are ready. Install AI dependencies to create an isolated Python environment and install the model packages.'
    };
  }} catch (_) {
    return {
      available: false,
      filesReady: true,
      runtimeReady: false,
      venvReady: false,
      message: 'SonicMaster source and model files are ready. Install AI dependencies to create an isolated Python environment and install the model packages.'
    };
  }
  const code = "import importlib.util,json; names=['torch','torchaudio','transformers','diffusers','accelerate','datasets','soundfile','safetensors','yaml']; print(json.dumps({name: bool(importlib.util.find_spec(name)) for name in names}))";
  const runtime = await runPythonCheck(config.pythonPath, code);
  if (!runtime.ok) {
    return { available: false, filesReady: true, runtimeReady: false, message: runtime.error || 'Could not inspect the selected Python environment.' };
  }
  let modules = {};
  try { modules = JSON.parse(runtime.stdout); } catch (_) {}
  const missing = Object.keys(modules).filter(name => !modules[name]);
  const runtimeReady = missing.length === 0;
  return {
    available: runtimeReady,
    filesReady: true,
    runtimeReady,
    missingModules: missing,
    message: runtimeReady
      ? 'SonicMaster files and required Python modules are present. The text encoder and Stable Audio VAE may still download additional model data on the first restoration.'
      : `SonicMaster model files are ready, but Python dependencies are missing: ${missing.join(', ')}. Use “Install AI dependencies” to install the official requirements.`
  };
}

ipcMain.handle('ai-restoration:check', async () => checkAiRestorationConfig());

ipcMain.handle('ai-restoration:setup-sonicmaster', async (event) => {
  if (aiSetupActive) return { ok: false, error: 'SonicMaster setup is already running.' };
  aiSetupActive = true;
  aiSetupRequest = event && event.sender;
  try {
    const owner = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : undefined;
    const picked = await dialog.showOpenDialog(owner, {
      title: 'Choose Python 3.10–3.12 for the pinned SonicMaster PyTorch requirements',
      properties: ['openFile'],
      filters: [{ name: 'Python executable', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }]
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { cancelled: true };
    const pythonSetupPath = picked.filePaths[0];
    const probe = await runPythonCheck(pythonSetupPath, "import sys,json; print(json.dumps(list(sys.version_info[:3])))");
    if (!probe.ok) throw new Error(`Selected Python could not be started: ${probe.error || 'unknown error'}`);
    let pythonVersion;
    try { pythonVersion = JSON.parse(probe.stdout); } catch (_) { pythonVersion = []; }
    if (pythonVersion[0] !== 3 || pythonVersion[1] < 10 || pythonVersion[1] > 12) {
      throw new Error('SonicMaster’s pinned PyTorch 2.4.0 dependencies require Python 3.10, 3.11, or 3.12. Select one of those Python versions.');
    }
    const modelDir = AI_RESTORATION_DIR;
    await fs.promises.mkdir(path.join(modelDir, 'configs'), { recursive: true });
    aiProgress(aiSetupRequest, { phase: 'source', message: 'Downloading official SonicMaster inference files…' });
    for (const [relativePath, url] of SONICMASTER_FILES) {
      const destination = path.join(modelDir, relativePath);
      await downloadTrustedAiAsset(url, destination, aiSetupRequest, `SonicMaster source: ${relativePath}`);
    }
    const checkpointPath = path.join(modelDir, 'model.safetensors');
    let checkpointReady = false;
    try { checkpointReady = fs.statSync(checkpointPath).isFile() && (await sha256File(checkpointPath)) === SONICMASTER_CHECKPOINT_SHA256; }
    catch (_) { checkpointReady = false; }
    if (!checkpointReady) {
      try { await fs.promises.unlink(checkpointPath); } catch (_) {}
      aiProgress(aiSetupRequest, { phase: 'checkpoint', message: 'Downloading the official SonicMaster checkpoint (about 3.45 GB)…' });
      await downloadTrustedAiAsset(SONICMASTER_CHECKPOINT_URL, checkpointPath, aiSetupRequest, 'SonicMaster model checkpoint');
      const digest = await sha256File(checkpointPath);
      if (digest !== SONICMASTER_CHECKPOINT_SHA256) {
        try { await fs.promises.unlink(checkpointPath); } catch (_) {}
        throw new Error('SonicMaster checkpoint SHA-256 verification failed. The partial or invalid file was deleted.');
      }
    }
    const venvDirectory = path.join(modelDir, '.venv');
    const venvPythonPath = process.platform === 'win32'
      ? path.join(venvDirectory, 'Scripts', 'python.exe')
      : path.join(venvDirectory, 'bin', 'python');
    const config = {
      provider: 'SonicMaster',
      pythonSetupPath,
      pythonPath: venvPythonPath,
      venvDirectory,
      modelDir,
      scriptPath: path.join(modelDir, 'infer_single.py'),
      checkpointPath,
      configPath: path.join(modelDir, 'configs', 'tangoflux_config.yaml'),
      requirementsPath: path.join(modelDir, 'requirements_sonic.txt')
    };
    saveAiRestorationConfig(config);
    const status = await checkAiRestorationConfig();
    aiProgress(aiSetupRequest, { phase: 'complete', message: status.message, percent: 100 });
    return { ok: true, ...status };
  } catch (error) {
    const message = error && error.message ? error.message : 'SonicMaster setup failed.';
    aiProgress(aiSetupRequest, { phase: 'error', message });
    return { ok: false, error: message };
  } finally {
    aiSetupActive = false;
    aiSetupRequest = null;
  }
});

function runAiSetupCommand(executable, args, cwd, sender, phase) {
  return new Promise((resolve) => {
    let child;
    let output = '';
    let settled = false;
    const finish = value => { if (settled) return; settled = true; resolve(value); };
    try {
      child = spawn(executable, args, {
        cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
      });
      const consume = chunk => {
        const value = chunk.toString();
        output = (output + value).slice(-10000);
        const lastLine = value.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
        if (lastLine) aiProgress(sender, { phase, message: lastLine.slice(-220) });
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      child.once('error', error => finish({ ok: false, error: error.message, output }));
      child.once('close', code => finish({ ok: code === 0, error: code === 0 ? '' : `Process exited with code ${code}`, output }));
    } catch (error) { finish({ ok: false, error: error.message, output }); }
  });
}

ipcMain.handle('ai-restoration:install-dependencies', async (event) => {
  const config = readAiRestorationConfig();
  const paths = checkSonicMasterFiles(config);
  if (!paths.filesReady) return { ok: false, error: 'Set up SonicMaster model files first.' };
  if (aiSetupActive) return { ok: false, error: 'Another AI setup task is running.' };
  aiSetupActive = true;
  const sender = event && event.sender;
  try {
    aiProgress(sender, { phase: 'dependencies', message: 'Creating an isolated Python environment for SonicMaster…' });
    try { await fs.promises.access(config.pythonPath); }
    catch (_) {
      const venvResult = await runAiSetupCommand(config.pythonSetupPath, ['-m', 'venv', config.venvDirectory], config.modelDir, sender, 'dependencies');
      if (!venvResult.ok) throw new Error(`Could not create the isolated Python environment: ${venvResult.error}. ${venvResult.output.split(/\r?\n/).slice(-5).join(' ')}`);
    }
    const pythonProbe = await runPythonCheck(config.pythonPath, 'import sys; print(sys.version.split()[0])');
    if (!pythonProbe.ok) throw new Error(`The isolated Python environment could not start: ${pythonProbe.error || 'unknown error'}`);
    aiProgress(sender, { phase: 'dependencies', message: 'Installing the official SonicMaster requirements and explicit inference dependencies. This can download several GB of packages.' });
    const result = await runAiSetupCommand(config.pythonPath, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', config.requirementsPath, 'soundfile', 'safetensors', 'PyYAML'], config.modelDir, sender, 'dependencies');
    if (!result.ok) throw new Error(`${result.error}. ${result.output.split(/\r?\n/).slice(-7).join(' ')}`);
    const status = await checkAiRestorationConfig();
    aiProgress(sender, { phase: 'complete', message: status.message, percent: 100 });
    return { ok: true, ...status };
  } catch (error) {
    const message = error && error.message ? error.message : 'Could not install SonicMaster dependencies.';
    aiProgress(sender, { phase: 'error', message });
    return { ok: false, error: message };
  } finally { aiSetupActive = false; }
});

ipcMain.handle('ai-restoration:restore-file', async (event) => {
  const config = readAiRestorationConfig();
  const status = await checkAiRestorationConfig();
  if (!status.available) throw new Error(status.message);
  const owner = event && event.sender ? BrowserWindow.fromWebContents(event.sender) : undefined;
  const picked = await dialog.showOpenDialog(owner, {
    title: 'Choose a local audio file to restore',
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: ['wav', 'flac', 'mp3', 'm4a', 'opus', 'ogg', 'aac'] }]
  });
  if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { cancelled: true };
  const inputPath = path.resolve(picked.filePaths[0]);
  const outputDirectory = path.join(app.getPath('music'), 'Sleeve Restored');
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const baseName = path.basename(inputPath, path.extname(inputPath)).replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').slice(0, 100) || 'Restored Audio';
  let outputPath = path.join(outputDirectory, `${baseName} (SonicMaster).wav`);
  for (let suffix = 2; fs.existsSync(outputPath); suffix += 1) outputPath = path.join(outputDirectory, `${baseName} (SonicMaster ${suffix}).wav`);
  const args = [
    config.scriptPath,
    '--ckpt', config.checkpointPath,
    '--input', inputPath,
    '--prompt', 'Restore this music recording. Reduce unwanted distortion, clipping, reverberation, and tonal imbalance while preserving the original musical performance and arrangement.',
    '--output', outputPath,
    '--config', config.configPath
  ];
  aiProgress(event && event.sender, { phase: 'inference', message: 'Running SonicMaster inference. Model loading and first-run VAE/text-encoder downloads may take time.' });
  return new Promise((resolve, reject) => {
    let stderr = '';
    let stdout = '';
    let child;
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; error ? reject(error) : resolve(result); };
    try {
      child = spawn(config.pythonPath, args, { cwd: config.modelDir, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => {
        const line = chunk.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
        stdout = (stdout + chunk.toString()).slice(-5000);
        if (line) aiProgress(event && event.sender, { phase: 'inference', message: line.slice(-220) });
      });
      child.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr = (stderr + text).slice(-8000);
        const line = text.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
        if (line) aiProgress(event && event.sender, { phase: 'inference', message: line.slice(-220) });
      });
      child.once('error', error => finish(error));
      child.once('close', code => {
        if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
          const message = `SonicMaster restoration finished. Your original is unchanged. Output: ${outputPath}`;
          aiProgress(event && event.sender, { phase: 'complete', message, percent: 100 });
          finish(null, { cancelled: false, outputPath, message });
        } else {
          const message = stderr.trim().split(/\r?\n/).slice(-6).join(' ') || stdout.trim().split(/\r?\n/).slice(-3).join(' ') || `SonicMaster exited with code ${code}.`;
          aiProgress(event && event.sender, { phase: 'error', message });
          finish(new Error(message));
        }
      });
    } catch (error) { finish(error); }
  });
});

// ---------- spotDL download integration ----------
// This block uses the existing Electron main-process imports (app, ipcMain,
// shell, path, fs and spawn). Do not expose child_process to the renderer.
const SPOTDL_DOWNLOAD_FOLDER_NAME = 'Sleeve Downloads';
let spotdlResolvedCommand = null;
let activeSpotdlJob = null;
let pendingSpotdlEnhancement = null;

function getSpotdlDownloadDirectory() {
  return path.join(app.getPath('music'), SPOTDL_DOWNLOAD_FOLDER_NAME);
}

function getSpotdlCandidates() {
  const candidates = [
    { command: 'spotdl', prefixArgs: [] },
    { command: 'spotdl.exe', prefixArgs: [] }
  ];
  if (process.platform === 'win32') {
    candidates.push(
      { command: 'py', prefixArgs: ['-m', 'spotdl'] },
      { command: 'python', prefixArgs: ['-m', 'spotdl'] },
      { command: 'python3', prefixArgs: ['-m', 'spotdl'] }
    );
  } else {
    candidates.push(
      { command: 'python3', prefixArgs: ['-m', 'spotdl'] },
      { command: 'python', prefixArgs: ['-m', 'spotdl'] }
    );
  }
  return candidates;
}

function probeSpotdlCandidate(candidate) {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let child;
    const finish = (success) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success ? { ...candidate, version: output.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '' } : null);
    };
    const timer = setTimeout(() => {
      try { if (child) child.kill(); } catch (_) {}
      finish(false);
    }, 9000);
    try {
      child = spawn(candidate.command, [...candidate.prefixArgs, '--version'], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { output += chunk.toString(); });
      child.once('error', () => finish(false));
      child.once('close', (code) => finish(code === 0));
    } catch (_) {
      finish(false);
    }
  });
}

async function findSpotdlCommand() {
  if (spotdlResolvedCommand) return spotdlResolvedCommand;
  for (const candidate of getSpotdlCandidates()) {
    const found = await probeSpotdlCandidate(candidate);
    if (found) {
      spotdlResolvedCommand = found;
      return found;
    }
  }
  return null;
}

function validateSpotdlUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = new Set(['open.spotify.com', 'spotify.com', 'www.spotify.com', 'spotify.link']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(host)) return null;
    if (host === 'spotify.link') return parsed.pathname.length > 1 ? parsed.toString() : null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const typeIndex = parts.findIndex((part) => ['track', 'album', 'playlist', 'artist'].includes(part));
    if (typeIndex < 0 || !parts[typeIndex + 1] || parts.length !== typeIndex + 2) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function sendSpotdlProgress(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('spotdl:progress', payload);
  } catch (_) {}
}

function countSpotdlAudioFiles(root) {
  const extensions = /\.(mp3|flac|ogg|opus|m4a|wav|aac)$/i;
  const stack = [root];
  let count = 0;
  let visited = 0;
  const MAX_DIRECTORIES = 10000;
  while (stack.length && visited < MAX_DIRECTORIES) {
    const current = stack.pop();
    visited += 1;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) { if (entry.name.toLowerCase() !== 'enhanced') stack.push(fullPath); }
      else if (entry.isFile() && extensions.test(entry.name)) count += 1;
    }
  }
  return count;
}

function snapshotSpotdlFiles(directory) {
  const files = new Map();
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (_) {}
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(mp3|flac|ogg|opus|m4a|wav|aac)$/i.test(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      files.set(fullPath, { size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (_) {}
  }
  return files;
}

function getFfmpegCandidates() {
  const executable = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  let configured = '';
  try {
    const settingsPath = path.join(app.getPath('userData'), 'find-music-convert.json');
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (typeof saved.ffmpegPath === 'string') configured = saved.ffmpegPath;
  } catch (_) {}

  return [...new Set([
    process.env.FFMPEG_PATH || '',
    configured,
    app.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', executable) : '',
    path.join(__dirname, executable),
    path.join(__dirname, 'vendor', 'ffmpeg', executable),
    executable
  ].filter(Boolean))];
}

function probeFfmpeg(binary) {
  return new Promise((resolve) => {
    let output = '';
    let child;
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Boolean(available) && /ffmpeg version/i.test(output));
    };
    const timer = setTimeout(() => {
      try { if (child) child.kill(); } catch (_) {}
      finish(false);
    }, 4000);

    try {
      child = spawn(binary, ['-version'], {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (chunk) => { output = (output + chunk.toString()).slice(0, 3000); });
      child.stderr.on('data', (chunk) => { output = (output + chunk.toString()).slice(0, 3000); });
      child.once('error', () => finish(false));
      child.once('close', (code) => finish(code === 0));
    } catch (_) {
      finish(false);
    }
  });
}

async function findFfmpegForEnhancement() {
  for (const candidate of getFfmpegCandidates()) {
    if (await probeFfmpeg(candidate)) return candidate;
  }
  throw new Error('FFmpeg was not found. Configure it in Find Music → Convert or add FFmpeg to PATH. The original downloads are still available.');
}

function uniqueEnhancedOutput(directory, baseName, extension) {
  let output = path.join(directory, `${baseName} (Enhanced)${extension}`);
  for (let suffix = 2; fs.existsSync(output); suffix += 1) {
    output = path.join(directory, `${baseName} (Enhanced ${suffix})${extension}`);
  }
  return output;
}

function transcodeEnhancedCopy(ffmpeg, source, temporaryOutput, extension, job) {
  const ext = extension.toLowerCase();
  let codecArgs;
  if (ext === '.m4a' || ext === '.m4b' || ext === '.aac') codecArgs = ['-c:a', 'aac', '-b:a', '256k'];
  else if (ext === '.opus' || ext === '.ogg' || ext === '.oga') codecArgs = ['-c:a', 'libopus', '-b:a', '160k'];
  else if (ext === '.mp3') codecArgs = ['-c:a', 'libmp3lame', '-q:a', '2'];
  else if (ext === '.flac') codecArgs = ['-c:a', 'flac', '-compression_level', '5'];
  else if (ext === '.wav') codecArgs = ['-c:a', 'pcm_s16le'];
  else throw new Error(`Smart enhancement does not support ${ext || 'this format'}.`);

  const args = [
    '-hide_banner', '-nostdin', '-y', '-i', source,
    '-map', '0:a:0', '-vn',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95:level=false',
    '-map_metadata', '0',
    ...codecArgs,
    '-nostats', temporaryOutput
  ];

  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (job && job.enhanceProc === child) job.enhanceProc = null;
      error ? reject(error) : resolve();
    };
    try {
      child = spawn(ffmpeg, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      if (job) job.enhanceProc = child;
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-5000); });
      child.once('error', (error) => finish(error));
      child.once('close', (code) => {
        finish(code === 0 ? null : new Error(stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `FFmpeg exited with code ${code}`));
      });
    } catch (error) {
      finish(error);
    }
  });
}

function getNewSpotdlFiles(downloadDirectory, beforeFiles) {
  const afterFiles = snapshotSpotdlFiles(downloadDirectory);
  return [...afterFiles.entries()].filter(([filePath, current]) => {
    const previous = beforeFiles.get(filePath);
    return !previous || previous.size !== current.size || previous.mtimeMs !== current.mtimeMs;
  });
}

async function enhanceNewSpotdlFiles(downloadDirectory, beforeFiles, sender, job) {
  const newFiles = getNewSpotdlFiles(downloadDirectory, beforeFiles);
  if (!newFiles.length) throw new Error('No newly downloaded audio files were found to enhance.');

  const ffmpeg = await findFfmpegForEnhancement();
  const enhancedDirectory = path.join(downloadDirectory, 'Enhanced');
  await fs.promises.mkdir(enhancedDirectory, { recursive: true });

  let created = 0;
  for (const [sourcePath] of newFiles) {
    const extension = path.extname(sourcePath);
    const baseName = path.basename(sourcePath, extension);
    const outputPath = uniqueEnhancedOutput(enhancedDirectory, baseName, extension);
    const tempPath = path.join(enhancedDirectory, `.${path.basename(outputPath, extension)}.${Date.now()}.tmp${extension}`);
    try {
      await transcodeEnhancedCopy(ffmpeg, sourcePath, tempPath, extension, job);
      await fs.promises.rename(tempPath, outputPath);
      created += 1;
      sendSpotdlProgress(sender, { status: 'enhancing', message: `Enhanced copy created: ${path.basename(outputPath)}` });
    } catch (error) {
      try { await fs.promises.unlink(tempPath); } catch (_) {}
      throw new Error(`Could not enhance ${path.basename(sourcePath)}: ${error.message || error}`);
    }
  }
  return created;
}

ipcMain.handle('spotdl:check', async () => {
  const command = await findSpotdlCommand();
  const downloadDir = getSpotdlDownloadDirectory();
  try { fs.mkdirSync(downloadDir, { recursive: true }); } catch (_) {}
  return {
    available: Boolean(command),
    version: command ? command.version : '',
    downloadDir
  };
});

ipcMain.handle('spotdl:start', async (event, rawUrl, options = {}) => {
  const requestedFormat = ['m4a', 'opus', 'mp3'].includes(String(options && options.format || '').toLowerCase())
    ? String(options.format).toLowerCase() : 'm4a';
  const spotifyUrl = validateSpotdlUrl(rawUrl);
  if (!spotifyUrl) return { ok: false, error: 'Enter a valid HTTPS Spotify link.' };
  if (activeSpotdlJob) return { ok: false, error: 'A spotDL job is already running.' };
  pendingSpotdlEnhancement = null;

  const command = await findSpotdlCommand();
  if (!command) {
    return {
      ok: false,
      error: 'spotDL was not found. Install it with Python, then reopen Sleeve and try again.'
    };
  }

  const downloadDir = getSpotdlDownloadDirectory();
  try {
    fs.mkdirSync(downloadDir, { recursive: true });
  } catch (error) {
    return { ok: false, error: `Could not create the download folder: ${error.message}` };
  }

  const outputTemplate = path.join(downloadDir, '{artist} - {title}.{output-ext}');
  const args = [
    ...command.prefixArgs,
    'download',
    spotifyUrl,
    '--format', requestedFormat,
    ...(requestedFormat === 'mp3' ? [] : ['--bitrate', 'disable']),
    '--output', outputTemplate
  ];

  return new Promise((resolve) => {
    let settled = false;
    let textBuffer = '';
    const job = { proc: null, enhanceProc: null, sender: event.sender, cancelled: false, resolve: null, enhancing: false, beforeFiles: snapshotSpotdlFiles(downloadDir) };
    activeSpotdlJob = job;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (activeSpotdlJob === job) activeSpotdlJob = null;
      resolve(result);
    };

    const publishLine = (rawLine) => {
      const message = String(rawLine || '')
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\u0000/g, '')
        .trim();
      if (!message) return;
      sendSpotdlProgress(job.sender, { status: 'running', message: message.slice(-280) });
    };

    const consumeOutput = (chunk) => {
      textBuffer += chunk.toString();
      const lines = textBuffer.split(/[\r\n]+/);
      textBuffer = lines.pop() || '';
      for (const line of lines) publishLine(line);
    };

    try {
      job.proc = spawn(command.command, args, {
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({ ok: false, error: `Could not start spotDL: ${error.message}` });
      return;
    }

    job.proc.stdout.on('data', consumeOutput);
    job.proc.stderr.on('data', consumeOutput);
    job.proc.once('error', (error) => {
      sendSpotdlProgress(job.sender, { status: 'error', message: error.message });
      finish({ ok: false, error: `Could not start spotDL: ${error.message}` });
    });
    job.proc.once('close', async (code) => {
      if (textBuffer.trim()) publishLine(textBuffer);
      if (job.cancelled) {
        sendSpotdlProgress(job.sender, { status: 'cancelled', message: 'Download cancelled.' });
        finish({ ok: false, cancelled: true, downloadDir });
        return;
      }
      if (code === 0) {
        const newFileCount = getNewSpotdlFiles(downloadDir, job.beforeFiles).length;
        pendingSpotdlEnhancement = newFileCount > 0
          ? { downloadDir, beforeFiles: job.beforeFiles, createdAt: Date.now() }
          : null;
        sendSpotdlProgress(job.sender, {
          status: 'done',
          downloadDir,
          count: countSpotdlAudioFiles(downloadDir),
          newFileCount,
          enhancementAvailable: Boolean(pendingSpotdlEnhancement)
        });
        finish({ ok: true, downloadDir, newFileCount, enhancementAvailable: Boolean(pendingSpotdlEnhancement) });
      } else {
        const message = `spotDL stopped with exit code ${code}. Check the output above; common causes are a network error, an unavailable match, or missing dependencies.`;
        sendSpotdlProgress(job.sender, { status: 'error', message });
        finish({ ok: false, error: message, downloadDir });
      }
    });

    sendSpotdlProgress(job.sender, { status: 'running', message: 'Starting spotDL…' });
  });
});



ipcMain.handle('spotdl:enhance', async (event) => {
  if (activeSpotdlJob) return { ok: false, error: 'Another spotDL job is still running.' };
  if (!pendingSpotdlEnhancement) return { ok: false, error: 'There is no recent download available to enhance.' };

  const pending = pendingSpotdlEnhancement;
  const job = { proc: null, enhanceProc: null, sender: event.sender, cancelled: false, enhancing: true };
  activeSpotdlJob = job;
  sendSpotdlProgress(job.sender, {
    status: 'enhancing',
    message: 'Creating separate enhanced copies with FFmpeg. The downloaded originals will not be changed.'
  });

  try {
    const enhancedCount = await enhanceNewSpotdlFiles(pending.downloadDir, pending.beforeFiles, job.sender, job);
    pendingSpotdlEnhancement = null;
    sendSpotdlProgress(job.sender, {
      status: 'enhance-done',
      downloadDir: pending.downloadDir,
      enhancedCount
    });
    return { ok: true, downloadDir: pending.downloadDir, enhancedCount };
  } catch (error) {
    const message = error && error.message ? error.message : 'FFmpeg enhancement failed.';
    sendSpotdlProgress(job.sender, { status: 'enhance-error', message, downloadDir: pending.downloadDir });
    return { ok: false, error: message };
  } finally {
    if (activeSpotdlJob === job) activeSpotdlJob = null;
  }
});

ipcMain.handle('spotdl:cancel', async () => {
  const job = activeSpotdlJob;
  if (job && job.enhancing) return { ok: false, error: 'The download has finished; the enhancement step cannot be cancelled.' };
  if (!job || !job.proc || !job.proc.pid) return { ok: false, error: 'No active spotDL download.' };
  job.cancelled = true;
  sendSpotdlProgress(job.sender, { status: 'cancelling', message: 'Stopping the download…' });
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(job.proc.pid), '/t', '/f'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore'
      });
      killer.unref();
    } else {
      try { process.kill(-job.proc.pid, 'SIGTERM'); }
      catch (_) { job.proc.kill('SIGTERM'); }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Could not stop spotDL: ${error.message}` };
  }
});

ipcMain.handle('spotdl:open-folder', async () => {
  const downloadDir = getSpotdlDownloadDirectory();
  try {
    fs.mkdirSync(downloadDir, { recursive: true });
    const error = await shell.openPath(downloadDir);
    return error ? { ok: false, error } : { ok: true, downloadDir };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not open the download folder.' };
  }
});

app.on('before-quit', () => {
  const job = activeSpotdlJob;
  if (!job) return;
  job.cancelled = true;
  const child = job.enhancing ? job.enhanceProc : job.proc;
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        shell: false,
        stdio: 'ignore'
      });
      killer.unref();
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (_) { child.kill('SIGTERM'); }
    }
  } catch (_) {}
});
// ---------- End spotDL download integration ----------
