'use strict';

/**
 * FIND MUSIC: CONVERT MODULE
 * Combined Backend (Main Process) and Frontend (Renderer Process) logic.
 */

// =============================================================================
// BACKEND LOGIC (Main Process)
// =============================================================================
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.mpeg', '.mpg', '.ts', '.m2ts', '.wmv', '.flv', '.ogv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.flac', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus', '.wma', '.aiff', '.aif', '.alac', '.ape', '.wv']);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_AUTO_IMPORT_BYTES = 300 * 1024 * 1024;
const MAX_OUTPUTS = 30;
const selectedSources = new Map();
const completedOutputs = new Map();
const jobs = new Map();
let configuredFfmpeg = '';
let validatedFfmpeg = '';

function safeText(value, max = 300) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function sanitizeBaseName(value) {
  const raw = path.basename(String(value || 'converted-media').replace(/\\/g, '/'));
  const cleaned = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').replace(/^\.+/g, '').replace(/[. ]+$/g, '').trim().slice(0, 100);
  return cleaned || 'converted-media';
}
function validFormat(format) {
  const value = String(format || '').toLowerCase();
  if (value !== 'mp3' && value !== 'mp4') throw new Error('Choose MP3 audio or MP4 video as the output format.');
  return value;
}
function sourceKind(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return '';
}
function uniqueOutputPath(directory, base, extension, exists = fs.existsSync) {
  const first = path.join(directory, `${base}.${extension}`);
  if (!exists(first)) return first;
  for (let n = 2; n < 10000; n += 1) {
    const candidate = path.join(directory, `${base} (${n}).${extension}`);
    if (!exists(candidate)) return candidate;
  }
  return path.join(directory, `${base}-${Date.now()}.${extension}`);
}
function buildFfmpegArgs(sourcePath, outputPath, format) {
  const outFormat = validFormat(format);
  if (outFormat === 'mp3') {
    return ['-hide_banner', '-nostdin', '-y', '-i', sourcePath, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-map_metadata', '0', '-progress', 'pipe:1', '-nostats', outputPath];
  }
  return ['-hide_banner', '-nostdin', '-y', '-i', sourcePath, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-map_metadata', '0', '-progress', 'pipe:1', '-nostats', outputPath];
}
function parseProgressTime(line) {
  const match = String(line || '').match(/^out_time_(?:ms|us)=(\d+)$/);
  if (!match) return null;
  return Number(match[1]) / 1_000_000;
}
function progressPercent(seconds, duration) {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.min(99, Math.round(seconds / duration * 100)));
}
function pathOnSearchPath(fileName) {
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const entry of pathEntries) {
    for (const ext of extensions) {
      const candidate = path.join(entry, fileName.endsWith(ext) ? fileName : `${fileName}${ext}`);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {}
    }
  }
  return '';
}
function candidateFfmpegPaths(app, configured) {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [configured, process.env.FFMPEG_PATH || '',
    app && app.isPackaged && process.resourcesPath ? path.join(process.resourcesPath, 'ffmpeg', name) : '',
    path.join(__dirname, name), path.join(__dirname, 'vendor', 'ffmpeg', name),
    pathOnSearchPath(name)];
  return [...new Set(candidates.filter(Boolean).map(p => path.resolve(p)))];
}
function runCapture(binary, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let child;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { try { child && child.kill(); } catch (_) {} finish({ ok: false, output }); }, timeoutMs);
    try {
      child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(0, 12000); });
      child.stderr.on('data', chunk => { output = (output + chunk.toString()).slice(0, 12000); });
      child.on('error', () => finish({ ok: false, output }));
      child.on('close', code => finish({ ok: code === 0, output }));
    } catch (_) { finish({ ok: false, output }); }
  });
}
async function resolveFfmpeg(app) {
  if (validatedFfmpeg) return validatedFfmpeg;
  for (const candidate of candidateFfmpegPaths(app, configuredFfmpeg)) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
    } catch (_) { continue; }
    const check = await runCapture(candidate, ['-version'], 4500);
    if (check.ok && /ffmpeg version/i.test(check.output)) {
      validatedFfmpeg = candidate;
      configuredFfmpeg = candidate;
      return candidate;
    }
  }
  return '';
}
function siblingFfprobe(ffmpegPath) {
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const candidate = path.join(path.dirname(ffmpegPath), name);
  try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {}
  return pathOnSearchPath(name);
}
async function probeDuration(ffmpegPath, sourcePath) {
  const ffprobe = siblingFfprobe(ffmpegPath);
  if (!ffprobe) return null;
  const result = await runCapture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath], 10000);
  if (!result.ok) return null;
  const duration = Number(String(result.output || '').trim().split(/\s+/)[0]);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}
