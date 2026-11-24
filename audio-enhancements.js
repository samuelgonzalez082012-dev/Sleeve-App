/* Sleeve audio quality enhancements.
 * Loaded by preload.js into the renderer page; this file has no Node/Electron access.
 * AI restoration is an optional adapter interface: users supply the model runtime.
 */
(() => {
  'use strict';

  if (window.__sleeveAudioEnhancementsInstalled) return;
  if (new URLSearchParams(window.location.search).get('mini') === '1') return;
  window.__sleeveAudioEnhancementsInstalled = true;

  const STATE_KEY = 'sleeveAudioQualityUpdate';
  const PRESETS = {
    warm: [3, 3, 2, 2, 1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 0, -1, -1, -2, -2],
    podcast: [-4, -3, -2, -1, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, 0, 0, 1, 1, 0],
    night: [2, 2, 1, 0, -1, -1, -1, 0, 1, 2, 2, 1, 0, -1, -1, -2, -2, -2, -3],
    jazz: [2, 2, 1, 1, 0, -1, -1, 0, 1, 2, 2, 2, 1, 1, 2, 2, 1, 1, 1],
    classical: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    deepBass: [6, 6, 5, 4, 3, 2, 1, 0, -1, -1, -1, 0, 0, 1, 1, 1, 0, 0, 0],
    clear: [-2, -2, -1, 0, 0, 1, 1, 2, 2, 2, 2, 1, 1, 2, 2, 2, 1, 1, 0]
  };

  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  const state = {
    eqEnabled: true,
    eqValues: null,
    smartPlaybackEnabled: false,
    aiEnabled: false,
    aiAvailable: false,
    ...readState()
  };
  state.eqEnabled = state.eqEnabled !== false;
  state.smartPlaybackEnabled = state.smartPlaybackEnabled === true;
  state.aiEnabled = state.aiEnabled === true;
  if (!Array.isArray(state.eqValues) || state.eqValues.length !== 19) state.eqValues = null;

  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById('sleeveAudioEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'sleeveAudioEnhancementStyles';
    style.textContent = `
      .sleeve-audio-quality-section{border:1px solid var(--border-subtle,rgba(255,255,255,.09));border-radius:12px;padding:14px;margin:14px 0;background:rgba(255,255,255,.018)}
      .sleeve-audio-quality-section .drawer-section-title{margin:0 0 10px}
      .sleeve-audio-quality-section .drawer-toggle-row{align-items:flex-start}
      .sleeve-audio-quality-copy{display:block;max-width:420px;line-height:1.4}
      .sleeve-audio-quality-copy small{display:block;margin-top:4px;font-size:11px;line-height:1.45;color:var(--text-secondary,rgba(255,255,255,.58));font-weight:400}
      .sleeve-audio-quality-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
      .sleeve-audio-quality-actions button{min-height:32px}
      .sleeve-audio-quality-status{margin:9px 0 0;font-size:11px;line-height:1.5;color:var(--text-secondary,rgba(255,255,255,.62));overflow-wrap:anywhere}
      .sleeve-eq-enabled-row{display:flex;align-items:center;gap:9px;margin:0 0 12px;font-size:12px;color:var(--text-primary,inherit)}
      .sleeve-eq-enabled-row input,.sleeve-audio-quality-section input[type=checkbox]{accent-color:var(--accent,#17abe8)}
      .sleeve-audio-quality-section button:disabled{opacity:.45;cursor:not-allowed}
    `;
    document.head.appendChild(style);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addSettings() {
    const body = document.querySelector('#customizeDrawer .drawer-body');
    if (!body || document.getElementById('sleeveAudioQualitySettings')) return;

    const section = element('section', 'drawer-section sleeve-audio-quality-section');
    section.id = 'sleeveAudioQualitySettings';
    section.innerHTML = `
      <div class="drawer-section-title">Audio enhancement</div>
      <div class="drawer-toggle-row">
        <span class="sleeve-audio-quality-copy">Smart playback enhancement
          <small>Gentle dynamic peak control while listening. Off by default; does not modify saved files.</small>
        </span>
        <label class="switch"><input type="checkbox" id="sleeveSmartPlaybackToggle"><span class="switch-track"></span></label>
      </div>
      <div class="drawer-toggle-row">
        <span class="sleeve-audio-quality-copy">AI music restoration
          <small>Official SonicMaster AI restoration for a selected local file. Off by default. The model is an optional 3.45 GB download; its pinned PyTorch stack requires Python 3.10–3.12. Setup uses an isolated environment.</small>
        </span>
        <label class="switch"><input type="checkbox" id="sleeveAiRestorationToggle"><span class="switch-track"></span></label>
      </div>
      <div class="sleeve-audio-quality-actions">
        <button class="drawer-reset-btn" id="sleeveAiCheckButton" type="button">Check setup</button>
        <button class="drawer-reset-btn" id="sleeveAiSetupButton" type="button">Set up SonicMaster (3.45 GB)</button>
        <button class="drawer-reset-btn" id="sleeveAiDependenciesButton" type="button" disabled>Install AI dependencies</button>
        <button class="drawer-reset-btn" id="sleeveAiRestoreButton" type="button" disabled>Restore a local file</button>
      </div>
      <p class="sleeve-audio-quality-status" id="sleeveAiStatus" role="status" aria-live="polite">AI restoration is off. Set up SonicMaster only when you are ready to download its model and Python dependencies.</p>
    `;

    const anchor = document.getElementById('settingsStatsSection') || document.getElementById('resetSettingsBtn');
    if (anchor && anchor.parentElement === body) body.insertBefore(section, anchor);
    else body.appendChild(section);

    const smartToggle = section.querySelector('#sleeveSmartPlaybackToggle');
    smartToggle.checked = state.smartPlaybackEnabled;
    smartToggle.addEventListener('change', () => {
      state.smartPlaybackEnabled = smartToggle.checked;
      saveState();
      applySmartPlaybackToNodes();
    });

    const aiToggle = section.querySelector('#sleeveAiRestorationToggle');
    const aiRestoreButton = section.querySelector('#sleeveAiRestoreButton');
    const aiStatus = section.querySelector('#sleeveAiStatus');
    const aiDependenciesButton = section.querySelector('#sleeveAiDependenciesButton');
    aiToggle.checked = state.aiEnabled;
    if (window.electronAPI && typeof window.electronAPI.onAiRestorationProgress === 'function') {
      window.electronAPI.onAiRestorationProgress((payload) => {
        if (payload && payload.message) aiStatus.textContent = payload.message;
      });
    }

    section.querySelector('#sleeveAiCheckButton').addEventListener('click', checkAiSetup);
    aiToggle.addEventListener('change', async () => {
      if (!aiToggle.checked) {
        state.aiEnabled = false;
        aiRestoreButton.disabled = true;
        saveState();
        aiStatus.textContent = 'AI restoration is off.';
        return;
      }
      const result = await checkAiSetup();
      if (!result || !result.available) {
        aiToggle.checked = false;
        state.aiEnabled = false;
        aiRestoreButton.disabled = true;
        saveState();
        return;
      }
      state.aiEnabled = true;
      aiRestoreButton.disabled = false;
      saveState();
      aiStatus.textContent = 'SonicMaster is ready. The first run may download its text encoder and Stable Audio VAE; inference can require substantial RAM or GPU memory.';
    });
    aiRestoreButton.addEventListener('click', restoreLocalFile);

    function setAiStatus(message) {
      aiStatus.textContent = String(message || '');
    }

    async function checkAiSetup() {
      if (!window.electronAPI || typeof window.electronAPI.checkAiRestoration !== 'function') {
        setAiStatus('The AI restoration bridge is unavailable. Check that the matching preload.js and main.js files were installed.');
        return null;
      }
      try {
        const result = await window.electronAPI.checkAiRestoration();
        state.aiAvailable = Boolean(result && result.available);
        aiRestoreButton.disabled = !(state.aiEnabled && result && result.available);
        aiDependenciesButton.disabled = !(result && result.filesReady && !result.runtimeReady);
        setAiStatus(result && result.message ? result.message : 'AI restoration setup check completed.');
        return result;
      } catch (error) {
        state.aiAvailable = false;
        aiRestoreButton.disabled = true;
        setAiStatus(error && error.message ? error.message : 'Could not check AI restoration setup.');
        return null;
      }
    }

    async function setupSonicMaster() {
      if (!window.electronAPI || typeof window.electronAPI.setupAiRestoration !== 'function') {
        setAiStatus('The SonicMaster setup bridge is unavailable. Check the matching main.js and preload.js files.');
        return;
      }
      const accepted = window.confirm('SonicMaster setup downloads official inference code and a 3.45 GB model checkpoint. Choose Python 3.10–3.12. Dependencies are installed into an isolated environment. The first restoration may also download a large text encoder and audio VAE. Continue?');
      if (!accepted) return;
      const setupButton = section.querySelector('#sleeveAiSetupButton');
      setupButton.disabled = true;
      aiDependenciesButton.disabled = true;
      setAiStatus('Choose your Python executable. The official model and code will be downloaded to Sleeve’s user-data folder.');
      try {
        const result = await window.electronAPI.setupAiRestoration();
        if (!result || result.cancelled) { setAiStatus('SonicMaster setup was cancelled.'); return; }
        if (!result.ok) throw new Error(result.error || 'SonicMaster setup failed.');
        state.aiAvailable = Boolean(result.available);
        aiDependenciesButton.disabled = Boolean(result.runtimeReady);
        aiRestoreButton.disabled = !(state.aiEnabled && result.available);
        setAiStatus(result.message || 'SonicMaster model files downloaded. Install the Python dependencies next.');
      } catch (error) {
        setAiStatus(error && error.message ? error.message : 'Could not set up SonicMaster.');
      } finally { setupButton.disabled = false; }
    }

    async function installAiDependencies() {
      if (!window.electronAPI || typeof window.electronAPI.installAiRestorationDependencies !== 'function') {
        setAiStatus('The dependency installation bridge is unavailable.');
        return;
      }
      const accepted = window.confirm('This runs pip using the official SonicMaster requirements file. It may download several GB of Python packages and may need a compatible Python/PyTorch combination. Continue?');
      if (!accepted) return;
      aiDependenciesButton.disabled = true;
      setAiStatus('Installing SonicMaster Python dependencies…');
      try {
        const result = await window.electronAPI.installAiRestorationDependencies();
        if (!result || !result.ok) throw new Error((result && result.error) || 'Python dependency installation failed.');
        state.aiAvailable = Boolean(result.available);
        aiRestoreButton.disabled = !(state.aiEnabled && state.aiAvailable);
        setAiStatus(result.message || 'SonicMaster dependencies installed.');
      } catch (error) {
        setAiStatus(error && error.message ? error.message : 'Could not install SonicMaster dependencies.');
      } finally { aiDependenciesButton.disabled = false; }
    }

    section.querySelector('#sleeveAiSetupButton').addEventListener('click', setupSonicMaster);
    aiDependenciesButton.addEventListener('click', installAiDependencies);

    async function restoreLocalFile() {
      if (!state.aiEnabled || !state.aiAvailable) {
        setAiStatus('Enable AI restoration and check the model setup first.');
        return;
      }
      if (!window.electronAPI || typeof window.electronAPI.restoreAiAudioFile !== 'function') {
        setAiStatus('The AI restoration bridge is unavailable.');
        return;
      }
      aiRestoreButton.disabled = true;
      setAiStatus('Choose a local audio file. The original will be preserved.');
      try {
        const result = await window.electronAPI.restoreAiAudioFile();
        if (result && !result.cancelled) setAiStatus(result.message || 'Restoration completed.');
      } catch (error) {
        setAiStatus(error && error.message ? error.message : 'Restoration failed. The original file was not overwritten.');
      } finally {
        aiRestoreButton.disabled = !(state.aiEnabled && state.aiAvailable);
      }
    }

    if (state.aiEnabled) {
      checkAiSetup().then((result) => {
        if (!result || !result.available) {
          state.aiEnabled = false;
          aiToggle.checked = false;
          aiRestoreButton.disabled = true;
          saveState();
        }
      });
    }
  }

  function getEqControls() {
    const grid = document.getElementById('eqGrid');
    if (!grid) return null;
    const sliders = [...grid.querySelectorAll('input[data-eq-index]')];
    const preset = document.getElementById('eqPreset');
    if (sliders.length !== 19 || !preset) return null;
    return { grid, sliders, preset };
  }

  function readSliderValues(controls) {
    return controls.sliders.map((slider) => {
      const value = Number(slider.value);
      return Number.isFinite(value) ? value : 0;
    });
  }

  function dispatchSliderValue(slider, value) {
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setEqControlsDisabled(controls, disabled) {
    controls.sliders.forEach((slider) => { slider.disabled = disabled; });
    controls.preset.disabled = disabled;
    const reset = document.getElementById('eqReset');
    if (reset) reset.disabled = disabled;
  }

  function applyEqEnabledState(controls) {
    let switchLabel = document.getElementById('sleeveEqEnabledRow');
    if (!switchLabel) {
      switchLabel = element('label', 'sleeve-eq-enabled-row');
      switchLabel.id = 'sleeveEqEnabledRow';
      switchLabel.innerHTML = '<input type="checkbox" id="sleeveEqEnabledToggle"><span>Equalizer enabled</span>';
      controls.grid.parentElement.insertBefore(switchLabel, controls.grid);
      switchLabel.querySelector('input').addEventListener('change', () => {
        const next = switchLabel.querySelector('input').checked;
        if (!next) {
          state.eqValues = readSliderValues(controls);
          state.eqEnabled = false;
          controls.sliders.forEach((slider) => dispatchSliderValue(slider, 0));
          setEqControlsDisabled(controls, true);
        } else {
          state.eqEnabled = true;
          const restore = Array.isArray(state.eqValues) && state.eqValues.length === 19 ? state.eqValues : Array(19).fill(0);
          controls.sliders.forEach((slider, index) => dispatchSliderValue(slider, restore[index]));
          setEqControlsDisabled(controls, false);
        }
        saveState();
      });
    }
    const toggle = switchLabel.querySelector('input');
    toggle.checked = state.eqEnabled;
    if (controls.grid.dataset.sleeveEqInitialized !== '1') {
      if (state.eqEnabled) {
        const current = readSliderValues(controls);
        if (!Array.isArray(state.eqValues) || state.eqValues.length !== 19) state.eqValues = current;
      } else {
        controls.sliders.forEach((slider) => dispatchSliderValue(slider, 0));
      }
      controls.grid.dataset.sleeveEqInitialized = '1';
      saveState();
    }
    setEqControlsDisabled(controls, !state.eqEnabled);
  }

  function installExtraEqPresets(controls) {
    const definitions = [
      ['warm', 'Warm'],
      ['podcast', 'Speech clarity'],
      ['night', 'Night listening'],
      ['jazz', 'Jazz'],
      ['classical', 'Classical'],
      ['deepBass', 'Deep bass'],
      ['clear', 'Clarity']
    ];
    definitions.forEach(([value, label]) => {
      if (![...controls.preset.options].some((option) => option.value === value)) {
        controls.preset.add(new Option(label, value));
      }
    });

    if (controls.preset.dataset.sleeveAudioPresets === '1') return;
    controls.preset.dataset.sleeveAudioPresets = '1';

    document.addEventListener('change', (event) => {
      if (event.target !== controls.preset || !Object.prototype.hasOwnProperty.call(PRESETS, controls.preset.value)) return;
      if (!state.eqEnabled) {
        controls.preset.value = 'custom';
        return;
      }
      event.stopImmediatePropagation();
      const name = controls.preset.value;
      PRESETS[name].forEach((gain, index) => dispatchSliderValue(controls.sliders[index], gain));
      state.eqValues = PRESETS[name].slice();
      state.selectedPreset = name;
      controls.preset.value = name;
      saveState();
    }, true);

    controls.grid.addEventListener('input', (event) => {
      if (!state.eqEnabled || !event.target.matches('input[data-eq-index]')) return;
      state.eqValues = readSliderValues(controls);
      state.selectedPreset = 'custom';
      saveState();
    });
  }

  function installEqualizer() {
    const controls = getEqControls();
    if (!controls) return false;
    installExtraEqPresets(controls);
    applyEqEnabledState(controls);
    return true;
  }

  const smartNodes = new Set();
  function updateSmartNode(node) {
    if (!node) return;
    const enabled = state.smartPlaybackEnabled;
    const now = node.context && Number.isFinite(node.context.currentTime) ? node.context.currentTime : 0;
    const params = {
      threshold: enabled ? -25 : 0,
      knee: enabled ? 18 : 0,
      ratio: enabled ? 2.2 : 1,
      attack: enabled ? 0.006 : 0.003,
      release: enabled ? 0.24 : 0.1
    };
    Object.entries(params).forEach(([key, value]) => {
      const param = node[key];
      if (!param) return;
      try {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(value, now, 0.035);
      } catch (_) {
        try { param.value = value; } catch (_) {}
      }
    });
  }

  function applySmartPlaybackToNodes() {
    smartNodes.forEach(updateSmartNode);
  }

  function installSmartPlaybackRouting() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !AudioContextClass.prototype || !window.AudioNode || !window.GainNode) return;
    const contextPrototype = AudioContextClass.prototype;
    const nodePrototype = window.AudioNode.prototype;
    if (contextPrototype.__sleeveSmartAudioWrapped || nodePrototype.__sleeveSmartAudioWrapped) return;

    const nativeCreateCompressor = contextPrototype.createDynamicsCompressor;
    const nativeConnect = nodePrototype.connect;
    if (typeof nativeCreateCompressor !== 'function' || typeof nativeConnect !== 'function') return;

    const limiterNodes = new WeakSet();
    const wrappedGainNodes = new WeakSet();
    const perContextSmartNodes = new WeakMap();

    contextPrototype.createDynamicsCompressor = function (...args) {
      const node = nativeCreateCompressor.apply(this, args);
      limiterNodes.add(node);
      return node;
    };
    Object.defineProperty(contextPrototype, '__sleeveSmartAudioWrapped', { value: true });

    nodePrototype.connect = function (destination, ...args) {
      if (
        args.length === 0 &&
        destination && limiterNodes.has(destination) &&
        this instanceof window.GainNode &&
        !wrappedGainNodes.has(this) &&
        this.context
      ) {
        let smartNode = perContextSmartNodes.get(this.context);
        if (!smartNode) {
          smartNode = this.context.createDynamicsCompressor();
          smartNodes.add(smartNode);
          updateSmartNode(smartNode);
          perContextSmartNodes.set(this.context, smartNode);
        }
        nativeConnect.call(this, smartNode);
        nativeConnect.call(smartNode, destination);
        wrappedGainNodes.add(this);
        return destination;
      }
      return nativeConnect.call(this, destination, ...args);
    };
    Object.defineProperty(nodePrototype, '__sleeveSmartAudioWrapped', { value: true });
  }

  function initialize() {
    injectStyles();
    addSettings();
    installEqualizer();
    installSmartPlaybackRouting();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }

  // The existing renderer creates EQ sliders synchronously, but retry if a future UI
  // update replaces the grid. This observer is bounded by the lifetime of the page.
  const observer = new MutationObserver(() => {
    const eqGrid = document.getElementById('eqGrid');
    if (eqGrid && eqGrid.dataset.sleeveEqInitialized !== '1') installEqualizer();
    if (!document.getElementById('sleeveAudioQualitySettings')) addSettings();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
