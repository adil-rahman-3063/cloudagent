# Project Memory - CloudAgent CLI

This document outlines key technical decisions, implementations, and setup details for **CloudAgent** to ensure seamless continuation in future development sessions.

---

## 🛠️ Tech Stack & Key Implementations

1. **Framework & Language**: 
   - Node.js (v18+) using ES Modules (`"type": "module"`).
   - Executable entry point: `src/cli.js` (aliased globally to `cloudagent`).

2. **Persistence**:
   - Configuration is stored locally in JSON format at `~/.cloudagent/config.json`.
   - SQLite Database is initialized at `~/.cloudagent/history.db` utilizing `better-sqlite3` in WAL mode for lightning-fast concurrent transactions (logs history & executed tools).

3. **Workspace Onboarding & Diagnostics (`/doctor`)**:
   - `src/doctor.js` runs environmental health checks.
   - If Google Workspace CLI (`gws`) is missing, it triggers an interactive npm onboarding pipeline to install `@googleworkspace/cli` globally and points to authentication instructions.

4. **Multi-Model Fallbacks & Robust APIs**:
   - Standardized provider wrappers reside in `src/providers/` (`gemini.js`, `openai.js`, `anthropic.js`, `openrouter.js`).
   - All external fetch requests utilize an `AbortController` set to abort after a strict **30-second timeout**.
   - Sticky fallback tracking: successful model outcomes are saved back to `config.json` as the new active provider.
   - Chat context sanitization runs prior to request dispatch to ensure strict `user` and `assistant` role alternation (preventing `400 Bad Request` schema validation failures).
   - **Context retention**: Proposed tool call payloads (arguments, thoughts, tool name) are explicitly saved in the message history before tool execution, ensuring follow-up prompts do not cause the model to lose context of drafts (e.g., subject and email body drafts).
   - **API parameter validation**: Programmatically intercepts and blocks `gmail_send` tool calls if `subject` or `body` are empty/only whitespace, converting them back into user-friendly text responses prompting for the missing inputs.
   - **Dynamic Time Context**: Automatically injects a system context message containing the host system's actual date and time (`new Date()`) at the start of the chat history before every LLM request. This ensures the model does not rely on static example dates (like June 25) or training cutoffs to evaluate relative terms like "today" or "tomorrow".

5. **Restricted System Tools**:
   - Local tools are configured under `src/tools/` using `execFileSync` to avoid unsafe raw terminal command injections:
     - `calendar.js`: `calendar_list`, `calendar_create`
     - `drive.js`: `drive_search`, `drive_download`
     - `gmail.js`: `gmail_list`, `gmail_send`
     - `tasks.js`: `tasks_list`, `tasks_create`
     - `git.js`: `git_status`, `git_pull`, `git_commit`, `git_push`, `github_repo_create`
     - `filesystem.js`: `file_list`, `file_read`, `file_write`, `file_delete`, `file_cd`, `file_find_projects`

6. **Terminal UI Experience**:
   - Clean, lightweight console outputs. Suppresses thoughts and raw intermediate tables.
   - Live loading status spinner indicating specific active API actions (e.g. `Running gws (Gmail)...`, `Running gws (Tasks)...`).
   - Context resumption: prompts the user on startup to load their prior active chat session.
   - Built-in capabilities menu: triggers on `/help`, `help`, `what can i do`, or `what can you do` to output a clean, formatted overview of supported integrations.
   - **Interactive Email Dispatcher**: Intercepts `/send` (without arguments) or conversational email requests to prompt the user to choose between "Manual" (prompting details one-by-one) or "AI" (drafting based on a described topic).
   - **Robust Command Parsing**: Utilizes `parseCommandArgs` in the CLI rather than a naive regex split, ensuring single-quote apostrophes (e.g. `you're`, `there's`) inside double-quoted string parameters do not cause argument truncation.
   - **Windows Direct Execution**: Avoids `cmd.exe /c` wrapping for `gws` on Windows by dynamically locating the absolute path of the global `@googleworkspace/cli/run.js` module and invoking it directly with `node`. This prevents `cmd.exe` from truncating multiline strings (like emails with newlines) at the first newline character.

7. **Flutter Client (Desktop App)**:
   - Resides under `cloudagent_flutter/` and targets Windows desktop environments.
   - Connects to the local server via a local WebSocket channel (`ws://127.0.0.1:3020`).
   - **Dynamic Path Resolution**: Utilizes `kReleaseMode`. In development, it spawns `node` pointing to the parent folder's server scripts. In production, it targets a bundled `backend/` folder alongside the executable (`Platform.resolvedExecutable`), allowing complete self-contained deployment inside a single release zip.
   - **Smooth Transition Animations**: Integrates `AnimatedSwitcher` to transition with a slide-and-fade animation from the dashboard view to the chat workspace view as soon as the user starts typing or clicks a shortcut suggestion.
   - **In-Widget Loading States**: Keeps the dashboard layout visible by embedding local progress indicators inside individual dashboard widgets during fetches instead of showing a blocking loading overlay.

---

## 🚀 Git Remote Setup
- **Branch**: `main`
- **Origin**: `https://github.com/adil-rahman-3063/cloudagent.git`
- **Dependency Disclaimer**: Google features are entirely powered by the [Google Workspace CLI (gws)](https://github.com/googleworkspace/cli). Without this, the program behaves strictly as a local AI agent frontend.
