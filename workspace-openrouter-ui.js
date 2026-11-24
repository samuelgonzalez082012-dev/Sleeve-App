(() => {
  'use strict';
  const setup = async () => {
    const root = document.getElementById('workspace-redesign-root');
    if (!root || root.dataset.providerReady) return;
    root.dataset.providerReady = '1';
    const panel = document.createElement('details');
    panel.className = 'wr-provider-drawer';
    panel.innerHTML = '<summary>OpenRouter connection · secure API key</summary><div class="wr-provider-body"><input id="wr-global-key" type="password" autocomplete="off" placeholder="OpenRouter API key"><button id="wr-global-save">Save key securely</button><button id="wr-global-clear">Clear key</button><button id="wr-global-test">Test connection</button><p id="wr-global-status" role="status">API key is encrypted by Electron secure storage. Each agent can select its own OpenRouter model in Team settings.</p></div>';
    root.append(panel);
    const status = panel.querySelector('#wr-global-status');
    const load = async () => {
      try {
        const state = await window.localAI.openRouter.status();
        if (!state.connected) { status.textContent = 'Not connected. Add an OpenRouter API key to use OpenRouter agents.'; return; }
        const models = await window.localAI.openRouter.models();
        status.textContent = 'Connected · ' + models.length + ' models available for per-agent assignment.';
      } catch (error) { status.textContent = error.message; }
    };
    panel.querySelector('#wr-global-save').onclick = async () => {
      try {
        await window.localAI.openRouter.setKey(panel.querySelector('#wr-global-key').value);
        panel.querySelector('#wr-global-key').value = '';
        await load();
      } catch (error) { status.textContent = error.message; }
    };
    panel.querySelector('#wr-global-clear').onclick = async () => { try { await window.localAI.openRouter.setKey(''); await load(); } catch (error) { status.textContent = error.message; } };
    panel.querySelector('#wr-global-test').onclick = load;
    await load();
  };
  const observer = new MutationObserver(setup);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => {
    setup(); observer.observe(document.body, { childList: true, subtree: true });
  });
  else { setup(); observer.observe(document.body, { childList: true, subtree: true }); }
})();