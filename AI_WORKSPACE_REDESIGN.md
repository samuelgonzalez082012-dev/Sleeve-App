# AI workspace redesign

This branch adds an optional integrated AI workspace and Planner-controlled team execution. The existing standalone Chat, Browser, Editor and other app sections remain available without entering the integrated workspace. Select **AI Workspace** in the sidebar to enter it; choose a normal section or **Exit workspace** to return to standalone mode.

## Workspace

- The integrated workspace is opt-in and does not replace the app's normal navigation.
- A unified tab strip inside AI Workspace exposes Chat, AI Team, Code Editor, Browser, Projects, Models, Tasks, Files, Activity, Connections, Memory, Insights, Settings and Help.
- Standalone Chat, Browser, Editor and other existing sections remain directly accessible from the sidebar. Selecting one while in AI Workspace exits the integrated mode and restores the native view.
- Existing Chat, Editor and Browser views are mounted inside the workspace rather than replaced with mock screens.
- Dragging a tab into a panel creates a second tab group. Each group has its own tab strip; the split can be horizontal or vertical and the divider is resizable.
- Layout state is saved per selected workspace folder.
- Files has a navigable project-folder explorer and read-only file preview.

## Agent Control Center

- The graph, Agent Inspector and team conversation live in one Work surface.
- The default roles are Planner, Developer 1, Developer 2 and Reviewer. Agent names and role instructions are editable.
- Each role has an independent provider and model assignment. OpenRouter model discovery uses the encrypted OpenRouter key; Ollama model discovery and inference are restricted to loopback.
- OpenRouter credentials are encrypted with Electron safeStorage. The key is not placed in renderer storage.
- Planner alone creates and routes tasks. A user can address the team or request a specific agent; requests are routed through Planner.
- Developers receive workspace context and prior agent reports. Reports are shared with subsequent agents and Reviewer, so agents can coordinate through the Planner-controlled run.
- Reviewer inspects proposed changes and records a concise decision summary. The UI shows activity and summaries, not private chain-of-thought.
- Runs support pause between agent steps, stop/interrupt, and stop-and-redirect.
- Team templates can be saved and loaded.

## Files and safety

- Agents do not write directly to the project. They return proposed file contents.
- The user must approve each create/write action through the existing preview/confirmation flow.
- Writes are serialized with per-file locks. Existing files are backed up before replacement.
- Approved modifications add a bounded line-diff summary to the activity timeline.
- Agent activity is stored locally, bounded to the latest 5,000 events, scoped by project, and recent project activity is supplied to Planner as project context.

## Validation

Automated checks run on each push to this branch:
- JavaScript syntax checks for the Electron main/preload, workspace and agent services.
- npm test, including agent orchestration, provider isolation, team-template persistence, event persistence and project filtering.

Both headless Electron smoke suites pass in CI: 15/15 workspace checks (including standalone Chat/Browser availability before entry and restoration after exit) and 57/57 browser-service checks. The full packaged application has not yet been interactively exercised on the target desktop. The remaining release gate is to launch the app on the target desktop, connect OpenRouter and/or Ollama, verify the real Chat/Editor/Browser view adapters, run a delegated task against a real workspace, approve a proposed file change, and verify pause/stop/redirect and layout persistence.

## Deliberate boundaries

- The current split manager supports independent tab groups in a resizable two-pane layout; it is not yet a recursive arbitrary-depth split tree.
- The shipped team has four built-in agent slots with editable names and role instructions. It does not yet support adding unlimited new agent identities.
- Agent-to-agent collaboration is mediated by Planner assignments and shared reports, not unrestricted peer-to-peer messaging.
- Ollama is intentionally loopback-only. Remote model servers are not accepted by the new Ollama path.
