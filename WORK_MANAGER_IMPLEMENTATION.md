# Work Manager implementation notes

## Source architecture retained

`main.js` remains the Electron main-process authority for trusted IPC and file writes. `preload.js` exposes a narrow context-isolated API. `renderer.js` reuses the configured Ollama, OpenAI-compatible or Anthropic transport and streaming parser. `editor-ui.js` mounts the existing editor inside Work. The existing browser, workspace, atomic-file, backup and tool-registry services remain in place.

## Work Manager features

- Project-scoped team configuration, saved team templates, task/message history, shared project memory and panel layout state.
- Default Planner, Developer 1, Developer 2 and Reviewer agents; custom agents and per-agent model-name overrides.
- Planner-generated independent workstreams, bounded concurrent developer execution, task-scoped agent messaging and a read-only Reviewer pass.
- Agents can list, read and search workspace source files. Developer agents with `write-proposal` permission can request file changes.
- File reads use shared read locks. File writes require the `allowFileWrites` setting, an exclusive write lock, a native approval dialog, a SHA-256 pre-approval file-version check, and the existing workspace backup/atomic-write implementation.
- Agents can propose shared project memory. Proposals remain pending until the user approves them; rejected proposals can be removed.
- Work Manager panels can be hidden, reordered by dragging their headers and resized using the native CSS resize affordance. Panel visibility/order and resized widths are persisted per project.
- Communication messages appear in the message list and as animated graph edges. Selecting an edge or message opens the full message detail.
- The existing editor and browser are embedded in Work; the standalone editor pop-out remains available as an optional window.

## Provider behavior

Each agent can override the model name while inheriting the currently configured application provider. Independent provider credentials and simultaneous per-agent provider routing are not implemented in this build; a non-inherited provider assignment is rejected explicitly rather than silently sent through the wrong connection. Ollama, OpenAI-compatible and Anthropic requests use the app's existing configured transport and credentials. Ollama models without native function calling use the app's bounded structured-tool fallback.

## Safety boundaries

- The renderer does not gain Node.js or direct filesystem access.
- Work Manager IPC calls are restricted to the trusted local renderer.
- Workspace paths are validated by the workspace service; lock paths reject absolute paths and traversal.
- Every agent file write requires the explicit file-write setting enforced in the main process and a native per-change confirmation.
- The main process revalidates lock ownership and the file's SHA-256 fingerprint after the approval dialog, preventing stale approvals from overwriting intervening edits.
- Existing files are backed up and writes remain atomic.
- Agent tool rounds, file sizes, file-read limits, message sizes, and concurrent agent counts are bounded.

## Validation status

- JavaScript syntax checks pass for changed runtime and service files.
- `npm test`: 50 tests pass.
- Electron startup, visual layout, native approval dialogs, editor embedding and browser interaction still require desktop Electron testing. `npm ci` did not finish in the current environment, so no Electron binary was available here.
