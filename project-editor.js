(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'lair-active-project-sandbox';
  const state = {
    projects: [], activeId: '', tree: null, opened: [], activePath: '', dirty: false,
    collapsed: new Set(), popout: false, loading: false
  };
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  const api = () => window.localAI?.projects;
  const bytes = value => new TextEncoder().encode(String(value ?? '')).length;
  const nameOf = value => String(value || '').split('/').pop() || value;
  const folderOf = value => String(value || '').includes('/') ? String(value).slice(0, String(value).lastIndexOf('/')) : '';
  const extensionOf = value => (String(value || '').split('.').pop() || '').toLowerCase();
  const languageFor = path => ({ js:'JAVASCRIPT', mjs:'JAVASCRIPT', cjs:'JAVASCRIPT', jsx:'REACT JSX', ts:'TYPESCRIPT', tsx:'REACT TSX', html:'HTML', htm:'HTML', css:'CSS', scss:'SCSS', py:'PYTHON', json:'JSON', md:'MARKDOWN', txt:'TEXT', xml:'XML', yml:'YAML', yaml:'YAML', sh:'SHELL', ps1:'POWERSHELL', sql:'SQL', java:'JAVA', cs:'C#', cpp:'C++', c:'C', h:'C HEADER', rs:'RUST', go:'GO', php:'PHP', rb:'RUBY', toml:'TOML', ini:'INI' })[extensionOf(path)] || 'TEXT';
  function toast(message) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
  }
  function setActiveId(id) {
    state.activeId = String(id || '');
    try { if (state.activeId) localStorage.setItem(STORAGE_KEY, state.activeId); else localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  function activeProject() { return state.projects.find(project => project.id === state.activeId) || null; }
  function projectRequired() {
    if (!state.activeId) throw new Error('Open a project folder in the Project editor first.');
    return state.activeId;
  }
  function markDirty() {
    state.dirty = true;
    if ($('editorSaveState')) $('editorSaveState').textContent = 'Unsaved changes';
    if ($('editorSave')) $('editorSave').disabled = false;
    updateFileStatus();
  }
  function updateFileStatus() {
    const editor = $('projectCodeEditor');
    if (!editor) return;
    const value = editor.value || '';
    if ($('editorFileSize')) $('editorFileSize').textContent = `${bytes(value).toLocaleString()} bytes`;
    if ($('editorCursorState')) {
      const before = value.slice(0, editor.selectionStart);
      const line = before.split('\n').length;
      const col = before.length - before.lastIndexOf('\n');
      $('editorCursorState').textContent = `Ln ${line}, Col ${col}`;
    }
  }
  function updateLineNumbers() {
    const editor = $('projectCodeEditor');
    const numbers = $('editorLineNumbers');
    if (!editor || !numbers) return;
    const count = Math.max(1, editor.value.split('\n').length);
    numbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
    numbers.scrollTop = editor.scrollTop;
    updateFileStatus();
  }
  function renderProjectSelect() {
    const select = $('editorProjectSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Choose an open project…</option>' + state.projects.map(project => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`).join('');
    select.value = state.activeId;
  }
  function renderHeader() {
    const project = activeProject();
    if ($('editorProjectName')) $('editorProjectName').textContent = project?.name || 'No project open';
    if ($('editorSandboxNotice')) $('editorSandboxNotice').textContent = project ? 'Editing the app-managed copy · original folder stays untouched until sync' : 'Open a folder to create a private sandbox copy.';
    if ($('editorSync')) $('editorSync').disabled = !project;
    if ($('editorRefresh')) $('editorRefresh').disabled = !project;
    if ($('editorNewFile')) $('editorNewFile').disabled = !project;
    if ($('editorNewFolder')) $('editorNewFolder').disabled = !project;
    if ($('editorPopout')) $('editorPopout').textContent = state.popout ? 'Editor open ↗' : 'Pop out ↗';
    renderProjectSelect();
  }
  function renderTree() {
    const root = $('editorTree');
    if (!root) return;
    if (!state.activeId || !state.tree) {
      root.innerHTML = '<div class="editor-tree-empty">Open a folder to start working.</div>';
      return;
    }
    const entries = state.tree.entries || [];
    const visible = entries.filter(entry => {
      const parts = entry.path.split('/');
      for (let i = 1; i < parts.length; i++) if (state.collapsed.has(parts.slice(0, i).join('/'))) return false;
      return true;
    });
    if (!visible.length) { root.innerHTML = '<div class="editor-tree-empty">This project contains no supported text files yet.</div>'; return; }
    root.innerHTML = visible.map(entry => {
      const depth = entry.path.split('/').length - 1;
      const isDir = entry.type === 'dir';
      const active = !isDir && entry.path === state.activePath;
      const expanded = !state.collapsed.has(entry.path);
      const status = entry.status ? `<span class="editor-entry-status status-${entry.status.toLowerCase()}" title="${entry.status === 'A' ? 'Added' : 'Modified'}">${entry.status}</span>` : '';
      return `<button type="button" class="editor-tree-entry${active ? ' active' : ''}" data-editor-path="${escapeHTML(entry.path)}" data-editor-type="${isDir ? 'dir' : 'file'}" style="--tree-depth:${depth}" title="${escapeHTML(entry.path)}"><span class="tree-chevron">${isDir ? (expanded ? '⌄' : '›') : ''}</span><span class="tree-file-icon">${isDir ? (expanded ? '▾' : '▸') : '◇'}</span><span class="tree-entry-name">${escapeHTML(nameOf(entry.path))}</span>${status}</button>`;
    }).join('');
  }
  function renderTabs() {
    const root = $('editorTabs');
    if (!root) return;
    root.innerHTML = state.opened.map(path => `<div class="editor-tab${path === state.activePath ? ' active' : ''}" role="tab" aria-selected="${path === state.activePath}" data-editor-tab="${escapeHTML(path)}"><button type="button" class="editor-tab-open" data-editor-tab-open="${escapeHTML(path)}">${escapeHTML(nameOf(path))}${path === state.activePath && state.dirty ? ' •' : ''}</button><button type="button" class="editor-tab-close" data-editor-tab-close="${escapeHTML(path)}" aria-label="Close ${escapeHTML(nameOf(path))}">×</button></div>`).join('');
  }
  async function loadTree() {
    if (!state.activeId) { state.tree = null; renderTree(); renderHeader(); return; }
    const tree = await api().tree(state.activeId);
    state.tree = tree;
    state.projects = state.projects.map(project => project.id === state.activeId ? { ...project, ...tree.project } : project);
    renderHeader(); renderTree();
  }
  async function loadProjects() {
    if (!api()) return;
    state.projects = await api().list();
    try { const saved = localStorage.getItem(STORAGE_KEY) || ''; if (!state.activeId) state.activeId = saved; } catch (_) {}
    if (!state.projects.some(project => project.id === state.activeId)) setActiveId('');
    renderHeader();
    await loadTree();
    if (state.activePath && state.opened.includes(state.activePath) && state.activeId && !state.dirty) {
      try { const file = await api().read(state.activeId, state.activePath); setEditorContents(file.content, false); } catch (_) { closeFile(state.activePath, true); }
    }
  }
  function setEditorContents(content, dirty) {
    const editor = $('projectCodeEditor');
    if (!editor) return;
    editor.value = String(content ?? '');
    state.dirty = !!dirty;
    if ($('editorDocument')) $('editorDocument').hidden = false;
    if ($('editorWelcome')) $('editorWelcome').hidden = true;
    if ($('editorFilePath')) $('editorFilePath').textContent = state.activePath;
    if ($('editorLanguage')) $('editorLanguage').textContent = languageFor(state.activePath);
    if ($('editorSaveState')) $('editorSaveState').textContent = dirty ? 'Unsaved changes' : 'Saved';
    if ($('editorSave')) $('editorSave').disabled = !dirty;
    updateLineNumbers(); renderTabs(); renderTree();
  }
  async function canLeaveCurrent() {
    if (!state.dirty) return true;
    const shouldSave = window.confirm(`Save changes to ${state.activePath} before continuing?\n\nChoose Cancel to stay in this file.`);
    if (!shouldSave) return false;
    await saveCurrent();
    return true;
  }
  async function openFile(relativePath) {
    if (relativePath === state.activePath) return;
    if (!(await canLeaveCurrent())) return;
    const file = await api().read(projectRequired(), relativePath);
    state.activePath = file.path;
    if (!state.opened.includes(file.path)) state.opened.push(file.path);
    setEditorContents(file.content, false);
    $('projectCodeEditor')?.focus();
  }
  function closeFile(path, force = false) {
    if (!force && path === state.activePath && state.dirty) {
      if (!window.confirm(`Discard unsaved changes to ${nameOf(path)}?`)) return;
    }
    state.opened = state.opened.filter(item => item !== path);
    if (state.activePath === path) {
      state.activePath = state.opened[state.opened.length - 1] || '';
      state.dirty = false;
      if (state.activePath) {
        api().read(state.activeId, state.activePath).then(file => setEditorContents(file.content, false)).catch(error => toast(error.message));
      } else {
        $('editorDocument').hidden = true; $('editorWelcome').hidden = false; renderTabs(); renderTree();
      }
    } else renderTabs();
  }
  async function saveCurrent() {
    if (!state.activePath || !state.activeId) return;
    const editor = $('projectCodeEditor');
    try {
      await api().write(state.activeId, state.activePath, editor.value);
      state.dirty = false;
      if ($('editorSaveState')) $('editorSaveState').textContent = 'Saved to sandbox';
      if ($('editorSave')) $('editorSave').disabled = true;
      await loadTree();
      renderTabs(); updateFileStatus();
      toast(`Saved ${nameOf(state.activePath)} to the sandbox copy.`);
    } catch (error) { toast(`Save failed: ${error.message}`); }
  }
  async function chooseProject(id) {
    if (id === state.activeId) return;
    if (!(await canLeaveCurrent())) { renderProjectSelect(); return; }
    setActiveId(id);
    state.tree = null; state.opened = []; state.activePath = ''; state.dirty = false; state.collapsed.clear();
    $('editorDocument').hidden = true; $('editorWelcome').hidden = false;
    await loadTree();
  }
  async function openFolder() {
    try {
      if (!(await canLeaveCurrent())) return;
      const project = await api().openFolder();
      if (!project) return;
      await loadProjects();
      setActiveId(project.id);
      state.opened = []; state.activePath = ''; state.dirty = false; state.collapsed.clear();
      await loadTree();
      toast(`${project.existing ? 'Reopened' : 'Imported'} ${project.name} as a sandbox copy.`);
    } catch (error) { toast(`Could not open folder: ${error.message}`); }
  }
  async function createEntry(isFolder) {
    if (!state.activeId) return;
    const base = state.activePath ? folderOf(state.activePath) : '';
    const name = window.prompt(isFolder ? 'New folder name' : 'New file name', '');
    if (!name || !name.trim()) return;
    const cleanName = name.trim().replace(/^[/\\]+/, '');
    const target = [base, cleanName].filter(Boolean).join('/');
    try {
      if (isFolder) await api().mkdir(state.activeId, target);
      else {
        await api().write(state.activeId, target, '');
        await openFile(target);
      }
      await loadTree();
    } catch (error) { toast(`Could not create ${isFolder ? 'folder' : 'file'}: ${error.message}`); }
  }
  async function renameCurrent() {
    if (!state.activePath) return;
    const nextName = window.prompt('Rename or move file (relative path)', state.activePath);
    if (!nextName || nextName.trim() === state.activePath) return;
    try {
      const old = state.activePath;
      await api().rename(state.activeId, old, nextName.trim());
      state.opened = state.opened.map(item => item === old ? nextName.trim() : item);
      state.activePath = nextName.trim();
      await loadTree();
      const file = await api().read(state.activeId, state.activePath);
      setEditorContents(file.content, false);
      toast('File renamed in the sandbox.');
    } catch (error) { toast(`Rename failed: ${error.message}`); }
  }
  async function deleteCurrent() {
    if (!state.activePath) return;
    if (state.dirty && !window.confirm('This file has unsaved changes. Delete the sandbox copy anyway?')) return;
    if (!window.confirm(`Delete ${state.activePath} from the sandbox copy?\n\nThe original folder will not be changed until you sync.`)) return;
    const old = state.activePath;
    try {
      await api().delete(state.activeId, old);
      closeFile(old, true);
      await loadTree();
      toast('Deleted from the sandbox copy.');
    } catch (error) { toast(`Delete failed: ${error.message}`); }
  }
  async function syncFiles() {
    if (!state.activeId) return;
    if (state.dirty && !(await canLeaveCurrent())) return;
    try {
      const result = await api().sync(state.activeId);
      if (result?.cancelled) return;
      await loadProjects();
      const written = result.written?.length || 0;
      const deleted = result.deleted?.length || 0;
      const skipped = result.skipped?.length || 0;
      toast(`Sync complete: ${written} written, ${deleted} deleted, ${skipped} skipped.`);
    } catch (error) { toast(`Sync failed: ${error.message}`); }
  }
  async function refreshFromDisk() {
    if (!state.activeId) return;
    if (state.dirty && !(await canLeaveCurrent())) return;
    try {
      const result = await api().pull(state.activeId);
      if (result?.cancelled) return;
      await loadProjects();
      const conflicts = result.conflicts?.length || 0;
      toast(`Refreshed sandbox: ${(result.updated?.length || 0) + (result.added?.length || 0)} updated, ${conflicts} conflict(s).`);
    } catch (error) { toast(`Refresh failed: ${error.message}`); }
  }
  async function popout() {
    try {
      if (state.popout) { await api().popout(); return; }
      await api().popout();
    } catch (error) { toast(`Could not open editor window: ${error.message}`); }
  }
  function bind() {
    $('editorOpenFolder')?.addEventListener('click', openFolder);
    $('editorWelcomeOpen')?.addEventListener('click', openFolder);
    $('editorRefresh')?.addEventListener('click', refreshFromDisk);
    $('editorSync')?.addEventListener('click', syncFiles);
    $('editorPopout')?.addEventListener('click', popout);
    $('editorWelcomePopout')?.addEventListener('click', popout);
    $('editorClosePopout')?.addEventListener('click', async () => { await api().closePopout(); });
    $('editorNewFile')?.addEventListener('click', () => createEntry(false));
    $('editorNewFolder')?.addEventListener('click', () => createEntry(true));
    $('editorSave')?.addEventListener('click', saveCurrent);
    $('editorRename')?.addEventListener('click', renameCurrent);
    $('editorDelete')?.addEventListener('click', deleteCurrent);
    $('editorProjectSelect')?.addEventListener('change', event => chooseProject(event.target.value).catch(error => toast(error.message)));
    $('editorTree')?.addEventListener('click', event => {
      const row = event.target.closest('[data-editor-path]');
      if (!row) return;
      const path = row.dataset.editorPath;
      if (row.dataset.editorType === 'dir') {
        if (state.collapsed.has(path)) state.collapsed.delete(path); else state.collapsed.add(path);
        renderTree();
      } else openFile(path).catch(error => toast(`Could not open file: ${error.message}`));
    });
    $('editorTabs')?.addEventListener('click', event => {
      const close = event.target.closest('[data-editor-tab-close]');
      if (close) { closeFile(close.dataset.editorTabClose); return; }
      const open = event.target.closest('[data-editor-tab-open]');
      if (open) openFile(open.dataset.editorTabOpen).catch(error => toast(error.message));
    });
    $('projectCodeEditor')?.addEventListener('input', () => { markDirty(); updateLineNumbers(); });
    $('projectCodeEditor')?.addEventListener('scroll', () => { const n = $('editorLineNumbers'); if (n) n.scrollTop = $('projectCodeEditor').scrollTop; });
    $('projectCodeEditor')?.addEventListener('click', updateFileStatus);
    $('projectCodeEditor')?.addEventListener('keyup', updateFileStatus);
    $('projectCodeEditor')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveCurrent(); return; }
      if (event.key === 'Tab') {
        event.preventDefault();
        const editor = event.currentTarget;
        const start = editor.selectionStart; const end = editor.selectionEnd;
        editor.setRangeText('  ', start, end, 'end');
        markDirty(); updateLineNumbers();
      }
    });
    window.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && $('editorView')?.classList.contains('active')) { event.preventDefault(); saveCurrent(); }
    });
    window.addEventListener('storage', event => {
      if (event.key === STORAGE_KEY && event.newValue && event.newValue !== state.activeId) chooseProject(event.newValue).catch(() => {});
    });
  }
  function setPopoutState(open) {
    state.popout = !!open;
    if ($('editorPopout')) $('editorPopout').textContent = state.popout ? 'Editor open ↗' : 'Pop out ↗';
  }
  async function initialize() {
    if (!api()) return;
    state.popout = new URLSearchParams(window.location.search).get('editorPopout') === '1';
    if (state.popout) {
      document.body.classList.add('editor-popout');
      if ($('editorClosePopout')) $('editorClosePopout').hidden = false;
      if ($('editorPopout')) $('editorPopout').hidden = true;
    }
    bind();
    api().onChanged(payload => {
      if (!payload || payload.id === state.activeId || payload.removed) {
        loadProjects().catch(error => toast(`Project refresh failed: ${error.message}`));
      } else if (payload.imported) loadProjects().catch(() => {});
    });
    api().onPopoutState(setPopoutState);
    await loadProjects();
    try { setPopoutState(await api().isPopout()); } catch (_) {}
  }
  window.projectEditor = Object.freeze({
    getActiveId: () => state.activeId,
    hasActiveProject: () => !!state.activeId,
    async runTool(name, args) {
      const id = projectRequired();
      return api().runTool(id, name, args || {});
    },
    openView: () => loadProjects().catch(error => toast(error.message))
  });
  initialize().catch(error => { console.error('Project editor initialization failed:', error); toast(`Project editor could not load: ${error.message}`); });
})();
