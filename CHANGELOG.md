# Changelog

## 1.4.0 — Game-speed browser and auto-approve

- Added **Auto-approve browser actions** (Inspector → Tools). When on, the assistant does not ask before submitting forms, clicking risky buttons, running page scripts or visiting new public sites. Turning it on shows a warning first. Passwords, payment and one-time-code fields are still never filled, and addresses on your own network still ask.
- New fast tools for games and quick pages: `browser_keys` (timed key sequences with held keys, real input), `browser_mouse` (move, click, double, drag, wheel at page coordinates), `browser_look` (small fast screenshots, up to 4 frames to show motion, optional zoom region) and `browser_reflex`.
- `browser_reflex` runs a small script inside the page every animation frame, so reactions take milliseconds instead of a model round trip. The script can press keys, click, and read canvas pixels; it runs in the background with status, stop and a time limit, and is stopped by the Stop button or when the task ends.
- The agent guide now teaches the look → act in bursts → write a reflex workflow.
- Maximum agent steps can now be set up to 300.
- Fixed a rare race where typing into a field could append to the old text instead of replacing it.
- Tests: 14 unit tests and 57 Electron browser checks, including key timing, mouse coordinates, frame capture, reflex pixel reading, interrupt and auto-approve.

## 1.3.0 — Integrated browser and Cowork-style agent

- Added an integrated browser (Electron WebContentsView in an isolated `persist:agent-browser` session with no preload). Use it full size from the new Browser page or docked beside the chat.
- Added 15 `browser_*` agent tools: navigate, get_dom, click, type, select, press_key, scroll, get_text, screenshot, execute_js, new_tab, close_tab, switch_tab, list_tabs and wait. Pages are read as numbered interactive elements (Set-of-Marks) that are also drawn on the page, with a visible agent cursor and glow border. Clicks and keys use real input events.
- Screenshots go to the chat model when it supports images, or to a separate vision model chosen in Inspector → Tools. Canvas-only pages fall back to a screenshot automatically.
- Added a Cowork-style plan: the agent writes a visible checklist (`update_plan`, `complete_step`) above the composer. You can pause, resume, stop, edit steps and add steps while it works.
- Safety: web content is wrapped as untrusted data; passwords, payment and one-time-code fields are never filled by the agent; form submits, Enter in forms, risky clicks and JavaScript execution need approval; private-network addresses always need approval; new sites ask first while the agent is active (optional); permissions and downloads are denied; file:// and javascript: URLs are blocked. "Clear browser data" is in Tools.
- Agent step limit is now configurable (default 25, was 12) and a time limit counts only active, unpaused time.
- Added unit tests for URL policy, click-risk and sensitive-field rules, plus `npm run smoke`, an Electron end-to-end browser test (27 checks).
- New interface text for these features is English only for now.

## 1.2.4 — Sidebar navigation fix

- Fixed the bottom sidebar navigation group so Connections, Memory, Insights, Help & guides, and Settings respond to clicks just like Chats, Projects, Models and Tasks.
- Moved sidebar navigation event delegation to the shared sidebar container, covering both navigation groups.
- Synchronized selected-button styling and six-language navigation labels across every sidebar item.
- Added a regression test covering the split navigation markup, shared click handler and active-state updates.
- Verified the complete automated suite: 81 tests passed.

## 1.2.3 — Consolidated interface, localization, accessibility and service hardening

- Unified the Projects, Models, Tasks and Settings screens with a consistent responsive design system and improved keyboard focus states.
- Expanded dynamic interface localization across English, Spanish, French, German, Japanese and Chinese. Language changes refresh the currently active view.
- Rebuilt conversation-list semantics around list items and separate open/options/delete buttons; localized conversation actions and empty states.
- Separated assistant status announcements from the streaming transcript and added accessible responding/completed/stopped/error messages.
- Improved Settings tab roles, selected state, panel relationships and arrow/Home/End keyboard navigation; labeled search and file-selection controls and synchronized disclosure states.
- Added MCP schema sanitization and argument validation, fail-closed handling of unsupported schema features, bounded JSON values, prototype-key rejection and credential masking in approval previews.
- Added atomic file persistence for credentials, MCP configuration, workspace data, workspace edits and backup-index/restore operations, with private default permissions.
- Hardened model-server and MCP configuration validation and bounded file/response handling.
- Added optional, resource-bounded OCR for scanned PDFs using Poppler and Tesseract when installed. Rendering and OCR are capped by page count, resolution, image size, text output and execution time; missing OCR tools do not block ordinary selectable-text PDF extraction.
- Kept model downloading excluded. Existing app features and user-data identity are retained.
- Added tests for atomic persistence, MCP schema/argument safeguards, OCR output/time limits and scanned-image text extraction when dependencies are available. The complete suite currently passes 80 tests.

## 1.2.2 — Screen design refinement

- Refined Projects, Models, Tasks and Settings into a consistent visual system.
- Improved project cards, document rows, model inventory cards, capability selection controls and model metric panels.
- Improved task filters, task cards, status badges, task actions and reusable workflow surfaces.
- Reworked Settings into a responsive category rail with grouped preference surfaces, more legible controls and improved touch targets.
- Preserved existing application workflows, data formats, security boundaries and the three-file renderer structure.
- Model downloading remains intentionally excluded.
- Added four screen-design contract tests.

## 1.2.1

See the 1.2.1 section in `README.md` for the previous release notes.

## 1.5.0 — Multi-agent Work Manager foundation

- Added a dedicated Work Manager workspace and moved the primary code editor into Work.
- Added a configurable default four-agent team, agent inspector, task board, communication feed and team-run pipeline.
- Added project-scoped shared memory, saved team templates and task/message persistence.
- Added a central file-lock manager with shared read locks, exclusive write locks, queueing and lease recovery.
- Added tests for Work Manager persistence, team templates, lock contention and path validation.
- Desktop Electron testing remains required before calling this release fully verified.

## 1.5.1 — Work Manager implementation pass

- Added bounded, tool-using agent execution for workspace listing, source-file reading/searching and file updates.
- Added explicit read/write locks around agent file reads and writes; writes require the existing file-write setting, a native per-change approval, an exclusive lock, a version fingerprint check and the workspace backup/atomic-write service.
- Changed developer runs from proposal-only output to actual approved workspace edits, with Planner-generated workstreams, configurable concurrency and a read-only Reviewer pass.
- Added agent-to-agent/team messaging tools and task-scoped message retrieval.
- Added pending shared-memory proposals from agents, with user approval or rejection.
- Added file-operation activity, draggable/reorderable Work Manager panels, CSS panel resizing and clickable communication graph edges that open message details.
- Added regression tests for approval-time file version fingerprints and pending-memory approval.

- Added task-scoped agent-to-agent messaging and message retrieval, including animated graph edges with message inspection.
- Added cancellable queued file-lock requests and waiting-agent polling so a queued agent can acquire its promoted lock rather than abandoning it.
- Added numbered immutable team-template versions and persisted panel ordering and resized widths.
- Added README instructions for configuring and running Work Manager tasks.

- Enforced the approved-file-write setting in the Electron main process as well as the renderer before an agent write can be approved.
