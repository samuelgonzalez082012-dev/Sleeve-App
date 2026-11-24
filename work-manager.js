(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let state = null;
  let selectedAgent = 'planner';
  let selectedTask = '';
  const activeRuns = new Map();
  function parsePlannerPlan(output, allowedAgentIds) {
    const source = String(output || '');
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(source.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.workstreams)) return null;
      const allowed = new Set(allowedAgentIds);
      const workstreams = parsed.workstreams.filter(item => item && allowed.has(item.agentId) && typeof item.objective === 'string' && item.objective.trim()).map(item => ({
        agentId: item.agentId,
        objective: item.objective.trim().slice(0, 4000),
        files: Array.isArray(item.files) ? item.files.filter(file => typeof file === 'string' && file.length <= 500 && !file.startsWith('/') && !file.split(/[\\/]/).includes('..')).slice(0, 80) : []
      }));
      return { summary: String(parsed.summary || '').slice(0, 4000), workstreams, risks: Array.isArray(parsed.risks) ? parsed.risks.filter(x => typeof x === 'string').slice(0, 30) : [], verification: Array.isArray(parsed.verification) ? parsed.verification.filter(x => typeof x === 'string').slice(0, 30) : [] };
    } catch (_) { return null; }
  }
  const agentDefaults = [
    { id:'planner', name:'Planner', role:'planner', provider:'inherit', model:'', instructions:'Coordinate the team, break work into tasks, and review decisions.', tools:['read','plan','message'], enabled:true },
    { id:'developer-1', name:'Developer 1', role:'developer', provider:'inherit', model:'', instructions:'Implement assigned development tasks within the agreed scope.', tools:['read','write-proposal','message'], enabled:true },
    { id:'developer-2', name:'Developer 2', role:'developer', provider:'inherit', model:'', instructions:'Work on independent assigned tasks and coordinate file ownership.', tools:['read','write-proposal','message'], enabled:true },
    { id:'reviewer', name:'Reviewer', role:'reviewer', provider:'inherit', model:'', instructions:'Review plans and proposed changes; identify risks and missing tests.', tools:['read','review','message'], enabled:true }
  ];
  function toast(message) { const node=byId('toast'); if(node){node.textContent=message;node.classList.add('visible');setTimeout(()=>node.classList.remove('visible'),2800);} }
  function time(value) { try { return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); } catch (_) { return ''; } }
  async function refresh() {
    if (!window.localAI?.work) return;
    try { state = await window.localAI.work.state(); render(); }
    catch (error) { toast(`Work Manager could not load: ${error.message}`); }
  }
  function renderAgents() {
    const list=byId('workAgentList'); if(!list||!state)return;
    list.innerHTML=state.team.agents.map(agent=>`<button class="work-agent-card ${selectedAgent===agent.id?'selected':''}" data-agent-select="${escapeHtml(agent.id)}"><span class="agent-avatar ${escapeHtml(agent.role)}">${escapeHtml(agent.name.slice(0,1).toUpperCase())}</span><span class="agent-copy"><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.role)} · ${escapeHtml(agent.provider==='inherit'?'Default model':agent.model||agent.provider)}</small></span><span class="agent-status">${agent.enabled?'Ready':'Paused'}</span></button>`).join('');
    renderInspector();
    const select=byId('workTaskAgent'); if(select)select.innerHTML=state.team.agents.map(agent=>`<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`).join('');
    const templates=byId('loadWorkTemplate');if(templates){const selected=templates.value;templates.innerHTML='<option value="">Saved teams…</option>'+state.templates.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · v${Number(item.version)||1}</option>`).join('');templates.value=state.templates.some(item=>item.id===selected)?selected:'';}
    byId('workAutonomy').value=state.team.autonomy||'hybrid'; byId('workConcurrency').value=state.team.maxConcurrent||3; byId('workMaxSteps').value=state.team.maxStepsPerAgent||8; byId('workAgentTimeout').value=state.team.agentTimeoutMinutes||10; byId('workMaxTokens').value=state.team.maxTokensPerAgent||4096;
  }
  function renderInspector(){const host=byId('workAgentInspector');if(!host||!state)return;const agent=state.team.agents.find(item=>item.id===selectedAgent);if(!agent){host.innerHTML='<p class="muted-text">Select an agent.</p>';return;}host.innerHTML=`<label class="field">Agent name<input id="inspectAgentName" maxlength="80" value="${escapeHtml(agent.name)}"></label><label class="field">Role<input id="inspectAgentRole" maxlength="40" value="${escapeHtml(agent.role)}"></label><label class="field">Provider<select id="inspectAgentProvider"><option value="inherit" ${!agent.provider||agent.provider==='inherit'?'selected':''}>Use application provider</option><option value="openrouter" ${agent.provider==='openrouter'?'selected':''}>OpenRouter (optional API)</option></select></label><label class="field">Model override<input id="inspectAgentModel" list="inspectAgentModelOptions" maxlength="200" value="${escapeHtml(agent.model||'')}" placeholder="${agent.provider==='openrouter'?'Choose an OpenRouter model':'Use default model or enter an Ollama model'}"></label><datalist id="inspectAgentModelOptions">${(window.localAIWorkRunner?.listModels?.().models||[]).map(model=>`<option value="${escapeHtml(model)}"></option>`).join('')}</datalist><p class="hint">Local agents use the selected local provider. OpenRouter is optional, requires an API key and may incur charges.</p><label class="field">Instructions<textarea id="inspectAgentInstructions" rows="5" maxlength="8000">${escapeHtml(agent.instructions||'')}</textarea></label><div class="work-permission-list">${['read','write-proposal','review','message','memory-propose'].map(tool=>`<label><input type="checkbox" name="agentTool" value="${tool}" ${agent.tools.includes(tool)?'checked':''}> ${tool.replace('-',' ')}</label>`).join('')}</div><label class="work-inspector-enabled"><input id="inspectAgentEnabled" type="checkbox" ${agent.enabled?'checked':''}> Agent enabled</label><button class="btn primary full" id="saveAgentConfig">Save agent configuration</button>`;byId('inspectAgentProvider')?.addEventListener('change',async()=>{const list=byId('inspectAgentModelOptions');if(!list)return;try{const models=await window.localAIWorkRunner.listProviderModels(byId('inspectAgentProvider').value);list.innerHTML=models.slice(0,1000).map(model=>`<option value="${escapeHtml(typeof model==='string'?model:model.id)}"></option>`).join('');}catch(error){toast('Could not load provider models: '+error.message);}});if(agent.provider==='openrouter')byId('inspectAgentProvider')?.dispatchEvent(new Event('change'));byId('saveAgentConfig')?.addEventListener('click',async()=>{agent.name=byId('inspectAgentName').value.trim();agent.role=byId('inspectAgentRole').value.trim()||'custom';agent.provider=byId('inspectAgentProvider').value;agent.model=byId('inspectAgentModel').value.trim();agent.instructions=byId('inspectAgentInstructions').value;agent.tools=[...document.querySelectorAll('#workAgentInspector input[name=agentTool]:checked')].map(input=>input.value);agent.enabled=byId('inspectAgentEnabled').checked;try{await saveTeam();toast('Agent configuration saved.');}catch(error){toast(error.message);}});}
  function renderGraph() {
    const messages=byId('workMessageList'); if(!messages||!state)return;
    messages.innerHTML=state.messages.length?state.messages.slice(-8).reverse().map(message=>`<button class="work-message" data-message-id="${escapeHtml(message.id)}"><strong>${escapeHtml(agentName(message.from))} → ${escapeHtml(message.to==='team'?'Team':agentName(message.to))}</strong><span>${escapeHtml(message.body)}</span><small>${time(message.createdAt)}</small></button>`).join(''):'<span class="muted-text">No agent messages yet. Task updates and agent coordination will appear here.</span>';
    const nodes=byId('workGraph'); nodes?.querySelectorAll('[data-agent-node]').forEach(node=>node.classList.toggle('selected',node.dataset.agentNode===selectedAgent));
    const svg=nodes?.querySelector('svg');if(svg){const point=id=>({planner:[300,65],'developer-1':[150,160],'developer-2':[450,160],reviewer:[300,265]}[id]||[300,160]);const paths=state.messages.slice(-16).map(message=>{const a=point(message.from),b=message.to==='team'?[300,160]:point(message.to);return `<path class="work-message-edge" data-message-id="${escapeHtml(message.id)}" d="M${a[0]} ${a[1]} L${b[0]} ${b[1]}"/>`;}).join('');svg.innerHTML=`<g class="work-base-edges"><path d="M300 65 L145 155 M300 65 L455 155 M145 205 L300 265 M455 205 L300 265 M145 155 L455 155"/></g>${paths}`;}
  }
  function showMessage(id){const message=state?.messages.find(item=>item.id===id);if(!message)return;byId('workMessageMeta').textContent=`${agentName(message.from)} → ${message.to==='team'?'Team':agentName(message.to)} · ${time(message.createdAt)}`;byId('workMessageBody').textContent=message.body;byId('workMessageDialog').showModal();}
  function agentName(id){return state?.team.agents.find(agent=>agent.id===id)?.name||id||'Unknown';}
  function renderTasks() {
    const list=byId('workTaskList'); if(!list||!state)return;
    byId('workTaskCount').textContent=`${state.tasks.length} task${state.tasks.length===1?'':'s'}`;
    list.innerHTML=state.tasks.length?state.tasks.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(task=>`<article class="work-task-card ${selectedTask===task.id?'selected':''}" data-task-card="${escapeHtml(task.id)}"><div class="work-task-top"><strong>${escapeHtml(task.title)}</strong><span class="task-status ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></div><p>${escapeHtml(task.description)}</p><small>${escapeHtml(agentName(task.assignedTo))} · ${escapeHtml(task.priority)} priority</small><div class="work-task-actions"><select data-task-status="${escapeHtml(task.id)}" aria-label="Task status"><option value="queued" ${task.status==='queued'?'selected':''}>Queued</option><option value="planning" ${task.status==='planning'?'selected':''}>Planning</option><option value="in-progress" ${task.status==='in-progress'?'selected':''}>In progress</option><option value="blocked" ${task.status==='blocked'?'selected':''}>Blocked</option><option value="review" ${task.status==='review'?'selected':''}>Review</option><option value="completed" ${task.status==='completed'?'selected':''}>Completed</option><option value="cancelled" ${task.status==='cancelled'?'selected':''}>Cancelled</option></select><button class="btn small" data-task-message="${escapeHtml(task.id)}">Message team</button><button class="btn small primary" data-task-run="${escapeHtml(task.id)}" ${['planning','in-progress','review'].includes(task.status)?'disabled':''}>Run team</button></div></article>`).join(''):'<p class="muted-text">Create a task to organize work for your agents.</p>';
  }
  function renderActivity() {
    const list=byId('workActivityList'); if(!list||!state)return;
    list.innerHTML=state.activity.length?state.activity.slice(0,24).map(item=>`<div class="work-activity-item"><i></i><span><strong>${escapeHtml(item.type.replace(/-/g,' '))}</strong><small>${escapeHtml(item.title||item.file||item.name||item.agentId||item.project||'Work Manager')} · ${time(item.at)}</small></span></div>`).join(''):'<p class="muted-text">No activity yet.</p>';
  }
  function renderMemory() {
    const list=byId('workMemoryList'); if(!list||!state)return;
    list.innerHTML=state.memory.length?state.memory.map(item=>`<article class="work-memory-item ${item.status==='pending'?'pending':''}"><div><strong>${escapeHtml(item.title)}</strong><span class="memory-category">${escapeHtml(item.category)}${item.pinned?' · Pinned':''} · ${escapeHtml(item.status||'approved')}</span></div><p>${escapeHtml(item.content)}</p>${item.proposedBy?`<small>Proposed by ${escapeHtml(agentName(item.proposedBy))}</small>`:''}<div class="work-memory-actions">${item.status==='pending'?`<button class="btn small primary" data-memory-approve="${escapeHtml(item.id)}">Approve</button>`:''}<button class="btn small" data-memory-remove="${escapeHtml(item.id)}">${item.status==='pending'?'Reject':'Remove'}</button></div></article>`).join(''):'<p class="muted-text">No shared project memory yet. Add architecture notes, rules, decisions and restrictions for the whole team.</p>';
  }
  function renderFileActivity(){const host=byId('workFileActivity');if(!host||!state)return;const active=state.locks||[];const queued=state.waiting||[];host.innerHTML=active.length||queued.length?[...active.map(lock=>`<span class="file-lock ${lock.mode}"><b>${escapeHtml(lock.mode==='write'?'Writing':'Reading')}</b> ${escapeHtml(lock.file)} · ${escapeHtml(agentName(lock.agentId))}</span>`),...queued.map(ticket=>`<span class="file-lock waiting"><b>Waiting to ${escapeHtml(ticket.mode)}</b> ${escapeHtml(ticket.file)} · ${escapeHtml(agentName(ticket.agentId))}</span>`)].join(''):'No active agent file operations.';}
  function render() { if(!state)return; renderAgents();renderGraph();renderTasks();renderActivity();renderMemory();renderFileActivity();applyLayout(); }
  function applyLayout(){const hidden=new Set(state?.layout?.hidden||[]);const order=state?.layout?.panels||[];document.querySelectorAll('[data-work-panel]').forEach(panel=>{panel.hidden=hidden.has(panel.dataset.workPanel);panel.style.order=String(Math.max(0,order.indexOf(panel.dataset.workPanel)));const width=Number(state?.layout?.widths?.[panel.dataset.workPanel]);panel.style.width=width>=220?`${width}px`:'';});}
  async function saveTeam() {
    if(!state)return;
    try { state.team.autonomy=byId('workAutonomy').value;state.team.maxConcurrent=Number(byId('workConcurrency').value)||3;state.team.maxStepsPerAgent=Number(byId('workMaxSteps').value)||8;state.team.agentTimeoutMinutes=Number(byId('workAgentTimeout').value)||10;state.team.maxTokensPerAgent=Number(byId('workMaxTokens').value)||4096;await window.localAI.work.saveTeam(state.team);await refresh();toast('Team configuration saved.'); }
    catch(error){toast(`Could not save team: ${error.message}`);}
  }
  function openTaskDialog(){byId('workTaskForm')?.reset();byId('workTaskAgent').value=selectedAgent;byId('workTaskDialog')?.showModal();}
  async function addAgent(){
    const name=prompt('Agent name');if(!name?.trim())return;
    const role=prompt('Agent role (for example: tester, architect, researcher)','custom')||'custom';
    const id=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||`agent-${Date.now()}`;
    if(state.team.agents.some(agent=>agent.id===id)){toast('An agent with that ID already exists.');return;}
    state.team.agents.push({id,name:name.trim().slice(0,80),role,provider:'inherit',model:'',instructions:`You are the ${role} agent. Follow project instructions and coordinate with the team.`,tools:['read','message'],enabled:true});await saveTeam();
  }
  async function addMemory(){
    const title=prompt('Memory title');if(!title?.trim())return;
    const content=prompt('Shared project information');if(!content?.trim())return;
    const category=prompt('Category: architecture, rules, design, decisions, restrictions, notes','notes')||'notes';
    try{await window.localAI.work.addMemory({title,content,category,pinned:false});await refresh();toast('Shared project memory saved.');}catch(error){toast(error.message);}
  }
  async function runTeamTask(taskId){
    const task=state.tasks.find(item=>item.id===taskId);if(!task)return;
    if(!window.localAIWorkRunner?.runAgent){toast('The model runner is not available.');return;}
    const agents=state.team.agents.filter(agent=>agent.enabled);
    const planner=agents.find(agent=>agent.role==='planner')||agents[0];
    if(!planner){toast('Add an enabled agent to the team first.');return;}
    const reviewer=agents.find(agent=>agent.role==='reviewer');
    const developers=agents.filter(agent=>agent.id!==planner.id&&agent.id!==reviewer?.id&&((agent.tools||[]).includes('read')||(agent.tools||[]).includes('write-proposal')));
    if(!developers.length){toast('Enable at least one additional agent with read permission to participate in a team task; write-proposal permission allows approved file changes.');return;}
    const taskAssignee=agents.find(agent=>agent.id===task.assignedTo);
    if(taskAssignee&&taskAssignee.id!==planner.id&&taskAssignee.id!==reviewer?.id&&!developers.some(agent=>agent.id===taskAssignee.id)){toast('The selected task owner does not have permission to participate in implementation.');return;}
    if(taskAssignee&&developers.some(agent=>agent.id===taskAssignee.id))developers.sort((a,b)=>a.id===taskAssignee.id?-1:b.id===taskAssignee.id?1:0);
    const controller=new AbortController();
    const runControl={controller,paused:false,waiters:[],pause(){this.paused=true;},resume(){this.paused=false;this.waiters.splice(0).forEach(resolve=>resolve());},async waitIfPaused(){while(this.paused&&!controller.signal.aborted)await new Promise(resolve=>this.waiters.push(resolve));if(controller.signal.aborted)throw new DOMException('The team run was stopped.','AbortError');}};
    controller.signal.addEventListener('abort',()=>runControl.resume(),{once:true});
    const agentBudget={maxSteps:Number(state.team.maxStepsPerAgent)||8,timeoutMs:(Number(state.team.agentTimeoutMinutes)||10)*60000,maxTokens:Number(state.team.maxTokensPerAgent)||4096,waitIfPaused:()=>runControl.waitIfPaused()};
    const projectMemory=state.memory.filter(item=>item.status==='approved').map(item=>`[${item.category}${item.pinned?' · pinned':''}] ${item.title}: ${item.content}`).join('\n\n');
    const memoryContext=projectMemory?`\n\nSHARED PROJECT MEMORY (follow pinned entries as project instructions):\n${projectMemory}`:'';
    const runButton=document.querySelector(`[data-task-run="${CSS.escape(taskId)}"]`);if(runButton){runButton.disabled=true;runButton.textContent='Running…';}
    const pauseButton=document.createElement('button');pauseButton.type='button';pauseButton.className='btn small';pauseButton.textContent='Pause';pauseButton.title='Pause after the current model or tool step';pauseButton.addEventListener('click',()=>{if(runControl.paused){runControl.resume();pauseButton.textContent='Pause';toast('Team run resumed.');}else{runControl.pause();pauseButton.textContent='Resume';toast('Team will pause after the current step.');}});
    const stopButton=document.createElement('button');stopButton.type='button';stopButton.className='btn small danger';stopButton.textContent='Stop';stopButton.setAttribute('aria-label','Stop this team run');stopButton.addEventListener('click',()=>{runControl.userStopped=true;controller.abort();});runButton?.parentElement?.append(pauseButton,stopButton);activeRuns.set(taskId,runControl);
    const activity=async event=>{
      const label=event.type==='agent-message'?`Messaged ${event.to}`:event.type==='tool-start'?`Started ${event.tool}`:event.type==='file-read'?`Read ${event.path}`:event.type==='file-written'?`Wrote ${event.path}`:event.type==='file-lock-waiting'?`Waiting for ${event.mode} lock on ${event.path}`:event.type==='file-lock-acquired'?`Locked ${event.path} for ${event.mode}`:event.type==='file-lock-released'?`Released ${event.path}`:event.type==='memory-proposed'?`Proposed project memory: ${event.title}`:`Finished ${event.tool}`;
      await window.localAI.work.sendMessage({from:event.agentId,to:'team',taskId,body:`${label}${event.args?.path?`: ${event.args.path}`:''}${event.path&&!event.args?.path?`: ${event.path}`:''}${event.result?` — ${event.result}`:''}`}).catch(()=>{});
      await refresh();
    };
    try{
      await window.localAI.work.updateTask(taskId,{status:'planning',note:'Planner is preparing an implementation plan.'});await refresh();
      const plannerOutput=await window.localAIWorkRunner.runAgent({agent:planner,prompt:`Create an implementation plan and divide it into independent workstreams for these team members: ${developers.map(agent=>`${agent.id} (${agent.name})`).join(', ')}. The task was assigned to ${taskAssignee?.name||'the Planner'}. In hybrid mode, treat that person as the primary owner and delegate only independent supporting work; in planner-led mode, choose the best distribution while keeping the assigned owner responsible for the outcome. Inspect the workspace first if needed. Do not edit files during planning. Return ONLY valid JSON with this shape: {\"summary\":\"...\",\"workstreams\":[{\"agentId\":\"developer-1\",\"objective\":\"...\",\"files\":[\"relative/path\"]}],\"risks\":[\"...\"],\"verification\":[\"...\"]}. Give each developer a distinct objective and avoid assigning the same file to multiple developers.\n\nTASK: ${task.title}\nINSTRUCTIONS: ${task.description}${memoryContext}`,signal:controller.signal,onActivity:activity,taskId,...agentBudget});
      const planData=parsePlannerPlan(plannerOutput,developers.map(agent=>agent.id));
      if(planData&&taskAssignee&&developers.some(agent=>agent.id===taskAssignee.id)&&!planData.workstreams.some(item=>item.agentId===taskAssignee.id))planData.workstreams.unshift({agentId:taskAssignee.id,objective:`Primary ownership: deliver the assigned task outcome and coordinate any supporting workstreams.`,files:[]});
      const plan=planData?JSON.stringify(planData,null,2):plannerOutput;
      await window.localAI.work.sendMessage({from:planner.id,to:'team',taskId,body:`Implementation plan:\n${plan.slice(0,7000)}`});
      if((state.team.autonomy||'hybrid')==='user-approved'&&!window.confirm(`Approve the Planner's plan for “${task.title}” before implementation?\n\n${String(planData?.summary||plan).slice(0,1800)}`)){await window.localAI.work.updateTask(taskId,{status:'queued',note:'Plan was not approved; no developer work was started.'});toast('Plan not approved. The task remains queued.');await refresh();return;}
      await window.localAI.work.updateTask(taskId,{status:'in-progress',note:'Developers are implementing the approved task plan. Every file change requires your confirmation.'});await refresh();
      const concurrency=Math.max(1,Math.min(8,Number(state.team.maxConcurrent)||3));
      const queue=developers.slice();const results=[];
      async function worker(){while(queue.length&&!controller.signal.aborted){const agent=queue.shift();if(!agent)break;
        const workstream=planData?.workstreams?.find(item=>item.agentId===agent.id);const fallbackObjective=developers.indexOf(agent)===0?'Own the primary implementation. Make the requested code changes and update the relevant source files.':'Own independent verification work: inspect the primary implementation, add or update focused tests and documentation, and do not duplicate the primary implementation changes.';const objective=String(workstream?.objective||fallbackObjective);const assignedFiles=Array.isArray(workstream?.files)?workstream.files.join(', '):'';
        const result=await window.localAIWorkRunner.runAgent({agent,prompt:`You are implementing your distinct workstream assigned by the Planner. This is an implementation task, not a proposal-only task. Inspect the actual project files, make the required changes using workspace tools, and run or describe relevant checks. Do not modify files outside your workstream. The write tool will request an exclusive file lock and ask the user to approve each change. If approval is declined or a lock is unavailable, explain that accurately and continue only with safe work.\n\nYOUR WORKSTREAM: ${objective}\nASSIGNED FILES: ${assignedFiles||'Use the Planner plan to choose files appropriate to your workstream.'}\n\nTASK: ${task.title}\nINSTRUCTIONS: ${task.description}\n\nPLANNER PLAN:\n${plan}${memoryContext}\n\nUse send_agent_message to coordinate dependencies or ask another agent a question. When finished, report exactly which files were changed, which changes were approved, and what remains.`,signal:controller.signal,onActivity:activity,taskId,...agentBudget}).catch(error=>{controller.abort();throw error;});
        results.push({agent,result});
        await window.localAI.work.sendMessage({from:agent.id,to:reviewer?.id||'team',taskId,body:result.slice(0,7000)});
      }}
      const workerOutcomes=await Promise.allSettled(Array.from({length:Math.min(concurrency,developers.length)},()=>worker()));
      const workerFailure=workerOutcomes.find(outcome=>outcome.status==='rejected');
      if(workerFailure)throw workerFailure.reason;
      if(controller.signal.aborted)throw new Error('Team run stopped by user.');
      let review='';
      if(reviewer){review=await window.localAIWorkRunner.runAgent({agent:reviewer,prompt:`Review the actual workspace after the developer implementation. Read the changed files and assess correctness, consistency with the plan, likely regressions, missing tests and acceptance criteria. Do not edit files. Clearly distinguish verified changes from claims in developer reports.\n\nTASK: ${task.title}\nPLAN:\n${plan}\n\nDEVELOPER REPORTS:\n${results.map(item=>`${item.agent.name}:\n${item.result}`).join('\n\n')}${memoryContext}`,signal:controller.signal,onActivity:activity,taskId,...agentBudget});await window.localAI.work.sendMessage({from:reviewer.id,to:'team',taskId,body:`Review:\n${review.slice(0,7000)}`});}
      const summary=`Implementation pass completed. ${results.length} developer workstream(s) ran. ${reviewer?'Reviewer completed a read-only review.':'No Reviewer is enabled; review remains outstanding.'} Inspect the approved file changes and reviewer notes before marking this task complete.`;
      await window.localAI.work.updateTask(taskId,{status:'review',note:summary});
      toast('Implementation pass completed. Review the approved file changes and reviewer report.');
    }catch(error){const cancelled=runControl.userStopped===true;await window.localAI.work.updateTask(taskId,{status:cancelled?'cancelled':'failed',note:(cancelled?'Stopped by user.':error.message).slice(0,1000)}).catch(()=>{});toast(cancelled?'Team run stopped.':`Team run failed: ${error.message}`);}
    finally{activeRuns.delete(taskId);pauseButton.remove();stopButton.remove();if(runButton){runButton.disabled=false;runButton.textContent='Run team';}}
    await refresh();
  }
  async function messageTask(taskId){
    const task=state.tasks.find(item=>item.id===taskId);if(!task)return;
    const body=prompt(`Message for ${agentName(task.assignedTo)} about “${task.title}”`);if(!body?.trim())return;
    try{await window.localAI.work.sendMessage({from:'planner',to:task.assignedTo,taskId,body});await refresh();}catch(error){toast(error.message);}
  }
  function bind(){
    byId('saveWorkTeam')?.addEventListener('click',saveTeam);
    byId('customizeWorkLayout')?.addEventListener('click',()=>{const hidden=new Set(state?.layout?.hidden||[]);document.querySelectorAll('#workLayoutForm input[name=panel]').forEach(input=>input.checked=!hidden.has(input.value));byId('workLayoutDialog').showModal();});
    byId('workLayoutForm')?.addEventListener('submit',async event=>{event.preventDefault();const hidden=[...document.querySelectorAll('#workLayoutForm input[name=panel]:not(:checked)')].map(input=>input.value);try{await window.localAI.work.setLayout({panels:['team','inspector','graph','tasks','timeline','memory','editor','browser'],hidden});byId('workLayoutDialog').close();await refresh();}catch(error){toast(error.message);}});
    document.querySelectorAll('[data-layout-close]').forEach(button=>button.addEventListener('click',()=>byId('workLayoutDialog').close()));byId('saveWorkTemplate')?.addEventListener('click',async()=>{await saveTeam();const name=prompt('Name this saved team',state.team.name);if(!name?.trim())return;await window.localAI.work.saveTemplate(name);await refresh();toast('Team template saved.');});byId('loadWorkTemplate')?.addEventListener('change',async event=>{if(!event.target.value)return;try{await window.localAI.work.loadTemplate(event.target.value);await refresh();toast('Saved team loaded.');}catch(error){toast(error.message);}});byId('addWorkAgent')?.addEventListener('click',addAgent);byId('newWorkTask')?.addEventListener('click',openTaskDialog);byId('addWorkMemory')?.addEventListener('click',addMemory);
    byId('workTaskForm')?.addEventListener('submit',async event=>{event.preventDefault();try{await window.localAI.work.createTask({title:byId('workTaskTitle').value,description:byId('workTaskDescription').value,assignedTo:byId('workTaskAgent').value,priority:byId('workTaskPriority').value});byId('workTaskDialog').close();await refresh();}catch(error){toast(error.message);}});
    document.querySelectorAll('[data-work-close]').forEach(button=>button.addEventListener('click',()=>byId('workTaskDialog').close()));
    byId('workAgentList')?.addEventListener('click',event=>{const card=event.target.closest('[data-agent-select]');if(card){selectedAgent=card.dataset.agentSelect;renderAgents();renderGraph();}});
    byId('workGraph')?.addEventListener('click',event=>{const messageEdge=event.target.closest('[data-message-id]');if(messageEdge){showMessage(messageEdge.dataset.messageId);return;}const node=event.target.closest('[data-agent-node]');if(node){selectedAgent=node.dataset.agentNode;renderAgents();renderGraph();}});
    byId('workMessageList')?.addEventListener('click',event=>{const message=event.target.closest('[data-message-id]');if(message)showMessage(message.dataset.messageId);});
    document.querySelectorAll('[data-message-close]').forEach(button=>button.addEventListener('click',()=>byId('workMessageDialog').close()));
    byId('workTaskList')?.addEventListener('change',async event=>{const select=event.target.closest('[data-task-status]');if(select){try{await window.localAI.work.updateTask(select.dataset.taskStatus,{status:select.value});await refresh();}catch(error){toast(error.message);}}});
    byId('workTaskList')?.addEventListener('click',event=>{const run=event.target.closest('[data-task-run]');if(run){runTeamTask(run.dataset.taskRun);return;}const button=event.target.closest('[data-task-message]');if(button)messageTask(button.dataset.taskMessage);});
    byId('workMemoryList')?.addEventListener('click',async event=>{const approve=event.target.closest('[data-memory-approve]');if(approve){try{await window.localAI.work.approveMemory(approve.dataset.memoryApprove);await refresh();toast('Project memory proposal approved.');}catch(error){toast(error.message);}return;}const button=event.target.closest('[data-memory-remove]');if(button&&confirm('Remove or reject this project memory entry?')){await window.localAI.work.removeMemory(button.dataset.memoryRemove);await refresh();}});
    byId('workAutonomy')?.addEventListener('change',saveTeam);byId('workConcurrency')?.addEventListener('change',saveTeam);byId('workMaxSteps')?.addEventListener('change',saveTeam);byId('workAgentTimeout')?.addEventListener('change',saveTeam);byId('workMaxTokens')?.addEventListener('change',saveTeam);
    const layout=byId('workLayout');let draggedPanel=null;document.querySelectorAll('[data-work-panel] > header').forEach(header=>{const panel=header.closest('[data-work-panel]');header.draggable=true;header.title='Drag this header to rearrange panels';header.addEventListener('dragstart',event=>{draggedPanel=panel;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',panel.dataset.workPanel);});header.addEventListener('dragover',event=>{if(draggedPanel&&draggedPanel!==panel)event.preventDefault();});header.addEventListener('drop',async event=>{event.preventDefault();if(!draggedPanel||draggedPanel===panel)return;const panels=[...layout.querySelectorAll('[data-work-panel]')].map(item=>item.dataset.workPanel);const from=panels.indexOf(draggedPanel.dataset.workPanel),to=panels.indexOf(panel.dataset.workPanel);panels.splice(from,1);panels.splice(to,0,draggedPanel.dataset.workPanel);draggedPanel=null;try{await window.localAI.work.setLayout({panels,hidden:state.layout.hidden,widths:state.layout.widths});await refresh();}catch(error){toast(error.message);}});header.addEventListener('dragend',()=>{draggedPanel=null;});});
    document.querySelectorAll('[data-work-panel]').forEach(panel=>panel.addEventListener('pointerup',async()=>{const width=Math.round(panel.getBoundingClientRect().width);if(width<220||Math.abs(width-(state?.layout?.widths?.[panel.dataset.workPanel]||0))<12)return;const widths={...(state?.layout?.widths||{}),[panel.dataset.workPanel]:width};try{state.layout=await window.localAI.work.setLayout({panels:state.layout.panels,hidden:state.layout.hidden,widths});}catch(error){toast(`Could not save panel size: ${error.message}`);}}));
    window.addEventListener('work-manager:show',refresh);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
