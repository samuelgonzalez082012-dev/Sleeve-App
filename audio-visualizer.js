/* Sleeve Phase 3 — Audio visualizers.
 * Uses the shared output analyser exposed by renderer.js. One animation loop
 * draws the lyrics-panel surface while the shared AudioContext is active.
 */
(() => {
  'use strict';

  const SETTINGS_KEY = 'sleeveSettings';
  const lyricsCanvas = document.getElementById('lyricsVisualizerCanvas');
  const lyricsPanel = document.getElementById('lyricsPanel');
  if (!lyricsCanvas || !lyricsPanel) return;

  const canvases = [
    { canvas: lyricsCanvas, context: lyricsCanvas.getContext('2d') }
  ];
  let settings = {};
  let frameId = 0;
  let analyser = null;
  let frequencyData = null;
  let waveformData = null;

  function readSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      settings = stored && typeof stored === 'object' ? stored : {};
    } catch (error) { settings = {}; }
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function currentStyle() {
    const style = settings.visualizerStyle || 'off';
    return ['spectrum', 'circular', 'waveform'].includes(style) ? style : 'off';
  }

  function stopLoop() {
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function audioState() {
    const api = window.__sleeveAudioAnalysis;
    if (!api || typeof api.getAnalyser !== 'function') return null;
    const next = api.getAnalyser();
    if (!next) return null;
    if (next !== analyser) {
      analyser = next;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      waveformData = new Uint8Array(analyser.fftSize);
    }
    return {
      api: api,
      analyser: analyser,
      context: typeof api.getContext === 'function' ? api.getContext() : null
    };
  }

  function syncSurfaces() {
    const enabled = currentStyle() !== 'off';
    const showLyrics = enabled && !!settings.lyricsVisualizerBackground;
    lyricsPanel.classList.toggle('visualizer-background-enabled', showLyrics);
    lyricsCanvas.style.display = showLyrics ? 'block' : 'none';
    if (!showLyrics) stopLoop();
    else startLoop();
  }

  function sizeCanvas(entry) {
    const rect = entry.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (entry.canvas.width !== width || entry.canvas.height !== height) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    }
    entry.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function hasVisibleSurface() {
    return canvases.some(entry => {
      if (entry.canvas.style.display === 'none') return false;
      const rect = entry.canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function drawSpectrum(ctx, width, height, data, color) {
    const count = Math.round(clamp(settings.visualizerBarCount, 16, 96, 48));
    const gap = Math.max(2, width * 0.004);
    const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
    const sensitivity = clamp(settings.visualizerSensitivity, 0.5, 2.5, 1.25);
    const usableBins = Math.max(1, Math.floor(data.length * 0.72));
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const start = Math.floor(Math.pow(i / count, 2.15) * usableBins);
      const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / count, 2.15) * usableBins));
      let peak = 0;
      for (let j = start; j < end; j++) peak = Math.max(peak, data[j] || 0);
      const amount = Math.min(1, (peak / 255) * sensitivity);
      const barHeight = Math.max(2, amount * height * 0.82);
      ctx.globalAlpha = 0.48 + amount * 0.5;
      ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
    ctx.globalAlpha = 1;
  }

  function drawCircular(ctx, width, height, data, color) {
    const count = Math.round(clamp(settings.visualizerBarCount, 16, 96, 48));
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.22;
    const maxLength = Math.min(width, height) * 0.2;
    const sensitivity = clamp(settings.visualizerSensitivity, 0.5, 2.5, 1.25);
    const usableBins = Math.max(1, Math.floor(data.length * 0.7));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.min(5, Math.min(width, height) / 100));
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const bin = Math.floor(Math.pow(i / count, 1.8) * usableBins);
      const amount = Math.min(1, ((data[bin] || 0) / 255) * sensitivity);
      const angle = (Math.PI * 2 * i / count) - Math.PI / 2;
      const outer = radius + Math.max(2, amount * maxLength);
      ctx.globalAlpha = 0.4 + amount * 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawWaveform(ctx, width, height, data, color) {
    const sensitivity = clamp(settings.visualizerSensitivity, 0.5, 2.5, 1.25);
    const center = height / 2;
    const amplitude = height * 0.36;
    const step = Math.max(1, Math.floor(data.length / Math.max(160, Math.floor(width))));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, Math.min(3, width / 500));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i += step) {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const sample = ((data[i] || 128) - 128) / 128;
      const y = center + sample * amplitude * sensitivity;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawEntry(entry, style, color) {
    if (entry.canvas.style.display === 'none') return;
    const size = sizeCanvas(entry);
    if (!size) return;
    const ctx = entry.context;
    ctx.clearRect(0, 0, size.width, size.height);
    if (style === 'spectrum') drawSpectrum(ctx, size.width, size.height, frequencyData, color);
    else if (style === 'circular') drawCircular(ctx, size.width, size.height, frequencyData, color);
    else if (style === 'waveform') drawWaveform(ctx, size.width, size.height, waveformData, color);
  }

  function startLoop() {
    if (frameId || document.hidden || !hasVisibleSurface()) return;
    const audio = audioState();
    if (!audio || !audio.context || audio.context.state !== 'running') return;
    const tick = () => {
      frameId = 0;
      if (currentStyle() === 'off' || document.hidden || !hasVisibleSurface()) return;
      const state = audioState();
      if (!state || !state.context || state.context.state !== 'running') return;
      state.analyser.smoothingTimeConstant = clamp(0.92 - clamp(settings.visualizerSpeed, 0.5, 2, 1) * 0.2, 0.5, 0.9, 0.72);
      state.analyser.getByteFrequencyData(frequencyData);
      state.analyser.getByteTimeDomainData(waveformData);
      const color = /^#[0-9a-f]{6}$/i.test(settings.visualizerColor || '') ? settings.visualizerColor : '#72c8ff';
      canvases.forEach(entry => drawEntry(entry, currentStyle(), color));
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
  }

  function refresh() {
    syncSurfaces();
    if (frameId) {
      stopLoop();
      startLoop();
    }
  }

  function handlePlaybackState() {
    if (frameId) stopLoop();
    startLoop();
  }

  function initialize() {
    readSettings();
    refresh();
    window.addEventListener('sleeve-settings-updated', event => {
      settings = Object.assign({}, settings, event.detail || {});
      refresh();
    });
    window.addEventListener('sleeve-playback-state', handlePlaybackState);
    document.addEventListener('visibilitychange', handlePlaybackState);
    window.addEventListener('resize', handlePlaybackState);
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(() => {
        if (frameId) { stopLoop(); startLoop(); }
        else startLoop();
      });
      canvases.forEach(entry => observer.observe(entry.canvas));
    }
    if (window.MutationObserver) {
      const observer = new window.MutationObserver(handlePlaybackState);
      observer.observe(lyricsPanel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();