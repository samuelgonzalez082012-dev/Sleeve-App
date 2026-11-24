(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.mount(root);
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const MIN_DESKTOP_WIDTH = 260;
  const MIN_MOBILE_WIDTH = 220;
  const STORAGE_PREFIX = 'local-ai-runner:dock-width:';

  function clampWidth(value, min, max) {
    const low = Number.isFinite(Number(min)) ? Number(min) : MIN_DESKTOP_WIDTH;
    const requestedMax = Number.isFinite(Number(max)) ? Number(max) : low;
    const high = Math.max(low, requestedMax);
    const number = Number(value);
    if (!Number.isFinite(number)) return low;
    return Math.min(high, Math.max(low, Math.round(number)));
  }

  function widthFromDrag(startWidth, startX, currentX, edge, min, max) {
    const delta = Number(currentX) - Number(startX);
    const direction = edge === 'right' ? 1 : -1;
    return clampWidth(Number(startWidth) + (Number.isFinite(delta) ? delta * direction : 0), min, max);
  }

  function widthFromKey(currentWidth, key, edge, step, min, max) {
    const amount = Math.max(1, Number(step) || 20);
    if (key === 'Home') return clampWidth(min, min, max);
    if (key === 'End') return clampWidth(max, min, max);
    if (key === 'ArrowLeft') return clampWidth(currentWidth + (edge === 'left' ? amount : -amount), min, max);
    if (key === 'ArrowRight') return clampWidth(currentWidth + (edge === 'right' ? amount : -amount), min, max);
    return null;
  }

  function mount(win) {
    const doc = win.document;
    const chat = doc.getElementById('chatView');
    if (!chat || chat.dataset.dockResizeReady === 'true') return;
    const panels = {
      browser: doc.getElementById('browserDock'),
      editor: doc.getElementById('editorDock')
    };
    if (!panels.browser || !panels.editor) return;
    chat.dataset.dockResizeReady = 'true';

    const preferredWidths = { browser: null, editor: null };
    const activeDrag = { pointerId: null, panel: null, edge: null, startWidth: 0, startX: 0, min: 0, max: 0, handle: null };

    function storageGet(id) {
      try {
        const value = Number(win.localStorage.getItem(STORAGE_PREFIX + id));
        return Number.isFinite(value) && value >= MIN_MOBILE_WIDTH ? value : null;
      } catch (_) { return null; }
    }

    function storageSet(id, value) {
      try { win.localStorage.setItem(STORAGE_PREFIX + id, String(Math.round(value))); } catch (_) {}
    }

    function isMobile() {
      return win.matchMedia ? win.matchMedia('(max-width: 920px)').matches : win.innerWidth <= 920;
    }

    function isVisible(panel) {
      return !!panel && !panel.hidden && panel.getBoundingClientRect().width > 0;
    }

    function otherVisible(id) {
      return isVisible(panels[id === 'browser' ? 'editor' : 'browser']);
    }

    function edgeFor(id) {
      return isMobile() && id === 'editor' ? 'right' : 'left';
    }

    function boundsFor(id) {
      const mobile = isMobile();
      const containerWidth = Math.max(1, mobile ? win.innerWidth : chat.getBoundingClientRect().width);
      const min = mobile ? MIN_MOBILE_WIDTH : MIN_DESKTOP_WIDTH;
      const otherId = id === 'browser' ? 'editor' : 'browser';
      const otherWidth = otherVisible(id) ? panels[otherId].getBoundingClientRect().width : 0;
      if (mobile) {
        const max = otherWidth ? containerWidth - otherWidth - 20 : containerWidth - 40;
        return { min, max: Math.max(min, max) };
      }
      const chatMinimum = otherWidth ? 360 : 420;
      const max = containerWidth - chatMinimum - otherWidth - 12;
      return { min, max: Math.max(min, max) };
    }

    function updateHandle(handle, width, bounds) {
      handle.setAttribute('aria-valuemin', String(Math.round(bounds.min)));
      handle.setAttribute('aria-valuemax', String(Math.round(bounds.max)));
      handle.setAttribute('aria-valuenow', String(Math.round(width)));
      handle.setAttribute('aria-valuetext', Math.round(width) + ' pixels wide');
    }

    function applyWidth(id, requested, persist) {
      const panel = panels[id];
      if (!panel) return 0;
      const bounds = boundsFor(id);
      const width = clampWidth(requested, bounds.min, bounds.max);
      panel.style.setProperty('--dock-panel-width', width + 'px');
      if (persist) {
        preferredWidths[id] = width;
        storageSet(id, width);
      }
      const handle = panel.querySelector('.dock-resize-handle');
      if (handle) updateHandle(handle, width, bounds);
      return width;
    }

    function refresh() {
      Object.keys(panels).forEach(id => {
        const panel = panels[id];
        const handle = panel.querySelector('.dock-resize-handle');
        const edge = edgeFor(id);
        if (handle) {
          handle.classList.toggle('dock-resize-handle--left', edge === 'left');
          handle.classList.toggle('dock-resize-handle--right', edge === 'right');
          handle.setAttribute('aria-label', 'Resize ' + id + ' sidebar');
          handle.title = 'Drag to resize the ' + id + ' sidebar. Use the arrow keys for precise adjustments.';
          const width = panel.getBoundingClientRect().width;
          updateHandle(handle, width, boundsFor(id));
        }
        if (preferredWidths[id] !== null && isVisible(panel)) {
          applyWidth(id, preferredWidths[id], false);
        }
      });
    }

    function finishDrag(event, save) {
      if (activeDrag.pointerId === null || (event && event.pointerId !== activeDrag.pointerId)) return;
      if (save && activeDrag.panel) {
        const id = activeDrag.panel === panels.browser ? 'browser' : 'editor';
        const width = activeDrag.panel.getBoundingClientRect().width;
        preferredWidths[id] = width;
        storageSet(id, width);
      }
      activeDrag.handle?.classList.remove('is-dragging');
      doc.body.classList.remove('dock-resizing');
      activeDrag.pointerId = null;
      activeDrag.panel = null;
      activeDrag.handle = null;
    }

    function startDrag(id, handle, event) {
      if (event.button !== 0 || activeDrag.pointerId !== null) return;
      const panel = panels[id];
      if (!isVisible(panel)) return;
      const bounds = boundsFor(id);
      activeDrag.pointerId = event.pointerId;
      activeDrag.panel = panel;
      activeDrag.edge = edgeFor(id);
      activeDrag.startWidth = panel.getBoundingClientRect().width;
      activeDrag.startX = event.clientX;
      activeDrag.min = bounds.min;
      activeDrag.max = bounds.max;
      activeDrag.handle = handle;
      handle.classList.add('is-dragging');
      doc.body.classList.add('dock-resizing');
      event.preventDefault();
      try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    }

    Object.entries(panels).forEach(([id, panel]) => {
      preferredWidths[id] = storageGet(id);
      const handle = doc.createElement('div');
      handle.className = 'dock-resize-handle';
      handle.dataset.dockResize = id;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize ' + id + ' sidebar');
      handle.setAttribute('aria-valuemin', String(isMobile() ? MIN_MOBILE_WIDTH : MIN_DESKTOP_WIDTH));
      handle.setAttribute('aria-valuemax', String(Math.round(boundsFor(id).max)));
      handle.setAttribute('aria-valuenow', String(Math.round(panel.getBoundingClientRect().width || 360)));
      handle.tabIndex = 0;
      handle.addEventListener('pointerdown', event => startDrag(id, handle, event));
      handle.addEventListener('keydown', event => {
        const bounds = boundsFor(id);
        const current = panel.getBoundingClientRect().width;
        const edge = edgeFor(id);
        const width = widthFromKey(current, event.key, edge, event.shiftKey ? 50 : 20, bounds.min, bounds.max);
        if (width === null) return;
        event.preventDefault();
        applyWidth(id, width, true);
      });
      panel.appendChild(handle);
      const initialEdge = edgeFor(id);
      handle.classList.add(initialEdge === 'left' ? 'dock-resize-handle--left' : 'dock-resize-handle--right');
      if (preferredWidths[id] !== null) panel.style.setProperty('--dock-panel-width', preferredWidths[id] + 'px');
    });

    win.addEventListener('pointermove', event => {
      if (activeDrag.pointerId === null || event.pointerId !== activeDrag.pointerId) return;
      const id = activeDrag.panel === panels.browser ? 'browser' : 'editor';
      const width = widthFromDrag(activeDrag.startWidth, activeDrag.startX, event.clientX, activeDrag.edge, activeDrag.min, activeDrag.max);
      applyWidth(id, width, false);
      event.preventDefault();
    }, { capture: true });
    win.addEventListener('pointerup', event => finishDrag(event, true), true);
    win.addEventListener('pointercancel', event => finishDrag(event, true), true);
    win.addEventListener('blur', () => finishDrag(null, true));
    win.addEventListener('resize', refresh);
    win.addEventListener('editor:dock-layout', refresh);
    const observer = new win.MutationObserver(refresh);
    observer.observe(chat, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    const resizeObserver = new win.ResizeObserver(refresh);
    resizeObserver.observe(chat);
    resizeObserver.observe(panels.browser);
    resizeObserver.observe(panels.editor);
    refresh();
  }

  return { clampWidth, widthFromDrag, widthFromKey, mount };
});
