(() => {
'use strict';
const roots=[...document.querySelectorAll('[data-editor-root]')];
if(!roots.length||!window.localAI?.workspace||!window.localAI?.editor)return;
const origin='editor-'+Math.random().toString(36).slice(2);
const ignored=new Set(['node_modules','vendor','dist','build','.git','.next','coverage']);
const allowed=new Set(['.txt','.md','.markdown','.csv','.json','.xml','.html','.htm','.css','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.java','.cs','.yaml','.yml','.log','.sql','.sh','.ps1','.toml','.ini','.cfg','.go','.rs','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt']);
const defaults={theme:'midnight',fontFamily:'cascadia',fontSize:13,lineHeight:1.6,tabSize:2,lineNumbers:true,background:'#0e131c',panel:'#151b26',text:'#d5dbea',accent:'#91a8ef',keyword:'#c792ea',string:'#a5d6a7',number:'#f2c879',comment:'#78869d'};
const palettes={
 midnight:{background:'#0e131c',panel:'#151b26',text:'#d5dbea',accent:'#91a8ef',keyword:'#c792ea',string:'#a5d6a7',number:'#f2c879',comment:'#78869d'},
 graphite:{background:'#17191d',panel:'#22252b',text:'#e2e4e8',accent:'#c4c9d4',keyword:'#d4a6e8',string:'#a7c99e',number:'#e2bc7a',comment:'#858b96'},
 light:{background:'#f7f8fb',panel:'#e9edf4',text:'#202634',accent:'#4267c7',keyword:'#873bb2',string:'#287a43',number:'#996500',comment:'#778092'},
 ocean:{background:'#081a27',panel:'#102a3b',text:'#d7eaf4',accent:'#5bc0d9',keyword:'#d29de7',string:'#9bd69e',number:'#efc779',comment:'#7394a7'},
 forest:{background:'#101b17',panel:'#1a2922',text:'#d8e9df',accent:'#80c79b',keyword:'#d1a0db',string:'#9dce8f',number:'#e2c37c',comment:'#7c9987'}
};
const state={tabs:[],active:'',workspace:null,busy:false,preferences:{...defaults}};
const ext=p=>{const m=String(p).toLowerCase().match(/(\.[^.\/]+)$/);return m?m[1]:'';};
const fileIcons={'.html':['<>','html'],'.htm':['<>','html'],'.js':['JS','javascript'],'.mjs':['JS','javascript'],'.cjs':['JS','javascript'],'.jsx':['JS','javascript'],'.ts':['TS','typescript'],'.tsx':['TS','typescript'],'.css':['#','css'],'.json':['{}','json'],'.py':['Py','python'],'.java':['Ja','java']};
const icon=p=>fileIcons[ext(p)]?.[0]||({'.md':'MD','.yaml':'YML','.yml':'YML','.sql':'SQL','.rs':'Rs','.go':'Go'})[ext(p)]||'TXT';
const iconClass=p=>'file-icon-'+(fileIcons[ext(p)]?.[1]||'text');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message){const el=document.getElementById('toast');if(el){el.textContent=message;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}else console.info(message);}
function sync(){window.localAI.editor.setSync({origin,tabs:state.tabs.map(t=>({path:t.path,content:t.content,dirty:t.dirty})),active:state.active});}
function receiveSync(value){
 if(!value||value.origin===origin)return;
 if(Array.isArray(value.tabs)){
  state.tabs=value.tabs.map(remote=>{const current=state.tabs.find(t=>t.path===remote.path);return current?{...current,content:remote.content,dirty:!!remote.dirty}:{path:remote.path,content:remote.content,dirty:!!remote.dirty};});
  state.active=value.active||'';
  roots.forEach(render);
 }
 if(value.preferences)applyPreferences(value.preferences,false);
}
window.localAI.editor.onSync(receiveSync);
window.localAI.editor.onPreferences(prefs=>applyPreferences(prefs,false));
function paletteFor(prefs){
 if(prefs.theme==='custom')return prefs;
 return {...(palettes[prefs.theme]||palettes.midnight),...{fontFamily:prefs.fontFamily,fontSize:prefs.fontSize,lineHeight:prefs.lineHeight,tabSize:prefs.tabSize,lineNumbers:prefs.lineNumbers}};
}
function fontStack(font){return ({cascadia:'"Cascadia Code",Consolas,monospace',consolas:'Consolas,"Courier New",monospace',system:'ui-monospace,SFMono-Regular,Consolas,monospace',fira:'"Fira Code",Consolas,monospace',jetbrains:'"JetBrains Mono",Consolas,monospace'})[font]||'Consolas,monospace';}
function applyPreferences(prefs,save=true){
 state.preferences={...state.preferences,...prefs};
 const p=paletteFor(state.preferences);
 roots.forEach(root=>{
  const shell=root.querySelector('.editor-shell');if(!shell)return;
  const vars={'--ed-bg':p.background,'--ed-panel':p.panel,'--ed-text':p.text,'--ed-accent':p.accent,'--ed-keyword':p.keyword,'--ed-string':p.string,'--ed-number':p.number,'--ed-comment':p.comment,'--ed-font':fontStack(state.preferences.fontFamily),'--ed-font-size':state.preferences.fontSize+'px','--ed-line-height':state.preferences.lineHeight,'--ed-tab-size':state.preferences.tabSize};
  Object.entries(vars).forEach(([key,value])=>shell.style.setProperty(key,String(value)));
  shell.classList.toggle('hide-line-numbers',!state.preferences.lineNumbers);
  const panel=shell.querySelector('.editor-custom-panel');if(panel)syncPreferenceControls(panel);
 });
 if(save)window.localAI.editor.setPreferences(state.preferences).catch(error=>notify('Could not save editor appearance: '+error.message));
}
function syncPreferenceControls(panel){
 panel.querySelectorAll('[data-pref]').forEach(control=>{
  const value=state.preferences[control.dataset.pref];
  if(control.type==='checkbox')control.checked=!!value;
  else if(value!==undefined)control.value=String(value);
 });
}
function highlight(source,lang){
 let h=esc(source);
 if(['js','mjs','cjs','ts','tsx','jsx','py','java','cs','go','rs'].includes(lang)){
  h=h.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g,'<span class="syn-string">$1</span>');
  h=h.replace(/\b(const|let|var|function|return|if|else|for|while|class|new|async|await|import|export|from|default|try|catch|throw|def|self|True|False|null|undefined|public|private|static|void|package|func|fn|struct|impl|use)\b/g,'<span class="syn-keyword">$1</span>');
  h=h.replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="syn-number">$1</span>');
  h=h.replace(/(\/\/.*|#.*)$/gm,'<span class="syn-comment">$1</span>');
 }else if(lang==='json'){
  h=h.replace(/(&quot;[^&]*?&quot;)(?=\s*:)/g,'<span class="syn-key">$1</span>').replace(/:\s*(&quot;.*?&quot;)/g,': <span class="syn-string">$1</span>').replace(/\b(true|false|null)\b/g,'<span class="syn-keyword">$1</span>');
 }else if(['html','htm','xml'].includes(lang))h=h.replace(/(&lt;\/?[\w:-]+|\/?&gt;)/g,'<span class="syn-tag">$1</span>');
 else if(lang==='css')h=h.replace(/([.#][\w-]+)(?=\s*\{)/g,'<span class="syn-keyword">$1</span>').replace(/([\w-]+)(?=\s*:)/g,'<span class="syn-key">$1</span>');
 return h||' ';
}
function renderTabs(root){
 const strip=root.querySelector('.editor-tabs');if(!strip)return;strip.replaceChildren();
 state.tabs.forEach(tab=>{
  const b=document.createElement('button');b.type='button';b.className='editor-tab'+(tab.path===state.active?' active':'')+(tab.dirty?' dirty':'');
  b.innerHTML='<span class="editor-file-icon '+iconClass(tab.path)+'">'+esc(icon(tab.path))+'</span><span class="editor-tab-name">'+esc(tab.path.split('/').pop())+'</span><span class="editor-dirty-dot"></span><span class="editor-tab-close" role="button" aria-label="Close tab">×</span>';b.title=tab.path;
  b.querySelector('.editor-tab-close')?.setAttribute('aria-label','Close '+tab.path);
  b.addEventListener('auxclick',event=>{if(event.button===1){event.preventDefault();closeTab(tab.path);}});
  b.addEventListener('click',e=>{if(e.target.closest('.editor-tab-close'))closeTab(tab.path);else{state.active=tab.path;roots.forEach(render);sync();}});
  strip.append(b);
 });
}
function lineGutter(source){return Array.from({length:Math.max(1,source.split('\n').length)},(_,i)=>'<span>'+String(i+1)+'</span>').join('');}
function renderActive(root){
 const tab=state.tabs.find(t=>t.path===state.active),area=root.querySelector('.editor-work-area');if(!area)return;
 if(!tab){area.innerHTML='<div class="editor-empty"><div class="editor-empty-mark">⌘</div><strong>Open a file to start editing</strong><p>Select a source file from the explorer, or create a new file.</p></div>';root.querySelector('.editor-file-path').textContent='No file selected';root.querySelector('.editor-language').textContent='TEXT';const save=root.querySelector('.editor-save');if(save)save.disabled=true;return;}
 root.querySelector('.editor-file-path').textContent=tab.path;
 area.innerHTML='<div class="editor-code-wrap"><div class="editor-gutter"></div><div class="editor-code-stack"><pre class="editor-highlight" aria-hidden="true"></pre><textarea class="editor-input" spellcheck="false" aria-label="Source code editor" autocapitalize="off" autocomplete="off"></textarea></div></div>';
 const input=area.querySelector('.editor-input');input.value=tab.content;input.style.tabSize=String(state.preferences.tabSize);
 area.querySelector('.editor-highlight').innerHTML=highlight(tab.content,ext(tab.path).slice(1))+'\n';
 area.querySelector('.editor-gutter').innerHTML=lineGutter(tab.content);
 root.querySelector('.editor-language').textContent=ext(tab.path).slice(1).toUpperCase()||'TEXT';
 const save=root.querySelector('.editor-save');if(save)save.disabled=!tab.dirty;
 updateCursor(root);
}
function render(root){renderTabs(root);renderActive(root);applyPreferences(state.preferences,false);}
function updateCursor(root){const a=root.querySelector('.editor-input');if(!a)return;const b=a.value.slice(0,a.selectionStart),line=b.split('\n').length,col=b.length-b.lastIndexOf('\n');root.querySelector('.editor-position').textContent='Ln '+line+', Col '+col;}
async function askEditorAI(action,root){
 const tab=state.tabs.find(item=>item.path===state.active);
 if(!tab){notify('Open a source file before using an AI action.');return;}
 const input=root.querySelector('.editor-input');
 const hasSelection=!!input&&input.selectionEnd>input.selectionStart;
 const selected=hasSelection?input.value.slice(input.selectionStart,input.selectionEnd):'';
 const source=(selected||(input?input.value:tab.content)).slice(0,20000);
 const instructions={
  explain:'Explain the selected code or active file clearly, including its purpose and important behavior.',
  debug:'Inspect the selected code or active file for likely bugs and propose safe fixes.',
  refactor:'Suggest a careful refactor that preserves behavior and explain the improvements.',
  tests:'Propose useful automated tests for the selected code or active file.',
  review:'Review the selected code or active file for correctness, maintainability and security concerns.'
 };
 const scope=hasSelection?'Selected code':'Active file';
 const prompt=instructions[action]+'\\n\\nFile: '+tab.path+'\\nScope: '+scope+'\\n\\n'+source+(source.length>=20000?'\\n\\n[Source truncated to 20,000 characters.]':'');
 try{await window.localAI.editor.askAI(prompt);}
 catch(error){notify('Could not send this editor request to Chat: '+error.message);}
}
async function renderExplorerEntries(root,container,entries,depth=0){
 const filtered=entries.filter(entry=>!entry.name.startsWith('.')&&!ignored.has(entry.name)&&(entry.type==='directory'||(entry.type==='file'&&allowed.has(ext(entry.name)))));
 filtered.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1);
 for(const entry of filtered.slice(0,500)){
  if(entry.type==='directory'){
   const group=document.createElement('div');group.className='editor-tree-folder';
   const button=document.createElement('button');button.type='button';button.className='editor-tree-item folder';button.setAttribute('aria-expanded','false');button.innerHTML='<span>▸</span><span>'+esc(entry.name)+'</span>';button.title=entry.path;
   const children=document.createElement('div');children.className='editor-tree-children';children.hidden=true;children.style.marginLeft=(depth+1)*10+'px';
   button.addEventListener('click',async()=>{
    const expanded=button.getAttribute('aria-expanded')==='true';
    if(expanded){button.setAttribute('aria-expanded','false');button.querySelector('span:first-child').textContent='▸';children.hidden=true;return;}
    button.setAttribute('aria-expanded','true');button.querySelector('span:first-child').textContent='▾';children.hidden=false;
    if(!children.dataset.loaded){children.innerHTML='<div class="editor-tree-message">Loading…</div>';try{const nested=await window.localAI.workspace.list(entry.path);children.replaceChildren();await renderExplorerEntries(root,children,nested,depth+1);children.dataset.loaded='true';if(!children.childElementCount)children.innerHTML='<div class="editor-tree-message">Empty folder</div>';}catch(error){children.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}}
   });
   group.append(button,children);container.append(group);
  }else{
   const button=document.createElement('button');button.type='button';button.className='editor-tree-item file';button.innerHTML='<span class="editor-file-icon '+iconClass(entry.path)+'">'+esc(icon(entry.path))+'</span><span>'+esc(entry.name)+'</span>';button.title=entry.path;button.addEventListener('click',()=>openFile(entry.path));container.append(button);
  }
 }
}
async function loadTree(root,dir=''){
 const list=root.querySelector('.editor-tree');if(!list)return;list.innerHTML='<div class="editor-tree-message">Loading workspace…</div>';
 try{
  state.workspace=await window.localAI.workspace.info();
  if(!state.workspace){list.innerHTML='<div class="editor-tree-message">Choose a workspace in Connections first.</div>';return;}
  const entries=await window.localAI.workspace.list(dir);list.replaceChildren();
  const filtered=entries.filter(e=>!e.name.startsWith('.')&&!ignored.has(e.name)&&(e.type==='directory'||(e.type==='file'&&allowed.has(ext(e.name)))));
  filtered.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='directory'?-1:1);
  if(dir){const up=document.createElement('button');up.type='button';up.className='editor-tree-item folder';up.textContent='↰ ..';up.addEventListener('click',()=>loadTree(root,dir.split('/').slice(0,-1).join('/')));list.append(up);}
  await renderExplorerEntries(root,list,filtered,0);
  if(!filtered.length)list.innerHTML='<div class="editor-tree-message">No supported source files in this folder.</div>';
  root.querySelector('.editor-workspace-name').textContent=state.workspace.name;
 }catch(error){list.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}
}
async function searchWorkspace(root,term){
 const resultsPanel=root.querySelector('.editor-search-results');
 if(!resultsPanel)return;
 resultsPanel.hidden=false;
 resultsPanel.innerHTML='<div class="editor-tree-message">Searching workspace…</div>';
 try{
  const response=await window.localAI.workspace.search(term);
  const matches=Array.isArray(response?.results)?response.results:[];
  resultsPanel.replaceChildren();
  if(!matches.length){resultsPanel.innerHTML='<div class="editor-tree-message">No matches found.</div>';}
  matches.forEach(result=>{
   const button=document.createElement('button');button.type='button';button.className='editor-search-result';
   button.innerHTML='<strong>'+esc(result.path)+':'+Number(result.line||1)+'</strong><small>'+esc(result.excerpt||'')+'</small>';
   button.addEventListener('click',async()=>{
    await openFile(result.path);
    const tab=state.tabs.find(item=>item.path===result.path);
    const input=root.querySelector('.editor-input');
    if(!tab||!input)return;
    const lines=tab.content.split(/\\r?\\n/);
    const lineIndex=Math.max(0,Math.min(lines.length-1,Number(result.line||1)-1));
    const before=lines.slice(0,lineIndex).join('\\n');
    const lineText=lines[lineIndex]||'';
    const relative=lineText.toLowerCase().indexOf(term.toLowerCase());
    const offset=(before?before.length+1:0)+Math.max(0,relative);
    input.focus();input.setSelectionRange(offset,offset+term.length);
   });
   resultsPanel.append(button);
  });
  if(response.capped){const note=document.createElement('p');note.className='editor-search-capped';note.textContent='Search reached the workspace scan limit. Narrow the search term or search a smaller folder.';resultsPanel.append(note);}
 }catch(error){resultsPanel.innerHTML='<div class="editor-tree-message">'+esc(error.message)+'</div>';}
}
async function openFile(path){
 if(state.tabs.some(t=>t.path===path)){state.active=path;roots.forEach(render);sync();return;}
 try{const content=await window.localAI.workspace.read(path);state.tabs.push({path,content,dirty:false});state.active=path;roots.forEach(render);sync();}
 catch(error){notify('Could not open '+path+': '+error.message);}
}
function closeTab(path){
 const tab=state.tabs.find(t=>t.path===path);if(tab?.dirty&&!confirm('Discard unsaved changes to '+path+'?'))return;
 state.tabs=state.tabs.filter(t=>t.path!==path);if(state.active===path)state.active=state.tabs.at(-1)?.path||'';
 roots.forEach(render);sync();
}
async function save(){
 const tab=state.tabs.find(t=>t.path===state.active);if(!tab||state.busy)return;
 state.busy=true;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=true));
 try{await window.localAI.workspace.write(tab.path,tab.content);tab.dirty=false;sync();roots.forEach(render);notify('Saved '+tab.path+'. The previous version was backed up.');}
 catch(error){notify('Save cancelled or failed: '+error.message);}
 finally{state.busy=false;roots.forEach(r=>r.querySelectorAll('.editor-save').forEach(b=>b.disabled=!state.tabs.find(t=>t.path===state.active)?.dirty));}
}
async function importFiles(root){
 try{
  const result=await window.localAI.workspace.importFiles();
  if(result.cancelled)return;
  if(result.imported?.length){
   await loadTree(root);
   await openFile(result.imported[0].path);
   notify('Imported '+result.imported.length+' file(s): '+result.imported.map(item=>item.name).join(', '));
  }
  if(result.skipped?.length)notify((result.imported?.length||0)+' imported; '+result.skipped.length+' skipped. '+result.skipped.map(item=>item.name+': '+item.reason).join(' · '));
  if(!result.imported?.length&&!result.skipped?.length)notify('No supported files were imported.');
 }catch(error){notify('Could not import files: '+error.message);}
}
async function createFile(){
 const path=prompt('New file path, relative to the selected workspace:','new-file.js');if(!path)return;
 if(path.startsWith('/')||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')){notify('Enter a safe relative path inside the selected workspace.');return;}
 try{await window.localAI.workspace.create(path,'');await openFile(path);roots.forEach(root=>loadTree(root));}
 catch(error){notify('Could not create file: '+error.message);}
}
function toggleDock(force){
 const dock=document.getElementById('editorDock');if(!dock)return;
 const open=typeof force==='boolean'?force:dock.hidden;dock.hidden=!open;
 document.getElementById('editorDockButton')?.setAttribute('aria-pressed',String(open));
 updateDockLayout();
 if(open)loadTree(document.getElementById('editorDockRoot'));
}
window.addEventListener('editor:dock-layout',()=>updateDockLayout());
function updateDockLayout(){
 const chat=document.getElementById('chatView');if(!chat)return;
 const editorOpen=!document.getElementById('editorDock')?.hidden;
 const browserOpen=!document.getElementById('browserDock')?.hidden;
 chat.classList.toggle('has-editor-dock',editorOpen);
 chat.classList.toggle('has-browser-dock',browserOpen);
 chat.classList.toggle('has-both-docks',editorOpen&&browserOpen);
 document.getElementById('editorDockButton')?.setAttribute('aria-pressed',String(editorOpen));
 document.getElementById('browserDockButton')?.setAttribute('aria-pressed',String(browserOpen));
}
function preferencePanel(){
 return '<div class="editor-custom-panel" hidden><div class="editor-custom-head"><div><strong>Editor appearance</strong><small>Changes apply to the editor in every window.</small></div><button type="button" class="editor-custom-close" data-action="customize">×</button></div><label>Theme<select data-pref="theme"><option value="midnight">Midnight</option><option value="graphite">Graphite</option><option value="light">Light</option><option value="ocean">Ocean</option><option value="forest">Forest</option><option value="custom">Custom colors</option></select></label><label>Code font<select data-pref="fontFamily"><option value="cascadia">Cascadia Code</option><option value="consolas">Consolas</option><option value="system">System monospace</option><option value="fira">Fira Code</option><option value="jetbrains">JetBrains Mono</option></select></label><div class="editor-custom-grid"><label>Font size <output data-output="fontSize"></output><input type="range" min="11" max="22" step="1" data-pref="fontSize"></label><label>Line height <output data-output="lineHeight"></output><input type="range" min="1.2" max="2.2" step="0.1" data-pref="lineHeight"></label><label>Tab size<select data-pref="tabSize"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></label><label class="editor-check"><input type="checkbox" data-pref="lineNumbers"> Show line numbers</label></div><div class="editor-colors"><label>Background<input type="color" data-pref="background"></label><label>Panel<input type="color" data-pref="panel"></label><label>Text<input type="color" data-pref="text"></label><label>Accent<input type="color" data-pref="accent"></label><label>Keywords<input type="color" data-pref="keyword"></label><label>Strings<input type="color" data-pref="string"></label><label>Numbers<input type="color" data-pref="number"></label><label>Comments<input type="color" data-pref="comment"></label></div><div class="editor-custom-actions"><button type="button" class="btn small" data-action="reset-preferences">Reset</button><button type="button" class="btn small primary" data-action="close-customize">Done</button></div></div>';
}
function mount(root){
 root.innerHTML='<div class="editor-shell"><div class="editor-toolbar"><div class="editor-workspace-label"><span class="editor-live-dot"></span><span class="editor-workspace-name">Workspace</span></div><div class="editor-toolbar-actions"><button type="button" class="btn small" data-action="tabs-toggle" aria-label="Collapse editor tabs">Tabs</button><button type="button" class="btn small" data-action="refresh">↻ Refresh</button><button type="button" class="btn small" data-action="import">⇧ Import file</button><button type="button" class="btn small" data-action="new">＋ New file</button><button type="button" class="btn small primary editor-save" data-action="save" disabled>Save</button><span class="editor-ai-actions"><button type="button" class="btn small" data-ai-action="explain">Explain</button><button type="button" class="btn small" data-ai-action="debug">Debug</button><button type="button" class="btn small" data-ai-action="refactor">Refactor</button><button type="button" class="btn small" data-ai-action="tests">Tests</button><button type="button" class="btn small" data-ai-action="review">Review</button></span><button type="button" class="btn small" data-action="customize">Customize</button><button type="button" class="btn small" data-action="popout">↗ Pop out</button></div></div>'+preferencePanel()+'<div class="editor-layout"><aside class="editor-explorer"><div class="editor-explorer-head"><strong>EXPLORER</strong><button type="button" data-action="refresh" title="Refresh files">↻</button></div><label class="editor-search-wrap"><span>⌕</span><input class="editor-search-input" type="search" placeholder="Search workspace…" aria-label="Search workspace files and contents"></label><div class="editor-tree"></div><div class="editor-search-results" hidden></div></aside><section class="editor-main"><div class="editor-tabs" role="tablist"></div><div class="editor-work-area"><div class="editor-empty"><div class="editor-empty-mark">⌘</div><strong>Open a file to start editing</strong></div></div><div class="editor-status"><span class="editor-file-path">No file selected</span><span class="editor-position">Ln 1, Col 1</span><span class="editor-language">TEXT</span></div></section></div></div>';
 const tabsToggle=root.querySelector('[data-action="tabs-toggle"]');if(tabsToggle)tabsToggle.dataset.action='tabs-toggle';
 root.addEventListener('click',event=>{
  const aiButton=event.target.closest('[data-ai-action]');if(aiButton&&root.contains(aiButton)){event.preventDefault();askEditorAI(aiButton.dataset.aiAction,root);return;}
  const button=event.target.closest('[data-action]');if(!button||!root.contains(button))return;
  const action=button.dataset.action;
  if(action==='tabs-toggle'){root.querySelector('.editor-shell')?.classList.toggle('tabs-collapsed');return;}
  if(action==='refresh'){loadTree(root);return;}
  if(action==='new'){createFile();return;}
  if(action==='import'){importFiles(root);return;}
  if(action==='save'){save();return;}
  if(action==='popout'){window.localAI.editor.openWindow().catch(error=>notify(error.message));return;}
  if(action==='customize'){const panel=root.querySelector('.editor-custom-panel');panel.hidden=!panel.hidden;syncPreferenceControls(panel);return;}
  if(action==='close-customize'){root.querySelector('.editor-custom-panel').hidden=true;return;}
  if(action==='reset-preferences'){applyPreferences({...defaults},true);syncPreferenceControls(root.querySelector('.editor-custom-panel'));return;}
 });
 let editorSearchTimer=null;
 root.addEventListener('input',event=>{
  if(event.target.matches('.editor-search-input')){
   clearTimeout(editorSearchTimer);const term=event.target.value.trim();
   if(term.length<2){root.querySelector('.editor-search-results').hidden=true;root.querySelector('.editor-search-results').replaceChildren();root.querySelector('.editor-tree').hidden=false;return;}
   root.querySelector('.editor-tree').hidden=true;editorSearchTimer=setTimeout(()=>searchWorkspace(root,term),220);return;
  }
  const control=event.target.closest('[data-pref]');if(control&&root.contains(control)){
   const key=control.dataset.pref;let value=control.type==='checkbox'?control.checked:control.type==='range'?Number(control.value):control.value;
   if(key==='tabSize')value=Number(value);
   if(['background','panel','text','accent','keyword','string','number','comment'].includes(key))state.preferences.theme='custom';
   applyPreferences({[key]:value},true);
   const output=root.querySelector('[data-output="'+key+'"]');if(output)output.textContent=String(value)+(key==='fontSize'?' px':key==='lineHeight'?'×':'');
   return;
  }
  if(!event.target.matches('.editor-input'))return;
  const tab=state.tabs.find(t=>t.path===state.active);if(!tab)return;
  tab.content=event.target.value;tab.dirty=true;
  const wrap=event.target.closest('.editor-code-wrap');
  wrap.querySelector('.editor-highlight').innerHTML=highlight(tab.content,ext(tab.path).slice(1))+'\n';
  wrap.querySelector('.editor-gutter').innerHTML=lineGutter(tab.content);
  renderTabs(root);updateCursor(root);root.querySelector('.editor-save').disabled=false;
  syncDebounced();
 });
 root.addEventListener('keydown',event=>{
  if(event.target.matches('.editor-input')){
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();return;}
   if(event.key==='Tab'){event.preventDefault();const input=event.target,start=input.selectionStart,end=input.selectionEnd,spaces=' '.repeat(state.preferences.tabSize);input.setRangeText(spaces,start,end,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
   if(event.key==='Escape'&&event.target.closest('.editor-code-wrap'))event.target.blur();
  }
 });
 root.addEventListener('keyup',()=>updateCursor(root));
 root.addEventListener('click',event=>{if(event.target.matches('.editor-input'))updateCursor(root);});
 root.addEventListener('scroll',event=>{if(!event.target.matches('.editor-input'))return;const w=event.target.closest('.editor-code-wrap');w.querySelector('.editor-highlight').scrollTop=event.target.scrollTop;w.querySelector('.editor-highlight').scrollLeft=event.target.scrollLeft;w.querySelector('.editor-gutter').scrollTop=event.target.scrollTop;},true);
 loadTree(root);
}
let syncTimer=null;
function syncDebounced(){clearTimeout(syncTimer);syncTimer=setTimeout(sync,180);}
roots.forEach(mount);
document.getElementById('editorDockButton')?.addEventListener('click',()=>toggleDock());
document.getElementById('openProjectEditor')?.addEventListener('click',()=>{
 const root=document.getElementById('projectEditorRoot');if(!root)return;
 const show=root.hidden;root.hidden=!show;if(show){root.scrollIntoView({behavior:'smooth',block:'start'});loadTree(root);}
});
document.getElementById('editorPopoutPage')?.addEventListener('click',()=>window.localAI.editor.openWindow().catch(error=>notify(error.message)));
document.getElementById('browserDockButton')?.addEventListener('click',updateDockLayout);
async function initialize(){
 try{
  const [shared,prefs]=await Promise.all([window.localAI.editor.getSync(),window.localAI.editor.getPreferences()]);
  if(shared?.tabs?.length){state.tabs=shared.tabs;state.active=shared.active||'';}
  applyPreferences(prefs||defaults,false);
  roots.forEach(root=>{render(root);syncPreferenceControls(root.querySelector('.editor-custom-panel'));});
  sync();
 }catch(error){notify('Editor initialization failed: '+error.message);}
 updateDockLayout();
}
initialize();
})();