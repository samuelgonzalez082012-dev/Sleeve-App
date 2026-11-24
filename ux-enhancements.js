(() => {
  'use strict';
  const commands = [
    { label: 'Open Chats', group: 'Navigate', icon: '◫', action: () => navigate('chat') },
    { label: 'Open Projects', group: 'Navigate', icon: '▦', action: () => navigate('projects') },
    { label: 'Open Work Manager', group: 'Navigate', icon: '◈', action: () => navigate('work') },
    { label: 'Open Models', group: 'Navigate', icon: '◇', action: () => navigate('models') },
    { label: 'Open Browser', group: 'Navigate', icon: '◍', action: () => navigate('browser') },
    { label: 'Open Code Editor', group: 'Navigate', icon: '⌘', action: () => navigate('editor') },
    { label: 'Open Tasks', group: 'Navigate', icon: '◷', action: () => navigate('tasks') },
    { label: 'Open Connections', group: 'Navigate', icon: '⌘', action: () => navigate('connections') },
    { label: 'Open Memory', group: 'Navigate', icon: '✧', action: () => navigate('memory') },
    { label: 'Open Insights', group: 'Navigate', icon: '◌', action: () => navigate('insights') },
    { label: 'Open Settings', group: 'Navigate', icon: '⚙', action: () => navigate('settings') },
    { label: 'Open Help & guides', group: 'Navigate', icon: '?', action: () => navigate('help') },
    { label: 'Start a new chat', group: 'Create', icon: '＋', shortcut: 'Ctrl+N', action: () => click('newChat') },
    { label: 'Create a project', group: 'Create', icon: '▦', action: () => { navigate('projects'); click('newProject'); } },
    { label: 'Create a task', group: 'Create', icon: '◷', action: () => { navigate('tasks'); click('newTask'); } },
    { label: 'Create a Work Manager task', group: 'Create', icon: '◈', action: () => { navigate('work'); click('newWorkTask'); } },
    { label: 'Search workspace', group: 'Actions', icon: '⌕', shortcut: 'Ctrl+K', action: () => click('searchOpen') },
    { label: 'Refresh installed models', group: 'Actions', icon: '↻', action: () => { navigate('models'); click('modelsRefresh'); } },
    { label: 'Toggle inspector', group: 'Actions', icon: '☷', action: () => click('toggleSettings') },
    { label: 'Toggle navigation sidebar', group: 'Actions', icon: '☰', action: () => click('toggleChats') }
  ];
  const click = id => document.getElementById(id)?.click();
  const navigate = view => document.querySelector('#primaryNav [data-view="' + view + '"]')?.click();
  let selected = 0;
  let visible = commands;
  const dialog = document.createElement('dialog');
  dialog.className = 'command-palette';
  dialog.setAttribute('aria-label', 'Command palette');
  dialog.innerHTML = '<input class="command-palette-input" type="search" placeholder="Search pages and actions…" aria-label="Search commands" autocomplete="off"><div class="command-palette-list" role="listbox" aria-label="Commands"></div>';
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('.command-palette-list');
  function render() {
    const query = input.value.trim().toLowerCase();
    visible = commands.filter(item => (item.label + ' ' + item.group).toLowerCase().includes(query));
    selected = Math.min(selected, Math.max(0, visible.length - 1));
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'command-palette-empty';
      empty.textContent = 'No matching commands.';
      list.append(empty);
      return;
    }
    visible.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-palette-item';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === selected));
      const icon = document.createElement('span');
      icon.textContent = item.icon;
      const label = document.createElement('span');
      label.textContent = item.label;
      const shortcut = document.createElement('small');
      shortcut.textContent = item.shortcut || item.group;
      button.append(icon, label, shortcut);
      button.addEventListener('click', () => run(item));
      list.append(button);
    });
  }
  function run(item) {
    dialog.close();
    item.action();
  }
  function open() {
    if (!dialog.open) dialog.showModal();
    input.value = '';
    selected = 0;
    render();
    input.focus();
  }
  input.addEventListener('input', () => { selected = 0; render(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(visible.length - 1, selected + 1); render(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, selected - 1); render(); }
    else if (event.key === 'Enter' && visible[selected]) { event.preventDefault(); run(visible[selected]); }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  const settingsSearch = document.getElementById('settingsSearch');
  if (settingsSearch) {
    const status = document.getElementById('settingsSearchStatus');
    const sections = [...document.querySelectorAll('#settingsView .settings-section')];
    const tabs = [...document.querySelectorAll('#settingsNav [data-settings-section]')];
    settingsSearch.addEventListener('input', () => {
      const query = settingsSearch.value.trim().toLowerCase();
      if (!query) {
        tabs.forEach(tab => { tab.hidden = false; });
        if (status) status.textContent = 'Find appearance, layout, language, privacy and data options.';
        return;
      }
      const matches = sections.filter(section => {
        const content = [section.querySelector('h2')?.textContent, section.querySelector('p')?.textContent, ...[...section.querySelectorAll('label')].map(label => label.textContent)].join(' ').toLowerCase();
        return content.includes(query);
      });
      tabs.forEach(tab => { tab.hidden = !matches.some(section => section.dataset.settingsSection === tab.dataset.settingsSection); });
      if (status) status.textContent = matches.length ? matches.length + ' matching settings category' + (matches.length === 1 ? '' : 'ies') + '.' : 'No settings categories match that search.';
      if (matches.length && !matches.some(section => section.classList.contains('active'))) {
        document.getElementById('settingsTab-' + matches[0].dataset.settingsSection)?.click();
      }
    });
  }
  document.getElementById('commandPaletteOpen')?.addEventListener('click', open);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      open();
    }
  });
})();