function sendProgress(sender, payload) {
  try { if (sender && !sender.isDestroyed()) sender.send('find-music:convert-progress', payload); } catch (_) {}
}
function loadConfiguredFfmpeg(app) {
  try {
    const configPath = path.join(app.getPath('userData'), 'find-music-convert.json');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (typeof saved.ffmpegPath === 'string') configuredFfmpeg = saved.ffmpegPath;
  } catch (_) {}
}
function saveConfiguredFfmpeg(app, executable) {
  try {
    const configPath = path.join(app.getPath('userData'), 'find-music-convert.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ ffmpegPath: executable }, null, 2), 'utf8');
  } catch (_) {}
}
function pruneMap(map, max) {
  while (map.size > max) map.delete(map.keys().next().value);
}

function registerFindMusicHandlers({ ipcMain, shell }) {
  // This is a placeholder for the main handler registration
  // to prevent crashes during startup. The actual feature-specific
  // handlers are registered in registerFindMusicConvertHandlers.
  return { registered: true };
}

function registerFindMusicConvertHandlers({ ipcMain, app, dialog, shell }) {
  if (!ipcMain || !app || !dialog) throw new TypeError('ipcMain, app and dialog are required.');
  loadConfiguredFfmpeg(app);

  ipcMain.handle('find-music:convert-status', async () => {
    const executable = await resolveFfmpeg(app);
    return executable
      ? { available: true, executableName: path.basename(executable), message: `FFmpeg ready (${path.basename(executable)}).` }
      : { available: false, executableName: '', message: 'FFmpeg was not found. Install FFmpeg or select your ffmpeg executable to enable conversion.' };
  });

  ipcMain.handle('find-music:convert-pick-ffmpeg', async (event) => {
    const dialogOptions = { title: 'Select FFmpeg executable', properties: ['openFile'] };
    if (process.platform === 'win32') dialogOptions.filters = [{ name: 'FFmpeg executable', extensions: ['exe'] }];
    const result = await dialog.showOpenDialog(event && event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : undefined, dialogOptions);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { cancelled: true };
    const selected = path.resolve(result.filePaths[0]);
    const check = await runCapture(selected, ['-version'], 5000);
    if (!check.ok || !/ffmpeg version/i.test(check.output)) throw new Error('That file did not run as an FFmpeg executable. Select ffmpeg.exe (or the ffmpeg binary on macOS/Linux).');
    configuredFfmpeg = selected;
    validatedFfmpeg = selected;
    saveConfiguredFfmpeg(app, selected);
    return { cancelled: false, executableName: path.basename(selected), message: `FFmpeg ready (${path.basename(selected)}).` };
  });

  ipcMain.handle('find-music:convert-pick-source', async (event) => {
    const result = await dialog.showOpenDialog(event && event.sender ? require('electron').BrowserWindow.fromWebContents(event.sender) : undefined, {
      title: 'Choose a media file you are allowed to convert', properties: ['openFile'],
      filters: [{ name: 'Audio and video files', extensions: [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].map(ext => ext.slice(1)).sort() }, { name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { cancelled: true };
    const sourcePath = path.resolve(result.filePaths[0]);
    const stat = await fs.promises.stat(sourcePath);
    const kind = sourceKind(sourcePath);
    if (!stat.isFile()) throw new Error('Choose a regular media file.');
    if (!kind) throw new Error('Choose a supported audio/video file (MP3, WAV, FLAC, M4A, MP4, MOV, MKV, WebM, or AVI).');
    if (stat.size <= 0) throw new Error('The selected media file is empty.');
    if (stat.size > MAX_SOURCE_BYTES) throw new Error('The selected file is larger than Sleeve’s 20 GB conversion limit.');
    const selectionToken = crypto.randomUUID();
    selectedSources.set(selectionToken, { path: sourcePath, name: path.basename(sourcePath), size: stat.size, kind, mtimeMs: stat.mtimeMs });
    pruneMap(selectedSources, 12);
    return { cancelled: false, selectionToken, name: path.basename(sourcePath), size: stat.size, kind, extension: path.extname(sourcePath).toLowerCase() };
  });

  ipcMain.handle('find-music:convert-run', async (event, payload) => {
    const selectionToken = safeText(payload && payload.selectionToken, 120);
    const selection = selectedSources.get(selectionToken);
    if (!selection) throw new Error('Choose the media file again; the previous selection has expired.');
    const format = validFormat(payload && payload.format);
    const jobId = safeText(payload && payload.jobId, 120) || crypto.randomUUID();
    if (jobs.has(jobId)) throw new Error('A conversion with that ID is already running.');
    if (format === 'mp4' && selection.kind !== 'video') throw new Error('MP4 output requires a video source. Choose MP3 to extract audio from an audio/video file.');
    const stat = await fs.promises.stat(selection.path);
    if (!stat.isFile() || stat.size !== selection.size || stat.mtimeMs !== selection.mtimeMs) throw new Error('The selected media file changed since you chose it. Select it again and retry.');
    const ffmpegPath = await resolveFfmpeg(app);
    if (!ffmpegPath) throw new Error('FFmpeg is not configured. Install FFmpeg or click “Locate FFmpeg” first.');

    const outputDir = path.join(app.getPath('music'), 'Sleeve Converted');
    await fs.promises.mkdir(outputDir, { recursive: true });
    const sourceBase = sanitizeBaseName(path.basename(selection.path, path.extname(selection.path)));
    const outputPath = uniqueOutputPath(outputDir, `${sourceBase} (Sleeve)`, format);
    const tempPath = path.join(outputDir, `.${path.basename(outputPath, `.${format}`)}.${jobId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36)}.tmp.${format}`);
    const sender = event && event.sender;
    const job = { process: null, tempPath, sender, cancelled: false };
    jobs.set(jobId, job);
    sendProgress(sender, { jobId, stage: 'preparing', percent: 0, message: 'Preparing conversion…' });
    let duration = null;
    try {
      duration = await probeDuration(ffmpegPath, selection.path);
      if (job.cancelled) throw new Error('Conversion cancelled.');
    } catch (error) {
      jobs.delete(jobId);
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
    const args = buildFfmpegArgs(selection.path, tempPath, format);

    sendProgress(sender, { jobId, stage: 'starting', percent: 0, message: 'Starting FFmpeg…' });
    return await new Promise((resolve, reject) => {
      let settled = false;
      let stderr = '';
      let stdoutBuffer = '';
      let child;
      const finish = async (error, result) => {
        if (settled) return;
        settled = true;
        jobs.delete(jobId);
        if (error) {
          await fs.promises.rm(tempPath, { force: true }).catch(() => {});
          reject(error);
          return;
        }
        try {
          const outputStat = await fs.promises.stat(tempPath);
          if (!outputStat.isFile() || outputStat.size <= 0) throw new Error('FFmpeg completed but did not create a usable output file.');
          await fs.promises.rename(tempPath, outputPath);
          const outputToken = crypto.randomUUID();
          completedOutputs.set(outputToken, { path: outputPath, name: path.basename(outputPath), size: outputStat.size, mtimeMs: outputStat.mtimeMs, format });
          pruneMap(completedOutputs, MAX_OUTPUTS);
          sendProgress(sender, { jobId, stage: 'complete', percent: 100, message: 'Conversion complete.' });
          resolve({ outputToken, name: path.basename(outputPath), size: outputStat.size, format, autoImport: outputStat.size <= MAX_AUTO_IMPORT_BYTES, directoryLabel: 'Music/Sleeve Converted' });
        } catch (error) {
          await fs.promises.rm(tempPath, { force: true }).catch(() => {});
          reject(error);
        }
      };
      try {
        if (job.cancelled) { finish(new Error('Conversion cancelled.')); return; }
        child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        job.process = child;
        child.stdout.on('data', chunk => {
          stdoutBuffer += chunk.toString();
          const lines = stdoutBuffer.split(/\\r?\\n/);
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            const seconds = parseProgressTime(line.trim());
            if (seconds == null) continue;
            const percent = progressPercent(seconds, duration);
            sendProgress(sender, { jobId, stage: 'processing', percent, message: percent == null ? 'Converting media…' : `Converting media… ${percent}%` });
          }
        });
        child.stderr.on('data', chunk => {
          stderr = (stderr + chunk.toString()).slice(-10000);
          if (!duration) {
            const match = stderr.match(/Duration:\\s*(\\d+):(\\d+):(\\d+(?:\\.\\d+)?)/i);
            if (match && !duration) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
          }
        });
        child.on('error', error => finish(new Error(`Could not start FFmpeg: ${error.message}`)));
        child.on('close', code => {
          if (job.cancelled) { finish(new Error('Conversion cancelled.')); return; }
          if (code !== 0) {
            const explanation = /Unknown encoder ['"]?libmp3lame/i.test(stderr) ? 'This FFmpeg build does not include the MP3 encoder (libmp3lame).' : /Unknown encoder ['"]?libx264/i.test(stderr) ? 'This FFmpeg build does not include the H.264 encoder (libx264).' : safeText(stderr.slice(-1600), 1600) || `FFmpeg exited with code ${code}.`;
            finish(new Error(`FFmpeg could not create the requested file. ${explanation}`));
            return;
          }
          finish(null, {});
        });
      } catch (error) { finish(new Error(`Could not start FFmpeg: ${error.message}`)); }
    });
  });

  ipcMain.handle('find-music:convert-cancel', async (_event, rawJobId) => {
    const jobId = safeText(rawJobId, 120);
    const job = jobs.get(jobId);
    if (!job) return { cancelled: false };
    job.cancelled = true;
    try { job.process && job.process.kill(); } catch (_) {}
    return { cancelled: true };
  });

  ipcMain.handle('find-music:convert-read-output', async (_event, rawToken) => {
    const token = safeText(rawToken, 120);
    const output = completedOutputs.get(token);
    if (!output) throw new Error('That converted file is no longer available to import. Convert it again.');
    const outputDir = path.resolve(app.getPath('music'), 'Sleeve Converted');
    const realPath = await fs.promises.realpath(output.path);
    const prefix = outputDir.endsWith(path.sep) ? outputDir : `${outputDir}${path.sep}`;
    if (!realPath.startsWith(prefix)) throw new Error('Sleeve blocked an output path outside its conversion folder.');
    const stat = await fs.promises.stat(realPath);
    if (!stat.isFile() || stat.size <= 0) throw new Error('The converted file is empty or missing.');
    if (stat.size > MAX_AUTO_IMPORT_BYTES) throw new Error('This converted file is too large for automatic library import (300 MB maximum). It has been saved to Music/Sleeve Converted.');
    const buffer = await fs.promises.readFile(realPath);
    if (buffer.length !== stat.size) throw new Error('The converted file changed while Sleeve was reading it. Try again.');
    const mime = output.format === 'mp4' ? 'video/mp4' : 'audio/mpeg';
    return { path: realPath, name: output.name, size: stat.size, type: mime, lastModified: stat.mtimeMs, bytes: Uint8Array.from(buffer) };
  });

  ipcMain.handle('find-music:convert-reveal-output', async (_event, rawToken) => {
    const output = completedOutputs.get(safeText(rawToken, 120));
    if (!output) throw new Error('That converted file is no longer available.');
    if (shell && typeof shell.showItemInFolder === 'function') shell.showItemInFolder(output.path);
    else if (shell && typeof shell.openPath === 'function') await shell.openPath(path.dirname(output.path));
    return { ok: true };
  });
}

module.exports = {
  registerFindMusicConvertHandlers,
  sanitizeBaseName,
  validFormat,
  sourceKind,
  uniqueOutputPath,
  buildFfmpegArgs,
  parseProgressTime,
  progressPercent,
  MAX_AUTO_IMPORT_BYTES
};

// =============================================================================
// FRONTEND LOGIC (Renderer Process)
// =============================================================================
function initFindMusicConvertUI() {
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  if (document.getElementById('fmConvertCard')) return;

  const api = window.electronAPI;
  const parent = document.getElementById('fmImportWorkflow');
  if (!api || !parent || typeof api.findMusicConvertPickSource !== 'function' ||
      typeof api.findMusicConvertRun !== 'function') {
    console.warn('[Sleeve Find Music] Local media converter is unavailable. Re-run the current installer.');
    return;
  }

  const card = document.createElement('section');
  card.id = 'fmConvertCard';
  card.className = 'find-music-card fm-convert-card';
  card.innerHTML = `
    <div class="fm-convert-head">
      <div class="fm-convert-icon" aria-hidden="true"><span></span><span></span></div>
      <div><span class="fm-import-eyebrow">LOCAL MEDIA TOOLS</span><h3>Make an MP3 or MP4</h3>
      <p>Use a media file you own or are authorized to convert. Paste a Spotify link above to identify a track, or a YouTube URL to identify a video.</p></div>
    </div>
    <div class="fm-convert-reference-row">
      <button id="fmConvertFindVideo" class="find-music-secondary" type="button">Find YouTube reference</button>
      <span class="fm-convert-muted">Opens the regular browser only when clicked.</span>
    </div>
    <div class="fm-convert-source-row">
      <button id="fmConvertPickSource" class="find-music-secondary" type="button">Choose media file…</button>
      <div class="fm-convert-source-info"><strong id="fmConvertSourceName">No file selected</strong><span id="fmConvertSourceDetails">Choose an audio or video file from your computer.</span></div>
    </div>
    <div class="fm-convert-actions">
      <label class="fm-convert-format-wrap" for="fmConvertFormat"><span>Output format</span>
        <select id="fmConvertFormat"><option value="mp3">MP3 · audio only</option><option value="mp4">MP4 · video</option></select>
      </label>
      <button id="fmConvertRun" class="fm-import-download-button" type="button" disabled>Convert &amp; Import</button>
    </div>
    <div class="fm-convert-ffmpeg-row"><span id="fmConvertFfmpegStatus" role="status">Checking FFmpeg…</span><button id="fmConvertPickFfmpeg" class="find-music-text-button" type="button">Locate FFmpeg</button></div>
    <div id="fmConvertProgressWrap" class="fm-import-progress" hidden>
      <div class="fm-import-progress-label"><span id="fmConvertProgressText">Converting…</span><span id="fmConvertProgressNumber"></span></div>
      <progress id="fmConvertProgress" max="100" value="0"></progress>
      <button id="fmConvertCancel" class="find-music-text-button" type="button">Cancel conversion</button>
    </div>
    <div id="fmConvertStatus" class="find-music-status" role="status" aria-live="polite">Ready. Select a media file to convert it locally.</div>
    <p class="fm-convert-footnote">A Spotify or YouTube URL identifies media; it is not itself a local media file. Sleeve does not extract streams from YouTube. For a video you uploaded, use YouTube Studio’s official download, then select that MP4 here. Large outputs are saved to Music/Sleeve Converted and can be revealed in Explorer.</p>
  `;
  parent.after(card);

  const $ = (id) => document.getElementById(id);
  const linkInput = $('fmImportLink');
  const pickSourceButton = $('fmConvertPickSource');
  const sourceName = $('fmConvertSourceName');
  const sourceDetails = $('fmConvertSourceDetails');
  const formatSelect = $('fmConvertFormat');
  const runButton = $('fmConvertRun');
  const pickFfmpegButton = $('fmConvertPickFfmpeg');
  const ffmpegStatus = $('fmConvertFfmpegStatus');
  const status = $('fmConvertStatus');
  const progressWrap = $('fmConvertProgressWrap');
  const progress = $('fmConvertProgress');
  const progressText = $('fmConvertProgressText');
  const progressNumber = $('fmConvertProgressNumber');
  const cancelButton = $('fmConvertCancel');
  const findVideoButton = $('fmConvertFindVideo');

  let selectedSource = null;
  let currentJobId = null;
  let busy = false;
  let ffmpegAvailable = false;

  function setStatus(message, kind = 'info') {
    status.textContent = message || '';
    status.className = `find-music-status${kind === 'success' ? ' find-music-status-ok' : kind === 'error' ? ' find-music-status-error' : ''}`;
  }
  function setBusy(value) {
    busy = Boolean(value);
    pickSourceButton.disabled = busy;
    pickFfmpegButton.disabled = busy;
    findVideoButton.disabled = busy;
    formatSelect.disabled = busy;
    runButton.disabled = busy || !selectedSource || !ffmpegAvailable;
  }
  function setProgress(message, percent) {
    progressWrap.hidden = false;
    progressText.textContent = message || 'Converting…';
    if (Number.isFinite(percent)) {
      progress.value = Math.max(0, Math.min(100, percent));
      progress.removeAttribute('data-indeterminate');
      progressNumber.textContent = `${Math.round(progress.value)}%`;
    } else {
      progress.value = 0;
      progress.setAttribute('data-indeterminate', 'true');
      progressNumber.textContent = '';
    }
  }
  function hideProgress() {
    progressWrap.hidden = true;
    progress.value = 0;
    progress.removeAttribute('data-indeterminate');
    progressNumber.textContent = '';
  }
  function formatBytes(value) {
    const n = Number(value) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  async function refreshFfmpegStatus() {
    try {
      const result = await api.findMusicConvertStatus();
      ffmpegStatus.textContent = result && result.message || 'FFmpeg status unavailable.';
      ffmpegAvailable = Boolean(result && result.available);
      ffmpegStatus.classList.toggle('is-ready', ffmpegAvailable);
      ffmpegStatus.classList.toggle('is-missing', !ffmpegAvailable);
      if (!ffmpegAvailable) setStatus('FFmpeg is required for conversion. Install it or use Locate FFmpeg to select its executable.');
      refreshActions();
    } catch (error) {
      ffmpegStatus.textContent = 'Could not check FFmpeg.';
      ffmpegStatus.classList.add('is-missing');
      setStatus(error && error.message || 'Could not check FFmpeg.', 'error');
    }
  }
  function videoLikeSource() { return Boolean(selectedSource && selectedSource.kind === 'video'); }
  function refreshActions() {
    const mp4 = formatSelect.value === 'mp4';
    const mp4Option = formatSelect.querySelector('option[value="mp4"]');
    if (mp4Option) mp4Option.disabled = Boolean(selectedSource && selectedSource.kind !== 'video');
    if (mp4 && selectedSource && selectedSource.kind !== 'video') formatSelect.value = 'mp3';
    runButton.disabled = busy || !selectedSource || !ffmpegAvailable;
  }

  pickSourceButton.addEventListener('click', async () => {
    try {
      const result = await api.findMusicConvertPickSource();
      if (!result || result.cancelled) return;
      selectedSource = result;
      sourceName.textContent = result.name;
      sourceDetails.textContent = `${formatBytes(result.size)} · ${result.kind === 'video' ? 'Video/audio source' : 'Audio source'}`;
      formatSelect.value = result.kind === 'video' ? 'mp3' : 'mp3';
      refreshActions();
      setStatus(result.kind === 'video'
        ? 'Video selected. Choose MP3 to extract its audio, or MP4 to convert the video.'
        : 'Audio selected. MP3 output is available; MP4 requires a video source.');
    } catch (error) { setStatus(error && error.message || 'Could not select that media file.', 'error'); }
  });

  pickFfmpegButton.addEventListener('click', async () => {
    try {
      const result = await api.findMusicConvertPickFfmpeg();
      if (!result || result.cancelled) return;
      ffmpegAvailable = true;
      ffmpegStatus.textContent = result.message || 'FFmpeg ready.';
      ffmpegStatus.classList.add('is-ready');
      ffmpegStatus.classList.remove('is-missing');
      refreshActions();
      setStatus('FFmpeg is configured. Select a media file and click Convert & Import.');
    } catch (error) { setStatus(error && error.message || 'Could not configure FFmpeg.', 'error'); }
  });

  formatSelect.addEventListener('change', () => {
    refreshActions();
    if (formatSelect.value === 'mp4' && selectedSource && selectedSource.kind !== 'video') setStatus('MP4 output requires a video file. Choose a video, or select MP3 to extract audio.');
  });

  findVideoButton.addEventListener('click', async () => {
    const raw = String(linkInput && linkInput.value || '').trim();
    if (!raw) { setStatus('Paste a Spotify track/album link or YouTube video URL above first.', 'error'); return; }
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
        await api.findMusicOpenUrl(parsed.href);
        setStatus('Opened the YouTube video in your normal browser. To convert it, select a media file you are allowed to use.', 'success');
        return;
      }
    } catch (_) {}
    try {
      setBusy(true);
      setStatus('Reading the Spotify link to build a YouTube reference search…');
      const result = await api.findMusicResolvePublicLink({ url: raw });
      let query = '';
      if (result && result.track) query = [result.track.title, result.track.artist, 'official audio'].filter(Boolean).join(' ');
      else if (result && result.collection) {
        const first = (result.collection.tracks || [])[0];
        query = [result.collection.name, result.collection.artist || (first && first.artist), 'official audio'].filter(Boolean).join(' ');
      } else if (result && Array.isArray(result.candidates) && result.candidates.length) {
        const first = result.candidates[0];
        query = [first.title, first.artist, 'official audio'].filter(Boolean).join(' ');
      }
      if (!query) throw new Error(result && result.message || 'Sleeve could not build a track search from this link. Import an Exportify CSV for playlists.');
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      await api.findMusicOpenUrl(searchUrl);
      setStatus('Opened a YouTube search for the identified recording in your normal browser. This is a reference only; the URL is not downloaded by Sleeve.', 'success');
    } catch (error) {
      setStatus(error && error.message || 'Could not create a YouTube reference search.', 'error');
    } finally { setBusy(false); }
  });

  runButton.addEventListener('click', async () => {
    if (!selectedSource || busy) return;
    if (formatSelect.value === 'mp4' && !videoLikeSource()) {
      setStatus('MP4 output requires a video source. Choose a video or select MP3.', 'error');
      return;
    }
    currentJobId = `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const jobId = currentJobId;
    setBusy(true);
    setProgress('Starting FFmpeg…', 0);
    setStatus('Converting your selected media locally…');
    try {
      const result = await api.findMusicConvertRun({ selectionToken: selectedSource.selectionToken, format: formatSelect.value, jobId });
      if (currentJobId !== jobId) return;
      hideProgress();
      if (result.autoImport) {
        const record = await api.findMusicConvertReadOutput(result.outputToken);
        if (!record || !record.bytes || !record.name) throw new Error('The converted output could not be read for library import.');
        const bytes = record.bytes instanceof Uint8Array ? record.bytes : new Uint8Array(record.bytes);
        const file = new File([bytes], record.name, { type: record.type || 'application/octet-stream', lastModified: Number(record.lastModified) || Date.now() });
        file.__sleeveSourcePath = record.path;
        window.dispatchEvent(new CustomEvent('sleeve:find-music-import-files', { detail: { files: [file] } }));
        setStatus(`Converted ${result.name} (${formatBytes(result.size)}) and added it to Sleeve. Saved in Music/Sleeve Converted.`, 'success');
      } else {
        setStatus(`Converted ${result.name} (${formatBytes(result.size)}). It exceeds the 300 MB auto-import limit, so it was saved to Music/Sleeve Converted. Click Show file to reveal it.`, 'success');
      }
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'find-music-secondary fm-convert-reveal';
      reveal.textContent = 'Show file';
      reveal.addEventListener('click', async () => {
        try { await api.findMusicConvertRevealOutput(result.outputToken); }
        catch (error) { setStatus(error && error.message || 'Could not reveal the converted file.', 'error'); }
      });
      status.appendChild(document.createTextNode(' '));
      status.appendChild(reveal);
    } catch (error) {
      if (currentJobId === jobId) {
        hideProgress();
        setStatus(error && error.message || 'Conversion failed. Check FFmpeg and the selected file.', 'error');
      }
    } finally {
      if (currentJobId === jobId) currentJobId = null;
      setBusy(false);
      refreshActions();
    }
  });

  cancelButton.addEventListener('click', async () => {
    if (!currentJobId) return;
    const job = currentJobId;
    try { await api.findMusicConvertCancel(job); } catch (_) {}
    setStatus('Cancellation requested. Any partial output will be removed.');
  });

  if (typeof api.findMusicConvertOnProgress === 'function') {
    api.findMusicConvertOnProgress((payload) => {
      if (!payload || payload.jobId !== currentJobId) return;
      setProgress(payload.message || 'Converting…', payload.percent);
      if (payload.stage === 'complete') setProgress('Finishing…', 100);
    });
  }

  document.addEventListener('sleeve:find-music-reset', async () => {
    if (currentJobId) {
      const job = currentJobId;
      currentJobId = null;
      try { await api.findMusicConvertCancel(job); } catch (_) {}
    }
    selectedSource = null;
    sourceName.textContent = 'No file selected';
    sourceDetails.textContent = 'Choose an audio or video file from your computer.';
    formatSelect.value = 'mp3';
    setBusy(false);
    refreshActions();
    hideProgress();
    setStatus('Ready. Select a media file to convert it locally.');
  });

  refreshFfmpegStatus();
  refreshActions();
}

module.exports = {
  initFindMusicConvertUI
};
