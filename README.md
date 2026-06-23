# ☁️ CloudAgent

> **Your local AI agent for Google Workspace.**
> Control Gmail, Drive, Calendar, Docs, and Git repos with natural language directly from your terminal.

---

## 🚀 Overview

**CloudAgent** is a local-first, privacy-focused terminal application that runs entirely on your own machine. It translates natural language requests into structured tool calls and executes them safely using command-line tools already installed on your system.

To protect your system, CloudAgent:
1. Maps AI intents to structured tool definitions (no raw LLM-generated shell commands are run).
2. Follows a **multi-tiered permission system** (`safe`, `confirm`, `high` risk actions).
3. Requires user confirmation (`Approve? [Y/n]`) for state-changing operations.

---

## ✨ Features

- **🔒 Local-First & Privacy-Focused**: All credentials and data remain strictly local.
- **🛡️ Sandbox Mapping & Multi-Tier Approvals**: 
  - **SAFE** (e.g. `drive_search`, `git_status`): Direct execution.
  - **CONFIRM** (e.g. `calendar_create`, `gmail_send`): Standard user confirmation prompt.
  - **HIGH RISK** (e.g. `git_push`, `file_delete`): Prompts with highlighted warning.
- **📂 Session Memory**: Keeps context (current repo, active directory, recent chats/files) under `~/.cloudagent/sessions/` and local SQLite storage.
- **🔌 Provider Abstraction**: Switch between multiple model providers based on your available API keys:
  - **OpenRouter** (Kimi K2, etc.)
  - **OpenAI** (GPT-4o, etc.)
  - **Gemini** (Gemini 1.5 Pro/Flash, etc.)
  - **Anthropic** (Claude 3.5 Sonnet, etc.)
- **☁️ Google Workspace Integration**: Controlled via the official [Google Workspace CLI (gws)](https://github.com/googleworkspace/cli).
- **🩺 Diagnostics Suite**: Run checks using `cloudagent doctor` to troubleshoot your environment immediately.

---

## 🛠️ Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Database**: SQLite (`better-sqlite3`)
- **Dependencies**: User-managed local CLI configurations (`gws auth login`, `gh auth login`).

---

## 📁 Project Structure

```text
cloudagent/
├── src/
│   ├── cli.js                  # CLI interactive loop entrypoint
│   ├── doctor.js               # Diagnostics CLI output runner
│   ├── tool-registry.js        # Dynamic tool registry loader & orchestrator
│   ├── db.js                   # better-sqlite3 interaction helper
│   ├── config.js               # config.json load/save helper
│   ├── providers/              # Abstracted AI Model provider interfaces
│   │   ├── provider.js         # Base abstract class
│   │   ├── openrouter.js       # OpenRouter implementation
│   │   ├── openai.js           # OpenAI implementation
│   │   ├── gemini.js           # Gemini implementation
│   │   ├── anthropic.js        # Anthropic implementation
│   │   └── models.js           # Model config configurations
│   ├── tools/                  # Structured tool definitions (No terminal.js in MVP)
│   │   ├── gmail.js
│   │   ├── drive.js
│   │   ├── calendar.js
│   │   ├── git.js
│   │   └── filesystem.js
│   └── mcp/                    # Future MCP servers integration placeholder
├── package.json
└── README.md
```

---

## ⚙️ Getting Started

### Prerequisites

1. **Node.js**: Ensure you have Node.js installed (v18+).
2. **Google Workspace CLI (`gws`)**: Install `gws` and authenticate:
   ```bash
   gws auth login
   ```
3. **Git & GitHub CLI (`gh`)**: Ensure `git` and `gh` are installed and authenticated.

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```
2. Link the package globally:
   ```bash
   npm link
   ```
3. Verify your environment setup:
   ```bash
   cloudagent doctor
   ```
4. Start the agent:
   ```bash
   cloudagent
   ```
