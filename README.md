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
- Google Workspace CLI (`gws`): CloudAgent will automatically guide you through its installation if it's missing on your first run.

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
