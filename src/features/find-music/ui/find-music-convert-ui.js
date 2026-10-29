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
