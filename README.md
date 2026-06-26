# CloudAgent

CloudAgent is a privacy-focused, local-first AI assistant for Google Workspace (Gmail, Drive, Calendar) and your local development environment. Built entirely in Node.js, it translates natural language instructions into secure, local tool executions.

> [!IMPORTANT]  
> **GWS Appreciation & Dependency:**  
> CloudAgent relies entirely on the fantastic **Google Workspace CLI (`gws`)** tool for executing all Google service integrations (Gmail, Calendar, Drive). Huge appreciation to the `gws` project for enabling secure, command-line-driven workspace control.  
> **Without `gws` installed and authenticated, CloudAgent functions only as an AI frontend for local terminal/filesystem operations and LLM queries.**

---

## Key Features

- **Local-First & Secure**: Translates user prompts into local API/system commands via a secure JSON structure, avoiding raw terminal execution risks.
- **Google Workspace Integration**: Connects seamlessly with Gmail, Drive, and Calendar via Google's `gws` command-line utility.
- **Clean & Concise Terminal Experience**: Automatically suppresses intermediate thought processes, raw tables, and verbose loading logs. Only the final formatted results are presented.
- **Dynamic Status Spinner**: Provides a persistent, live loading indicator that updates with the active operation (e.g. `Running gws (Gmail)...`), keeping the console alive without clutter.
- **Session Resumption**: Prompts you to resume your previous chat history on startup, ensuring you never lose your context.
- **Multi-Model Fallbacks**: Automatically falls back through multiple free/paid LLM endpoints (via OpenRouter, OpenAI, Gemini, or Anthropic) if the active model encounters rate limits or service unavailability.
- **15-Second Request Timeouts**: Restricts model calls to a maximum duration of 15 seconds. If a request hangs, it aborts instantly and switches to the next fallback model.
- **Slash Commands**:
  - `/send <recipient> "<subject>" "<body>"`: Direct email command bypasses LLM parsing for fast delivery.
  - `/doctor`: Triggers doctor diagnostics to verify your node, git, and workspace credentials.
  - `/exit`: Exits the shell loop.

---

## Getting Started & Setup

### Prerequisites
- Node.js (v18+)
- SQLite3
- [Google Workspace CLI (gws)](https://github.com/googleworkspace/cli) (required for all Google integrations)

### Installation
Clone this repository locally, link it globally, and install dependencies:
```bash
git clone https://github.com/adil-rahman-3063/cloudagent.git
cd cloudagent
npm install
npm link
```

### Configuration
1. **API Keys**: Configure your active LLM provider and API keys:
   ```bash
   cloudagent config
   ```
2. **Google Authentication**: Authenticate the Google Workspace CLI tool:
   ```bash
   gws auth login
   ```
3. **Health Check**: Run diagnostics to verify all paths are ready:
   ```bash
   cloudagent doctor
   ```

### Usage
Start the interactive chat loop:
```bash
cloudagent
```

---

## Production Readiness

CloudAgent is ready for production environments:
- **Strict Role Alternation**: Sanitizes conversation history before dispatching calls to provider endpoints, avoiding `400 Bad Request` schema validation errors.
- **Robust Parameter Handling**: Intercepts model formatting errors (like returning parameters at the root level or using text/reply placeholder tools) and automatically normalizes them.
- **Timeout & Retries**: All API fetch calls are signal-aborted after 15 seconds to ensure zero hangs.
- **Local SQLite DB WAL Mode**: Chat session histories and tool execution logs are stored locally under `~/.cloudagent/history.db` using WAL mode for concurrent, fast database transactions.

---

## Integration Test Status

This checklist tracks the testing status of all CloudAgent capabilities:

- [x] **Email Integration (Gmail)**
  - [x] Send email with recipient, subject, and body (direct command & AI draft).
  - [x] Parameter validation (preventing empty subject/body executions).
  - [x] Multiline body formatting (escaped newlines parsed correctly on Windows without truncation).
  - [x] Apostrophe command parsing (e.g., words like `you're` and `I'm` inside double-quoted parameters).
  - [ ] List unread inbox summaries.
  - [ ] Read specific email threads by ID.

- [x] **Google Tasks**
  - [x] List tasks from the default or specific list (formatted in boxed tables).
  - [x] Create tasks with titles, notes, and due dates.
  - [x] Dynamic tool name normalization (`google_tasks_list` -> `tasks_list`).
  - [ ] Update and complete tasks (`tasks_update`).

- [x] **Google Calendar**
  - [x] List agenda and upcoming schedule events.
  - [x] Create calendar events with summaries, times, and Meet links.

- [ ] **Google Drive**
  - [ ] Search files and directories by query parameters.
  - [ ] Download files to local directories.
  - [ ] Upload local files to Drive.

- [x] **System Diagnostics & Configurations**
  - [x] doctor check (Node, Internet, API keys, gws installation, git, sqlite status).
  - [x] Onboarding missing dependencies checking.
  - [x] SQLite database schema initialization and chat session logging.

- [ ] **Local Filesystem**
  - [x] Workspace access approval check on startup.
  - [x] Restricted mode handling (when workspace permission is denied).
  - [x] Change directory and navigate folders (`file_cd`).
  - [x] List files in current directory.
  - [ ] Read local file contents.
  - [ ] Create/Write to local files.
  - [ ] Delete local files.

- [x] **Git & GitHub**
  - [x] Local git repository initialization.
  - [x] Committing code changes.
  - [x] Remote origin linking.
  - [x] Pushing commits to GitHub.
  - [x] Git commands (e.g. `git_status`, `git_pull`) triggered via natural language prompts.

- [ ] **Future Roadmap (Additional gws Services)**
  - [ ] **Google Sheets**: Read, write, and append spreadsheet tables.
  - [ ] **Google Keep**: Manage and sync Keep notes.
  - [ ] **Google Docs**: Read and write Google Document files.
  - [ ] **Google People**: Retrieve and search contacts.

